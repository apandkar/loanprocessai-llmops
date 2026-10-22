"""RAG retrieval + LLM call demo with LangSmith tracing.

Use this only for teaching/debugging. It sends the retrieved context and final
prompt to LangSmith so participants can see what text was given to the LLM.
Do not use this mode for sensitive customer data unless approved by policy.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_dotenv_if_present() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

    # LangSmith's newer env name is LANGSMITH_TRACING. Keep compatibility with
    # existing LANGCHAIN_TRACING_V2 settings in local .env files.
    if os.getenv("LANGCHAIN_TRACING_V2", "").lower() == "true":
        os.environ.setdefault("LANGSMITH_TRACING", "true")
    if os.getenv("LANGCHAIN_PROJECT"):
        os.environ.setdefault("LANGSMITH_PROJECT", os.getenv("LANGCHAIN_PROJECT", ""))
    if os.getenv("LANGCHAIN_ENDPOINT"):
        os.environ.setdefault("LANGSMITH_ENDPOINT", os.getenv("LANGCHAIN_ENDPOINT", ""))


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(2)
    return value


def require_langsmith():
    try:
        from langsmith import traceable
        from langsmith.wrappers import wrap_openai

        return traceable, wrap_openai
    except ImportError:
        print("Missing optional package: langsmith", file=sys.stderr)
        print("Install it with:", file=sys.stderr)
        print(r"  .\.venv\Scripts\python.exe -m pip install langsmith", file=sys.stderr)
        sys.exit(2)


def preview(text: str, limit: int = 500) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "..."


def optional_positive_int_env(name: str) -> int | None:
    value = os.getenv(name, "").strip()
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError:
        print(f"Ignoring {name}: expected a positive integer, got {value!r}", file=sys.stderr)
        return None
    if parsed <= 0:
        print(f"Ignoring {name}: expected a positive integer, got {value!r}", file=sys.stderr)
        return None
    return parsed


def build_functions(traceable):
    @traceable(name="azure_ai_search_retrieve_chunks", run_type="retriever")
    def search_documents(question: str, top: int, use_vector_text: bool) -> list[dict]:
        endpoint = require_env("AZURE_SEARCH_ENDPOINT").rstrip("/")
        index_name = require_env("AZURE_SEARCH_INDEX")
        api_key = require_env("AZURE_SEARCH_API_KEY")
        api_version = os.getenv("AZURE_SEARCH_API_VERSION", "2024-07-01")

        url = f"{endpoint}/indexes/{index_name}/docs/search?api-version={api_version}"
        body: dict = {
            "search": question,
            "top": top,
            "select": "chunk_id,parent_id,title,chunk",
        }
        if use_vector_text:
            body["vectorQueries"] = [
                {
                    "kind": "text",
                    "text": question,
                    "fields": "text_vector",
                    "k": top,
                }
            ]

        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "api-key": api_key},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
                return payload.get("value", [])
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            print(f"Azure AI Search returned HTTP {exc.code}", file=sys.stderr)
            print(details, file=sys.stderr)
            sys.exit(1)

    @traceable(name="assemble_grounded_rag_prompt", run_type="chain")
    def build_prompt(question: str, chunks: list[dict]) -> str:
        context_blocks = []
        for index, chunk in enumerate(chunks, start=1):
            title = chunk.get("title") or chunk.get("parent_id") or "unknown source"
            context_blocks.append(
                f"[Source {index}: {title}]\n{preview(chunk.get('chunk', ''), 1600)}"
            )

        context_text = "\n\n".join(context_blocks)
        return f"""Use only the retrieved context to answer the question.

If the answer is not present in the retrieved context, say that the indexed
documents do not contain enough evidence. Do not invent policy details.

Retrieved context:
{context_text}

Question:
{question}

Return a concise answer and mention the source document names used."""

    @traceable(name="azure_openai_grounded_answer", run_type="llm")
    def call_llm(prompt: str) -> str:
        from openai import AzureOpenAI
        from langsmith.wrappers import wrap_openai

        client = wrap_openai(
            AzureOpenAI(
                azure_endpoint=require_env("AZURE_OPENAI_ENDPOINT"),
                api_key=require_env("AZURE_OPENAI_API_KEY"),
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview"),
            )
        )
        request_args = {
            "model": require_env("AZURE_OPENAI_DEPLOYMENT"),
            "messages": [
                {
                    "role": "system",
                    "content": "You are LoanAssist. Answer with grounded evidence from the supplied context.",
                },
                {"role": "user", "content": prompt},
            ],
        }
        max_completion_tokens = optional_positive_int_env("RAG_MAX_COMPLETION_TOKENS")
        if max_completion_tokens:
            request_args["max_completion_tokens"] = max_completion_tokens

        response = client.chat.completions.create(**request_args)
        return response.choices[0].message.content or ""

    return search_documents, build_prompt, call_llm


def main() -> None:
    load_dotenv_if_present()
    traceable, _wrap_openai = require_langsmith()
    search_documents, build_prompt, call_llm = build_functions(traceable)

    parser = argparse.ArgumentParser(description="Trace RAG retrieval and LLM prompt in LangSmith.")
    parser.add_argument("question", nargs="?", default="What is the minimum DSCR guideline?")
    parser.add_argument("--top", type=int, default=int(os.getenv("RAG_TOP_K", "5")))
    parser.add_argument("--keyword-only", action="store_true")
    args = parser.parse_args()

    chunks = search_documents(args.question, args.top, not args.keyword_only)
    prompt = build_prompt(args.question, chunks)
    answer = call_llm(prompt)

    print(f"\nQuestion: {args.question}")
    print(f"Returned chunks: {len(chunks)}")
    print(f"Prompt characters sent to LLM: {len(prompt)}")
    configured_max_tokens = optional_positive_int_env("RAG_MAX_COMPLETION_TOKENS")
    print(f"Max completion tokens: {configured_max_tokens or 'provider default'}")
    print("\nRetrieved sources:")
    for index, chunk in enumerate(chunks, start=1):
        print(f"{index}. {chunk.get('title')} | {chunk.get('chunk_id')}")
    print("\nAnswer:")
    print(answer)
    print("\nOpen LangSmith project to inspect:")
    print("- azure_ai_search_retrieve_chunks")
    print("- assemble_grounded_rag_prompt")
    print("- azure_openai_grounded_answer")


if __name__ == "__main__":
    main()
