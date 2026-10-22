// ============================================================================
// API BRIDGE
// ----------------------------------------------------------------------------
// The backend exposes ONLY two real endpoints (Google ADK orchestrator):
//   POST /cases                  -> { application_id, assigned_rm } -> case row
//   POST /chat/{case_id}         -> { user_id, message }            -> { response }
//
// The frontend was originally written against many domain-specific endpoints
// (tickets, KYC, spreading, memo, decisioning, closing, lendwise...).
// To keep the frontend unchanged in shape, this bridge:
//   1. Persists tickets/cases/agent outputs in localStorage so the dashboard
//      pages render without a backend tickets table.
//   2. Forwards every "agent action" to the orchestrator chat endpoint with
//      a targeted natural-language instruction. The orchestrator picks the
//      right ADK sub-agent, the markdown reply is stored under the right key.
//   3. Returns shapes that include `markdown` so the UI can render the agent's
//      response without needing strict JSON.
// ============================================================================

import {
  DEMO_APPLICATIONS,
  isDemoApplicationId,
  isDemoTicketId,
  isDemoCaseId,
  isAnyDemoId,
  demoCaseIdForApplication,
  getDemoCase,
  getDemoCaseWithOverrides,
  getDemoDocuments,
  getDemoDocumentSummary,
  applyDemoHumanDecision,
  clearDemoOverride,
} from "../mock-data/demoCases";

const API_BASE = process.env.REACT_APP_API_BASE || "https://commercial-lending-backend-964994766361.us-central1.run.app";

// ---------- localStorage helpers ----------
const LS_TICKETS = "cl.tickets";
const LS_CASES = "cl.cases"; // map: caseId -> { case, kyc, spreading, memo, decision, closing, ticketId }
const LS_CACHE_VERSION = "cl.cacheVersion";
const CURRENT_CACHE_VERSION = "v5-processed-apps-fix"; // Bump this to force cache clear

// Clear stale cache on version change
(function clearStaleCache() {
  try {
    const cachedVersion = localStorage.getItem(LS_CACHE_VERSION);
    if (cachedVersion !== CURRENT_CACHE_VERSION) {
      // Before wiping cases, mark existing real-app cases as processed so they
      // don't reappear as orphan tickets after the cache clear.
      try {
        const raw = localStorage.getItem(LS_CASES);
        const cases = raw ? JSON.parse(raw) : {};
        const processed = JSON.parse(localStorage.getItem('cl.processed.apps') || '[]');
        const set = new Set(processed);
        for (const val of Object.values(cases)) {
          const appId = val?.case?.applicationId;
          if (appId) set.add(appId);
        }
        localStorage.setItem('cl.processed.apps', JSON.stringify([...set]));
      } catch { /* ignore */ }
      // Clear all dashboard-related caches
      localStorage.removeItem('cl.dash.cache.v1');
      localStorage.removeItem(LS_TICKETS);
      localStorage.removeItem(LS_CASES);
      localStorage.setItem(LS_CACHE_VERSION, CURRENT_CACHE_VERSION);
      console.log('Cache cleared for new version:', CURRENT_CACHE_VERSION);
    }
  } catch { /* ignore */ }
})();

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function getTickets() { return lsGet(LS_TICKETS, []); }
function setTickets(arr) { lsSet(LS_TICKETS, arr); }
function getCases() { return lsGet(LS_CASES, {}); }
function setCases(obj) { lsSet(LS_CASES, obj); }

// Track real applications that have already been auto-processed so they don't
// reappear as orphan tickets after a cache clear wipes their local cases.
const LS_PROCESSED_APPS = 'cl.processed.apps';
export function getProcessedApps() { return lsGet(LS_PROCESSED_APPS, []); }
function addProcessedApp(applicationId) {
  const set = new Set(getProcessedApps());
  set.add(applicationId);
  lsSet(LS_PROCESSED_APPS, [...set]);
}

// ---------------------------------------------------------------------------
// Parse a structured JSON object out of an agent's markdown response. Agents
// are instructed to append a fenced ```json ... ``` (or bare {...}) block at
// the end of their narrative. Returns {} if nothing parseable is found.
// ---------------------------------------------------------------------------
function extractJsonFromMarkdown(md) {
  if (!md || typeof md !== "string") return {};
  // 1) Prefer fenced ```json ... ``` blocks (last one wins, agent may emit
  //    multiple).
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let lastFence = null;
  let m;
  while ((m = fenceRe.exec(md)) !== null) {
    const body = m[1].trim();
    if (body.startsWith("{") || body.startsWith("[")) lastFence = body;
  }
  if (lastFence) {
    try { return JSON.parse(lastFence); } catch { /* fall through */ }
  }
  // 2) Fallback: find the last balanced top-level {...} block in the text.
  const lastOpen = md.lastIndexOf("{");
  const lastClose = md.lastIndexOf("}");
  if (lastOpen !== -1 && lastClose > lastOpen) {
    const candidate = md.slice(lastOpen, lastClose + 1);
    try { return JSON.parse(candidate); } catch { /* ignore */ }
  }
  return {};
}

