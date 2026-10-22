# Telemetry Instrumentation Participant Guide

This guide explains what telemetry was added to the LoanProcessAI backend and where the code changes are located.

Use this together with:

```text
FINAL_BACKEND_DEPLOYMENT_PARTICIPANT_NOTE.md
FINAL_CLOUD_OBSERVABILITY_PARTICIPANT_NOTE.md
```

## 1. Why We Added Instrumentation

The goal is to operate an LLM application, not just run it.

The telemetry helps answer:

- Is the backend receiving requests?
- Is RAG retrieval working?
- How long did Azure AI Search take?
- How long did the model call take?
- Which source documents were retrieved?
- How many input and output tokens did an instrumented LLM call use?
- Why did the model stop generating?
- Did Azure OpenAI report prompt or content-filter results?
- Did guardrails block anything?
- Which agent step ran?
- Which agent step was slow?
- Was the full pre-approval process completed?
- Can the same evidence be diagnosed locally when Azure Monitor is unavailable?

## 2. Main Files Changed

```text
backend/app.py
backend/config.py
backend/observability.py
backend/analyze_local_logs.py
backend/guardrails.py
backend/evaluator.py
backend/test_rag_search_langsmith.py
backend/.env.example
```

Supporting agent/pipeline files:

```text
backend/agent.py
backend/tools.py
backend/sub_agents/
backend/prompts/
```

Most telemetry is emitted from `app.py` and formatted/exported by `observability.py`.

## 3. Telemetry Event Types

| Event | Purpose |
|---|---|
| `http.request.completed` | Every API request completed |
| `http.request.failed` | API request failed |
| `llm.request.started` | LLM call started |
| `llm.request.completed` | LLM call completed |
| `llm.request.failed` | LLM call failed |
| `rag.request.completed` | RAG request completed |
| `guardrail.blocked` | Input/output guardrail blocked content |
| `agent.step.completed` | One agent step completed |
| `agent.request.completed` | Full agent/pipeline operation completed |
| `agent.step.delay_simulated` | Training-only agent delay was introduced |
| `agent.context.corrupted` | Training-only agent context issue was introduced |
| `observability.configured` | Shows whether local-only or Azure Monitor export is active |

## 4. `observability.py`

File:

```text
backend/observability.py
```

This file provides the common telemetry foundation.

Key responsibilities:

- create JSON logs
- write the same structured events to a local JSONL file
- attach correlation id
- configure Azure Monitor / Application Insights
- provide `observe_operation`
- extract safe usage, finish, model, and filter metadata from LLM responses
- include custom telemetry fields

Important fields supported:

```text
correlation_id
operation
method
path
status_code
duration_ms
model_latency_ms
search_latency_ms
prompt_length
response_length
input_tokens
output_tokens
total_tokens
finish_reason
content_filter_results
prompt_filter_results
llm_response_id
llm_response_model
system_fingerprint
model_deployment
llm_route
llm_phase
llm_status
agent_name
case_id
pipeline
step_order
step_status
guardrail_type
guardrail_action
guardrail_reason
app_release
rag_prompt_version
loanassist_prompt_version
rag_index_version
llm_trace_mode
```

Important distinction:

```text
prompt_length and response_length = character counts calculated by our code
input_tokens, output_tokens and total_tokens = token counts returned by the LLM API
```

Character counts are useful even when an SDK does not expose usage. Actual token
counts are better for quota and cost monitoring, but are available only for the
LLM calls whose complete API response is captured by our instrumentation.

Participant takeaway:

```text
observability.py decides how logs look and where telemetry is sent.
```

## 5. Correlation ID Instrumentation

File:

```text
backend/app.py
```

The middleware adds a correlation id to every request.

It does three things:

1. accepts `X-Correlation-ID` if caller provides one,
2. generates a new id if missing,
3. writes the same id into logs and response headers.

This helps trace one request across:

```text
frontend -> backend -> RAG -> LLM -> logs
```

Watch for:

```text
correlation_id
```

in terminal logs or Azure Monitor.

## 6. Readiness Metadata

File:

```text
backend/app.py
```

Endpoint:

```text
GET /readyz
```

It now shows operational metadata:

