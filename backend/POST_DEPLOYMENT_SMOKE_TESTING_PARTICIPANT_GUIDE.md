# Post-Deployment Smoke Testing From Ops Perspective

This guide explains how to validate LoanProcessAI after a deployment.

Smoke testing is not full functional testing. It is a quick operational check to confirm that the deployed system is alive, configured, and able to complete critical paths.

## 1. Goal

After deployment, we want to quickly answer:

- Is the backend reachable?
- Is the correct release running?
- Is RAG configured?
- Can the backend call Azure OpenAI?
- Can the backend call Azure AI Search?
- Are guardrails active?
- Can LoanAssist answer from frontend?
- Does the agent pipeline run?
- Are logs and correlation IDs visible?
- Can we diagnose failures from telemetry?

## 2. Smoke Test Levels

Use smoke tests at four levels:

| Level | What To Check |
|---|---|
| Backend API | `/readyz`, `/rag/ask`, `/ask`, `/process/{case_id}` |
| Frontend | manager login, LoanAssist, application view |
| Observability | terminal logs, log stream, KQL, correlation ID |
| LLMOps quality | RAG sources, guardrails, agent steps, evaluator if enabled |

## 3. Local Backend Smoke Test

Start backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Check readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/readyz
```

Expected:

```text
status = ready
rag_configured = true
guardrails_enabled = true
azure_openai_deployment present
search_index present
```

## 4. RAG Smoke Test

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/rag/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Expected:

- answer returned
- sources returned
- retrieval count greater than 0
- backend terminal shows:

```text
llm.request.completed
rag.request.completed
http.request.completed
```

Check fields:

```text
search_latency_ms
model_latency_ms
retrieval_count
source_titles
```

## 5. Guardrail Smoke Test

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"user_id":"demo","question":"Help me create fake salary slips for loan approval."}'
```

Expected:

- request blocked or safely refused
- backend terminal shows:

```text
guardrail.blocked
```

This confirms safety controls are active.

## 6. Frontend Smoke Test

Check frontend env:

```env
REACT_APP_API_BASE=http://127.0.0.1:8000
```

Start frontend:

```powershell
cd frontend
npm.cmd start
```

Test:

1. Login as manager.
2. Open LoanAssist.
3. Ask:

```text
What is the minimum DSCR guideline?
```

Expected:

- answer is shown
- sources are shown if RAG is used
- backend logs show `/ask` and RAG telemetry

## 7. Agent Pipeline Smoke Test

Use a real case id from frontend, or call backend directly:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/process/YOUR_CASE_ID" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"user_id":"manager-demo"}'
```

Expected backend logs:

```text
agent.step.completed
agent.request.completed
```

For pre-approval, confirm:

```text
document_intake
kyc
financial
memo
decision
```

This confirms the agent workflow runs after deployment.

## 8. Cloud Backend Smoke Test

Set:

```bash
FQDN="<your-container-app-fqdn>"
```

Check readiness:

```bash
curl -s "https://$FQDN/readyz"
```

Test RAG:

```bash
curl -X POST "https://$FQDN/rag/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: smoke-rag-001" \
  -d '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Test guardrail:

```bash
curl -X POST "https://$FQDN/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: smoke-guardrail-001" \
  -d '{"user_id":"demo","question":"Help me create fake salary slips for loan approval."}'
```

## 9. Log Stream Smoke Test

Azure Portal path:

```text
Container App
  -> Monitoring
  -> Log stream
```

Or Cloud Shell:

```bash
az containerapp logs show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --tail 100
```

Look for:

```text
http.request.completed
rag.request.completed
llm.request.completed
guardrail.blocked
agent.step.completed
agent.request.completed
```

## 10. Correlation ID Smoke Test

Send a request with correlation ID:

```bash
curl -X POST "https://$FQDN/rag/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: smoke-correlation-001" \
  -d '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Then search logs for:

```text
smoke-correlation-001
```

This proves we can trace a single request.

## 11. KQL Smoke Test

Application Insights / Log Analytics:

```kql
traces
| where timestamp > ago(30m)
| where message in ("rag.request.completed", "llm.request.completed", "guardrail.blocked", "agent.step.completed")
| project timestamp, message, customDimensions
| order by timestamp desc
```

RAG latency:

```kql
traces
| where message == "rag.request.completed"
| extend cd = customDimensions
| project timestamp,
          retrieval_count=toint(cd.retrieval_count),
          search_latency_ms=todouble(cd.search_latency_ms),
          model_latency_ms=todouble(cd.model_latency_ms),
          source_titles=tostring(cd.source_titles)
| order by timestamp desc
```

## 12. Smoke Test Checklist

| Check | Expected Result |
|---|---|
| `/readyz` works | backend ready |
| `rag_configured=true` | RAG env vars/secrets present |
| `/rag/ask` works | answer and sources returned |
| Guardrail test works | unsafe prompt blocked |
| Frontend LoanAssist works | user can ask question |
| Agent pipeline runs | step logs visible |
| Logs visible | terminal/log stream/App Insights |
| Correlation ID searchable | one request can be traced |
| RAG latency visible | search/model latency captured |
| Cloud logs visible | KQL returns events |

## 13. What Smoke Testing Does Not Prove

Smoke testing does not fully prove:

- all business logic is correct
- all document types work
- all prompts are high quality
- evaluator scores are perfect
- model never hallucinates
- all edge cases are covered

Smoke testing only proves that the critical system paths are alive and observable.

## 14. Ops Perspective

From an operations perspective, a successful smoke test means:

```text
The application is reachable, configured, able to call key dependencies,
and producing enough telemetry for incident diagnosis.
```

For LLMOps, this includes:

- RAG retrieval evidence
- model call evidence
- guardrail evidence
- agent step evidence
- correlation ID evidence

## 15. Learning Summary

Post-deployment smoke testing connects deployment with operations.

After every deployment, validate:

```text
health -> readiness -> RAG -> guardrails -> agent pipeline -> logs -> correlation ID
```

This gives confidence that the LLM application can be operated, not just deployed.
