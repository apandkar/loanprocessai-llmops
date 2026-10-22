"""Minimal FastAPI endpoints for the RM console.

Two endpoints only:
- POST /cases                    — create a case for an application_id
- POST /chat/{case_id}           — send a message to the orchestrator;
                                   returns the agent's combined response.

The frontend already exists; this module just exposes the orchestrator
behind a tiny HTTP surface. All reasoning happens inside the ADK agents.
"""
 
from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
import json
import urllib.error
import urllib.request
from pathlib import Path

import dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request 
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

dotenv.load_dotenv(Path(__file__).resolve().parent / ".env")

from observability import (  # noqa: E402
    configure_observability,
    extract_llm_response_metadata,
    logger,
    new_correlation_id,
    observe_operation,
    reset_correlation_id,
    set_correlation_id,
    trace_id,
)
from config import settings  # noqa: E402
from evaluator import evaluate_rag_answer  # noqa: E402
from guardrails import check_guardrails, check_output_guardrails  # noqa: E402

configure_observability()

from agent import root_agent
from sub_agents import INDIVIDUAL_AGENTS, pre_approval_pipeline, post_approval_pipeline
from tools import (
    build_initial_state,
    create_application as bq_create_application,
    create_case as bq_create_case,
    delete_application as bq_delete_application,
    flush_all_streaming_buffers as bq_flush_all_streaming_buffers,
    get_application as bq_get_application,
    get_case as bq_get_case,
    get_document_signed_url as bq_get_document_signed_url,
    get_persisted_agent_outputs as bq_get_persisted_agent_outputs,
    list_applications as bq_list_applications,
    list_cases as bq_list_cases,
    list_customer_applications as bq_list_customer_applications,
    list_documents as bq_list_documents,
    record_human_decision as bq_record_human_decision,
    summarize_document as bq_summarize_document,
    upload_document as bq_upload_document,
)


## Observability: common guardrail logging used by RAG, LoanAssist, and agent routes.
def _guardrail_response(question: str, result, route: str) -> dict:
    logger.warning(
        "guardrail.blocked",
        extra={
            "operation": f"loanprocessai.{route}",
            "status_code": 200,
            "question_length": len(question or ""),
            "guardrail_type": result.guardrail_type,
            "guardrail_action": "blocked",
            "guardrail_reason": result.reason,
            "app_release": settings.app_release,
        },
    )
    return {
        "question": question,
        "response": result.safe_response,
        "route": "guardrail",
        "guardrail": {
            "blocked": True,
            "type": result.guardrail_type,
            "reason": result.reason,
        },
    }


def _is_llm_evaluation_enabled() -> bool:
    return settings.llm_evaluation_enabled


## Observability: output guardrail logging for model responses before returning to users.
def _apply_output_guardrail(answer: str, route: str) -> tuple[str, dict | None]:
    result = check_output_guardrails(answer)
    if result.allowed:
        return answer, None

    logger.warning(
        "guardrail.blocked",
        extra={
            "operation": f"loanprocessai.{route}",
            "status_code": 200,
            "question_length": 0,
            "guardrail_type": result.guardrail_type,
            "guardrail_action": "output_blocked",
            "guardrail_reason": result.reason,
            "app_release": settings.app_release,
        },
    )
    return result.safe_response or "The response was blocked by output guardrails.", {
        "blocked": True,
        "type": result.guardrail_type,
        "reason": result.reason,
        "stage": "output",
    }

APP_NAME = "commercial_lending_agent"

app = FastAPI(title="Commercial Lending Multi-Agent Backend")


## Observability: attach correlation ID and emit one HTTP completion/failure log per request.
@app.middleware("http")
async def request_observability(request: Request, call_next):
    """Attach an ID to every request and emit one PII-safe completion log."""
    correlation_id = new_correlation_id(
        request.headers.get("x-correlation-id") or request.headers.get("x-request-id")
    )
    token = set_correlation_id(correlation_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        logger.info(
            "http.request.completed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "trace_id": trace_id(),
                "app_release": settings.app_release,
            },
        )
        return response
    except Exception:
        logger.exception(
            "http.request.failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "trace_id": trace_id(),
                "app_release": settings.app_release,
            },
        )
        raise
    finally:
        reset_correlation_id(token)


@app.get("/healthz")
async def healthz():
    """Liveness probe for local runs and Azure Container Apps."""
    return {"status": "ok"}


## Readiness: expose non-secret release, RAG, prompt, guardrail, and evaluator metadata.
@app.get("/readyz")
async def readyz():
    """Readiness probe with non-secret deployment and LLMOps metadata."""
    from sub_agents._config import MODEL

    return {
        "status": "ready",
        "model_connector": type(MODEL).__name__,
        "app_release": settings.app_release,
        "rag_configured": _rag_is_configured(),
        "search_index": settings.azure_search_index or None,
        "rag_index_version": settings.rag_index_version,
        "rag_prompt_version": settings.rag_prompt_version,
        "loanassist_prompt_version": settings.loanassist_prompt_version,
        "guardrails_enabled": settings.guardrails_enabled,
        "llm_evaluation_enabled": settings.llm_evaluation_enabled,
        "llm_trace_mode": settings.llm_trace_mode,
        "azure_openai_deployment": settings.azure_openai_deployment or None,
    }

# CORS — allow the React dev server (and anything else) to call us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_session_service = InMemorySessionService()
_runner = Runner(
    agent=root_agent, app_name=APP_NAME, session_service=_session_service
)

# A dedicated runner per individual sub-agent. Lets the dashboard re-run one
# tab at a time (e.g. "Run only KYC") without going through the root
# orchestrator's delegation (which only sees the two pipelines + chatbot due
# to ADK's single-parent rule).
_individual_runners = {
    name: Runner(agent=ag, app_name=APP_NAME, session_service=_session_service)
    for name, ag in INDIVIDUAL_AGENTS.items()
}