// Strip fenced ```json blocks (and any trailing bare {...} JSON dump) from
// the markdown so the "Agent Response" card shows only the narrative and the
// structured fields render in the dedicated KV cards beneath it.
function stripJsonFromMarkdown(md) {
  if (!md || typeof md !== "string") return md;
  // Remove fenced JSON blocks (```json ... ``` and bare ``` ... ``` blocks
  // whose body looks like JSON).
  let cleaned = md.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (whole, body) => {
    const t = body.trim();
    return (t.startsWith("{") || t.startsWith("[")) ? "" : whole;
  });
  // Remove a trailing bare JSON object the agent appended without a fence.
  const lastOpen = cleaned.lastIndexOf("\n{");
  const lastClose = cleaned.lastIndexOf("}");
  if (lastOpen !== -1 && lastClose > lastOpen) {
    const candidate = cleaned.slice(lastOpen + 1, lastClose + 1).trim();
    try {
      JSON.parse(candidate);
      cleaned = cleaned.slice(0, lastOpen);
    } catch { /* not JSON, leave it */ }
  }
  return cleaned.trim();
}

function newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function nowIso() { return new Date().toISOString(); }

// ---------- Backend calls ----------
async function backendCreateCase(applicationId, assignedRm) {
  const res = await fetch(`${API_BASE}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_id: applicationId, assigned_rm: assignedRm }),
  });
  if (!res.ok) throw new Error(`createCase failed (${res.status})`);
  return res.json();
}

async function backendChat(caseId, userId, message) {
  const res = await fetch(`${API_BASE}/chat/${encodeURIComponent(caseId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, message }),
  });
  if (!res.ok) throw new Error(`chat failed (${res.status})`);
  return res.json(); // { case_id, response }
}

// Per-agent endpoint: bypasses the root orchestrator LLM (which refuses to run
// individual sub-agents "out of order"). Hits POST /chat/{case_id}/agent/{name}.
async function backendChatAgent(caseId, userId, agentName, message) {
  const res = await fetch(
    `${API_BASE}/chat/${encodeURIComponent(caseId)}/agent/${encodeURIComponent(agentName)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, message }),
    },
  );
  if (!res.ok) throw new Error(`agent ${agentName} failed (${res.status})`);
  return res.json(); // { case_id, agent, response, output }
}

// Deterministic sequential pipeline: runs all 5 pre-approval agents in order.
// POST /process/{case_id} -> Document_Intake -> KYC -> Financial -> Memo -> Decision
async function backendProcessCase(caseId, userId) {
  const res = await fetch(
    `${API_BASE}/process/${encodeURIComponent(caseId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    },
  );
  if (!res.ok) throw new Error(`process pipeline failed (${res.status})`);
  return res.json(); // { case_id, pipeline, response, agent_outputs }
}

// Deterministic post-approval: runs closing agent after human decision.
// POST /decide/{case_id} with decision = "APPROVED" | "REJECTED"
async function backendDecideCase(caseId, userId, decision) {
  const res = await fetch(
    `${API_BASE}/decide/${encodeURIComponent(caseId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, decision }),
    },
  );
  if (!res.ok) throw new Error(`decide pipeline failed (${res.status})`);
  return res.json(); // { case_id, pipeline, decision, response, agent_outputs }
}

// Read-only: pulls the latest persisted output for each agent on a case
// from the backend (which reads BigQuery `agent_runs`). Never re-runs any
// agent — used by `getFullCase` to hydrate empty per-agent panels after a
// fresh browser load / cache clear.
async function fetchPersistedAgentOutputs(caseId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000); // 5s timeout
  try {
    const res = await fetch(
      `${API_BASE}/cases/${encodeURIComponent(caseId)}/agent_outputs`,
      { method: "GET", signal: controller.signal },
    );
    if (!res.ok) throw new Error(`agent_outputs fetch failed (${res.status})`);
    const j = await res.json();
    return (j && j.agent_outputs) || {};
  } finally {
    clearTimeout(timer);
  }
}

async function backendCreateApplication(formData) {
  const res = await fetch(`${API_BASE}/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData || {}),
  });
  if (!res.ok) throw new Error(`createApplication failed (${res.status})`);
  return res.json(); // { application_id, ticket_id, status }
}

async function backendListApplications() {
  const res = await fetch(`${API_BASE}/applications`);
  if (!res.ok) throw new Error(`listApplications failed (${res.status})`);
  return res.json();
}

async function backendDeleteApplication(applicationId) {
  const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(applicationId)}`, {
    method: "DELETE",
  });
  // Treat 404 as success - resource is already gone (idempotent delete)
  if (res.status === 404) {
    return { status: "already_deleted", application_id: applicationId };
  }
  if (!res.ok) throw new Error(`deleteApplication failed (${res.status})`);
  return res.json();
}

async function backendListCustomerApplications(email) {
  const res = await fetch(`${API_BASE}/customers/${encodeURIComponent(email)}/applications`);
  if (!res.ok) throw new Error(`listCustomerApplications failed (${res.status})`);
  return res.json();
}

async function backendListDocuments(applicationId) {
  const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(applicationId)}/documents`);
  if (!res.ok) throw new Error(`listDocuments failed (${res.status})`);
  return res.json();
}

async function backendUploadDocuments(applicationId, files, docTypes, uploadedBy) {
  const fd = new FormData();
  files.forEach(f => fd.append("files", f));
  (docTypes || []).forEach(d => fd.append("doc_types", d || ""));
  if (uploadedBy) fd.append("uploaded_by", uploadedBy);
  const res = await fetch(`${API_BASE}/applications/${encodeURIComponent(applicationId)}/documents`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`uploadDocuments failed (${res.status})`);
  return res.json(); // { uploaded: [...], errors: [...] }
}

