"""Quick Azure AI Search retrieval test for the RAG setup.

Run this before changing the FastAPI backend. It proves that the index can be
queried from code and that useful chunks come back from Azure AI Search.
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


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(2)
    return value


def search_documents(question: str, top: int, use_vector_text: bool, use_semantic: bool) -> dict:
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

    if use_semantic:
        body["queryType"] = "semantic"
        body["captions"] = "extractive"
        body["answers"] = "extractive|count-3"

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
        headers={
            "Content-Type": "application/json",
            "api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        print(f"Azure AI Search returned HTTP {exc.code}", file=sys.stderr)
        print(details, file=sys.stderr)
        sys.exit(1)


def preview(text: str, limit: int = 500) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "..."


def main() -> None:
    load_dotenv_if_present()

    parser = argparse.ArgumentParser(description="Test Azure AI Search RAG retrieval.")
    parser.add_argument("question", nargs="?", default="What is the minimum DSCR guideline?")
    parser.add_argument("--top", type=int, default=int(os.getenv("RAG_TOP_K", "5")))
    parser.add_argument(
        "--keyword-only",
        action="store_true",
        help="Use keyword/semantic search only. Useful if text vector queries are not enabled.",
    )
    parser.add_argument(
        "--semantic",
        action="store_true",
        help="Request semantic captions and answers. Requires semantic query support/configuration.",
    )
    args = parser.parse_args()

    result = search_documents(
        question=args.question,
        top=args.top,
        use_vector_text=not args.keyword_only,
        use_semantic=args.semantic,
    )

    print(f"\nQuestion: {args.question}")
    print(f"Returned chunks: {len(result.get('value', []))}\n")

    answers = result.get("@search.answers") or []
    if answers:
        print("Extractive answers:")
        for answer in answers:
            print(f"- score={answer.get('score')}: {preview(answer.get('text', ''), 250)}")
        print()

    for index, item in enumerate(result.get("value", []), start=1):
        print(f"Result {index}")
        print(f"  score: {item.get('@search.score')}")
        if item.get("@search.rerankerScore") is not None:
            print(f"  rerankerScore: {item.get('@search.rerankerScore')}")
        print(f"  title: {item.get('title')}")
        print(f"  chunk_id: {item.get('chunk_id')}")
        print(f"  parent_id: {item.get('parent_id')}")
        print(f"  chunk: {preview(item.get('chunk', ''))}")
        print()


if __name__ == "__main__":
    main()