# Dedicated runners for the two deterministic pipelines.
# These bypass the root orchestrator's LLM-based routing.
_pre_approval_runner = Runner(
    agent=pre_approval_pipeline, app_name=APP_NAME, session_service=_session_service
)
_post_approval_runner = Runner(
    agent=post_approval_pipeline, app_name=APP_NAME, session_service=_session_service
)

# Map individual-agent name -> the session-state key it writes its output to.
_AGENT_OUTPUT_KEY = {
    "document_intake": "document_intake_output",
    "kyc": "kyc_output",
    "financial": "financial_output",
    "memo": "memo_output",
    "decision": "decision_output",
    "closing": "closing_output",
    "chatbot": "chatbot_output",
}

_PIPELINE_STEPS = {
    "pre_approval": [
        ("document_intake", "document_intake_output"),
        ("kyc", "kyc_output"),
        ("financial", "financial_output"),
        ("memo", "memo_output"),
        ("decision", "decision_output"),
    ],
    "post_approval": [
        ("closing", "closing_output"),
    ],
}


def _simulation_value(name: str) -> str:
    return os.getenv(name, "").strip().lower()


def _simulation_delay_ms(agent_name: str) -> int:
    target = _simulation_value("SIMULATE_AGENT_DELAY_STEP")
    if target and target != agent_name:
        return 0
    try:
        return max(0, int(os.getenv("SIMULATE_AGENT_STEP_DELAY_MS", "0")))
    except ValueError:
        return 0


def _maybe_corrupt_agent_context(pipeline: str, agent_name: str, case_id: str, state: dict) -> None:
    """Incident simulation: corrupt memo context after financial output is written."""
    target = _simulation_value("SIMULATE_AGENT_CONTEXT_CORRUPTION")
    if pipeline != "pre_approval" or target != "memo" or agent_name != "financial":
        return
    if state.get("_simulate_memo_context_corrupted"):
        return
    if not state.get("financial_output"):
        return

    state["_original_financial_output"] = state.get("financial_output")
    state["financial_output"] = (
        "SIMULATED INCIDENT: financial_output unavailable due to context packaging issue. "
        "Credit memo should identify that required financial context is missing and request manual review."
    )
    state["_simulate_memo_context_corrupted"] = True
    logger.warning(
        "agent.context.corrupted",
        extra={
            "operation": "loanprocessai.pipeline.pre_approval",
            "pipeline": pipeline,
            "agent_name": "memo",
            "case_id": case_id,
            "step_status": "context_corrupted",
            "status_code": 200,
            "app_release": settings.app_release,
        },
    )


## Agent observability: emit one waterfall event for each completed pipeline step.
def _log_agent_step(
    *,
    pipeline: str,
    agent_name: str,
    case_id: str,
    step_order: int,
    duration_ms: float,
    output_text: str | None,
    status: str = "success",
) -> None:
    logger.info(
        "agent.step.completed",
        extra={
            "operation": "loanprocessai.agent.step",
            "pipeline": pipeline,
            "agent_name": agent_name,
            "case_id": case_id,
            "step_order": step_order,
            "step_status": status,
            "duration_ms": round(duration_ms, 2),
            "output_length": len(output_text or ""),
            "status_code": 200 if status == "success" else 500,
            "app_release": settings.app_release,
        },
    )


## Agent observability: inspect session state and log newly completed agent steps.
async def _log_new_pipeline_steps(
    *,
    pipeline: str,
    case_id: str,
    user_id: str,
    session_id: str,
    completed_steps: set[str],
    step_started_at: float,
) -> float:
    session = await _session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    state = session.state if session else {}
    for step_order, (agent_name, output_key) in enumerate(_PIPELINE_STEPS[pipeline], start=1):
        if agent_name in completed_steps:
            continue
        output_text = state.get(output_key)
        if output_text:
            delay_ms = _simulation_delay_ms(agent_name)
            if delay_ms:
                logger.warning(
                    "agent.step.delay_simulated",
                    extra={
                        "operation": "loanprocessai.agent.step",
                        "pipeline": pipeline,
                        "agent_name": agent_name,
                        "case_id": case_id,
                        "step_status": "delay_simulated",
                        "duration_ms": delay_ms,
                        "status_code": 200,
                        "app_release": settings.app_release,
                    },
                )
                await asyncio.sleep(delay_ms / 1000)
            elapsed_ms = (time.perf_counter() - step_started_at) * 1000
            _log_agent_step(
                pipeline=pipeline,
                agent_name=agent_name,
                case_id=case_id,
                step_order=step_order,
                duration_ms=elapsed_ms,
                output_text=str(output_text),
            )
            completed_steps.add(agent_name)
            _maybe_corrupt_agent_context(pipeline, agent_name, case_id, state)
            step_started_at = time.perf_counter()
    return step_started_at


class CreateCaseBody(BaseModel):
    application_id: str
    assigned_rm: str


class ChatBody(BaseModel):
    user_id: str
    message: str


class ProcessBody(BaseModel):
    """Body for the deterministic /process endpoint (submission)."""
    user_id: str


class DecideBody(BaseModel):
    """Body for the deterministic /decide endpoint (approval/rejection)."""
    user_id: str
    decision: str  # "APPROVED" or "REJECTED"


class AskBody(BaseModel):
    """Body for the /ask chatbot endpoint."""
    user_id: str
    question: str
    case_id: str | None = None  # Optional: focus on a specific case


class RagAskBody(BaseModel):
    """Body for the /rag/ask grounded RAG endpoint."""
    question: str
    top_k: int | None = None


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing required environment variable: {name}")
    return value


## Guardrails: central input check used before RAG, LoanAssist, and agent prompts.
def _input_guardrail(user_text: str):
    if not settings.guardrails_enabled:
        return None
    result = check_guardrails(user_text)
    return None if result.allowed else result