async function backendGetDocumentUrl(applicationId, documentId) {
  const res = await fetch(
    `${API_BASE}/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}/url`
  );
  if (!res.ok) {
    let detail = "";
    try { 
      const j = await res.json(); 
      detail = j.detail || JSON.stringify(j); 
    } catch { 
      try { detail = await res.text(); } catch { /* ignore */ } 
    }
    throw new Error(`getDocumentUrl failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json(); // { document_id, filename, content_type, signed_url, expires_in_minutes }
}

// Map a backend application row -> ticket-shaped object for legacy UI.
function appRowToTicket(row) {
  return {
    ticketId: row.ticket_id,
    applicationId: row.application_id,
    status: row.status || "Pending Review",
    formData: row.form_data || {},
    documents: [],
    createdAt: row.submitted_at,
    updatedAt: row.updated_at,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
    businessLegalName: row.business_legal_name,
    loanAmount: row.loan_amount,
    loanPurpose: row.loan_purpose,
    ownerEmail: row.owner_email,
  };
}

// ---------- Tickets (real backend) ----------
export async function submitTicket(formData) {
  const res = await backendCreateApplication(formData);
  return {
    ticketId: res.ticket_id,
    applicationId: res.application_id,
    status: res.status,
  };
}

export async function getAllTickets() {
  try {
    const rows = await backendListApplications();
    const tickets = rows.map(appRowToTicket);
    // Sort by date (latest first) and show ALL real applications
    const sorted = tickets.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });
    // Return: all real ones first, then demo applications
    return [...sorted, ...DEMO_APPLICATIONS];
  } catch (e) {
    console.warn("getAllTickets failed:", e);
    return [...DEMO_APPLICATIONS];
  }
}

export async function getCustomerTickets(email) {
  // Always fetch all applications and show 2 latest real ones + 3 demo
  // This ensures customer portal shows real applications regardless of email match
  try {
    const rows = await backendListApplications();
    const tickets = rows.map(appRowToTicket);
    // Sort by date (latest first) and show ALL real applications
    const sorted = tickets.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });
    // Return: all real ones first, then demo applications
    return [...sorted, ...DEMO_APPLICATIONS];
  } catch (e) {
    console.warn("getCustomerTickets failed:", e);
    return [...DEMO_APPLICATIONS];
  }
}

export async function uploadApplicationDocuments(applicationId, files, docTypes = []) {
  if (isDemoApplicationId(applicationId)) {
    // Refuse uploads for demo apps so we never send fake files to GCS.
    return { uploaded: [], errors: ["Demo application — uploads are disabled."] };
  }
  try {
    const res = await backendUploadDocuments(applicationId, files, docTypes);
    return {
      uploaded: (res.uploaded || []).map(u => ({
        filename: u.filename,
        docType: u.doc_type,
        sizeBytes: u.size_bytes,
        gcsUri: u.gcs_uri,
      })),
      errors: res.errors || [],
    };
  } catch (e) {
    return { uploaded: [], errors: [String(e.message || e)] };
  }
}

export async function listApplicationDocuments(applicationId) {
  // Demo apps have a hardcoded document list and never hit the backend.
  if (isDemoApplicationId(applicationId)) {
    return { documents: getDemoDocuments(applicationId) };
  }
  try {
    const docs = await backendListDocuments(applicationId);
    return {
      documents: docs.map(d => ({
        documentId: d.document_id,
        filename: d.filename,
        docType: d.doc_type,
        sizeBytes: d.size_bytes,
        gcsUri: d.gcs_uri,
        uploadedAt: d.uploaded_at,
      })),
    };
  } catch (e) {
    return { documents: [] };
  }
}

export async function summarizeDocument(applicationId, documentId) {
  // Demo documents have pre-written summaries; never call Gemini for them.
  if (isDemoApplicationId(applicationId)) {
    const hit = getDemoDocumentSummary(documentId);
    if (hit) return hit;
    return { document_id: documentId, summary: "Demo document — no further detail available." };
  }
  // localStorage cache keyed by documentId — Gemini summaries are deterministic
  // for a given file, so we run once per document and reuse forever after.
  // Avoids re-firing a slow Gemini call every time the RM opens the case.
  const CACHE_KEY = "cl.docSummaries";
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { cache = {}; }
  if (cache[documentId] && cache[documentId].summary) {
    return cache[documentId];
  }
  const res = await fetch(
    `${API_BASE}/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}/summary`,
    { method: "POST" },
  );
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j.detail || JSON.stringify(j); }
    catch { try { detail = await res.text(); } catch { /* ignore */ } }
    throw new Error(`summarizeDocument failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = await res.json(); // { document_id, filename, doc_type, summary }
  try {
    cache[documentId] = data;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota / privacy mode — ignore */ }
  return data;
}

export async function getDocumentUrl(applicationId, documentId) {
  // Demo documents are not stored in GCS — return a stub so the UI doesn't
  // try to fetch a signed URL.
  if (isDemoApplicationId(applicationId)) {
    return { signed_url: null, demo: true };
  }
  // Get a signed URL to view/download a document from GCS.
  // Used to make document filenames clickable in the KYC checklist.
  return backendGetDocumentUrl(applicationId, documentId);
}

// ---------- Delete application ----------
export async function deleteApplication(applicationId) {
  // Remove from backend (BQ + GCS) - 404 is treated as success
  const result = await backendDeleteApplication(applicationId);
  // Clean up localStorage references
  try {
    const cases = JSON.parse(localStorage.getItem(LS_CASES) || '{}');
    for (const [caseId, val] of Object.entries(cases)) {
      if (val?.case?.applicationId === applicationId) {
        delete cases[caseId];
      }
    }
    localStorage.setItem(LS_CASES, JSON.stringify(cases));
    // Remove from processed apps
    const processed = JSON.parse(localStorage.getItem('cl.processed.apps') || '[]');
    const filtered = processed.filter(id => id !== applicationId);
    localStorage.setItem('cl.processed.apps', JSON.stringify(filtered));
    // Remove matching tickets
    const tickets = JSON.parse(localStorage.getItem(LS_TICKETS) || '[]');
    const filteredTickets = tickets.filter(t => t.applicationId !== applicationId);
    localStorage.setItem(LS_TICKETS, JSON.stringify(filteredTickets));
    // Clear dashboard cache so stale entries don't reappear
    localStorage.removeItem('cl.dash.cache.v1');
  } catch { /* localStorage cleanup best-effort */ }
  return result;
}

// ---------- Banker review / auto-process ----------
export async function reviewTicket(ticketId, action, reviewer, note) {
  // Demo tickets are short-circuited: an "approve" simply hands back the
  // pre-mapped demo case ID so the UI navigates straight to the detail
  // page. No backend call, no case row, no Phase A pipeline trigger.
  if (isDemoTicketId(ticketId)) {
    const t = DEMO_APPLICATIONS.find(x => x.ticketId === ticketId);
    if (!t) return { error: "demo ticket not found" };
    if (action === "approve") {
      return { caseId: demoCaseIdForApplication(t.applicationId), applicationId: t.applicationId, demo: true };
    }
    return { ticketId, status: action === "hold" ? "On Hold" : "Rejected", demo: true };
  }
  // Find the application by ticket_id from the backend.
  const tickets = await getAllTickets();
  const t = tickets.find(x => x.ticketId === ticketId);
  if (!t) return { error: "ticket not found" };

  // On approve, create a case in the backend and run the pre-approval pipeline.
  if (action === "approve") {
    try {
      const caseRow = await backendCreateCase(t.applicationId, reviewer || "Banker");
      const caseId = caseRow.case_id;
      // Save case skeleton in localStorage for the per-case panels.
      const cases = getCases();
      cases[caseId] = {
        ticketId,
        case: {
          caseId,
          applicationId: t.applicationId,
          formData: t.formData,
          status: "In Review",
          statusType: "review",
          completeness: { overall: 70 },
          assignedTo: reviewer || "Banker",
          createdAt: caseRow.created_at || nowIso(),
          updatedAt: nowIso(),
          documentChecklist: [],
          timeline: [{ date: nowIso(), event: "Case created", actor: reviewer }],
          kycApproved: false,
        },
      };
      setCases(cases);

      // Trigger Phase A pipeline.
      try {
        const chat = await backendChat(
          caseId,
          reviewer || "Banker",
          "Process this case. Run the pre-approval pipeline (Document Intake -> KYC -> Financial Spreading -> Memo) end to end and present the consolidated outputs."
        );
        const cs = getCases();
        const ao = chat.agent_outputs || {};
        cs[caseId].phaseA = chat.response;
        cs[caseId].intake = ao.document_intake ? { markdown: ao.document_intake } : null;
        cs[caseId].kyc = { kycChecklist: [], kycId: newId("KYC"), flags: [], markdown: ao.kyc || chat.response };
        cs[caseId].spreading = { spreadingId: newId("SPR"), status: "completed", ratios: {}, summary: {}, assessments: [], anomalies: [], markdown: ao.financial || chat.response };
        cs[caseId].memo = { summary: {}, sections: [], markdown: ao.memo || chat.response };
        cs[caseId].case.timeline.push({ date: nowIso(), event: "Pre-approval pipeline complete", actor: "Orchestrator" });
        setCases(cs);
      } catch (e) {
        console.warn("Phase A chat failed:", e);
      }
      return { caseId, applicationId: t.applicationId };
    } catch (e) {
      console.error("Case creation failed:", e);
      return { error: String(e) };
    }
  }
  return { ticketId, status: action === "hold" ? "On Hold" : "Rejected" };
}

export async function autoProcessTicket(ticketId) {
  // Demo tickets are pre-baked and never run through the backend pipeline.
  if (isDemoTicketId(ticketId)) {
    const t = DEMO_APPLICATIONS.find(x => x.ticketId === ticketId);
    return t ? { ok: true, caseId: demoCaseIdForApplication(t.applicationId), demo: true } : { ok: false };
  }
  // Customer just submitted. Find the application, create a case, and run the
  // pre-approval pipeline so the RM sees agent outputs without any approval.
  try {
    const tickets = await getAllTickets();
    const t = tickets.find(x => x.ticketId === ticketId);
    if (!t) return { ok: false, error: "ticket not found" };

    // Mark as processed IMMEDIATELY so no duplicate auto-process fires even
    // if backendCreateCase is slow or fails on this attempt.
    addProcessedApp(t.applicationId);

    // Try backend case creation, but if it fails (timeout / overloaded),
    // generate a local-only caseId so the dashboard still shows progress.
    let caseId;
    let createdAt = nowIso();
    try {
      const caseRow = await backendCreateCase(t.applicationId, "Auto-Intake");
      caseId = caseRow.case_id;
      createdAt = caseRow.created_at || createdAt;
    } catch (backendErr) {
      console.warn("backendCreateCase failed, using local caseId:", backendErr);
      caseId = `CASE-${t.applicationId.slice(0, 8)}-${Date.now().toString(36)}`;
    }

    const cases = getCases();
    cases[caseId] = {
      ticketId,
      case: {
        caseId,
        applicationId: t.applicationId,
        formData: t.formData,
        status: "In Review",
        statusType: "review",
        completeness: { overall: 70 },
        assignedTo: "Auto-Intake",
        createdAt,
        updatedAt: nowIso(),
        documentChecklist: [],
        timeline: [{ date: nowIso(), event: "Case created (auto)", actor: "System" }],
        kycApproved: false,
      },
    };
    setCases(cases);

    // Fire-and-forget: run Phase A pipeline. The RM page will read it later.
    runPreApprovalPipeline(caseId, "Auto-Intake").catch(e => console.warn("auto pipeline failed:", e));

    return { ok: true, ticketId, caseId };
  } catch (e) {
    console.error("autoProcessTicket failed:", e);
    return { ok: false, error: String(e) };
  }
}

// ---------- Cases ----------
export async function getDemoCases() {
  // If the backend has been wiped (no applications at all), prune any stale
  // local cases so the dashboard doesn't keep showing ghost rows.
  try {
    const apps = await backendListApplications();
    if (!apps || apps.length === 0) {
      setCases({});
      try { localStorage.removeItem('cl.dash.cache.v1'); } catch { /* ignore */ }
      return [];
    }
    
    // Sort applications by date (latest first) — show ALL
    const sortedApps = [...apps].sort((a, b) => {
      const dateA = new Date(a.submitted_at || 0);
      const dateB = new Date(b.submitted_at || 0);
      return dateB - dateA;
    });
    const validIds = new Set(sortedApps.map(a => a.application_id));
    
    const cases = getCases();
    let pruned = false;
    for (const [caseId, val] of Object.entries(cases)) {
      // Only keep cases for known applications
      if (val?.case?.applicationId && !isDemoApplicationId(val.case.applicationId) && !validIds.has(val.case.applicationId)) {
        delete cases[caseId];
        pruned = true;
      }
    }
    if (pruned) setCases(cases);
    // Mark surviving real cases as processed so they stay gone after a future
    // cache prune (prevents the reappear-after-disappear glitch).
    for (const val of Object.values(cases)) {
      const appId = val?.case?.applicationId;
      if (appId && !isDemoApplicationId(appId)) addProcessedApp(appId);
    }
    return Object.values(cases);
  } catch {
    // Backend unreachable — fall back to whatever's cached locally.
    return Object.values(getCases());
  }
}

export async function findCaseIdByApplication(applicationId) {
  // Demo apps map deterministically to their pre-baked caseId — never look
  // them up in localStorage and never hit the backend.
  if (isDemoApplicationId(applicationId)) {
    return demoCaseIdForApplication(applicationId);
  }
  const cases = getCases();
  for (const [caseId, val] of Object.entries(cases)) {
    if (val?.case?.applicationId === applicationId) return caseId;
  }
  return null;
}

export async function getFullCase(caseId) {
  // Demo cases are served entirely from the mock-data module. No backend
  // call, no localStorage migration, no agent re-run — just return the
  // pre-baked payload (with any persisted human-decision overrides merged).
  if (isDemoCaseId(caseId)) {
    const demo = getDemoCaseWithOverrides(caseId);
    return demo || { case: null };
  }
  const cases = getCases();
  const c = cases[caseId];
  if (!c) return { case: null };
  // BQ-backed hydration: if any per-agent panel is empty OR currently
  // shows a transient failure stub in localStorage, try to fill it from
  // `GET /cases/{case_id}/agent_outputs` (which reads the most recent
  // persisted run from BigQuery). This makes the dashboard resilient to
  //   - cache clears / incognito / different browsers
  //   - in-flight HTTP requests that were canceled by a re-render so the
  //     frontend never received the agent's output even though the agent
  //     COMPLETED on backend and persisted to BQ.
  const _looksLikeFailureStub = (md) => {
    if (!md || typeof md !== "string") return false;
    const t = md.trim();
    return t.startsWith("(agent ") || t.startsWith("> \u26a0");
  };
  const _isEmptySlot = (slot) => {
    if (!slot) return true;
    // A decision slot with humanDecision set is NOT empty — the user signed off
    if (slot.humanDecision) return false;
    const md = slot.markdown;
    if (!md || String(md).trim().length < 20) return true;
    if (_looksLikeFailureStub(md)) return true;
    return false;
  };
  const _needsHydrate = (
    _isEmptySlot(c.intake) || _isEmptySlot(c.kyc) || _isEmptySlot(c.spreading) ||
    _isEmptySlot(c.memo)   || _isEmptySlot(c.decision) || _isEmptySlot(c.closing)
  );
  if (_needsHydrate) {
    try {
      const persisted = await fetchPersistedAgentOutputs(caseId);
      const _hydrate = (slotName, agentKey, defaults) => {
        if (!_isEmptySlot(c[slotName])) return;
        const raw = persisted[agentKey];
        if (!raw) return;
        const md = stripJsonFromMarkdown(raw) || "";
        const json = extractJsonFromMarkdown(raw) || null;
        if (!md && !json) return;
        // Preserve human decision fields when re-hydrating the decision slot
        const existing = c[slotName] || {};
        const preserved = {};
        if (slotName === "decision") {
          for (const k of ["humanDecision", "humanDecisionBy", "humanDecisionAt", "humanDecisionNotes", "reviewChecklist"]) {
            if (existing[k] != null) preserved[k] = existing[k];
          }
        }
        c[slotName] = { ...defaults, ...(json || {}), ...preserved, markdown: md };
      };
      _hydrate("intake",    "document_intake", {});
      _hydrate("kyc",       "kyc",       { kycId: newId("KYC"), kycChecklist: [], flags: [] });
      _hydrate("spreading", "financial", { spreadingId: newId("SPR"), status: "completed", ratios: {}, summary: {}, assessments: [], anomalies: [] });
      _hydrate("memo",      "memo",      { memoId: newId("MEMO"), summary: {}, sections: [] });
      _hydrate("decision",  "decision",  { decisionId: newId("DEC"), pd: {}, lgd: {} });
      _hydrate("closing",   "closing",   { packageId: newId("PKG"), status: "assembled" });
      cases[caseId] = c;
      setCases(cases);
    } catch (e) {
      console.warn("agent_outputs hydration failed:", e);
    }
  }
  // One-time auto-migration: earlier builds wrote the Closing Package
  // Agent's manager-summary markdown into `decision.markdown` (after the
  // human Approve/Reject), so it surfaced on the Decisioning tab. Detect
  // that pattern and move the content over to the Closing tab so existing
  // cases self-heal without forcing the user to wipe localStorage.
  // Only trigger if the content STARTS with a closing-package-style header
  // (not just mentions closing keywords anywhere in a decision writeup).
  const decMd = c.decision?.markdown || "";
  const looksLikeClosing =
    /^#{1,4}\s*(Manager Decision|Closing Package|Loan Package)/im.test(decMd) ||
    (/^#{1,4}\s*Closing (Checklist|Readiness)/im.test(decMd) && !/^#{1,4}\s*(GO|NO.GO|CONDITIONAL)/im.test(decMd));
  const closingHasContent = !!(c.closing && c.closing.markdown && !_looksLikeFailureStub(c.closing.markdown));
  if (looksLikeClosing && !closingHasContent) {
    // Only carry over the closing markdown if its embedded "Decision:"
    // matches the underwriter's most recent sign-off. Otherwise it's a
    // stale package from a previous flip-flop and would mislead the user.
    const human = String(c.decision?.humanDecision || "").toUpperCase();
    const embedded = (decMd.match(/Decision:\s*\*?\*?\s*(APPROVED|REJECTED|DECLINED)/i) || [])[1];
    const embeddedNorm = embedded ? embedded.toUpperCase().replace("DECLINED", "REJECTED") : null;
    const humanNorm = human === "DECLINED" ? "REJECTED" : human;
    const consistent = !humanNorm || !embeddedNorm || embeddedNorm === humanNorm;
    if (consistent) {
      c.closing = {
        ...(c.closing || {}),
        packageId: c.closing?.packageId || newId("PKG"),
        status: "assembled",
        markdown: decMd,
      };
    }
    // Either way, clear the closing content from the Decision panel.
    c.decision = { ...c.decision, markdown: "" };
    cases[caseId] = c;
    setCases(cases);
  }
  return {
    case: c.case,
    intake: c.intake || null,
    kyc: c.kyc || null,
    spreading: c.spreading || null,
    memo: c.memo || null,
    decision: c.decision || null,
    closing: c.closing || null,
    phaseA: c.phaseA || null,
    pipelineRanAt: c.pipelineRanAt || null,
    pipelineStartedAt: c.pipelineStartedAt || null,
  };
}

// Run the Phase A pipeline (Document Intake -> KYC -> Financial -> Memo ->
// Decision) and store each agent's own output in its own panel. The Closing
// Package agent is intentionally NOT run here — it waits for the human
// Approve/Reject decision recorded via submitHumanDecision().
//
// SEQUENTIAL EXECUTION: Uses the /process endpoint which runs a SequentialAgent
// on the backend. Agents run strictly in order: Document_Intake -> KYC ->
// Financial -> Memo -> Decision. This ensures each agent sees prior outputs.

// Wipe all cached agent outputs and pipeline guards for a single case so the
// next pipeline run starts fresh. Used by the "Reset Case" button when an
// earlier run produced empty / failed outputs that are stuck in cache.
export function resetCaseAgentOutputs(caseId) {
  if (isDemoCaseId(caseId)) {
    // Reset = drop the local human-decision override, falling back to the
    // canonical demo payload.
    clearDemoOverride(caseId);
    return true;
  }
  const cs = getCases();
  const c = cs[caseId];
  if (!c) return false;
  delete c.intake;
  delete c.kyc;
  delete c.spreading;
  delete c.memo;
  delete c.decision;
  delete c.closing;
  delete c.phaseA;
  c.pipelineRanAt = null;
  c.pipelineStartedAt = null;
  setCases(cs);
  return true;
}

export async function runPreApprovalPipeline(caseId, reviewer, onAgentDone) {
  // Demo cases are pre-baked. The pipeline is a no-op so we don't fire any
  // ADK / Vertex Gemini calls and don't hit the backend.
  if (isDemoCaseId(caseId)) {
    return getDemoCaseWithOverrides(caseId);
  }
  const userId = reviewer || "Banker";
  // onAgentDone(agentKey) is fired after each agent completes so the UI can
  // update progressively. With sequential execution, we fire these after
  // the full pipeline completes (all outputs arrive together).
  const fire = (k) => { try { onAgentDone && onAgentDone(k); } catch (_) {} };
  
  // Mark the pipeline as in-flight immediately so re-mounts don't kick off
  // a duplicate run while the agents are still working.
  {
    const _cases = getCases();
    _cases[caseId] = _cases[caseId] || { case: { caseId, timeline: [] } };
    _cases[caseId].pipelineStartedAt = nowIso();
    setCases(_cases);
  }

  try {
    // Call the sequential /process endpoint - runs all 5 agents in order
    const result = await backendProcessCase(caseId, userId);
    const ao = result.agent_outputs || {};
    
    // Extract outputs - the backend returns them keyed by agent short name
    const intakeRaw = ao.document_intake || "";
    const kycRaw = ao.kyc || "";
    const finRaw = ao.financial || "";
    const memoRaw = ao.memo || "";
    const decRaw = ao.decision || "";
    
    // Parse JSON and markdown from each agent's output
    const intakeJson = extractJsonFromMarkdown(intakeRaw);
    const kycJson = extractJsonFromMarkdown(kycRaw);
    const finJson = extractJsonFromMarkdown(finRaw);
    const memoJson = extractJsonFromMarkdown(memoRaw);
    const decJson = extractJsonFromMarkdown(decRaw);
    
    const intakeMd = stripJsonFromMarkdown(intakeRaw);
    const kycMd = stripJsonFromMarkdown(kycRaw);
    const finMd = stripJsonFromMarkdown(finRaw);
    const memoMd = stripJsonFromMarkdown(memoRaw);
    const decMd = stripJsonFromMarkdown(decRaw);
    
    // Update localStorage with all agent outputs
    const cases = getCases();
    cases[caseId] = cases[caseId] || { case: { caseId, timeline: [] } };
    
    // Build phaseA combined output
    cases[caseId].phaseA = [
      intakeRaw, kycRaw, finRaw, memoRaw, decRaw
    ].join("\n\n---\n\n");
    
    // Store each agent's output
    cases[caseId].intake = { ...(intakeJson || {}), markdown: intakeMd };
    fire("intake");
    
    cases[caseId].kyc = {
      kycId: newId("KYC"),
      kycChecklist: [],
      flags: [],
      ...(kycJson || {}),
      markdown: kycMd,
    };
    fire("kyc");
    
    cases[caseId].spreading = {
      spreadingId: newId("SPR"),
      status: "completed",
      ratios: {},
      summary: {},
      assessments: [],
      anomalies: [],
      ...(finJson || {}),
      markdown: finMd,
    };
    fire("spreading");
    
    cases[caseId].memo = {
      memoId: newId("MEMO"),
      summary: {},
      sections: [],
      ...(memoJson || {}),
      markdown: memoMd,
    };
    fire("memo");
    
    cases[caseId].decision = {
      decisionId: newId("DEC"),
      pd: {},
      lgd: {},
      ...(decJson || {}),
      markdown: decMd,
    };
    fire("decision");
    
    // Update case metadata
    cases[caseId].case = cases[caseId].case || { caseId, timeline: [] };
    cases[caseId].case.timeline = cases[caseId].case.timeline || [];
    cases[caseId].case.timeline.push({
      date: nowIso(),
      event: "Pre-approval pipeline complete (sequential)",
      actor: "SequentialAgent"
    });
    cases[caseId].pipelineRanAt = nowIso();
    cases[caseId].pipelineStartedAt = null;
    setCases(cases);
    
    return cases[caseId];
  } catch (err) {
    console.error("Pipeline failed:", err);
    // Clear the in-flight marker on failure
    const cases = getCases();
    if (cases[caseId]) {
      cases[caseId].pipelineStartedAt = null;
      setCases(cases);
    }
    throw err;
  }
}

// ---------- Agent runs (forwarded to chat) ----------
// outputKey = which key under chat.agent_outputs to prefer (e.g. "kyc", "financial").
async function runAgentStep(caseId, instruction, key, outputKey, baseFields = {}, agentName = null) {
  const cases = getCases();
  const c = cases[caseId];
  const userId = c?.case?.assignedTo || "Banker";
  // Prefer the per-agent endpoint when we know the ADK agent name. This skips
  // the root orchestrator (which refuses to run a single sub-agent "out of order")
  // and runs the agent directly with the same pre-seeded session state.
  let md;
  if (agentName) {
    const r = await backendChatAgent(caseId, userId, agentName, instruction);
    md = r.output || r.response;
  } else {
    const chat = await backendChat(caseId, userId, instruction);
    const ao = chat.agent_outputs || {};
    md = (outputKey && ao[outputKey]) || chat.response;
  }
  cases[caseId] = cases[caseId] || { case: { caseId, timeline: [] } };
  cases[caseId][key] = { ...baseFields, markdown: md };
  cases[caseId].case.timeline = cases[caseId].case.timeline || [];
  cases[caseId].case.timeline.push({ date: nowIso(), event: `${key} agent ran`, actor: agentName || "Orchestrator" });
  setCases(cases);
  return cases[caseId][key];
}

export async function runKycCheck(caseId /*, applicationData */) {
  return runAgentStep(
    caseId,
    "Run the KYC Concierge analysis for this case using the documents and application data already in state. Return the KYC checklist, risk flags and compliance summary.",
    "kyc",
    "kyc",
    { kycChecklist: [], kycId: newId("KYC"), flags: [] },
    "kyc",
  );
}

export async function approveKyc(caseId, reviewer /*, flaggedItems */) {
  const cases = getCases();
  if (cases[caseId]) {
    cases[caseId].case.kycApproved = true;
    cases[caseId].case.kycApprovedBy = reviewer;
    cases[caseId].case.kycApprovedAt = nowIso();
    setCases(cases);
  }
  return { ok: true };
}

export async function runSpreading(caseId /*, data */) {
  return runAgentStep(
    caseId,
    "Run only the Financial Spreading Agent for this case. Read the financial documents in state, spread the data, reason about ratios and anomalies, and produce a confidence report.",
    "spreading",
    "financial",
    { spreadingId: newId("SPR"), status: "completed", ratios: {}, summary: {}, assessments: [], anomalies: [] },
  );
}

export async function generateMemo(caseId, underwriterNotes) {
  const note = underwriterNotes ? ` Underwriter notes to consider: ${underwriterNotes}` : "";
  return runAgentStep(
    caseId,
    `Run only the Credit Memo Agent for this case. Use the prior agent outputs (intake, KYC, financial) in state to draft the credit memo and underwriting narrative.${note}`,
    "memo",
    "memo",
    { memoId: newId("MEMO"), summary: {}, sections: [] },
  );
}

export async function runDecisioning(caseId) {
  return runAgentStep(
    caseId,
    "Run only the Decision Support Agent for this case. Provide a GO / NO GO / CONDITIONAL GO recommendation with rationale, suggested conditions and top risks. Do NOT call record_human_decision yet — wait for the human.",
    "decision",
    "decision",
    { decisionId: newId("DEC"), pd: {}, lgd: {} },
  );
}

export async function submitHumanDecision(caseId, decision, reviewer, notes, reviewChecklist) {
  // Demo cases: persist the underwriter's verdict locally, no backend call,
  // no Closing Package Agent run.
  if (isDemoCaseId(caseId)) {
    const ov = applyDemoHumanDecision(caseId, decision, reviewer, notes);
    return {
      humanDecision: ov.humanDecision,
      humanDecisionBy: ov.humanDecisionBy,
      humanDecisionAt: ov.humanDecisionAt,
      humanDecisionNotes: ov.humanDecisionNotes,
    };
  }
  const verdict = decision === "approved" ? "APPROVED" : "REJECTED";
  const noteSuffix = notes ? ` Notes: ${notes}` : "";
  // Wipe any previous closing package immediately. If the manager just
  // flipped their verdict (e.g. APPROVED -> REJECTED), the old closing
  // markdown is now misleading and must not stay on the Closing tab while
  // the new agent run is in flight.
  {
    const _cases = getCases();
    if (_cases[caseId]) {
      _cases[caseId].closing = null;
      setCases(_cases);
    }
  }

  // STEP 1: persist the human decision LOCALLY first. This must always
  // succeed even if the backend is unreachable / slow / restarting — the
  // underwriter's sign-off should never be lost just because the Closing
  // Package Agent call fails.
  {
    const _cases = getCases();
    if (_cases[caseId]) {
      _cases[caseId].decision = _cases[caseId].decision || {};
      _cases[caseId].decision.humanDecision = verdict;
      _cases[caseId].decision.humanDecisionBy = reviewer;
      _cases[caseId].decision.humanDecisionAt = nowIso();
      _cases[caseId].decision.humanDecisionNotes = notes;
      _cases[caseId].decision.reviewChecklist = reviewChecklist || {};
      _cases[caseId].case = _cases[caseId].case || { caseId, timeline: [] };
      _cases[caseId].case.status = verdict === "APPROVED" ? "Approved" : "Declined";
      _cases[caseId].case.statusType = verdict === "APPROVED" ? "success" : "warning";
      _cases[caseId].case.timeline = _cases[caseId].case.timeline || [];
      _cases[caseId].case.timeline.push({
        date: nowIso(),
        event: `Human decision: ${verdict}`,
        actor: reviewer,
      });
      setCases(_cases);
    }
  }

  // STEP 2: invoke the Closing Package Agent via the deterministic /decide
  // endpoint. This runs the post_approval_pipeline (SequentialAgent) which
  // calls record_human_decision and produces the closing package.
  let closingMd = "";
  try {
    const result = await backendDecideCase(caseId, reviewer || "Underwriter", verdict);
    closingMd = result.agent_outputs?.closing || result.response || "";
  } catch (err) {
    console.warn("Closing Package Agent call failed:", err);
    closingMd =
      `> ⚠️ The Loan Package Agent could not be reached (${err && err.message ? err.message : 'network error'}).\n\n` +
      `The underwriter's **${verdict}** decision has been recorded. ` +
      `Click **Re-run Loan Package** on the Loan Package tab to retry once the backend is reachable.`;
  }

  const cases = getCases();
  if (cases[caseId]) {
    // Closing agent output lives on its own tab.
    cases[caseId].closing = {
      ...(cases[caseId].closing || {}),
      packageId: cases[caseId].closing?.packageId || newId("PKG"),
      status: closingMd && !closingMd.startsWith("> ⚠️") ? "assembled" : "pending",
      markdown: closingMd,
    };
    cases[caseId].case.timeline = cases[caseId].case.timeline || [];
    if (closingMd && !closingMd.startsWith("> ⚠️")) {
      cases[caseId].case.timeline.push({
        date: nowIso(),
        event: "Closing package generated",
        actor: reviewer,
      });
    }
    setCases(cases);
  }
  return cases[caseId]?.decision;
}

export async function assembleClosingPackage(caseId) {
  return runAgentStep(
    caseId,
    "Assemble the final closing package summary for this case, verify completeness, and flag missing dependencies.",
    "closing",
    "closing",
    { packageId: newId("PKG"), status: "assembled", documents: [] },
    "closing",
  );
}

async function backendAsk(question, userId, caseId = null) {
  const res = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, question, case_id: caseId }),
  });
  if (!res.ok) throw new Error(`ask failed (${res.status})`);
  return res.json(); // { response, context_summary }
}

// ---------- Chatbot (LoanAssist) ----------
// Use /ask because the backend endpoint explicitly loads applications, cases,
// and persisted agent outputs before invoking the chatbot agent.
export async function sendLendWiseMessage(caseId, message, userRole, userEmail) {
  const userId = userEmail || userRole || "User";
  try {
    const r = await backendAsk(message, userId, caseId || null);
    const reply = r.response || "";
    return {
      reply,
      response: reply,
      message: reply,
      route: r.route || "chatbot",
      rag: r.rag || null,
    };
  } catch (e) {
    return {
      reply: `Sorry, the assistant is unavailable right now (${e.message}). Please try again in a moment.`,
      response: null,
    };
  }
}
