# Local Incident Simulation Participant Note

This note covers two local LLMOps incident simulations for LoanProcessAI.

Use these after local backend, frontend, RAG, and logging are working.

## 1. Incident 1: RAG Index Freshness Issue

### Scenario

A new policy document is uploaded to storage, but the Azure AI Search index is not refreshed yet.

Result:

```text
RAG cannot answer from the new policy even though the document exists in storage.
```

### Document

Use:

```text
rag_seed_documents/LoanProcessAI_Crypto_Backed_CRE_Policy_2026.pdf
```

Policy ID:

```text
LP-AI-CRE-CRYPTO-2026
```

### Test Question

```text
What is the policy for crypto-backed commercial real estate loans?
```

### Before Re-indexing

Upload the PDF to the RAG source/blob location, but do not re-index yet.

Ask the question using:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/rag/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"question":"What is the policy for crypto-backed commercial real estate loans?","top_k":5}'
```

Expected:

- new PDF is not returned
- policy ID is not returned
- RAG may say not enough evidence
- Search may return irrelevant chunks with a high score

Diagnosis:

```text
RAG index freshness / data hygiene issue
```

Key learning:

```text
Do not trust retrieval score alone. Validate source title, policy ID, and chunk content.
```

### After Re-indexing

Run the ingestion/re-indexing process.

Ask the same question again.

Expected:

- new PDF appears in sources
- policy ID appears
- answer mentions that crypto-backed CRE loans are not eligible for standard approval
- answer mentions exception committee approval before credit memo issuance

Run analyzer:

```powershell
cd backend
python analyze_local_logs.py
```

Check:

```text
RAG Health
retrieval_count
source_titles
model_latency_ms
search_latency_ms
Evaluator Risk Signals
```

## 2. Incident 2: Agent Memo Delay / Context Issue

### Scenario

The pre-approval pipeline runs, but the memo step is slow and receives corrupted financial context.

This simulates:

- context packaging issue
- session/state issue
- prompt context bug
- slow agent step
- downstream decision risk

### Enable Simulation Flags

Add these to `backend/.env`:

```env
SIMULATE_AGENT_STEP_DELAY_MS=8000
SIMULATE_AGENT_DELAY_STEP=memo
SIMULATE_AGENT_CONTEXT_CORRUPTION=memo
```

Restart backend after changing `.env`.

Optional: clear old local logs:

```powershell
cd backend
Remove-Item .\logs\loanprocessai.jsonl -ErrorAction SilentlyContinue
```

### Run The Pipeline

Submit or use a case, then run pre-approval:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/process/YOUR_CASE_ID" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"user_id":"manager-demo"}'
```

Replace:

```text
YOUR_CASE_ID
```

with the actual case id.

### Analyze Logs

```powershell
cd backend
python analyze_local_logs.py
```

Expected section:

```text
Agent Incident Simulation Signals
```

Expected events:

```text
agent.context.corrupted
agent.step.delay_simulated
```

Expected waterfall:

```text
memo has higher duration_ms than other steps
```

Example:

```text
memo: avg 20247 ms
agent.step.delay_simulated | agent=memo | duration_ms=8000
agent.context.corrupted | agent=memo | status=context_corrupted
```

### Diagnosis

Incident type:

```text
Agent workflow quality / latency issue
```

Evidence:

- pipeline completed
- memo step was slow
- memo context was corrupted
- downstream memo/decision quality may be affected

Key learning:

```text
The backend can be healthy while an agent workflow has context or quality issues.
```

## 3. Stage 1 Diagnosis Template

Use this short version:

```text
Incident Title:

Incident Type:

Affected Feature:

What Happened:

Evidence:
- event name:
- correlation id:
- source titles:
- retrieval count:
- agent name:
- duration:
- status:

Suspected Component:

Business Impact:

First Remediation:

Confidence:
High / Medium / Low
```

## 4. Suggested Remediation

For RAG incident:

```text
Run/retry indexing, validate source document appears in Search Explorer, then repeat RAG question.
```

For agent incident:

```text
Check memo prompt/context packaging, verify financial_output is present before memo, inspect agent step latency.
```

## 5. Disable Simulation Flags

After demo, remove or comment:

```env
SIMULATE_AGENT_STEP_DELAY_MS=8000
SIMULATE_AGENT_DELAY_STEP=memo
SIMULATE_AGENT_CONTEXT_CORRUPTION=memo
```

Restart backend.

## 6. Learning Summary

These two incidents show two important LLMOps ideas:

```text
RAG incidents can be caused by stale or incomplete indexes.
Agent incidents can be caused by slow steps or corrupted context, even when the backend is healthy.
```
