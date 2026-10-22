"""Local persistence adapter used by the Azure-ready development baseline.

It mirrors the data-facing functions exported by ``tools.py`` so the ADK
agents and FastAPI API can run without BigQuery or Cloud Storage credentials.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types

_DIR = Path(__file__).resolve().parent / "data"
_DOCS = _DIR / "documents"
_DB = _DIR / "loan_origination.db"
_AGENTS = {
    "Document_Intake_Agent": ("document_intake_output", "document_intake"),
    "KYC_Concierge_Agent": ("kyc_output", "kyc"),
    "Financial_Spreading_Agent": ("financial_output", "financial"),
    "Credit_Memo_Agent": ("memo_output", "memo"),
    "Decision_Support_Agent": ("decision_output", "decision"),
    "Closing_Package_Agent": ("closing_output", "closing"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    _DIR.mkdir(exist_ok=True)
    _DOCS.mkdir(exist_ok=True)
    conn = sqlite3.connect(_DB)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS applications (
          application_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL,
          submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_email TEXT,
          business_legal_name TEXT, loan_amount TEXT, loan_purpose TEXT, form_data TEXT NOT NULL,
          reviewed_by TEXT, review_note TEXT);
        CREATE TABLE IF NOT EXISTS documents (
          document_id TEXT PRIMARY KEY, application_id TEXT NOT NULL, filename TEXT NOT NULL,
          local_path TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
          doc_type TEXT, uploaded_at TEXT NOT NULL, uploaded_by TEXT);
        CREATE TABLE IF NOT EXISTS cases (
          case_id TEXT PRIMARY KEY, application_id TEXT NOT NULL, assigned_rm TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_runs (
          run_id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, case_id TEXT, application_id TEXT,
          status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, output TEXT,
          summary TEXT, error_message TEXT);
        CREATE TABLE IF NOT EXISTS case_audit_log (
          audit_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, decision TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL);
    """)
    return conn


def _id(prefix: str, length: int) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:length].upper()}"


def create_application(form_data: dict) -> dict:
    form_data, now = form_data or {}, _now()
    application_id, ticket_id = _id("APP", 6), _id("TKT", 6)
    with _connect() as conn:
        conn.execute("INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
            application_id, ticket_id, "Pending Review", now, now,
            form_data.get("ownerEmail") or form_data.get("owner_email"),
            form_data.get("businessLegalName") or form_data.get("business_legal_name"),
            str(form_data.get("loanAmount") or form_data.get("loan_amount") or ""),
            form_data.get("loanPurpose") or form_data.get("loan_purpose"), json.dumps(form_data), None, None))
    return {"application_id": application_id, "ticket_id": ticket_id, "status": "Pending Review"}


def _rows(sql: str, args: tuple = ()) -> list[dict]:
    with _connect() as conn:
        return [dict(row) for row in conn.execute(sql, args)]


def list_applications() -> list[dict]:
    return _rows("SELECT * FROM applications ORDER BY submitted_at DESC")


def list_customer_applications(email: str) -> list[dict]:
    return _rows("SELECT * FROM applications WHERE lower(owner_email)=lower(?) ORDER BY submitted_at DESC", (email,)) if email else []


def get_application(application_id: str) -> dict | None:
    rows = _rows("SELECT * FROM applications WHERE application_id=?", (application_id,))
    return rows[0] if rows else None