def _preview_text(value: str, limit: int = 500) -> str:
    cleaned = " ".join((value or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "..."


def _redact_trace_text(value: str) -> str:
    """Mask common PII before optional debug trace logging."""
    redacted = value or ""
    redacted = re.sub(r"[\w\.-]+@[\w\.-]+\.\w+", "[REDACTED_EMAIL]", redacted)
    redacted = re.sub(r"\b(?:\+?\d[\s-]?){10,15}\b", "[REDACTED_PHONE_OR_ID]", redacted)
    redacted = re.sub(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", "[REDACTED_PAN]", redacted, flags=re.IGNORECASE)
    redacted = re.sub(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b", "[REDACTED_AADHAAR]", redacted)
    redacted = re.sub(r"\b\d{3}-\d{2}-\d{4}\b", "[REDACTED_SSN]", redacted)
    return redacted


def _debug_trace_payload(prompt: str, chunks: list[dict], answer: str) -> dict:
    """Optionally include prompt/chunks/answer for local debugging only."""
    mode = settings.llm_trace_mode.strip().lower()
    if mode not in {"debug_redacted", "debug_full"}:
        return {}

    chunk_payload = [
        {
            "title": chunk.get("title"),
            "chunk_id": chunk.get("chunk_id"),
            "parent_id": chunk.get("parent_id"),
            "chunk": chunk.get("chunk", ""),
        }
        for chunk in chunks
    ]

    if mode == "debug_redacted":
        return {
            "debug_prompt": _redact_trace_text(prompt),
            "debug_chunks": [
                {**chunk, "chunk": _redact_trace_text(str(chunk.get("chunk", "")))}
                for chunk in chunk_payload
            ],
            "debug_answer": _redact_trace_text(answer),
        }

    logger.warning(
        "llm.trace.full_enabled",
        extra={
            "operation": "loanprocessai.rag.ask",
            "llm_trace_mode": settings.llm_trace_mode,
            "app_release": settings.app_release,
        },
    )
    return {
        "debug_prompt": prompt,
        "debug_chunks": chunk_payload,
        "debug_answer": answer,
    }


## RAG observability: retrieve chunks from Azure AI Search and measure search latency.
def _search_rag_chunks(question: str, top_k: int) -> tuple[list[dict], float]:
    # RAG retrieval step:
    # 1. Send the user question to Azure AI Search.
    # 2. Azure AI Search performs hybrid keyword/vector retrieval.
    # 3. We measure only this search call as search_latency_ms.
    endpoint = _required_env("AZURE_SEARCH_ENDPOINT").rstrip("/")
    index_name = _required_env("AZURE_SEARCH_INDEX")
    api_key = _required_env("AZURE_SEARCH_API_KEY")
    api_version = settings.azure_search_api_version

    url = f"{endpoint}/indexes/{index_name}/docs/search?api-version={api_version}"
    body = {
        "search": question,
        "top": top_k,
        "select": "chunk_id,parent_id,title,chunk",
        "vectorQueries": [
            {
                "kind": "text",
                "text": question,
                "fields": "text_vector",
                "k": top_k,
            }
        ],
    }

    # Start timer immediately before the external Search call.
    started = time.perf_counter()
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Azure AI Search failed: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Azure AI Search is unreachable: {exc}") from exc

    # Stop timer after Search returns. This is the RAG retrieval latency.
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return payload.get("value", []), latency_ms


## LLM observability: call Azure OpenAI for grounded RAG answer and measure model latency.
def _call_rag_chat_model(question: str, chunks: list[dict]) -> tuple[str, float, int, dict]:
    # RAG generation step:
    # 1. Build a grounded prompt from retrieved chunks.
    # 2. Send the prompt to Azure OpenAI.
    # 3. Measure only the model call as model_latency_ms.
    from openai import AzureOpenAI

    endpoint = _required_env("AZURE_OPENAI_ENDPOINT")
    api_key = _required_env("AZURE_OPENAI_API_KEY")
    deployment = _required_env("AZURE_OPENAI_DEPLOYMENT")
    api_version = settings.azure_openai_api_version

    context_blocks = []
    for index, chunk in enumerate(chunks, start=1):
        title = chunk.get("title") or chunk.get("parent_id") or "unknown source"
        context_blocks.append(
            f"[Source {index}: {title}]\n{_preview_text(chunk.get('chunk', ''), 1600)}"
        )

    context_text = "\n\n".join(context_blocks)
    prompt = f"""Use only the retrieved context to answer the question.

If the answer is not present in the retrieved context, say that the indexed
documents do not contain enough evidence. Do not invent policy details.

Retrieved context:
{context_text}

Question:
{question}

Return a concise answer and mention the source document names used."""

    client = AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=api_version,
    )

    prompt_length = len(prompt)
    max_completion_tokens = None
    value = os.getenv("RAG_MAX_COMPLETION_TOKENS", "").strip()
    if value:
        try:
            max_completion_tokens = max(1, int(value))
        except ValueError:
            max_completion_tokens = None

    logger.info(
        "llm.request.started",
        extra={
            "operation": "loanprocessai.rag.ask",
            "llm_route": "rag_answer",
            "llm_phase": "generation",
            "model_deployment": deployment,
            "prompt_length": prompt_length,
            "max_completion_tokens": max_completion_tokens,
            "rag_prompt_version": settings.rag_prompt_version,
            "app_release": settings.app_release,
            "llm_trace_mode": settings.llm_trace_mode,
        },
    )

    request_args = {
        "model": deployment,
        "messages": [
            {
                "role": "system",
                "content": "You are LoanAssist. Answer with grounded evidence from the supplied context.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    if max_completion_tokens:
        request_args["max_completion_tokens"] = max_completion_tokens

    # Start timer immediately before the external Azure OpenAI call.
    started = time.perf_counter()
    try:
        response = client.chat.completions.create(**request_args)
        # Stop timer after the model returns. This is generation latency.
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        answer = response.choices[0].message.content or ""
        llm_metadata = extract_llm_response_metadata(response)
        debug_trace = _debug_trace_payload(prompt, chunks, answer)
        logger.info(
            "llm.request.completed",
            extra={
                "operation": "loanprocessai.rag.ask",
                "llm_route": "rag_answer",
                "llm_phase": "generation",
                "llm_status": "success",
                "model_latency_ms": latency_ms,
                "model_deployment": deployment,
                "prompt_length": prompt_length,
                "response_length": len(answer),
                "max_completion_tokens": max_completion_tokens,
                "rag_prompt_version": settings.rag_prompt_version,
                "app_release": settings.app_release,
                "llm_trace_mode": settings.llm_trace_mode,
                **llm_metadata,
                **debug_trace,
            },
        )
        return answer, latency_ms, prompt_length, llm_metadata
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.exception(
            "llm.request.failed",
            extra={
                "operation": "loanprocessai.rag.ask",
                "llm_route": "rag_answer",
                "llm_phase": "generation",
                "llm_status": "failed",
                "llm_error_type": type(exc).__name__,
                "model_latency_ms": latency_ms,
                "model_deployment": deployment,
                "prompt_length": prompt_length,
                "max_completion_tokens": max_completion_tokens,
                "rag_prompt_version": settings.rag_prompt_version,
                "app_release": settings.app_release,
                "llm_trace_mode": settings.llm_trace_mode,
            },
        )
        raise


def _should_use_rag(question: str) -> bool:
    """Route policy/reference questions to RAG; leave app status questions to LoanAssist."""
    q = question.lower()
    rag_keywords = (
        "policy",
        "guideline",
        "guidelines",
        "requirement",
        "requirements",
        "required",
        "commercial loan",
        "occ",
        "fdic",
        "sba",
        "dscr",
        "debt service",
        "collateral",
        "covenant",
        "credit policy",
        "risk management",
        "real estate lending",
        "interagency",
        "icerc",
    )
    app_keywords = (
        "my application",
        "application status",
        "show cases",
        "all cases",
        "pending review",
        "missing documents",
        "kyc result",
        "sla",
        "pipeline",
    )
    return any(word in q for word in rag_keywords) and not any(word in q for word in app_keywords)


def _rag_is_configured() -> bool:
    return all(
        os.getenv(name)
        for name in (
            "AZURE_SEARCH_ENDPOINT",
            "AZURE_SEARCH_INDEX",
            "AZURE_SEARCH_API_KEY",
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_DEPLOYMENT",
        )
    )


## RAG orchestration: combine retrieval, generation, output guardrails, evaluator, and logs.
def _run_rag_answer(question: str, top_k: int) -> dict:
    # Main RAG orchestration:
    # retrieval -> grounded LLM answer -> output guardrail -> optional evaluator -> logs.
    chunks, search_latency_ms = _search_rag_chunks(question, top_k)
    if not chunks:
        logger.info(
            "rag.request.completed",
            extra={
                "operation": "loanprocessai.rag.ask",
                "top_k": top_k,
                "retrieval_count": 0,
                "search_latency_ms": search_latency_ms,
                "question_length": len(question),
                "app_release": settings.app_release,
                "rag_prompt_version": settings.rag_prompt_version,
                "rag_index_version": settings.rag_index_version,
                "status_code": 200,
            },
        )
        return {
            "question": question,
            "answer": "The indexed documents did not return relevant evidence for this question.",
            "sources": [],
            "retrieval_count": 0,
            "latency_ms": {"search": search_latency_ms, "model": 0},
        }

    answer, model_latency_ms, prompt_length, llm_metadata = _call_rag_chat_model(question, chunks)
    answer, output_guardrail = _apply_output_guardrail(answer, "rag.ask")
    sources = [
        {
            "title": chunk.get("title"),
            "chunk_id": chunk.get("chunk_id"),
            "parent_id": chunk.get("parent_id"),
            "score": chunk.get("@search.score"),
            "reranker_score": chunk.get("@search.rerankerScore"),
            "content_preview": _preview_text(chunk.get("chunk", ""), 350),
        }
        for chunk in chunks
    ]

    evaluation = None
    if _is_llm_evaluation_enabled() and not output_guardrail:
        evaluation = evaluate_rag_answer(question, chunks, answer)

    # Emit one PII-safe structured completion log for observability.
    # This lets us query retrieval count, search latency, model latency,
    # prompt/response size, model deployment, and source titles in terminal
    # logs today and Azure Log Analytics after cloud deployment.
    logger.info(
        "rag.request.completed",
        extra={
            "operation": "loanprocessai.rag.ask",
            "top_k": top_k,
            "retrieval_count": len(chunks),
            "search_latency_ms": search_latency_ms,
            "model_latency_ms": model_latency_ms,
            "question_length": len(question),
            "prompt_length": prompt_length,
            "response_length": len(answer),
            "model_deployment": os.getenv("AZURE_OPENAI_DEPLOYMENT"),
            "source_titles": sorted({str(source.get("title")) for source in sources if source.get("title")}),
            "app_release": settings.app_release,
            "rag_prompt_version": settings.rag_prompt_version,
            "rag_index_version": settings.rag_index_version,
            "llm_trace_mode": settings.llm_trace_mode,
            "evaluation_groundedness": evaluation.get("groundedness") if evaluation else None,
            "evaluation_correctness": evaluation.get("correctness") if evaluation else None,
            "evaluation_answer_relevance": evaluation.get("answer_relevance") if evaluation else None,
            "evaluation_hallucination_risk": evaluation.get("hallucination_risk") if evaluation else None,
            "evaluation_bias_fairness_risk": evaluation.get("bias_fairness_risk") if evaluation else None,
            "evaluation_pii_risk": evaluation.get("pii_risk") if evaluation else None,
            "evaluation_safety": evaluation.get("safety") if evaluation else None,
            "evaluation_policy_compliance": evaluation.get("policy_compliance") if evaluation else None,
            **llm_metadata,
            "status_code": 200,
        },
    )

    result = {
        "question": question,
        "answer": answer,
        "sources": sources,
        "retrieval_count": len(chunks),
        "latency_ms": {
            "search": search_latency_ms,
            "model": model_latency_ms,
        },
    }
    if output_guardrail:
        result["guardrail"] = output_guardrail
    if evaluation:
        result["evaluation"] = evaluation
    return result


# ---------------------------------------------------------------------------
# Customer-portal endpoints 
# ---------------------------------------------------------------------------
@app.post("/applications")
async def create_application_endpoint(request: Request):
    """Create a new application from the customer-portal form."""
    form_data = await request.json()
    return bq_create_application(form_data)


@app.get("/applications")
async def list_applications_endpoint():
    return bq_list_applications()


@app.get("/applications/{application_id}")
async def get_application_endpoint(application_id: str):
    app_row = bq_get_application(application_id)
    if not app_row:
        raise HTTPException(status_code=404, detail="application not found")
    docs = bq_list_documents(application_id)
    return {"application": app_row, "documents": docs}


# ---------------------------------------------------------------------------
# Admin: 
# ---------------------------------------------------------------------------
@app.post("/admin/flush-streaming-buffer")
async def flush_streaming_buffer():
    """Force-flush BigQuery streaming buffers for cases & applications tables.

    Old rows inserted via streaming API sit in a buffer for up to 90 min
    and block UPDATE/DELETE. This copies each table in-place to move
    buffered rows into regular storage.
    """
    results = bq_flush_all_streaming_buffers()
    return {"status": "ok", "results": results}


@app.delete("/applications/{application_id}")
async def delete_application_endpoint(application_id: str):
    """Delete an application and all related BQ data + GCS files."""
    app_row = bq_get_application(application_id)
    if not app_row:
        raise HTTPException(status_code=404, detail="application not found")
    try:
        result = bq_delete_application(application_id)
        return {"status": "deleted", **result}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/applications/{application_id}/documents")
async def list_documents_endpoint(application_id: str):
    return bq_list_documents(application_id)


@app.get("/applications/{application_id}/documents/{document_id}/url")
async def get_document_url_endpoint(application_id: str, document_id: str):
    """Return a signed URL to view/download the document from GCS."""
    try:
        return bq_get_document_signed_url(application_id, document_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local-documents/{document_id}")
async def get_local_document_endpoint(document_id: str):
    """Serve a development-mode document; Blob SAS replaces this in Stage 2."""
    from tools import get_local_document_path

    path = get_local_document_path(document_id)
    if path is None:
        raise HTTPException(status_code=404, detail="document not found")
    return FileResponse(str(path))


@app.post("/applications/{application_id}/documents/{document_id}/summary")
async def summarize_document_endpoint(application_id: str, document_id: str):
    """Return a Gemini-generated markdown summary for a single document."""
    try:
        return bq_summarize_document(application_id, document_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/applications/{application_id}/documents")
async def upload_documents_endpoint(
    application_id: str,
    files: list[UploadFile] = File(...),
    doc_types: list[str] | None = Form(default=None),
    uploaded_by: str | None = Form(default=None),
):
    """Upload one or more documents for an application to GCS + BQ."""
    uploaded = []
    errors: list[str] = []
    types_list = doc_types or []
    for idx, f in enumerate(files):
        try:
            data = await f.read()
            doc_type = types_list[idx] if idx < len(types_list) else None
            rec = bq_upload_document(
                application_id=application_id,
                file_bytes=data,
                filename=f.filename,
                content_type=f.content_type or "application/octet-stream",
                doc_type=doc_type,
                uploaded_by=uploaded_by,
            )
            uploaded.append(rec)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{f.filename}: {e}")
    return {"uploaded": uploaded, "errors": errors}


@app.get("/customers/{email}/applications")
async def list_customer_applications_endpoint(email: str):
    return bq_list_customer_applications(email)


@app.post("/cases")
async def create_case_endpoint(body: CreateCaseBody):
    case = bq_create_case(body.application_id, body.assigned_rm)
    return case


@app.get("/cases/{case_id}")
async def get_case_endpoint(case_id: str):
    """Fetch case details from BigQuery."""
    case = bq_get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    return {"case": case}


@app.post("/chat/{case_id}")
@observe_operation("loanprocessai.agent.orchestrator_chat")
async def chat(case_id: str, body: ChatBody):
    started = time.perf_counter()
    guardrail = _input_guardrail(body.message)
    if guardrail:
        response = _guardrail_response(body.message, guardrail, "agent.orchestrator_chat")
        return {
            "case_id": case_id,
            "response": response["response"],
            "route": "guardrail",
            "guardrail": response["guardrail"],
            "agent_outputs": {},
        }

    session_id = f"{case_id}:{body.user_id}"
    session = await _session_service.get_session(
        app_name=APP_NAME, user_id=body.user_id, session_id=session_id
    )
    if session is None:
        session = await _session_service.create_session(
            app_name=APP_NAME,
            user_id=body.user_id,
            session_id=session_id,
            state=build_initial_state(case_id, body.user_id),
        )

    content = types.Content(role="user", parts=[types.Part(text=body.message)])
    chunks: list[str] = []
    async for event in _runner.run_async(
        user_id=body.user_id, session_id=session_id, new_message=content
    ):
        if event.is_final_response() and event.content and event.content.parts:
            for p in event.content.parts:
                if getattr(p, "text", None):
                    chunks.append(p.text)

    # Pull each sub-agent's output_key from session state so the frontend can
    # render them in their own panels (no Python logic / parsing).
    final_session = await _session_service.get_session(
        app_name=APP_NAME, user_id=body.user_id, session_id=session_id
    )
    state = final_session.state if final_session else {}
    agent_outputs = {
        "document_intake": state.get("document_intake_output"),
        "kyc": state.get("kyc_output"),
        "financial": state.get("financial_output"),
        "memo": state.get("memo_output"),
        "decision": state.get("decision_output"),
        "closing": state.get("closing_output"),
        "chatbot": state.get("chatbot_output"),
    }
    response_text = "\n".join(chunks)
    response_text, output_guardrail = _apply_output_guardrail(response_text, "agent.orchestrator_chat")
    response = {
        "case_id": case_id,
        "response": response_text,
        "agent_outputs": agent_outputs,
    }
    if output_guardrail:
        response["route"] = "guardrail"
        response["guardrail"] = output_guardrail
    logger.info(
        "agent.request.completed",
        extra={
            "operation": "loanprocessai.agent.orchestrator_chat",
            "agent_name": "orchestrator",
            "case_id": case_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "output_length": len(response_text),
            "status_code": 200,
            "app_release": settings.app_release,
        },
    )
    return response


@app.post("/chat/{case_id}/agent/{agent_name}")
@observe_operation("loanprocessai.agent.single_run")
async def chat_single_agent(case_id: str, agent_name: str, body: ChatBody):
    """Run ONE sub-agent directly (used by per-tab re-run buttons).

    Bypasses the root orchestrator so that single-agent re-runs always
    work, regardless of pipeline structure.
    """
    started = time.perf_counter()
    guardrail = _input_guardrail(body.message)
    if guardrail:
        response = _guardrail_response(body.message, guardrail, "agent.single_run")
        return {
            "case_id": case_id,
            "agent": agent_name,
            "response": response["response"],
            "output": response["response"],
            "route": "guardrail",
            "guardrail": response["guardrail"],
        }

    runner = _individual_runners.get(agent_name)
    if runner is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown agent '{agent_name}'. Known: {list(_individual_runners)}",
        )
    session_id = f"{case_id}:{body.user_id}:{agent_name}"
    # Always build fresh state from BQ so the agent sees the latest upstream
    # outputs. Delete any stale session first (InMemorySessionService throws
    # if you create with a duplicate session_id).
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=body.user_id, session_id=session_id
        )
    except Exception:  # noqa: BLE001
        pass  # session didn't exist — fine
    session = await _session_service.create_session(
        app_name=APP_NAME,
        user_id=body.user_id,
        session_id=session_id,
        state=build_initial_state(case_id, body.user_id),
    )

    content = types.Content(role="user", parts=[types.Part(text=body.message)])
    chunks: list[str] = []
    all_text: list[str] = []  # fallback: capture ALL non-thought text events
    try:
        async for event in runner.run_async(
            user_id=body.user_id, session_id=session_id, new_message=content
        ):
            if event.content and event.content.parts:
                for p in event.content.parts:
                    if getattr(p, "text", None) and not getattr(p, "thought", False):
                        all_text.append(p.text)
            if event.is_final_response() and event.content and event.content.parts:
                for p in event.content.parts:
                    if getattr(p, "text", None) and not getattr(p, "thought", False):
                        chunks.append(p.text)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

    final_session = await _session_service.get_session(
        app_name=APP_NAME, user_id=body.user_id, session_id=session_id
    )
    state = final_session.state if final_session else {}
    output_key = _AGENT_OUTPUT_KEY.get(agent_name)
    output_text = state.get(output_key) if output_key else None
    # Fallback: if output_key wasn't written, use captured text from events.
    response_text = "\n".join(chunks) or "\n".join(all_text)
    response_text, output_guardrail = _apply_output_guardrail(response_text, "agent.single_run")
    if not output_text and response_text:
        output_text = response_text
    response = {
        "case_id": case_id,
        "agent": agent_name,
        "response": response_text,
        "output": output_text,
    }
    if output_guardrail:
        response["route"] = "guardrail"
        response["guardrail"] = output_guardrail
        response["output"] = response_text
    logger.info(
        "agent.request.completed",
        extra={
            "operation": "loanprocessai.agent.single_run",
            "agent_name": agent_name,
            "case_id": case_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "output_length": len(response_text),
            "status_code": 200,
            "app_release": settings.app_release,
        },
    )
    return response


# ---------------------------------------------------------------------------
# Deterministic pipeline endpoints (no LLM routing)
# ---------------------------------------------------------------------------
## Agent observability: pre-approval emits process-level and step-level telemetry.
@app.post("/process/{case_id}")
@observe_operation("loanprocessai.pipeline.pre_approval")
async def process_case(case_id: str, body: ProcessBody):
    """API #1: Run Pre-Approval Pipeline at submission time.
    
    Deterministically runs all 5 agents in order:
    Document_Intake -> KYC -> Financial -> Memo -> Decision
    
    Call this ONCE when the application is submitted.
    """
    started = time.perf_counter()
    session_id = f"{case_id}:{body.user_id}:pre_approval"
    
    # Always create a fresh session for deterministic runs
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=body.user_id, session_id=session_id
        )
    except Exception:
        pass
    
    await _session_service.create_session(
        app_name=APP_NAME,
        user_id=body.user_id,
        session_id=session_id,
        state=build_initial_state(case_id, body.user_id),
    )
    
    # Trigger the pre-approval pipeline with a simple start message
    content = types.Content(
        role="user",
        parts=[types.Part(text="Process this loan application.")]
    )
    
    chunks: list[str] = []
    completed_steps: set[str] = set()
    step_started_at = time.perf_counter()
    try:
        async for event in _pre_approval_runner.run_async(
            user_id=body.user_id, session_id=session_id, new_message=content
        ):
            step_started_at = await _log_new_pipeline_steps(
                pipeline="pre_approval",
                case_id=case_id,
                user_id=body.user_id,
                session_id=session_id,
                completed_steps=completed_steps,
                step_started_at=step_started_at,
            )
            if event.is_final_response() and event.content and event.content.parts:
                for p in event.content.parts:
                    if getattr(p, "text", None) and not getattr(p, "thought", False):
                        chunks.append(p.text)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    
    # Get all agent outputs from session state
    final_session = await _session_service.get_session(
        app_name=APP_NAME, user_id=body.user_id, session_id=session_id
    )
    state = final_session.state if final_session else {}
    for step_order, (agent_name, output_key) in enumerate(_PIPELINE_STEPS["pre_approval"], start=1):
        if agent_name not in completed_steps:
            _log_agent_step(
                pipeline="pre_approval",
                agent_name=agent_name,
                case_id=case_id,
                step_order=step_order,
                duration_ms=(time.perf_counter() - step_started_at) * 1000,
                output_text=state.get(output_key),
                status="missing_output",
            )
    
    response_text = "\n".join(chunks)
    logger.info(
        "agent.request.completed",
        extra={
            "operation": "loanprocessai.pipeline.pre_approval",
            "agent_name": "pre_approval_pipeline",
            "pipeline": "pre_approval",
            "case_id": case_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "output_length": len(response_text),
            "status_code": 200,
            "app_release": settings.app_release,
        },
    )
    return {
        "case_id": case_id,
        "pipeline": "pre_approval",
        "response": response_text,
        "agent_outputs": {
            "document_intake": state.get("document_intake_output"),
            "kyc": state.get("kyc_output"),
            "financial": state.get("financial_output"),
            "memo": state.get("memo_output"),
            "decision": state.get("decision_output"),
        },
    }


@app.post("/decide/{case_id}")
@observe_operation("loanprocessai.pipeline.post_approval")
async def decide_case(case_id: str, body: DecideBody):
    """API #2: Run Post-Approval Pipeline at decision time.
    
    Deterministically runs the Closing agent after human approval/rejection.
    
    Call this ONCE when the human approves or rejects the application.
    Pass decision as "APPROVED" or "REJECTED".
    """
    started = time.perf_counter()
    decision = body.decision.upper()
    if decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(
            status_code=400,
            detail="decision must be 'APPROVED' or 'REJECTED'"
        )
    
    # Record the decision in BigQuery (case status + audit log)
    # This now returns a detailed status message
    decision_record_status = bq_record_human_decision(case_id, decision, body.user_id)
    
    session_id = f"{case_id}:{body.user_id}:post_approval"
    
    # Always create a fresh session for deterministic runs
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=body.user_id, session_id=session_id
        )
    except Exception:
        pass
    
    await _session_service.create_session(
        app_name=APP_NAME,
        user_id=body.user_id,
        session_id=session_id,
        state=build_initial_state(case_id, body.user_id),
    )
    
    # Pass the decision to the closing agent
    content = types.Content(
        role="user",
        parts=[types.Part(text=f"Manager decision: {decision} by {body.user_id}. Run the Closing Package Agent.")]
    )
    
    chunks: list[str] = []
    completed_steps: set[str] = set()
    step_started_at = time.perf_counter()
    try:
        async for event in _post_approval_runner.run_async(
            user_id=body.user_id, session_id=session_id, new_message=content
        ):
            step_started_at = await _log_new_pipeline_steps(
                pipeline="post_approval",
                case_id=case_id,
                user_id=body.user_id,
                session_id=session_id,
                completed_steps=completed_steps,
                step_started_at=step_started_at,
            )
            if event.is_final_response() and event.content and event.content.parts:
                for p in event.content.parts:
                    if getattr(p, "text", None) and not getattr(p, "thought", False):
                        chunks.append(p.text)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    
    # Get closing output from session state
    final_session = await _session_service.get_session(
        app_name=APP_NAME, user_id=body.user_id, session_id=session_id
    )
    state = final_session.state if final_session else {}
    for step_order, (agent_name, output_key) in enumerate(_PIPELINE_STEPS["post_approval"], start=1):
        if agent_name not in completed_steps:
            _log_agent_step(
                pipeline="post_approval",
                agent_name=agent_name,
                case_id=case_id,
                step_order=step_order,
                duration_ms=(time.perf_counter() - step_started_at) * 1000,
                output_text=state.get(output_key),
                status="missing_output",
            )
    
    response_text = "\n".join(chunks)
    logger.info(
        "agent.request.completed",
        extra={
            "operation": "loanprocessai.pipeline.post_approval",
            "agent_name": "post_approval_pipeline",
            "pipeline": "post_approval",
            "case_id": case_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "output_length": len(response_text),
            "status_code": 200,
            "app_release": settings.app_release,
        },
    )
    return {
        "case_id": case_id,
        "pipeline": "post_approval",
        "decision": decision,
        "decision_record_status": decision_record_status,
        "response": response_text,
        "agent_outputs": {
            "closing": state.get("closing_output"),
        },
    }


## LoanAssist observability: guardrails, optional RAG routing, and agent request telemetry.
@app.post("/ask")
@observe_operation("loanprocessai.agent.loan_assist")
async def ask_chatbot(body: AskBody):
    """API #3: Standalone chatbot for queries about cases/applications.
    
    Input context from BigQuery:
    - Case management list (all cases)
    - Application list (all applications)  
    - Agent outputs (if case_id is provided)
    
    This does NOT trigger any pipeline - it's read-only Q&A.
    """
    started = time.perf_counter()
    guardrail = _input_guardrail(body.question)
    if guardrail:
        response = _guardrail_response(body.question, guardrail, "agent.loan_assist")
        response["case_id"] = body.case_id
        return response

    if _should_use_rag(body.question) and _rag_is_configured():
        top_k = settings.rag_top_k
        rag_result = _run_rag_answer(body.question.strip(), max(1, min(top_k, 10)))
        source_names = [
            source.get("title") or source.get("parent_id")
            for source in rag_result.get("sources", [])
            if source.get("title") or source.get("parent_id")
        ]
        source_text = ""
        if source_names:
            source_text = "\n\nSources:\n" + "\n".join(f"- {name}" for name in dict.fromkeys(source_names))
        response_text = f"{rag_result['answer']}{source_text}"
        response_text, output_guardrail = _apply_output_guardrail(response_text, "agent.loan_assist")
        response = {
            "question": body.question,
            "case_id": body.case_id,
            "response": response_text,
            "route": "rag",
            "rag": {
                "retrieval_count": rag_result.get("retrieval_count", 0),
                "latency_ms": rag_result.get("latency_ms", {}),
                "sources": rag_result.get("sources", []),
                "evaluation": rag_result.get("evaluation"),
            },
        }
        if output_guardrail:
            response["guardrail"] = output_guardrail
        logger.info(
            "agent.request.completed",
            extra={
                "operation": "loanprocessai.agent.loan_assist",
                "agent_name": "loan_assist_rag_router",
                "case_id": body.case_id,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "output_length": len(response_text),
                "status_code": 200,
                "app_release": settings.app_release,
                "loanassist_prompt_version": settings.loanassist_prompt_version,
            },
        )
        return response
    
    # Fetch context from BigQuery
    cases_list = bq_list_cases()
    applications_list = bq_list_applications()
    
    # Build context for the chatbot
    context_parts = []
    context_parts.append("## Available Cases (from case_management.cases)")
    context_parts.append(json.dumps(cases_list[:50], indent=2, default=str))  # Limit to 50 for context size
    
    context_parts.append("\n## Available Applications (from loan_applications.applications)")
    context_parts.append(json.dumps(applications_list[:50], indent=2, default=str))  # Limit to 50
    
    # If a specific case_id is provided, include agent outputs
    agent_outputs = {}
    if body.case_id:
        agent_outputs = bq_get_persisted_agent_outputs(body.case_id)
        context_parts.append(f"\n## Agent Outputs for Case {body.case_id}")
        context_parts.append(json.dumps(agent_outputs, indent=2, default=str))
    
    context_text = "\n".join(context_parts)
    
    # Create session for chatbot
    session_id = f"ask:{body.user_id}:{body.case_id or 'global'}"
    
    try:
        await _session_service.delete_session(
            app_name=APP_NAME, user_id=body.user_id, session_id=session_id
        )
    except Exception:
        pass
    
    # Build initial state with the BQ context
    initial_state = {
        "cases_list": cases_list[:50],
        "applications_list": applications_list[:50],
        "case_id": body.case_id,
        "actor": body.user_id,
        # Empty placeholders for agent outputs (will be populated if case_id provided)
        "case": {},
        "application": {},
        "documents": [],
        "document_intake_output": agent_outputs.get("document_intake", ""),
        "kyc_output": agent_outputs.get("kyc", ""),
        "financial_output": agent_outputs.get("financial", ""),
        "memo_output": agent_outputs.get("memo", ""),
        "decision_output": agent_outputs.get("decision", ""),
        "closing_output": agent_outputs.get("closing", ""),
    }
    
    # If case_id provided, also load case details
    if body.case_id:
        from .tools import _populate_state_dict
        _populate_state_dict(initial_state)
    
    await _session_service.create_session(
        app_name=APP_NAME,
        user_id=body.user_id,
        session_id=session_id,
        state=initial_state,
    )
    
    # Build the prompt with context + question
    prompt_text = f"""Here is the current data context:

{context_text}

User Question: {body.question}

Please answer the question based on the data above."""
    
    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt_text)]
    )
    
    # Use the chatbot agent runner
    chatbot_runner = _individual_runners.get("chatbot")
    if not chatbot_runner:
        raise HTTPException(status_code=500, detail="Chatbot agent not available")
    
    chunks: list[str] = []
    try:
        async for event in chatbot_runner.run_async(
            user_id=body.user_id, session_id=session_id, new_message=content
        ):
            if event.is_final_response() and event.content and event.content.parts:
                for p in event.content.parts:
                    if getattr(p, "text", None) and not getattr(p, "thought", False):
                        chunks.append(p.text)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    
    response_text = "\n".join(chunks)
    response_text, output_guardrail = _apply_output_guardrail(response_text, "agent.loan_assist")
    response = {
        "question": body.question,
        "case_id": body.case_id,
        "response": response_text,
        "context_summary": {
            "cases_count": len(cases_list),
            "applications_count": len(applications_list),
            "has_agent_outputs": bool(body.case_id and any(agent_outputs.values())),
        },
    }
    if output_guardrail:
        response["route"] = "guardrail"
        response["guardrail"] = output_guardrail
    logger.info(
        "agent.request.completed",
        extra={
            "operation": "loanprocessai.agent.loan_assist",
            "agent_name": "chatbot",
            "case_id": body.case_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "output_length": len(response_text),
            "status_code": 200,
            "app_release": settings.app_release,
            "loanassist_prompt_version": settings.loanassist_prompt_version,
        },
    )
    return response


## Direct RAG endpoint: useful for testing retrieval, generation, guardrails, and telemetry.
@app.post("/rag/ask")
@observe_operation("loanprocessai.rag.ask")
async def ask_rag(body: RagAskBody):
    """Grounded RAG Q&A over Azure AI Search indexed documents."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    guardrail = _input_guardrail(question)
    if guardrail:
        response = _guardrail_response(question, guardrail, "rag.ask")
        return {
            "question": question,
            "answer": response["response"],
            "sources": [],
            "retrieval_count": 0,
            "latency_ms": {"search": 0, "model": 0},
            "route": "guardrail",
            "guardrail": response["guardrail"],
        }

    top_k = body.top_k or settings.rag_top_k
    top_k = max(1, min(top_k, 10))

    return _run_rag_answer(question, top_k)


@app.get("/cases/{case_id}/agent_outputs")
async def get_case_agent_outputs(case_id: str):
    """Return the latest persisted output for each agent on this case.

    Read-only — never invokes an agent. Used by the frontend to hydrate the
    per-agent panels when localStorage is empty (incognito, new browser,
    cache cleared) so the user always sees prior runs without re-firing the
    pipeline.
    """
    return {
        "case_id": case_id,
        "agent_outputs": bq_get_persisted_agent_outputs(case_id),
    }


# ---------------------------------------------------------------------------
# Serve React frontend (production / Cloud Run)
# ---------------------------------------------------------------------------
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR / "static")), name="frontend-static")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        """Catch-all: serve React index.html for client-side routing."""
        file_path = _STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_STATIC_DIR / "index.html"))