```text
status
model_connector
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

It does not expose secrets.

Participant takeaway:

```text
/readyz confirms whether the backend is configured for RAG, guardrails, and telemetry.
```

## 7. Config Instrumentation

File:

```text
backend/config.py
```

This centralizes runtime configuration.

Important values:

```text
APP_RELEASE
RAG_PROMPT_VERSION
LOANASSIST_PROMPT_VERSION
RAG_INDEX_VERSION
LLM_TRACE_MODE
RAG_TOP_K
RAG_MAX_COMPLETION_TOKENS
GUARDRAILS_ENABLED
LLM_EVALUATION_ENABLED
AZURE_OPENAI_DEPLOYMENT
AZURE_OPENAI_EVALUATOR_DEPLOYMENT
AZURE_SEARCH_INDEX
```

The following logging controls are read directly by `observability.py`:

```text
LOCAL_FILE_LOG_ENABLED
LOCAL_LOG_FILE
LOG_LEVEL
APPLICATIONINSIGHTS_CONNECTION_STRING
```

Participant takeaway:

```text
Configuration should be changed using env vars, not by editing code.
```

## 8. RAG Instrumentation

File:

```text
backend/app.py
```

Endpoint:

```text
POST /rag/ask
```

RAG flow:

```text
question
-> input guardrail
-> Azure AI Search retrieval
-> context prompt creation
-> Azure OpenAI answer generation
-> output guardrail
-> optional evaluator
-> telemetry log
```

Main event:

```text
rag.request.completed
```

Important fields:

```text
top_k
retrieval_count
search_latency_ms
model_latency_ms
question_length
prompt_length
response_length
input_tokens
output_tokens
total_tokens
finish_reason
model_deployment
source_titles
rag_prompt_version
rag_index_version
llm_trace_mode
```

Participant takeaway:

```text
RAG telemetry separates search latency from model latency.
```

## 9. LLM Call Instrumentation

Files:

```text
backend/app.py
backend/evaluator.py
```

Events:

```text
llm.request.started
llm.request.completed
llm.request.failed
```

Important fields:

```text
llm_route
llm_phase
llm_status
model_deployment
model_latency_ms
prompt_length
response_length
max_completion_tokens
input_tokens
output_tokens
total_tokens
finish_reason
content_filter_results
prompt_filter_results
llm_response_id
llm_response_model
system_fingerprint
```

Example routes:

```text
rag_answer
rag_evaluator
```

Participant takeaway:

```text
LLM telemetry shows model latency, character size, actual API token usage when
available, the finish reason, and Azure OpenAI filter metadata.
```

Note:

```text
Direct Azure OpenAI calls made in RAG/evaluator are instrumented explicitly.
ADK agent internals are monitored at agent operation and step level.
```

Therefore, token metadata is expected for instrumented RAG generation and
evaluator calls. It may not appear for every internal ADK agent call because the
application does not receive or instrument every raw provider response at that
level.

## 10. Guardrail Instrumentation

Files:

```text
backend/guardrails.py
backend/app.py
```

`guardrails.py` contains the checks.

Input guardrails check for:

```text
prompt injection
loan fraud or misuse
PII patterns
unsafe content
```

Output guardrails check for:

```text
PII leakage
instruction leakage
loan misuse
```

Main event:

```text
guardrail.blocked
```

Important fields:

```text
guardrail_type
guardrail_action
guardrail_reason
route
operation
```

Participant takeaway:

```text
Guardrail logs record the reason and category, but do not log raw sensitive content.
```

## 11. Evaluator Instrumentation

File:

```text
backend/evaluator.py
```

Evaluator is optional and controlled by:

```env
LLM_EVALUATION_ENABLED=true
```

It uses LLM-as-judge to score:

```text
groundedness
correctness
answer_relevance
hallucination_risk
bias_fairness_risk
pii_risk
safety
policy_compliance
```

It also emits:

```text
llm.request.started
llm.request.completed
llm.request.failed
```

with route:

```text
rag_evaluator
```

The evaluator LLM call also records token usage, finish reason, latency, and
filter metadata when returned by the API. The final `rag.request.completed`
event records the evaluator's quality and risk fields.

Participant takeaway:

```text
Evaluator telemetry lets us discuss quality, not only availability.
```

## 12. LoanAssist Instrumentation

File:

```text
backend/app.py
```

Endpoint:

```text
POST /ask
```

LoanAssist now supports:

- app status questions
- case questions
- RAG routing for policy/reference questions
- input guardrails
- output guardrails
- operation telemetry

Main event:

```text
agent.request.completed
```

Important operation:

```text
loanprocessai.agent.loan_assist
```

Participant takeaway:

```text
LoanAssist is monitored as an agent-level business operation.
```

## 13. Agent Pipeline Instrumentation

Files:

```text
backend/app.py
backend/agent.py
backend/tools.py
backend/sub_agents/
```

Pre-approval endpoint:

```text
POST /process/{case_id}
```

Post-approval process is also monitored.

Process-level event:

```text
agent.request.completed
```

Step-level event:

```text
agent.step.completed
```

Pre-approval steps:

```text
document_intake
kyc
financial
memo
decision
```

Post-approval step:

```text
closing
```

Important fields:

```text
case_id
pipeline
agent_name
step_order
step_status
duration_ms
output_length
```

Participant takeaway:

```text
Agent step telemetry creates a waterfall view of the loan process.
```

## 14. What Changed In Agent Files

Files:

```text
backend/agent.py
backend/tools.py
backend/sub_agents/
backend/prompts/
```

The agent files define the loan process behavior:

- root orchestrator
- sub-agent responsibilities
- processing tools
- prompts
- persisted agent outputs

Most final telemetry is not deeply embedded inside every sub-agent file.

Instead, `app.py` wraps the process and emits:

```text
agent.step.completed
agent.request.completed
```

This keeps the demo simple:

```text
operations team sees process and step health without reading every agent implementation.
```

## 15. LangSmith RAG Demo Instrumentation

File:

```text
backend/test_rag_search_langsmith.py
```

This is a demo/debug script, not the production API path.

It helps inspect:

- retrieval call
- retrieved chunks
- final prompt sent to LLM
- model response
- token/context behavior

Participant takeaway:

```text
LangSmith is useful for development-time tracing. Azure Monitor is used for cloud operations.
```

## 16. Local Structured Logging

The same JSON event is written to:

```text
backend terminal/stdout
backend/logs/loanprocessai.jsonl
Azure Monitor, when APPLICATIONINSIGHTS_CONNECTION_STRING is configured
```

Local file logging is enabled by default. It can be controlled with:

```env
LOCAL_FILE_LOG_ENABLED=true
# LOCAL_LOG_FILE=D:/temporary/loanprocessai.jsonl
```

Use an absolute path when overriding `LOCAL_LOG_FILE`. When no override is
provided, the stable default is:

```text
backend/logs/loanprocessai.jsonl
```

Each line is one JSON object. This makes the file suitable for PowerShell,
Python, log shippers, dashboards, or a GenAI incident-analysis exercise.

Do not share this generated log file without reviewing it, especially if full
trace mode was enabled.

## 17. Local Log Analyzer

File:

```text
backend/analyze_local_logs.py
```

Run from the backend folder:

```powershell
cd backend
python analyze_local_logs.py
```

Optional arguments:

```powershell
python analyze_local_logs.py --log logs/loanprocessai.jsonl --limit 20
```

The analyzer summarizes:

- event counts and HTTP status codes
- recent errors and failed operations
- RAG retrieval count and search/model latency
- LLM input, output, and total tokens
- LLM finish reasons
- guardrail blocks
- evaluator risk signals
- agent simulation signals
- average duration by agent step

Participant takeaway:

```text
The analyzer is a local learning equivalent of an operations dashboard.
Production teams normally use dashboards, alerts, saved queries, and incident tools over centralized telemetry.
```

## 18. Trace Modes And Sensitive Content

Config:

```env
LLM_TRACE_MODE=metadata
```

Current behavior:

```text
logs include metadata
logs do not include full prompts
logs do not include full chunks
logs do not include customer PII
```

Metadata examples:

```text
prompt_length
response_length
source_titles
retrieval_count
latency
route
deployment
```

Participant takeaway:

```text
Production telemetry should usually log metadata, not full prompt/chunk text.
```

Supported modes:

| Mode | Logged content | Intended use |
|---|---|---|
| `metadata` | Lengths, tokens, latency, routes, sources, filters and versions | Default for local and cloud operations |
| `debug_redacted` | Full prompt, chunks and answer after basic PII masking | Controlled local diagnosis only |
| `debug_full` | Full prompt, chunks and answer without masking | Exceptional local testing only |

`debug_full` can capture customer PII, uploaded-document content, prompts, and
answers. Never enable it in shared, cloud, classroom, or production environments
that contain real customer data.

When either debug mode is used, the extra fields are:

```text
debug_prompt
debug_chunks
debug_answer
```

Restart the backend after changing `LLM_TRACE_MODE`.

## 19. Local Terminal And File Events To Check

When testing locally, watch backend terminal for:

```text
http.request.completed
llm.request.started
llm.request.completed
rag.request.completed
guardrail.blocked
agent.step.completed
agent.request.completed
```

If these appear, the instrumentation is working.

The events should also appear as separate JSON lines in:

```text
backend/logs/loanprocessai.jsonl
```

## 20. Cloud Events To Check

In Azure Monitor / Application Insights, use:

```text
traces
```

Check:

```kql
traces
| where message in (
    "rag.request.completed",
    "llm.request.completed",
    "guardrail.blocked",
    "agent.step.completed",
    "agent.request.completed"
)
| order by timestamp desc
```

## 21. How To Explain The Flow

Simple explanation:

```text
HTTP telemetry tells us who called the API.
RAG telemetry tells us whether retrieval and generation worked.
LLM telemetry tells us latency, character size, actual token usage, finish reason, and filter outcomes.
Guardrail telemetry tells us whether safety rules blocked anything.
Agent telemetry tells us which loan process step ran and how long it took.
Local JSONL logging makes the same operational evidence available without a cloud dashboard.
```

## 22. Learning Summary

After this instrumentation, LoanProcessAI can be monitored as an LLMOps application:

- request level
- model call level
- token, finish, and content-filter metadata level
- RAG level
- safety/guardrail level
- evaluator quality level
- process level
- agent step level
- local incident-diagnosis level

This is the difference between only deploying an app and operating an LLM application responsibly.