def upload_document(application_id: str, file_bytes: bytes, filename: str, content_type: str,
                    doc_type: str | None = None, uploaded_by: str | None = None) -> dict:
    if not get_application(application_id):
        raise RuntimeError("application not found")
    document_id, name = _id("DOC", 8), Path(filename).name
    path = _DOCS / f"{document_id}{Path(name).suffix}"
    path.write_bytes(file_bytes)
    row = (document_id, application_id, name, str(path), content_type or "application/octet-stream",
           len(file_bytes), doc_type, _now(), uploaded_by)
    with _connect() as conn:
        conn.execute("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
    return dict(zip(("document_id", "application_id", "filename", "local_path", "content_type", "size_bytes", "doc_type", "uploaded_at", "uploaded_by"), row))


def list_documents(application_id: str) -> list[dict]:
    return _rows("SELECT * FROM documents WHERE application_id=? ORDER BY uploaded_at DESC", (application_id,))


def get_local_document_path(document_id: str) -> Path | None:
    rows = _rows("SELECT local_path FROM documents WHERE document_id=?", (document_id,))
    path = Path(rows[0]["local_path"]) if rows else None
    return path if path and path.is_file() else None


def get_document_signed_url(application_id: str, document_id: str, expiration_minutes: int = 60) -> dict:
    document = next((d for d in list_documents(application_id) if d["document_id"] == document_id), None)
    if not document:
        raise RuntimeError("document not found")
    return {"document_id": document_id, "filename": document["filename"], "content_type": document["content_type"],
            "signed_url": f"/local-documents/{document_id}", "expires_in_minutes": None,
            "note": "Local development URL; Azure Blob SAS replaces this in Stage 2."}


def summarize_document(application_id: str, document_id: str) -> dict:
    document = next((d for d in list_documents(application_id) if d["document_id"] == document_id), None)
    if not document:
        raise RuntimeError("document not found")
    return {"document_id": document_id, "filename": document["filename"], "doc_type": document["doc_type"],
            "summary": "Local baseline: document stored successfully. Azure document extraction is added in Stage 2."}


def create_case(application_id: str, assigned_rm: str) -> dict:
    if not get_application(application_id):
        raise RuntimeError("application not found")
    case_id, now = _id("CASE", 8), _now()
    with _connect() as conn:
        conn.execute("INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?)", (case_id, application_id, assigned_rm, "In Review", now, now))
    return {"case_id": case_id, "application_id": application_id, "assigned_rm": assigned_rm, "status": "In Review"}


def list_cases() -> list[dict]:
    return _rows("SELECT * FROM cases ORDER BY created_at DESC")


def get_case(case_id: str) -> dict | None:
    rows = _rows("SELECT * FROM cases WHERE case_id=?", (case_id,))
    return rows[0] if rows else None


def record_human_decision(case_id: str, decision: str, actor: str) -> str:
    decision, case = decision.upper(), get_case(case_id)
    if decision not in {"APPROVED", "REJECTED"}:
        raise RuntimeError("decision must be APPROVED or REJECTED")
    if not case:
        raise RuntimeError("case not found")
    now = _now()
    with _connect() as conn:
        conn.execute("UPDATE cases SET status=?, updated_at=? WHERE case_id=?", (decision.title(), now, case_id))
        conn.execute("UPDATE applications SET status=?, updated_at=?, reviewed_by=? WHERE application_id=?", (decision.title(), now, actor, case["application_id"]))
        conn.execute("INSERT INTO case_audit_log VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), case_id, decision, actor, now))
    return f"Recorded {decision} decision for {case_id} by {actor}."


def _populate_state_dict(state: dict) -> None:
    if state.get("context_loaded"):
        return
    case = get_case(state.get("case_id")) if state.get("case_id") else None
    application_id = state.get("application_id") or (case or {}).get("application_id")
    state.update({"case": case or {}, "application": get_application(application_id) or {},
                  "application_id": application_id, "documents": list_documents(application_id) if application_id else [],
                  "context_loaded": True})


def _hydrate_agent_outputs(state: dict, case_id: str | None) -> None:
    if not case_id:
        return
    for row in _rows("SELECT agent_name, output FROM agent_runs WHERE case_id=? AND status='completed' ORDER BY completed_at DESC", (case_id,)):
        mapping = _AGENTS.get(row["agent_name"])
        if mapping and not state.get(mapping[0]):
            state[mapping[0]] = json.loads(row["output"] or "{}").get("text", "")


def build_initial_state(case_id: str, actor: str) -> dict:
    state = {"case_id": case_id, "actor": actor, "cases_list": [], "applications_list": [], "case": {}, "application": {}, "documents": []}
    state.update({value[0]: "" for value in _AGENTS.values()})
    state["chatbot_output"] = ""
    if case_id == "GENERAL" or case_id.startswith("ask:"):
        state.update({"cases_list": list_cases()[:50], "applications_list": list_applications()[:50]})
    _populate_state_dict(state)
    _hydrate_agent_outputs(state, case_id)
    return state


def load_case_context(callback_context: CallbackContext) -> None:
    _populate_state_dict(callback_context.state)


def make_persist_callback(agent_name: str, output_key: str):
    def _persist(callback_context: CallbackContext) -> None:
        state, output = callback_context.state, callback_context.state.get(output_key)
        if not output:
            return
        now = _now()
        with _connect() as conn:
            conn.execute("INSERT INTO agent_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (str(uuid.uuid4()), agent_name, state.get("case_id"), state.get("application_id"), "completed", now, now,
                          json.dumps({"text": str(output)}), str(output)[:1000], None))
    return _persist


def make_attach_documents_callback(doc_type_prefixes: tuple[str, ...] | None = None, filename_keywords: tuple[str, ...] | None = None):
    """Attach document metadata; binary extraction becomes an Azure lab later."""
    def _attach(callback_context: CallbackContext, llm_request: LlmRequest):
        items = []
        for document in callback_context.state.get("documents") or []:
            doc_type, filename = (document.get("doc_type") or "").lower(), (document.get("filename") or "").lower()
            matches = not doc_type_prefixes and not filename_keywords
            matches = matches or bool(doc_type_prefixes and any(doc_type.startswith(v) for v in doc_type_prefixes))
            matches = matches or bool(filename_keywords and any(v in filename for v in filename_keywords))
            if matches:
                items.append(f"- {document['filename']} (type: {document.get('doc_type') or 'unknown'})")
        if items:
            llm_request.contents.append(types.Content(role="user", parts=[types.Part(text="Uploaded document inventory:\n" + "\n".join(items))]))
        return None
    return _attach


def get_persisted_agent_outputs(case_id: str) -> dict:
    result = {value[1]: None for value in _AGENTS.values()}
    for row in _rows("SELECT agent_name, output FROM agent_runs WHERE case_id=? AND status='completed' ORDER BY completed_at DESC", (case_id,)):
        mapping = _AGENTS.get(row["agent_name"])
        if mapping and result[mapping[1]] is None:
            result[mapping[1]] = json.loads(row["output"] or "{}").get("text")
    return result


def flush_all_streaming_buffers() -> dict:
    return {"mode": "local", "message": "SQLite has no streaming buffer."}


def delete_application(application_id: str) -> dict:
    documents = list_documents(application_id)
    with _connect() as conn:
        cases = [row["case_id"] for row in conn.execute("SELECT case_id FROM cases WHERE application_id=?", (application_id,))]
        for case_id in cases:
            conn.execute("DELETE FROM agent_runs WHERE case_id=?", (case_id,))
            conn.execute("DELETE FROM case_audit_log WHERE case_id=?", (case_id,))
        conn.execute("DELETE FROM cases WHERE application_id=?", (application_id,))
        conn.execute("DELETE FROM documents WHERE application_id=?", (application_id,))
        conn.execute("DELETE FROM applications WHERE application_id=?", (application_id,))
    for document in documents:
        Path(document["local_path"]).unlink(missing_ok=True)
    return {"application_id": application_id, "documents_deleted": len(documents)}
