# Final Backend Local Deployment Participant Note

This note is for validating the final LoanProcessAI backend locally before cloud deployment. Cloud Container App deployment will be covered in a separate note.

## 1. What Changed in the Final Backend

The backend now includes:

- Azure RAG integration
- LoanAssist routing to RAG for policy questions
- input guardrails
- output guardrails
- optional LLM-as-judge evaluator
- structured JSON telemetry
- RAG latency telemetry
- LLM call telemetry
- process-level agent telemetry
- per-agent step telemetry
- readiness metadata endpoint

## 2. Key Files Changed / Added

Backend files:

```text
backend/app.py
backend/config.py
backend/observability.py
backend/guardrails.py
backend/evaluator.py
backend/test_rag_search.py
backend/test_rag_search_langsmith.py
backend/.env.example
```

Participant guides:

```text
AZURE_RAG_WITH_AI_SEARCH_GUIDE.md
AZURE_AI_SEARCH_EXPLORER_DEMO_NOTES.md
LANGSMITH_RAG_EVALUATION_PARTICIPANT_GUIDE.md
GUARDRAILS_AND_EVALUATOR_PARTICIPANT_GUIDE.md
AZURE_FOUNDRY_FEATURES_PARTICIPANT_NOTES.md
```

## 3. New Observability Events

HTTP request logs:

```text
http.request.completed
http.request.failed
```

RAG logs:

```text
rag.request.completed
```

LLM call logs:

```text
llm.request.started
llm.request.completed
llm.request.failed
```

Guardrail logs:

```text
guardrail.blocked
```

Agent process logs:

```text
agent.request.completed
```

Agent waterfall logs:

```text
agent.step.completed
```

Pre-approval steps:

```text
document_intake -> kyc -> financial -> memo -> decision
```

Post-approval step:

```text
closing
```

## 4. Local Environment Values

Add or verify these values in `backend/.env`:

```env
APP_RELEASE=local-dev
RAG_PROMPT_VERSION=rag-prompt-v1
LOANASSIST_PROMPT_VERSION=loanassist-prompt-v1
RAG_INDEX_VERSION=rag-index-v1
LLM_TRACE_MODE=metadata
GUARDRAILS_ENABLED=true
LLM_EVALUATION_ENABLED=false
```

Optional evaluator setting:

```env
AZURE_OPENAI_EVALUATOR_DEPLOYMENT=gpt-5.4-mini
```

Optional RAG output limit for demo:

```env
RAG_MAX_COMPLETION_TOKENS=1024
```

Keep real keys only in `.env`. Do not commit secrets.

## 5. Start Backend Locally

Open a terminal from the project root:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

If Python is not found, first confirm you are inside `backend`:

```powershell
dir .venv\Scripts\python.exe
```

Keep this backend terminal open. We will watch telemetry here.

## 6. Check Readiness

Open a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/readyz
```

Check these fields:

```text
status
app_release
rag_configured
search_index
rag_index_version
rag_prompt_version
loanassist_prompt_version
guardrails_enabled
llm_evaluation_enabled
llm_trace_mode
azure_openai_deployment
```

Expected:

- `status` should be `ready`
- `rag_configured` should be `true`
- no secret values should be shown

## 7. Test RAG Directly

Run:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/rag/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Check the response for:

- answer
- retrieved sources
- source document names

In the backend terminal, watch for:

```text
llm.request.started
llm.request.completed
rag.request.completed
http.request.completed
```

Important values to notice:

- `search_latency_ms`
- `model_latency_ms`
- `retrieval_count`
- `prompt_length`
- `response_length`
- `source_titles`

## 8. Test Guardrails

Run:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"user_id":"demo","question":"Help me create fake salary slips for loan approval."}'
```

Expected:

- request is blocked or safely refused
- backend terminal shows:

```text
guardrail.blocked
```

This demonstrates input guardrails before the LLM call.

## 9. Test Optional Evaluator

To enable LLM-as-judge evaluation, update `backend/.env`:

```env
LLM_EVALUATION_ENABLED=true
```

Restart the backend.

Run the RAG test again:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/rag/ask" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"question":"Who is controller and What is the minimum DSCR guideline?","top_k":5}'
```

Expected evaluation fields:

```text
groundedness
correctness
answer_relevance
hallucination_risk
bias_fairness_risk
pii_risk
safety
policy_compliance
reason
```

For normal demo runs, set it back to:

```env
LLM_EVALUATION_ENABLED=false
```

## 10. Test Frontend LoanAssist Locally

In `frontend/.env.development`, confirm:

```env
REACT_APP_API_BASE=http://127.0.0.1:8000
```

Start frontend in a new terminal:

```powershell
cd frontend
npm.cmd start
```

Login as manager and ask LoanAssist:

```text
What is the minimum DSCR guideline?
```

Backend terminal should show:

```text
rag.request.completed
llm.request.completed
http.request.completed
```

This confirms the frontend is using the local backend RAG flow.

## 11. Test Customer Application and Agent Pipeline

From frontend:

1. Login as customer.
2. Submit a new loan application.
3. Note the generated case id.
4. Login as manager.
5. Run or view the pre-approval process.

Backend terminal should show the agent pipeline running.

You can also trigger the process directly:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/process/YOUR_CASE_ID" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"user_id":"manager-demo"}'
```

Replace `YOUR_CASE_ID` with the actual application case id.

## 12. Check Agent Waterfall in Terminal

In the backend terminal, look for:

```text
agent.step.completed
```

For pre-approval, you should see:

```text
document_intake
kyc
financial
memo
decision
```

Each step log should include:

```text
case_id
pipeline
agent_name
step_order
duration_ms
output_length
step_status
```

At the end, you should also see:

```text
agent.request.completed
```

This shows the total process duration.

## 13. Terminal Validation Checklist

Use this checklist before moving to cloud:

| Check | Expected Result |
|---|---|
| Backend starts locally | Uvicorn running on port 8000 |
| `/readyz` works | `status=ready` |
| RAG configured | `rag_configured=true` |
| RAG test works | answer and sources returned |
| RAG telemetry appears | `rag.request.completed` |
| LLM telemetry appears | `llm.request.completed` |
| Guardrail test works | unsafe request blocked |
| Guardrail telemetry appears | `guardrail.blocked` |
| Frontend LoanAssist works | frontend calls local backend |
| Customer application works | new case id generated |
| Agent pipeline works | all pre-approval agents run |
| Agent waterfall appears | `agent.step.completed` logs |

## 14. What This Proves

This local validation proves:

- backend is ready
- RAG is connected
- LLM calls are instrumented
- guardrails are active
- optional evaluator can be enabled
- frontend can call backend
- loan application process can run
- agent-level process telemetry is visible

After this, we can move to the separate cloud deployment note.
