"""Thin BigQuery + GCS plumbing exposed to ADK as callbacks and tools.

No business logic — only loads context the agents need and persists agent
outputs back to BigQuery. All decisions stay with the LLM.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import dotenv

# ---------------------------------------------------------------------------
# Make the bundled `financial_anomaly_tool` package importable. It uses
# script-style absolute imports (`from models import ...`) so we add its
# directory to sys.path rather than restructuring the package. Try the
# in-backend location first, then fall back to the sibling repo layout.
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent
_FA_TOOL_CANDIDATES = [
    _BACKEND_DIR / "financial_anomaly_tool",
    _BACKEND_DIR / "financial_anomaly_tool" / "financial_anomaly_tool",
    _BACKEND_DIR.parent / "financial_anomaly_tool" / "financial_anomaly_tool",
]
_FA_TOOL_DIR = next(
    (p for p in _FA_TOOL_CANDIDATES if (p / "adk_tool.py").is_file()),
    None,
)
if _FA_TOOL_DIR and str(_FA_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_FA_TOOL_DIR))
try:
    from adk_tool import (  # type: ignore  # noqa: E402
        detect_financial_anomalies as _fa_detect_financial_anomalies,
    )
    _FA_TOOL_AVAILABLE = True
    _FA_TOOL_IMPORT_ERROR: str | None = None
except Exception as _fa_e:  # noqa: BLE001
    _fa_detect_financial_anomalies = None  # type: ignore
    _FA_TOOL_AVAILABLE = False
    _FA_TOOL_IMPORT_ERROR = f"{type(_fa_e).__name__}: {_fa_e}"
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types

dotenv.load_dotenv(Path(__file__).resolve().parent / ".env")

STORAGE_MODE = os.getenv("STORAGE_MODE", "local").strip().lower()
GCP_PROJECT = os.getenv("GCP_PROJECT")
GCS_BUCKET = os.getenv("GCS_BUCKET")
DS_APPS = os.getenv("BQ_DS_APPLICATIONS", "loan_applications")
DS_OUT = os.getenv("BQ_DS_AGENT_OUTPUTS", "agent_outputs")
DS_CASE = os.getenv("BQ_DS_CASE_MANAGEMENT", "case_management")

# MIME types Gemini can ingest natively from a GCS URI.
_GEMINI_NATIVE_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "text/plain",
}

if STORAGE_MODE == "gcp":
    from google.cloud import bigquery, storage

    _bq = bigquery.Client(project=GCP_PROJECT)
    _gcs = storage.Client(project=GCP_PROJECT)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Structured per-agent logger
# ---------------------------------------------------------------------------
# Goal: extremely clean, grep-friendly observability for every agent run.
# Format example:
#   [AGENT] Document_Validation_Agent  STARTED   case=CASE-ABC123
#   [AGENT] Document_Validation_Agent  COMPLETED case=CASE-ABC123  dur=4123ms  out_chars=842
#   [AGENT] Memo_Drafting_Agent        FAILED    case=CASE-ABC123  dur=120ms   error=...
# Wire this once at module import so uvicorn picks up the formatter even
# when started without --log-config.
_logger = logging.getLogger("cla.agent")
if not _logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%H:%M:%S",
    ))
    _logger.addHandler(_h)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False


def _log_event(agent_name: str, status: str, case_id: str | None,
               duration_ms: int | None = None, extra: str = "") -> None:
    parts = [f"[AGENT] {agent_name:<30s} {status:<9s}"]
    if case_id:
        parts.append(f"case={case_id}")
    if duration_ms is not None:
        parts.append(f"dur={duration_ms}ms")
    if extra:
        parts.append(extra)
    _logger.info("  ".join(parts))


# ---------------------------------------------------------------------------
# Callback: load case + application + documents into state before any agent
# ---------------------------------------------------------------------------
def _populate_state_dict(state: dict) -> None:
    """Fetch case + application + documents into a plain state-like mapping."""
    if state.get("context_loaded"):
        return

    case_id = state.get("case_id")
    application_id = state.get("application_id")

    if case_id and not application_id:
        row = next(_bq.query(
            f"SELECT * FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
            f"WHERE case_id = @cid LIMIT 1",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("cid", "STRING", case_id)
            ]),
        ).result(), None)
        if row:
            state["case"] = dict(row)
            application_id = row.get("application_id")
            state["application_id"] = application_id

    if application_id:
        app_row = next(_bq.query(
            f"SELECT * FROM `{GCP_PROJECT}.{DS_APPS}.applications` "
            f"WHERE application_id = @aid LIMIT 1",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("aid", "STRING", application_id)
            ]),
        ).result(), None)
        if app_row:
            state["application"] = dict(app_row)

        docs = list(_bq.query(
            f"SELECT document_id, filename, doc_type, gcs_uri, content_type, "
            f"size_bytes, uploaded_at "
            f"FROM `{GCP_PROJECT}.{DS_APPS}.documents` "
            f"WHERE application_id = @aid",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("aid", "STRING", application_id)
            ]),
        ).result())
        state["documents"] = [dict(d) for d in docs]

    state["context_loaded"] = True


def load_case_context(callback_context: CallbackContext) -> None:
    """ADK before_agent_callback: hydrate state AND log a STARTED event.

    Doubles as the single before-callback for every sub-agent so we get
    uniform "[AGENT] X STARTED" lines without touching each agent module.
    """
    state = callback_context.state
    _populate_state_dict(state)
    # Best-effort agent name extraction. `agent_name` is the documented
    # public attribute on CallbackContext in google-adk; fall back to
    # the invocation context if a future version renames it.
    agent_name = (
        getattr(callback_context, "agent_name", None)
        or getattr(getattr(callback_context, "_invocation_context", None), "agent", None)
        and getattr(callback_context._invocation_context.agent, "name", None)  # type: ignore[attr-defined]
        or "unknown_agent"
    )
    # Per-invocation start marker — keyed by agent_name so multiple agents
    # in the same session don't overwrite each other's timing.
    state[f"_started_mono::{agent_name}"] = time.monotonic()
    state[f"_started_iso::{agent_name}"] = _now()
    _log_event(str(agent_name), "STARTED", state.get("case_id"))


def build_initial_state(case_id: str, actor: str) -> dict:
    """Build the dict used as the initial session state for ADK runners.

    Pre-fetches the case / application / documents so individual sub-agents
    (which don't go through the root orchestrator's before_agent_callback)
    still see {case}, {application}, {documents} in their prompt placeholders.
    Also pre-seeds empty strings for all per-agent *_output keys so a
    standalone re-run of a downstream agent doesn't fail when an upstream
    agent has not produced output yet.
    """
    state: dict = {
        "case_id": case_id,
        "actor": actor,
        # Global lists for chatbot to answer aggregate questions
        "cases_list": [],
        "applications_list": [],
        # Default placeholders for the BQ-backed context so prompt templating
        # never KeyErrors even if BigQuery lookup fails (DNS, missing row,
        # quota, etc.). _populate_state_dict will overwrite these on success.
        "case": {},
        "application": {},
        "documents": [],
        # Default empty placeholders so prompt templating never KeyErrors
        # when an agent is re-run on its own and an upstream output is
        # missing. The agent prompt should treat empty strings as "not
        # available yet" and proceed using the documents in state.
        "document_intake_output": "",
        "kyc_output": "",
        "financial_output": "",
        "memo_output": "",
        "decision_output": "",
        "closing_output": "",
        "chatbot_output": "",
    }
    # For GENERAL session or chatbot, load global lists
    if case_id == "GENERAL" or case_id.startswith("ask:"):
        try:
            state["cases_list"] = list_cases()[:50]  # limit for context size
            state["applications_list"] = list_applications()[:50]
        except Exception as e:  # noqa: BLE001
            state["global_lists_error"] = str(e)
    try:
        _populate_state_dict(state)
    except Exception as e:  # noqa: BLE001
        # Don't block agent execution — they can still answer with case_id
        # even if BQ lookup fails. Surface the failure in state for debugging.
        state["context_load_error"] = str(e)
    # Hydrate the most recent persisted output for each upstream agent so
    # downstream agents (and the chatbot) see the full pipeline context
    # even when this is a fresh ADK session.
    try:
        _hydrate_agent_outputs(state, case_id)
    except Exception as e:  # noqa: BLE001
        state["agent_outputs_hydrate_error"] = str(e)
    return state


# Map BQ `agent_name` -> the session-state key the agent writes its output to.
_AGENT_NAME_TO_OUTPUT_KEY = {
    "Document_Intake_Agent":     "document_intake_output",
    "KYC_Concierge_Agent":       "kyc_output",
    "Financial_Spreading_Agent": "financial_output",
    "Credit_Memo_Agent":         "memo_output",
    "Decision_Support_Agent":    "decision_output",
    "Closing_Package_Agent":     "closing_output",
}


def _hydrate_agent_outputs(state: dict, case_id: str | None) -> None:
    """Pull the latest persisted output for each agent into session state.

    `make_persist_callback` writes a row per successful agent run into
    `{project}.{agent_outputs}.agent_runs`. To make every new ADK session
    (per-agent re-runs, chatbot, etc.) aware of the full pipeline so far,
    we read back the most recent completed run for each agent and seed
    its `*_output` key with the captured text.
    """
    if not case_id:
        return
    sql = (
        "SELECT agent_name, output, completed_at "
        f"FROM `{GCP_PROJECT}.{DS_OUT}.agent_runs` "
        "WHERE case_id = @cid AND status = 'completed' "
        "ORDER BY completed_at DESC"
    )
    rows = list(_bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("cid", "STRING", case_id)
        ]),
    ).result())
    seen: set[str] = set()
    for r in rows:
        name = r.get("agent_name")
        key = _AGENT_NAME_TO_OUTPUT_KEY.get(name)
        if not key or key in seen:
            continue
        out = r.get("output") or {}
        # `output` is stored as a JSON column with shape {"text": "..."}.
        if isinstance(out, dict):
            text = out.get("text") or ""
        else:
            text = str(out)
        if text and not state.get(key):
            state[key] = text
            seen.add(key)


def get_persisted_agent_outputs(case_id: str) -> dict:
    """Return the latest persisted output for each agent on a case.

    Used by the read-only `GET /cases/{case_id}/agent_outputs` endpoint so
    the frontend can hydrate its panels on page-load without re-running any
    agent. Keyed by the frontend-friendly short name (document_intake, kyc,
    financial, memo, decision, closing) to match `_AGENT_OUTPUT_KEY` in
    app.py.
    """
    out: dict[str, str | None] = {
        "document_intake": None,
        "kyc": None,
        "financial": None,
        "memo": None,
        "decision": None,
        "closing": None,
    }
    if not case_id:
        return out
    # Map BQ agent_name -> frontend short key.
    short = {
        "Document_Intake_Agent":     "document_intake",
        "KYC_Concierge_Agent":       "kyc",
        "Financial_Spreading_Agent": "financial",
        "Credit_Memo_Agent":         "memo",
        "Decision_Support_Agent":    "decision",
        "Closing_Package_Agent":     "closing",
    }
    sql = (
        "SELECT agent_name, output, completed_at "
        f"FROM `{GCP_PROJECT}.{DS_OUT}.agent_runs` "
        "WHERE case_id = @cid AND status = 'completed' "
        "ORDER BY completed_at DESC"
    )
    try:
        rows = list(_bq.query(
            sql,
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("cid", "STRING", case_id),
            ]),
        ).result())
    except Exception:  # noqa: BLE001
        return out
    for r in rows:
        key = short.get(r.get("agent_name"))
        if not key or out.get(key):
            continue
        o = r.get("output") or {}
        text = o.get("text") if isinstance(o, dict) else str(o)
        if text:
            out[key] = text
    return out


# ---------------------------------------------------------------------------
# Callback factory: persist an agent's output to agent_runs
# ---------------------------------------------------------------------------
def make_start_callback(agent_name: str, output_key: str):
    """Return a before_agent_callback that records start time + logs STARTED."""

    def _start(callback_context: CallbackContext) -> None:
        state = callback_context.state
        state[f"{output_key}_started_at"] = _now()
        state[f"{output_key}_started_mono"] = time.monotonic()
        _log_event(agent_name, "STARTED", state.get("case_id"))

    return _start


def make_persist_callback(agent_name: str, output_key: str):
    """Return an after_agent_callback that writes the agent's output to BQ
    and emits a single COMPLETED / FAILED log line with timing."""

    def _persist(callback_context: CallbackContext) -> None:
        state = callback_context.state
        output_text = state.get(output_key)
        case_id = state.get("case_id")
        # Prefer the agent-name-keyed start marker recorded by
        # `load_case_context`, fall back to the per-output one set by
        # `make_start_callback` if someone wired that in directly.
        started_mono = (
            state.get(f"_started_mono::{agent_name}")
            or state.get(f"{output_key}_started_mono")
        )
        dur_ms = int((time.monotonic() - started_mono) * 1000) if started_mono else None

        if not output_text:
            _log_event(
                agent_name, "FAILED", case_id, dur_ms,
                extra="error=no_output_in_state",
            )
            return

        try:
            row = {
                "run_id": str(uuid.uuid4()),
                "agent_name": agent_name,
                "case_id": case_id,
                "application_id": state.get("application_id"),
                "status": "completed",
                "started_at": (
                    state.get(f"_started_iso::{agent_name}")
                    or state.get(f"{output_key}_started_at")
                    or _now()
                ),
                "completed_at": _now(),
                "output": json.dumps({"text": str(output_text)}),
                "summary": str(output_text)[:1000],
                "error_message": None,
            }
            errors = _bq.insert_rows_json(
                f"{GCP_PROJECT}.{DS_OUT}.agent_runs", [row]
            )
            if errors:
                _log_event(
                    agent_name, "FAILED", case_id, dur_ms,
                    extra=f"error=bq_insert:{errors}",
                )
            else:
                _log_event(
                    agent_name, "COMPLETED", case_id, dur_ms,
                    extra=f"out_chars={len(str(output_text))}",
                )
        except Exception as e:  # noqa: BLE001
            _log_event(
                agent_name, "FAILED", case_id, dur_ms,
                extra=f"error={type(e).__name__}:{e}",
            )

    return _persist


# ---------------------------------------------------------------------------
# ADK tool: record the human-in-the-loop decision
# ---------------------------------------------------------------------------
def _flush_table_streaming_buffer(full_table_id: str) -> bool:
    """Flush a table's streaming buffer by copying it in-place.

    BigQuery's streaming insert puts rows in a buffer that blocks DML
    (UPDATE/DELETE/MERGE) for up to 90 minutes. Copying the table via
    CREATE OR REPLACE forces all buffered rows into regular storage,
    making them immediately available for DML.

    Args:
        full_table_id: Fully qualified table like "project.dataset.table".

    Returns:
        True if the flush succeeded, False otherwise.
    """
    try:
        _bq.query(
            f"CREATE OR REPLACE TABLE `{full_table_id}` AS "
            f"SELECT * FROM `{full_table_id}`"
        ).result()
        _logger.info("[flush_streaming_buffer] Flushed %s", full_table_id)
        return True
    except Exception as e:  # noqa: BLE001
        _logger.error("[flush_streaming_buffer] Failed for %s: %s", full_table_id, str(e)[:200])
        return False


def flush_all_streaming_buffers() -> dict:
    """Flush streaming buffers for all tables that need DML updates."""
    tables = [
        f"{GCP_PROJECT}.{DS_CASE}.cases",
        f"{GCP_PROJECT}.{DS_APPS}.applications",
    ]
    results = {}
    for t in tables:
        results[t] = _flush_table_streaming_buffer(t)
    return results


def record_human_decision(case_id: str, decision: str, actor: str) -> str:
    """Record the manager's GO / NO GO decision on a case.

    Args:
        case_id: The case identifier.
        decision: One of "APPROVED" or "REJECTED".
        actor: Email or id of the manager taking the action.

    Returns:
        Confirmation message.
    """
    now = _now()
    
    # First, get the application_id linked to this case
    application_id = None
    try:
        rows = list(_bq.query(
            f"SELECT application_id FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
            f"WHERE case_id = @cid",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("cid", "STRING", case_id)
            ]),
        ).result())
        if rows:
            application_id = rows[0].get("application_id")
    except Exception as e:
        _logger.warning("[record_human_decision] Failed to get application_id: %s", e)
    
    # STEP 1: Update the cases table
    case_update_ok = False
    case_update_error = None
    try:
        _bq.query(
            f"UPDATE `{GCP_PROJECT}.{DS_CASE}.cases` "
            f"SET decision = @dec, decision_at = TIMESTAMP(@ts), "
            f"decision_by = @actor, status = @dec, updated_at = TIMESTAMP(@ts) "
            f"WHERE case_id = @cid",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("dec", "STRING", decision),
                bigquery.ScalarQueryParameter("ts", "STRING", now),
                bigquery.ScalarQueryParameter("actor", "STRING", actor),
                bigquery.ScalarQueryParameter("cid", "STRING", case_id),
            ]),
        ).result()
        case_update_ok = True
        _logger.info(
            "[record_human_decision] cases table updated. case_id=%s, decision=%s",
            case_id, decision
        )
    except Exception as e:  # noqa: BLE001
        case_update_error = str(e)
        # If it's a streaming buffer error, auto-flush and retry ONCE
        if "streaming buffer" in str(e).lower():
            _logger.info("[record_human_decision] Streaming buffer detected for cases, flushing...")
            if _flush_table_streaming_buffer(f"{GCP_PROJECT}.{DS_CASE}.cases"):
                try:
                    _bq.query(
                        f"UPDATE `{GCP_PROJECT}.{DS_CASE}.cases` "
                        f"SET decision = @dec, decision_at = TIMESTAMP(@ts), "
                        f"decision_by = @actor, status = @dec, updated_at = TIMESTAMP(@ts) "
                        f"WHERE case_id = @cid",
                        job_config=bigquery.QueryJobConfig(query_parameters=[
                            bigquery.ScalarQueryParameter("dec", "STRING", decision),
                            bigquery.ScalarQueryParameter("ts", "STRING", now),
                            bigquery.ScalarQueryParameter("actor", "STRING", actor),
                            bigquery.ScalarQueryParameter("cid", "STRING", case_id),
                        ]),
                    ).result()
                    case_update_ok = True
                    case_update_error = None
                    _logger.info(
                        "[record_human_decision] cases table updated after flush. case_id=%s",
                        case_id
                    )
                except Exception as e2:  # noqa: BLE001
                    case_update_error = str(e2)
                    _logger.error(
                        "[record_human_decision] Update still failed after flush. error=%s",
                        str(e2)[:200]
                    )
        else:
            _logger.error(
                "[record_human_decision] Failed to update cases table. case_id=%s, error=%s",
                case_id, str(e)[:200]
            )
    
    # STEP 2: Update the applications table
    app_update_ok = False
    app_update_error = None
    if application_id:
        app_status = "Approved" if decision == "APPROVED" else "Rejected"
        try:
            _bq.query(
                f"UPDATE `{GCP_PROJECT}.{DS_APPS}.applications` "
                f"SET status = @status, reviewed_by = @actor, updated_at = TIMESTAMP(@ts) "
                f"WHERE application_id = @aid",
                job_config=bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("status", "STRING", app_status),
                    bigquery.ScalarQueryParameter("actor", "STRING", actor),
                    bigquery.ScalarQueryParameter("ts", "STRING", now),
                    bigquery.ScalarQueryParameter("aid", "STRING", application_id),
                ]),
            ).result()
            app_update_ok = True
            _logger.info(
                "[record_human_decision] applications table updated. application_id=%s, status=%s",
                application_id, app_status
            )
        except Exception as e:  # noqa: BLE001
            app_update_error = str(e)
            # If it's a streaming buffer error, auto-flush and retry ONCE
            if "streaming buffer" in str(e).lower():
                _logger.info("[record_human_decision] Streaming buffer detected for applications, flushing...")
                if _flush_table_streaming_buffer(f"{GCP_PROJECT}.{DS_APPS}.applications"):
                    try:
                        _bq.query(
                            f"UPDATE `{GCP_PROJECT}.{DS_APPS}.applications` "
                            f"SET status = @status, reviewed_by = @actor, updated_at = TIMESTAMP(@ts) "
                            f"WHERE application_id = @aid",
                            job_config=bigquery.QueryJobConfig(query_parameters=[
                                bigquery.ScalarQueryParameter("status", "STRING", app_status),
                                bigquery.ScalarQueryParameter("actor", "STRING", actor),
                                bigquery.ScalarQueryParameter("ts", "STRING", now),
                                bigquery.ScalarQueryParameter("aid", "STRING", application_id),
                            ]),
                        ).result()
                        app_update_ok = True
                        app_update_error = None
                        _logger.info(
                            "[record_human_decision] applications table updated after flush. "
                            "application_id=%s", application_id
                        )
                    except Exception as e2:  # noqa: BLE001
                        app_update_error = str(e2)
                        _logger.error(
                            "[record_human_decision] Update still failed after flush. error=%s",
                            str(e2)[:200]
                        )
            else:
                _logger.error(
                    "[record_human_decision] Failed to update applications table. "
                    "application_id=%s, error=%s", application_id, str(e)[:200]
                )

    # STEP 3: Always record the audit log (this is the authoritative record)
    try:
        _bq.insert_rows_json(
            f"{GCP_PROJECT}.{DS_CASE}.case_audit_log",
            [{
                "event_id": str(uuid.uuid4()),
                "case_id": case_id,
                "application_id": application_id,
                "action": f"decision_{decision.lower()}",
                "actor": actor,
                "timestamp": now,
                "details": json.dumps({
                    "decision": decision,
                    "case_update_ok": case_update_ok,
                    "app_update_ok": app_update_ok,
                    "case_error": case_update_error,
                    "app_error": app_update_error,
                }),
            }],
        )
    except Exception as e:  # noqa: BLE001
        _logger.error(
            "[record_human_decision] Failed to insert audit log. case_id=%s, error=%s",
            case_id, str(e)[:200]
        )
    
    # STEP 4: Build status response
    if case_update_ok and app_update_ok:
        status = "recorded (case + application updated)"
    elif case_update_ok:
        status = "recorded (case updated, application update failed)"
    elif app_update_ok:
        status = "recorded (application updated, case update failed)"
    else:
        status = "recorded in audit log only (table updates failed)"
    
    _logger.info(
        "[record_human_decision] Final: %s. case_id=%s, decision=%s",
        status, case_id, decision
    )
    
    return f"Decision {decision} for case {case_id} by {actor}: {status}"


# ---------------------------------------------------------------------------
# Plumbing helpers used by FastAPI (not by the LLM)
# ---------------------------------------------------------------------------
def list_cases() -> list[dict]:
    """List all cases from the case_management.cases table."""
    rows = _bq.query(
        f"SELECT case_id, application_id, ticket_id, status, created_at, updated_at, "
        f"assigned_rm, kyc_approved, kyc_approved_at, kyc_approved_by, "
        f"decision, decision_at, decision_by "
        f"FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
        f"ORDER BY created_at DESC LIMIT 500"
    ).result()
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


def get_case(case_id: str) -> dict | None:
    """Fetch a single case by case_id from BigQuery."""
    try:
        rows = list(_bq.query(
            f"SELECT case_id, application_id, ticket_id, status, created_at, updated_at, "
            f"assigned_rm, kyc_approved, kyc_approved_at, kyc_approved_by, "
            f"decision, decision_at, decision_by "
            f"FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
            f"WHERE case_id = @cid",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("cid", "STRING", case_id)
            ]),
        ).result())
        if not rows:
            return None
        d = dict(rows[0])
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        return d
    except Exception as e:  # noqa: BLE001
        _logger.error("[get_case] Failed to fetch case %s: %s", case_id, str(e))
        return None


def create_case(application_id: str, assigned_rm: str) -> dict:
    """Create a case row for an application and return the case dict.

    Uses DML INSERT (not streaming insert_rows_json) so the row is
    immediately available for UPDATE/MERGE in record_human_decision.
    Streaming-inserted rows sit in a buffer for up to 90 min and block DML.
    
    IDEMPOTENT: If a case already exists for this application_id, returns the
    existing case instead of creating a duplicate.
    """
    # Check if a case already exists for this application
    existing = next(_bq.query(
        f"SELECT * FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
        f"WHERE application_id = @app_id ORDER BY created_at DESC LIMIT 1",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("app_id", "STRING", application_id)
        ]),
    ).result(), None)
    
    if existing:
        _logger.info("[create_case] Case %s already exists for application %s, returning existing", 
                     existing.case_id, application_id)
        return dict(existing)
    
    case_id = f"CASE-{uuid.uuid4().hex[:8].upper()}"
    now = _now()
    row = {
        "case_id": case_id,
        "application_id": application_id,
        "ticket_id": None,
        "status": "OPEN",
        "created_at": now,
        "updated_at": now,
        "assigned_rm": assigned_rm,
        "kyc_approved": None,
        "kyc_approved_at": None,
        "kyc_approved_by": None,
        "decision": None,
        "decision_at": None,
        "decision_by": None,
    }
    # DML INSERT — bypasses streaming buffer so later UPDATEs work instantly
    _bq.query(
        f"INSERT INTO `{GCP_PROJECT}.{DS_CASE}.cases` "
        f"(case_id, application_id, ticket_id, status, created_at, updated_at, "
        f" assigned_rm, kyc_approved, kyc_approved_at, kyc_approved_by, "
        f" decision, decision_at, decision_by) "
        f"VALUES (@case_id, @app_id, @ticket_id, @status, TIMESTAMP(@created), "
        f"TIMESTAMP(@updated), @rm, @kyc_ok, @kyc_at, @kyc_by, @dec, @dec_at, @dec_by)",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("case_id", "STRING", case_id),
            bigquery.ScalarQueryParameter("app_id", "STRING", application_id),
            bigquery.ScalarQueryParameter("ticket_id", "STRING", None),
            bigquery.ScalarQueryParameter("status", "STRING", "OPEN"),
            bigquery.ScalarQueryParameter("created", "STRING", now),
            bigquery.ScalarQueryParameter("updated", "STRING", now),
            bigquery.ScalarQueryParameter("rm", "STRING", assigned_rm),
            bigquery.ScalarQueryParameter("kyc_ok", "BOOL", None),
            bigquery.ScalarQueryParameter("kyc_at", "STRING", None),
            bigquery.ScalarQueryParameter("kyc_by", "STRING", None),
            bigquery.ScalarQueryParameter("dec", "STRING", None),
            bigquery.ScalarQueryParameter("dec_at", "STRING", None),
            bigquery.ScalarQueryParameter("dec_by", "STRING", None),
        ]),
    ).result()
    # Audit log can stay streaming — we never UPDATE audit rows
    _bq.insert_rows_json(
        f"{GCP_PROJECT}.{DS_CASE}.case_audit_log",
        [{
            "event_id": str(uuid.uuid4()),
            "case_id": case_id,
            "application_id": application_id,
            "action": "case_created",
            "actor": assigned_rm,
            "timestamp": now,
            "details": json.dumps({}),
        }],
    )
    _logger.info("[create_case] Created case %s for application %s (DML INSERT)", case_id, application_id)
    return row


# ---------------------------------------------------------------------------
# before_model_callback factory: attach GCS document files to the LLM request
# ---------------------------------------------------------------------------
def make_attach_documents_callback(
    doc_type_prefixes: tuple[str, ...] | None = None,
    filename_keywords: tuple[str, ...] | None = None,
):
    """Return a before_model_callback that appends document files to the prompt.

    Gemini on Vertex AI can read PDFs / images directly from a `gs://` URI
    (passed as `Part.from_uri`). This callback walks `state["documents"]`
    and attaches every file whose mime type Gemini understands.

    Args:
        doc_type_prefixes: optional filter on the BQ `doc_type` column
            (e.g. ("financial",) for the financial agent). None = all.
        filename_keywords: fallback substring match on the filename. Used
            when `doc_type` is missing / generic (e.g. "Other") so the
            agent still receives the right files even when upload-time
            classification is weak. If a doc matches EITHER the doc_type
            prefix OR any filename keyword, it is attached.
    """

    def _attach(callback_context: CallbackContext, llm_request: LlmRequest):
        # Only attach documents on the FIRST model call (before any tool
        # interactions). Re-attaching after a tool response inserts a "user"
        # message after a function_response which breaks the conversation
        # structure and causes the model to produce no text output.
        for content in llm_request.contents:
            if content.role == "model" and content.parts:
                for p in content.parts:
                    if getattr(p, "function_call", None) is not None:
                        return None  # tool-calling turn — skip re-attach

        docs = callback_context.state.get("documents") or []
        if not docs:
            return None

        parts: list[types.Part] = []
        attached_index: list[str] = []
        for d in docs:
            mime = (d.get("content_type") or "").lower()
            uri = d.get("gcs_uri")
            if not uri or mime not in _GEMINI_NATIVE_MIME:
                continue
            if doc_type_prefixes or filename_keywords:
                dt = (d.get("doc_type") or "").lower()
                fn = (d.get("filename") or "").lower()
                type_match = bool(doc_type_prefixes) and any(
                    dt.startswith(p) for p in doc_type_prefixes
                )
                name_match = bool(filename_keywords) and any(
                    kw in fn for kw in filename_keywords
                )
                if not (type_match or name_match):
                    continue
            parts.append(types.Part.from_uri(file_uri=uri, mime_type=mime))
            attached_index.append(
                f"- {d.get('filename')} (doc_type={d.get('doc_type')}, mime={mime})"
            )

        if not parts:
            return None

        # Prepend a small header so the LLM knows what these files are.
        header = types.Part.from_text(
            text=(
                "The following document files are attached for you to read directly:\n"
                + "\n".join(attached_index)
            )
        )
        llm_request.contents.append(
            types.Content(role="user", parts=[header, *parts])
        )
        return None

    return _attach


# ---------------------------------------------------------------------------
# Customer-portal plumbing: applications + GCS document uploads
# ---------------------------------------------------------------------------
def _new_app_id() -> str:
    return f"APP-{uuid.uuid4().hex[:6].upper()}"


def _new_ticket_id() -> str:
    return f"TKT-{uuid.uuid4().hex[:6].upper()}"


def _new_doc_id() -> str:
    return f"DOC-{uuid.uuid4().hex[:8].upper()}"


def create_application(form_data: dict) -> dict:
    """Insert a new applications row from the customer portal form data.

    Uses DML INSERT (not streaming insert_rows_json) so the row is
    immediately available for UPDATE in record_human_decision.
    """
    application_id = _new_app_id()
    ticket_id = _new_ticket_id()
    now = _now()
    fd = form_data or {}
    owner_email = fd.get("ownerEmail") or fd.get("owner_email")
    business_legal_name = fd.get("businessLegalName") or fd.get("business_legal_name")
    loan_amount = str(fd.get("loanAmount") or fd.get("loan_amount") or "")
    loan_purpose = fd.get("loanPurpose") or fd.get("loan_purpose")
    form_data_json = json.dumps(fd)

    # DML INSERT — bypasses streaming buffer so later UPDATEs work instantly
    _bq.query(
        f"INSERT INTO `{GCP_PROJECT}.{DS_APPS}.applications` "
        f"(application_id, ticket_id, status, submitted_at, updated_at, "
        f" owner_email, business_legal_name, loan_amount, loan_purpose, "
        f" form_data, reviewed_by, review_note) "
        f"VALUES (@app_id, @ticket_id, @status, TIMESTAMP(@submitted), "
        f"TIMESTAMP(@updated), @email, @biz_name, @amount, @purpose, "
        f"PARSE_JSON(@form_data), @reviewed_by, @review_note)",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("app_id", "STRING", application_id),
            bigquery.ScalarQueryParameter("ticket_id", "STRING", ticket_id),
            bigquery.ScalarQueryParameter("status", "STRING", "Pending Review"),
            bigquery.ScalarQueryParameter("submitted", "STRING", now),
            bigquery.ScalarQueryParameter("updated", "STRING", now),
            bigquery.ScalarQueryParameter("email", "STRING", owner_email),
            bigquery.ScalarQueryParameter("biz_name", "STRING", business_legal_name),
            bigquery.ScalarQueryParameter("amount", "STRING", loan_amount),
            bigquery.ScalarQueryParameter("purpose", "STRING", loan_purpose),
            bigquery.ScalarQueryParameter("form_data", "STRING", form_data_json),
            bigquery.ScalarQueryParameter("reviewed_by", "STRING", None),
            bigquery.ScalarQueryParameter("review_note", "STRING", None),
        ]),
    ).result()
    _logger.info("[create_application] Created application %s (DML INSERT)", application_id)
    return {"application_id": application_id, "ticket_id": ticket_id, "status": "Pending Review"}


def list_applications() -> list[dict]:
    rows = _bq.query(
        f"SELECT application_id, ticket_id, status, submitted_at, updated_at, "
        f"owner_email, business_legal_name, loan_amount, loan_purpose, "
        f"form_data, reviewed_by, review_note "
        f"FROM `{GCP_PROJECT}.{DS_APPS}.applications` "
        f"ORDER BY submitted_at DESC LIMIT 500"
    ).result()
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


def list_customer_applications(email: str) -> list[dict]:
    if not email:
        return []
    rows = _bq.query(
        f"SELECT application_id, ticket_id, status, submitted_at, updated_at, "
        f"owner_email, business_legal_name, loan_amount, loan_purpose, "
        f"form_data, reviewed_by, review_note "
        f"FROM `{GCP_PROJECT}.{DS_APPS}.applications` "
        f"WHERE LOWER(owner_email) = LOWER(@email) "
        f"ORDER BY submitted_at DESC",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("email", "STRING", email)
        ]),
    ).result()
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


def get_application(application_id: str) -> dict | None:
    row = next(_bq.query(
        f"SELECT * FROM `{GCP_PROJECT}.{DS_APPS}.applications` "
        f"WHERE application_id = @aid LIMIT 1",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id)
        ]),
    ).result(), None)
    if not row:
        return None
    d = dict(row)
    for k, v in list(d.items()):
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


def list_documents(application_id: str) -> list[dict]:
    rows = _bq.query(
        f"SELECT document_id, application_id, filename, gcs_uri, gcs_path, "
        f"content_type, size_bytes, doc_type, uploaded_at, uploaded_by "
        f"FROM `{GCP_PROJECT}.{DS_APPS}.documents` "
        f"WHERE application_id = @aid ORDER BY uploaded_at DESC",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id)
        ]),
    ).result()
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
        out.append(d)
    return out


def summarize_document(application_id: str, document_id: str) -> dict:
    """Run Gemini directly on a single uploaded document and return a markdown
    summary. Used by the per-document "View Summary" button on the UI.

    PERSISTENCE: the result is cached in GCS at
    `gs://{BUCKET}/summaries/{document_id}.json`. On subsequent calls the
    cached JSON is returned immediately — no Gemini call, no cost. The
    cache survives browser clears, different machines, and zip transfers.
    Only the "Reset Case" button (or manually deleting the sidecar object)
    forces a re-summarization.
    """
    # 1. Check GCS sidecar cache first.
    cache_path = f"summaries/{document_id}.json"
    if GCS_BUCKET:
        try:
            cache_blob = _gcs.bucket(GCS_BUCKET).blob(cache_path)
            if cache_blob.exists():
                cached_raw = cache_blob.download_as_bytes()
                cached = json.loads(cached_raw.decode("utf-8"))
                if cached.get("summary"):
                    return cached
        except Exception:
            pass  # fall through to fresh summarize on any cache read error

    rows = list(_bq.query(
        f"SELECT document_id, filename, doc_type, gcs_uri, content_type "
        f"FROM `{GCP_PROJECT}.{DS_APPS}.documents` "
        f"WHERE application_id = @aid AND document_id = @did LIMIT 1",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id),
            bigquery.ScalarQueryParameter("did", "STRING", document_id),
        ]),
    ).result())
    if not rows:
        raise RuntimeError("document not found")
    d = dict(rows[0])
    mime = (d.get("content_type") or "").lower()
    uri = d.get("gcs_uri")
    if not uri:
        raise RuntimeError("document has no gcs_uri")
    if mime not in _GEMINI_NATIVE_MIME:
        result = {
            "document_id": document_id,
            "filename": d.get("filename"),
            "doc_type": d.get("doc_type"),
            "summary": (
                f"Cannot natively summarize `{d.get('filename')}` — Gemini does "
                f"not accept `{mime}` directly. Convert to PDF and re-upload."
            ),
        }
        # Cache even the unsupported-mime stub so we don't keep re-checking.
        if GCS_BUCKET:
            try:
                _gcs.bucket(GCS_BUCKET).blob(cache_path).upload_from_string(
                    json.dumps(result), content_type="application/json",
                )
            except Exception:
                pass
        return result

    from google import genai as _genai  # local import to avoid hard dep at import time
    client = _genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )
    model = os.getenv("MODEL", "gemini-2.5-flash")
    prompt = (
        f"You are reviewing a single document attached to a commercial loan "
        f"application.\n\n"
        f"Filename: {d.get('filename')}\n"
        f"Document type hint: {d.get('doc_type') or 'unknown'}\n\n"
        f"Analyze this document and provide a CONCISE structured response with these sections ONLY:\n\n"
        f"## Document Classification\n"
        f"- **Category:** [Financial Statements / Business Documents / Identity Documents / "
        f"Loan Application / Collateral Documents / Bank Statements / Legal Documents / Other]\n"
        f"- **Sub-Type:** [e.g., Balance Sheet, Tax Return, Business License, etc.]\n\n"
        f"## Key Data Extracted\n"
        f"Extract and list the most important data points from this document (max 8-10 bullet points):\n"
        f"- Names, IDs, registration numbers\n"
        f"- Addresses, dates, amounts\n"
        f"- Financial figures (revenue, assets, liabilities)\n\n"
        f"## Summary\n"
        f"Provide a 2-3 sentence summary of what this document contains and its purpose.\n\n"
        f"Keep the response brief and to the point. Do not include validation checklists or quality assessments. "
        f"Do not invent facts that aren't in the file. Mark unknown fields as 'Not found'."
    )
    resp = client.models.generate_content(
        model=model,
        contents=types.Content(role="user", parts=[
            types.Part.from_text(text=prompt),
            types.Part.from_uri(file_uri=uri, mime_type=mime),
        ]),
    )
    text = (resp.text or "").strip() if hasattr(resp, "text") else ""
    if not text and getattr(resp, "candidates", None):
        for c in resp.candidates:
            for p in (getattr(c.content, "parts", None) or []):
                if getattr(p, "text", None):
                    text += p.text
    result = {
        "document_id": document_id,
        "filename": d.get("filename"),
        "doc_type": d.get("doc_type"),
        "summary": text or "(empty response)",
    }
    # 2. Persist to GCS sidecar so future calls are instant and free.
    if GCS_BUCKET and text:
        try:
            _gcs.bucket(GCS_BUCKET).blob(cache_path).upload_from_string(
                json.dumps(result), content_type="application/json",
            )
        except Exception:
            pass
    return result


def get_document_signed_url(application_id: str, document_id: str, expiration_minutes: int = 60) -> dict:
    """Generate a signed URL for a document in GCS.
    
    Returns a dict with the signed URL that can be used to download/view the document.
    The URL expires after the specified number of minutes (default: 60).
    """
    if not GCS_BUCKET:
        raise RuntimeError("GCS_BUCKET env var not set")
    
    # Look up the document in BQ
    rows = list(_bq.query(
        f"SELECT document_id, filename, gcs_uri, gcs_path, content_type "
        f"FROM `{GCP_PROJECT}.{DS_APPS}.documents` "
        f"WHERE application_id = @aid AND document_id = @did LIMIT 1",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id),
            bigquery.ScalarQueryParameter("did", "STRING", document_id),
        ]),
    ).result())
    
    if not rows:
        raise RuntimeError("Document not found")
    
    doc = dict(rows[0])
    gcs_path = doc.get("gcs_path")
    gcs_uri = doc.get("gcs_uri")
    if not gcs_path:
        raise RuntimeError("Document has no GCS path")
    
    # Try to generate signed URL, fall back to returning GCS URI
    from datetime import timedelta
    try:
        blob = _gcs.bucket(GCS_BUCKET).blob(gcs_path)
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method="GET",
        )
    except Exception as e:
        # If signed URL generation fails (e.g., no service account key),
        # return the GCS URI which can be used in Google Cloud Console
        # or construct a public URL if the bucket is public
        return {
            "document_id": document_id,
            "filename": doc.get("filename"),
            "content_type": doc.get("content_type"),
            "signed_url": f"https://storage.cloud.google.com/{GCS_BUCKET}/{gcs_path}",
            "gcs_uri": gcs_uri,
            "expires_in_minutes": None,
            "note": "Using direct GCS URL (requires Google auth)",
        }
    
    return {
        "document_id": document_id,
        "filename": doc.get("filename"),
        "content_type": doc.get("content_type"),
        "signed_url": signed_url,
        "expires_in_minutes": expiration_minutes,
    }


def upload_document(
    application_id: str,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    doc_type: str | None = None,
    uploaded_by: str | None = None,
) -> dict:
    """Upload one file to GCS and insert a documents row in BQ."""
    if not GCS_BUCKET:
        raise RuntimeError("GCS_BUCKET env var not set")
    safe_name = filename.replace("\\", "/").split("/")[-1]
    gcs_path = f"{application_id}/{uuid.uuid4().hex[:8]}_{safe_name}"
    blob = _gcs.bucket(GCS_BUCKET).blob(gcs_path)
    blob.upload_from_string(file_bytes, content_type=content_type or "application/octet-stream")
    gcs_uri = f"gs://{GCS_BUCKET}/{gcs_path}"

    document_id = _new_doc_id()
    now = _now()
    row = {
        "document_id": document_id,
        "application_id": application_id,
        "case_id": None,
        "filename": safe_name,
        "gcs_uri": gcs_uri,
        "gcs_path": gcs_path,
        "content_type": content_type,
        "size_bytes": len(file_bytes),
        "doc_type": doc_type,
        "uploaded_at": now,
        "uploaded_by": uploaded_by,
    }
    errors = _bq.insert_rows_json(
        f"{GCP_PROJECT}.{DS_APPS}.documents", [row]
    )
    if errors:
        raise RuntimeError(f"BQ insert failed: {errors}")
    return {
        "document_id": document_id,
        "filename": safe_name,
        "gcs_uri": gcs_uri,
        "gcs_path": gcs_path,
        "content_type": content_type,
        "size_bytes": len(file_bytes),
        "doc_type": doc_type,
    }


# ---------------------------------------------------------------------------
# Financial Anomaly Detection Tool
# ---------------------------------------------------------------------------
def _legacy_detect_financial_anomalies(
    revenue: float | None = None,
    prior_revenue: float | None = None,
    net_income: float | None = None,
    prior_net_income: float | None = None,
    total_assets: float | None = None,
    total_liabilities: float | None = None,
    current_assets: float | None = None,
    current_liabilities: float | None = None,
    operating_expenses: float | None = None,
    cost_of_goods_sold: float | None = None,
    interest_expense: float | None = None,
    ebitda: float | None = None,
) -> dict:
    """
    Analyze financial data for anomalies and calculate confidence scores.
    
    Returns anomaly flags, risk indicators, and a confidence assessment
    for the financial data quality and consistency.
    """
    anomalies = []
    warnings = []
    ratios = {}
    confidence_factors = []
    
    # === Revenue Growth Analysis ===
    if revenue is not None and prior_revenue is not None and prior_revenue > 0:
        revenue_growth = ((revenue - prior_revenue) / prior_revenue) * 100
        ratios["revenue_growth_pct"] = round(revenue_growth, 2)
        
        if revenue_growth > 100:
            anomalies.append({
                "type": "EXTREME_REVENUE_GROWTH",
                "severity": "high",
                "value": revenue_growth,
                "threshold": 100,
                "message": f"Revenue grew {revenue_growth:.1f}% YoY - requires verification"
            })
        elif revenue_growth > 50:
            warnings.append({
                "type": "HIGH_REVENUE_GROWTH",
                "severity": "medium",
                "value": revenue_growth,
                "message": f"Revenue grew {revenue_growth:.1f}% YoY - above typical range"
            })
        elif revenue_growth < -30:
            anomalies.append({
                "type": "SIGNIFICANT_REVENUE_DECLINE",
                "severity": "high",
                "value": revenue_growth,
                "message": f"Revenue declined {abs(revenue_growth):.1f}% YoY - material concern"
            })
        confidence_factors.append(("revenue_trend", 0.9 if -30 <= revenue_growth <= 50 else 0.6))
    
    # === Profit Margin Analysis ===
    if revenue is not None and net_income is not None and revenue > 0:
        profit_margin = (net_income / revenue) * 100
        ratios["profit_margin_pct"] = round(profit_margin, 2)
        
        if profit_margin > 40:
            warnings.append({
                "type": "UNUSUALLY_HIGH_MARGIN",
                "severity": "medium",
                "value": profit_margin,
                "message": f"Profit margin {profit_margin:.1f}% is unusually high - verify accuracy"
            })
        elif profit_margin < -20:
            anomalies.append({
                "type": "SEVERE_LOSSES",
                "severity": "high",
                "value": profit_margin,
                "message": f"Net loss margin of {abs(profit_margin):.1f}% indicates distress"
            })
        confidence_factors.append(("margin_reasonableness", 0.85 if -10 <= profit_margin <= 30 else 0.5))
    
    # === Leverage Analysis ===
    if total_assets is not None and total_liabilities is not None and total_assets > 0:
        debt_to_assets = (total_liabilities / total_assets) * 100
        ratios["debt_to_assets_pct"] = round(debt_to_assets, 2)
        
        equity = total_assets - total_liabilities
        if equity > 0:
            debt_to_equity = total_liabilities / equity
            ratios["debt_to_equity"] = round(debt_to_equity, 2)
            
            if debt_to_equity > 4:
                anomalies.append({
                    "type": "EXCESSIVE_LEVERAGE",
                    "severity": "high",
                    "value": debt_to_equity,
                    "threshold": 4,
                    "message": f"Debt-to-equity ratio of {debt_to_equity:.2f} indicates high risk"
                })
            elif debt_to_equity > 2:
                warnings.append({
                    "type": "HIGH_LEVERAGE",
                    "severity": "medium",
                    "value": debt_to_equity,
                    "message": f"Debt-to-equity ratio of {debt_to_equity:.2f} is elevated"
                })
        elif equity <= 0:
            anomalies.append({
                "type": "NEGATIVE_EQUITY",
                "severity": "critical",
                "value": equity,
                "message": "Negative shareholder equity - technical insolvency"
            })
        confidence_factors.append(("leverage_health", 0.9 if debt_to_assets < 70 else 0.5))
    
    # === Liquidity Analysis ===
    if current_assets is not None and current_liabilities is not None and current_liabilities > 0:
        current_ratio = current_assets / current_liabilities
        ratios["current_ratio"] = round(current_ratio, 2)
        
        if current_ratio < 1:
            anomalies.append({
                "type": "LIQUIDITY_CRISIS",
                "severity": "high",
                "value": current_ratio,
                "threshold": 1.0,
                "message": f"Current ratio {current_ratio:.2f} below 1.0 - liquidity risk"
            })
        elif current_ratio < 1.2:
            warnings.append({
                "type": "LOW_LIQUIDITY",
                "severity": "medium",
                "value": current_ratio,
                "message": f"Current ratio {current_ratio:.2f} is tight"
            })
        confidence_factors.append(("liquidity_position", 0.9 if current_ratio >= 1.2 else 0.6))
    
    # === Interest Coverage Analysis ===
    if ebitda is not None and interest_expense is not None and interest_expense > 0:
        interest_coverage = ebitda / interest_expense
        ratios["interest_coverage"] = round(interest_coverage, 2)
        
        if interest_coverage < 1.5:
            anomalies.append({
                "type": "DEBT_SERVICE_RISK",
                "severity": "high",
                "value": interest_coverage,
                "threshold": 1.5,
                "message": f"Interest coverage {interest_coverage:.2f}x is dangerously low"
            })
        elif interest_coverage < 2.5:
            warnings.append({
                "type": "WEAK_COVERAGE",
                "severity": "medium",
                "value": interest_coverage,
                "message": f"Interest coverage {interest_coverage:.2f}x leaves limited margin"
            })
        confidence_factors.append(("debt_service", 0.9 if interest_coverage >= 2.5 else 0.6))
    
    # === Cost Structure Analysis ===
    if revenue is not None and cost_of_goods_sold is not None and revenue > 0:
        gross_margin = ((revenue - cost_of_goods_sold) / revenue) * 100
        ratios["gross_margin_pct"] = round(gross_margin, 2)
        
        if gross_margin < 10:
            warnings.append({
                "type": "THIN_MARGINS",
                "severity": "medium",
                "value": gross_margin,
                "message": f"Gross margin of {gross_margin:.1f}% is very thin"
            })
    
    if revenue is not None and operating_expenses is not None and revenue > 0:
        opex_ratio = (operating_expenses / revenue) * 100
        ratios["opex_to_revenue_pct"] = round(opex_ratio, 2)
        
        if opex_ratio > 80:
            anomalies.append({
                "type": "EXCESSIVE_OPERATING_COSTS",
                "severity": "high",
                "value": opex_ratio,
                "message": f"Operating expenses at {opex_ratio:.1f}% of revenue is unsustainable"
            })
    
    # === Data Completeness Check ===
    required_fields = [revenue, net_income, total_assets, total_liabilities]
    fields_provided = sum(1 for f in required_fields if f is not None)
    data_completeness = (fields_provided / len(required_fields)) * 100
    
    if data_completeness < 50:
        warnings.append({
            "type": "INCOMPLETE_DATA",
            "severity": "medium",
            "value": data_completeness,
            "message": f"Only {data_completeness:.0f}% of key financial fields provided"
        })
    
    # === Calculate Overall Confidence Score ===
    if confidence_factors:
        avg_confidence = sum(score for _, score in confidence_factors) / len(confidence_factors)
    else:
        avg_confidence = 0.5  # Low confidence if no factors computed
    
    # Penalize for anomalies and warnings
    anomaly_penalty = len(anomalies) * 0.1
    warning_penalty = len(warnings) * 0.05
    final_confidence = max(0, min(1, avg_confidence - anomaly_penalty - warning_penalty))
    confidence_pct = round(final_confidence * 100, 1)
    
    # Determine risk level
    if len(anomalies) >= 2 or confidence_pct < 40:
        risk_level = "High"
    elif len(anomalies) == 1 or len(warnings) >= 3 or confidence_pct < 60:
        risk_level = "Medium"
    else:
        risk_level = "Low"
    
    return {
        "anomalies": anomalies,
        "warnings": warnings,
        "ratios": ratios,
        "confidence_score": confidence_pct,
        "risk_level": risk_level,
        "data_completeness_pct": round(data_completeness, 1),
        "factors_analyzed": len(confidence_factors),
        "summary": {
            "total_anomalies": len(anomalies),
            "total_warnings": len(warnings),
            "critical_issues": sum(1 for a in anomalies if a.get("severity") == "critical"),
            "high_severity_issues": sum(1 for a in anomalies if a.get("severity") == "high"),
        }
    }


def detect_financial_anomalies(
    revenue: float | None = None,
    prior_revenue: float | None = None,
    net_income: float | None = None,
    prior_net_income: float | None = None,
    total_assets: float | None = None,
    total_liabilities: float | None = None,
    current_assets: float | None = None,
    current_liabilities: float | None = None,
    operating_expenses: float | None = None,
    cost_of_goods_sold: float | None = None,
    interest_expense: float | None = None,
    ebitda: float | None = None,
    debt_service: float | None = None,
    total_debt: float | None = None,
    total_equity: float | None = None,
    collateral_value: float | None = None,
    loan_amount: float | None = None,
    industry_code: str = "DEFAULT",
    loan_type: str = "corporate",
) -> dict:
    """Run the full financial-anomaly + PD/LGD pipeline on a borrower.

    Wraps the standalone `financial_anomaly_tool` package (Isolation Forest
    + policy thresholds + PD scorecard + LGD by collateral coverage +
    combined credit decision). When that package is unavailable, falls back
    to the lightweight in-process heuristic.

    Args:
        revenue, ebitda, net_income, interest_expense, debt_service,
        total_debt, total_equity, current_assets, current_liabilities,
        collateral_value, loan_amount: raw financial line items.
        industry_code: e.g. MANUFACTURING, TECHNOLOGY, REAL_ESTATE.
        loan_type: 'secured', 'auto', or 'corporate'.

        prior_revenue, prior_net_income, total_assets, total_liabilities,
        operating_expenses, cost_of_goods_sold: kept for backward-compat
        with the older heuristic / fallback path.

    Returns:
        On success: dict with `calculated_ratios`, `policy_thresholds`,
        `threshold_breaches`, `anomaly_detection`, `pd_assessment`,
        `lgd_assessment`, `credit_decision`, `confidence_report`, plus
        legacy keys `ratios`, `risk_level`, `confidence_score` for the
        existing prompt/UI to keep working.
    """
    # Build the financials dict the standalone pipeline expects.
    financials = {
        "revenue": revenue,
        "ebitda": ebitda,
        "net_income": net_income,
        "interest_expense": interest_expense,
        "debt_service": debt_service,
        "total_debt": total_debt if total_debt is not None else total_liabilities,
        "total_equity": (
            total_equity
            if total_equity is not None
            else (
                (total_assets - total_liabilities)
                if (total_assets is not None and total_liabilities is not None)
                else None
            )
        ),
        "current_assets": current_assets,
        "current_liabilities": current_liabilities,
        "collateral_value": collateral_value,
        "loan_amount": loan_amount,
    }

    if _FA_TOOL_AVAILABLE and _fa_detect_financial_anomalies is not None:
        try:
            result = _fa_detect_financial_anomalies(
                financials, industry_code or "DEFAULT", loan_type or "corporate"
            )
            # Surface flat aliases the existing prompt/dashboard already use.
            ratios = result.get("calculated_ratios") or {}
            anomaly_block = result.get("anomaly_detection") or {}
            confidence_block = result.get("confidence_report") or {}
            credit_decision = result.get("credit_decision") or {}
            pd_assessment = result.get("pd_assessment") or {}
            overall_score = anomaly_block.get("overall_anomaly_score") or 0.0

            # Use PD-based risk_level (Low/Moderate/High/Very High) — NOT anomaly-based
            pd_risk_level = pd_assessment.get("risk_level") or "High"

            # Normalize credit decision to prompt-allowed vocabulary
            raw_decision = credit_decision.get("decision") or "REVIEW_REQUIRED"
            decision_map = {
                "APPROVE": "APPROVE",
                "APPROVE_WITH_HIGHER_RATE": "APPROVE_WITH_HIGHER_RATE",
                "APPROVE_NORMAL_RATE": "APPROVE",
                "CONSIDER_WITH_CONDITIONS": "CONSIDER_WITH_CONDITIONS",
                "REJECT": "REJECT",
                "REVIEW_REQUIRED": "CONSIDER_WITH_CONDITIONS",
            }
            normalized_decision = decision_map.get(raw_decision, "CONSIDER_WITH_CONDITIONS")

            result["ratios"] = ratios
            result["risk_level"] = pd_risk_level
            result["confidence_score"] = round(
                (confidence_block.get("confidence_score") or 0.0) * 100, 1
            )
            result["summary"] = {
                "decision": normalized_decision,
                "risk_level": pd_risk_level,
                "pd_pct": pd_assessment.get("pd_percentage"),
                "lgd_pct": (result.get("lgd_assessment") or {}).get("lgd_percentage"),
                "expected_loss_pct": credit_decision.get("expected_loss_pct"),
                "anomaly_score": overall_score,
                "recommendation": pd_assessment.get("recommendation"),
            }
            result["engine"] = "financial_anomaly_tool"
            return result
        except Exception as e:  # noqa: BLE001
            # Fall through to the legacy heuristic, but record why.
            return {
                **_legacy_detect_financial_anomalies(
                    revenue=revenue, prior_revenue=prior_revenue,
                    net_income=net_income, prior_net_income=prior_net_income,
                    total_assets=total_assets, total_liabilities=total_liabilities,
                    current_assets=current_assets, current_liabilities=current_liabilities,
                    operating_expenses=operating_expenses,
                    cost_of_goods_sold=cost_of_goods_sold,
                    interest_expense=interest_expense, ebitda=ebitda,
                ),
                "engine": "legacy_fallback",
                "fa_tool_error": f"{type(e).__name__}: {e}",
            }

    # Standalone tool not importable (missing deps, etc.) — use legacy.
    return {
        **_legacy_detect_financial_anomalies(
            revenue=revenue, prior_revenue=prior_revenue,
            net_income=net_income, prior_net_income=prior_net_income,
            total_assets=total_assets, total_liabilities=total_liabilities,
            current_assets=current_assets, current_liabilities=current_liabilities,
            operating_expenses=operating_expenses,
            cost_of_goods_sold=cost_of_goods_sold,
            interest_expense=interest_expense, ebitda=ebitda,
        ),
        "engine": "legacy_fallback",
        "fa_tool_error": _FA_TOOL_IMPORT_ERROR,
    }


def calculate_financial_ratios(
    revenue: float | None = None,
    net_income: float | None = None,
    total_assets: float | None = None,
    total_liabilities: float | None = None,
    current_assets: float | None = None,
    current_liabilities: float | None = None,
    inventory: float | None = None,
    accounts_receivable: float | None = None,
    accounts_payable: float | None = None,
    cost_of_goods_sold: float | None = None,
    interest_expense: float | None = None,
    ebitda: float | None = None,
    depreciation: float | None = None,
) -> dict:
    """
    Calculate comprehensive financial ratios for lending analysis.
    
    Returns a structured dictionary of liquidity, leverage, profitability,
    and efficiency ratios commonly used in commercial lending decisions.
    """
    ratios = {}
    
    # === Liquidity Ratios ===
    if current_assets is not None and current_liabilities is not None and current_liabilities > 0:
        ratios["current_ratio"] = round(current_assets / current_liabilities, 2)
        
        # Quick ratio (excludes inventory)
        quick_assets = current_assets - (inventory or 0)
        ratios["quick_ratio"] = round(quick_assets / current_liabilities, 2)
        
        # Cash ratio approximation (if we have AR, estimate cash)
        if accounts_receivable is not None:
            cash_estimate = current_assets - (inventory or 0) - accounts_receivable
            if cash_estimate > 0:
                ratios["cash_ratio"] = round(cash_estimate / current_liabilities, 2)
    
    # === Leverage Ratios ===
    if total_assets is not None and total_liabilities is not None:
        ratios["debt_to_assets"] = round(total_liabilities / total_assets, 2) if total_assets > 0 else None
        
        equity = total_assets - total_liabilities
        if equity > 0:
            ratios["debt_to_equity"] = round(total_liabilities / equity, 2)
            ratios["equity_ratio"] = round(equity / total_assets, 2) if total_assets > 0 else None
    
    # === Profitability Ratios ===
    if revenue is not None and revenue > 0:
        if net_income is not None:
            ratios["net_profit_margin_pct"] = round((net_income / revenue) * 100, 2)
        
        if cost_of_goods_sold is not None:
            gross_profit = revenue - cost_of_goods_sold
            ratios["gross_profit_margin_pct"] = round((gross_profit / revenue) * 100, 2)
        
        if ebitda is not None:
            ratios["ebitda_margin_pct"] = round((ebitda / revenue) * 100, 2)
    
    if total_assets is not None and total_assets > 0 and net_income is not None:
        ratios["return_on_assets_pct"] = round((net_income / total_assets) * 100, 2)
    
    if total_assets is not None and total_liabilities is not None:
        equity = total_assets - total_liabilities
        if equity > 0 and net_income is not None:
            ratios["return_on_equity_pct"] = round((net_income / equity) * 100, 2)
    
    # === Coverage Ratios ===
    if interest_expense is not None and interest_expense > 0:
        if ebitda is not None:
            ratios["interest_coverage"] = round(ebitda / interest_expense, 2)
        
        # Debt service coverage approximation
        if ebitda is not None and depreciation is not None:
            operating_cash = ebitda  # Simplified
            ratios["debt_service_coverage"] = round(operating_cash / interest_expense, 2)
    
    # === Efficiency Ratios ===
    if revenue is not None and revenue > 0:
        if accounts_receivable is not None:
            ratios["receivables_turnover"] = round(revenue / accounts_receivable, 2)
            ratios["days_sales_outstanding"] = round(365 / ratios["receivables_turnover"], 0)
        
        if total_assets is not None and total_assets > 0:
            ratios["asset_turnover"] = round(revenue / total_assets, 2)
    
    if cost_of_goods_sold is not None and cost_of_goods_sold > 0:
        if inventory is not None and inventory > 0:
            ratios["inventory_turnover"] = round(cost_of_goods_sold / inventory, 2)
            ratios["days_inventory_outstanding"] = round(365 / ratios["inventory_turnover"], 0)
        
        if accounts_payable is not None and accounts_payable > 0:
            ratios["payables_turnover"] = round(cost_of_goods_sold / accounts_payable, 2)
            ratios["days_payables_outstanding"] = round(365 / ratios["payables_turnover"], 0)
    
    # === Cash Conversion Cycle ===
    if all(k in ratios for k in ["days_sales_outstanding", "days_inventory_outstanding", "days_payables_outstanding"]):
        ratios["cash_conversion_cycle_days"] = (
            ratios["days_sales_outstanding"] +
            ratios["days_inventory_outstanding"] -
            ratios["days_payables_outstanding"]
        )
    
    return {
        "ratios": ratios,
        "ratios_calculated": len(ratios),
        "categories": {
            "liquidity": [k for k in ratios if k in ["current_ratio", "quick_ratio", "cash_ratio"]],
            "leverage": [k for k in ratios if k in ["debt_to_assets", "debt_to_equity", "equity_ratio"]],
            "profitability": [k for k in ratios if "margin" in k or "return" in k],
            "coverage": [k for k in ratios if "coverage" in k],
            "efficiency": [k for k in ratios if "turnover" in k or "days" in k or "cycle" in k],
        }
    }


# ---------------------------------------------------------------------------
# Delete Application (BQ rows + GCS objects)
# ---------------------------------------------------------------------------
def delete_application(application_id: str) -> dict:
    """Delete an application and ALL related data from BQ tables and GCS.

    Removes rows from:
      - loan_applications.applications
      - loan_applications.documents
      - case_management.cases
      - case_management.case_audit_log (via case_id)
      - agent_outputs.agent_runs (via case_id)
    Removes GCS objects:
      - All blobs under {application_id}/ prefix
      - All summary sidecars for the application's documents
    
    Note: If rows are in the BQ streaming buffer (<15 min old), DELETE may
    fail. We handle this gracefully and continue with other deletions.
    """
    deleted = {"bq_tables": [], "gcs_blobs_deleted": 0, "warnings": []}

    # 1. Find case_id(s) linked to this application
    case_rows = list(_bq.query(
        f"SELECT case_id FROM `{GCP_PROJECT}.{DS_CASE}.cases` "
        f"WHERE application_id = @aid",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id)
        ]),
    ).result())
    case_ids = [r["case_id"] for r in case_rows]

    # 2. Find document_ids for GCS summary cleanup
    doc_rows = list(_bq.query(
        f"SELECT document_id, gcs_path FROM `{GCP_PROJECT}.{DS_APPS}.documents` "
        f"WHERE application_id = @aid",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("aid", "STRING", application_id)
        ]),
    ).result())

    # Helper to run DELETE with streaming buffer error handling
    def _safe_delete(query: str, params: list, table_name: str):
        try:
            _bq.query(
                query,
                job_config=bigquery.QueryJobConfig(query_parameters=params),
            ).result()
            deleted["bq_tables"].append(table_name)
        except Exception as e:
            if "streaming buffer" in str(e).lower():
                deleted["warnings"].append(f"{table_name}: rows in streaming buffer, will be deleted automatically after ~15 min")
            else:
                deleted["warnings"].append(f"{table_name}: {str(e)[:100]}")

    # 3. Delete from BQ tables using DML
    # Applications
    _safe_delete(
        f"DELETE FROM `{GCP_PROJECT}.{DS_APPS}.applications` WHERE application_id = @aid",
        [bigquery.ScalarQueryParameter("aid", "STRING", application_id)],
        f"{DS_APPS}.applications"
    )

    # Documents
    _safe_delete(
        f"DELETE FROM `{GCP_PROJECT}.{DS_APPS}.documents` WHERE application_id = @aid",
        [bigquery.ScalarQueryParameter("aid", "STRING", application_id)],
        f"{DS_APPS}.documents"
    )

    # Cases
    if case_ids:
        _safe_delete(
            f"DELETE FROM `{GCP_PROJECT}.{DS_CASE}.cases` WHERE application_id = @aid",
            [bigquery.ScalarQueryParameter("aid", "STRING", application_id)],
            f"{DS_CASE}.cases"
        )

        # Audit log & agent runs (per case_id)
        for cid in case_ids:
            _safe_delete(
                f"DELETE FROM `{GCP_PROJECT}.{DS_CASE}.case_audit_log` WHERE case_id = @cid",
                [bigquery.ScalarQueryParameter("cid", "STRING", cid)],
                f"{DS_CASE}.case_audit_log"
            )
            _safe_delete(
                f"DELETE FROM `{GCP_PROJECT}.{DS_OUT}.agent_runs` WHERE case_id = @cid",
                [bigquery.ScalarQueryParameter("cid", "STRING", cid)],
                f"{DS_OUT}.agent_runs"
            )

    # 4. Delete GCS objects
    if GCS_BUCKET:
        bucket = _gcs.bucket(GCS_BUCKET)
        # Delete all blobs under application_id/ prefix
        blobs = list(bucket.list_blobs(prefix=f"{application_id}/"))
        for blob in blobs:
            blob.delete()
            deleted["gcs_blobs_deleted"] += 1
        # Delete summary sidecars
        for doc_row in doc_rows:
            summary_blob = bucket.blob(f"summaries/{doc_row['document_id']}.json")
            if summary_blob.exists():
                summary_blob.delete()
                deleted["gcs_blobs_deleted"] += 1

    deleted["application_id"] = application_id
    deleted["case_ids"] = case_ids
    return deleted


# The original implementation remains available for the existing GCP build.
# Local mode swaps only the persistence/document functions; the ADK callbacks,
# prompts, routes, and financial tools keep their public interface unchanged.
if STORAGE_MODE == "local":
    from local_tools import (  # noqa: F401
        build_initial_state,
        create_application,
        create_case,
        delete_application,
        flush_all_streaming_buffers,
        get_application,
        get_case,
        get_document_signed_url,
        get_local_document_path,
        get_persisted_agent_outputs,
        list_applications,
        list_cases,
        list_customer_applications,
        list_documents,
        load_case_context,
        make_attach_documents_callback,
        make_persist_callback,
        record_human_decision,
        summarize_document,
        upload_document,
    )

