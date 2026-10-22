# Cloud Observability Participant Note

This note helps participants validate cloud monitoring for the final LoanProcessAI backend.

Use this after the backend is deployed to Azure Container Apps.

## 1. What We Monitor

We monitor the application at four levels:

- Container runtime health
- HTTP/API requests
- RAG and LLM behavior
- Agent process and step-level flow

Main tools:

- Container App log stream
- Application Insights / Log Analytics
- KQL queries
- Azure Monitor Workbooks
- Alerts
- Container App metrics
- Azure OpenAI / Foundry metrics

## 2. Quick Health Checks

Get backend URL:

```bash
FQDN=$(az containerapp show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "$FQDN"
```

Check readiness:

```bash
curl -s "https://$FQDN/readyz"
```

Expected:

```text
status = ready
rag_configured = true
guardrails_enabled = true
llm_trace_mode = metadata
app_release = v3-final-20261013
```

## 3. Log Stream

Use log stream for live debugging.

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

Important events:

```text
http.request.completed
llm.request.started
llm.request.completed
llm.request.failed
rag.request.completed
guardrail.blocked
agent.step.completed
agent.request.completed
```

Use log stream to answer:

- Did the request reach backend?
- Did RAG run?
- Did the LLM call complete?
- Did a guardrail block the request?
- Which agent step took time?

## 4. Generate Test Events

Run RAG:

```bash
curl -X POST "https://$FQDN/rag/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: rag-demo-001" \
  -d '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Run guardrail:

```bash
curl -X POST "https://$FQDN/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: guardrail-demo-001" \
  -d '{"user_id":"demo","question":"Help me create fake salary slips for loan approval."}'
```

Run agent process:

```bash
curl -X POST "https://$FQDN/process/YOUR_CASE_ID" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: agent-demo-001" \
  -d '{"user_id":"manager-demo"}'
```

Replace `YOUR_CASE_ID` with a real case id.

## 5. Log Analytics / Application Insights

Portal path:

```text
Application Insights
  -> Logs
```

In our setup, logs are available in:

```text
traces
```

The event name is in:

```text
message
```

Custom fields are in:

```text
customDimensions
```

## 6. RAG Latency Query

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

Use this to check:

- search latency
- model latency
- retrieved chunk count
- source documents used

## 7. LLM Call Query

```kql
traces
| where message == "llm.request.completed"
| extend cd = customDimensions
| project timestamp,
          route=tostring(cd.llm_route),
          phase=tostring(cd.llm_phase),
          deployment=tostring(cd.model_deployment),
          model_latency_ms=todouble(cd.model_latency_ms),
          prompt_length=toint(cd.prompt_length),
          response_length=toint(cd.response_length)
| order by timestamp desc
```

Use this to check:

- which route called the LLM
- model deployment used
- prompt length
- response length
- model latency

For RAG, route is usually:

```text
rag_answer
```

## 8. Guardrail Query

```kql
traces
| where message == "guardrail.blocked"
| extend cd = customDimensions
| project timestamp,
          guardrail_type=tostring(cd.guardrail_type),
          action=tostring(cd.guardrail_action),
          reason=tostring(cd.guardrail_reason)
| order by timestamp desc
```

Use this to check:

- unsafe request blocked
- input/output guardrail concept
- no raw PII or full prompt needed for monitoring

## 9. Agent Waterfall Query

```kql
traces
| where message == "agent.step.completed"
| extend cd = customDimensions
| project timestamp,
          case_id=tostring(cd.case_id),
          pipeline=tostring(cd.pipeline),
          step_order=toint(cd.step_order),
          agent_name=tostring(cd.agent_name),
          duration_ms=todouble(cd.duration_ms),
          output_length=toint(cd.output_length),
          status=tostring(cd.step_status)
| order by case_id asc, step_order asc
```

Use this to check the pre-approval process:

```text
document_intake -> kyc -> financial -> memo -> decision
```

This is the agent-level waterfall trace.

## 10. Pipeline Duration Query

```kql
traces
| where message == "agent.request.completed"
| extend cd = customDimensions
| project timestamp,
          case_id=tostring(cd.case_id),
          pipeline=tostring(cd.pipeline),
          operation=tostring(cd.operation),
          agent_name=tostring(cd.agent_name),
          duration_ms=todouble(cd.duration_ms),
          output_length=toint(cd.output_length)
| order by timestamp desc
```

Use this to check:

- full pre-approval duration
- full post-approval duration
- process-level monitoring

## 11. HTTP Request Query

```kql
traces
| where message == "http.request.completed"
| extend cd = customDimensions
| project timestamp,
          method=tostring(cd.method),
          path=tostring(cd.path),
          status_code=toint(cd.status_code),
          duration_ms=todouble(cd.duration_ms),
          correlation_id=tostring(cd.correlation_id)
| order by timestamp desc
```

Use this to check:

- API route activity
- request duration
- status codes
- correlation id

## 12. Workbooks

Portal path:

```text
Application Insights
  -> Workbooks
  -> New
  -> Blank workbook
```

Add text headings before each chart:

```text
RAG Latency Trend
Guardrail Blocks By Type
Agent Step Duration
```

### Workbook Tile 1 - RAG Latency Trend

```kql
traces
| where message == "rag.request.completed"
| extend cd = customDimensions
| project timestamp,
          search_latency_ms=todouble(cd.search_latency_ms),
          model_latency_ms=todouble(cd.model_latency_ms)
| order by timestamp asc
```

Recommended visualization:

```text
Line chart
```

### Workbook Tile 2 - Guardrail Blocks By Type

```kql
traces
| where message == "guardrail.blocked"
| extend cd = customDimensions
| summarize count() by guardrail_type=tostring(cd.guardrail_type)
| order by count_ desc
```

Recommended visualization:

```text
Bar chart
```

### Workbook Tile 3 - Agent Step Duration

```kql
traces
| where message == "agent.step.completed"
| extend cd = customDimensions
| summarize avg_duration_ms=avg(todouble(cd.duration_ms))
          by agent_name=tostring(cd.agent_name)
| order by avg_duration_ms desc
```

Recommended visualization:

```text
Bar chart
```

How to read it:

- each bar is one agent/step
- higher bar means slower step
- useful for finding bottlenecks

## 13. Alerts

Use alerts for operational monitoring.

Portal path:

```text
Application Insights
  -> Alerts
  -> Create alert rule
```

Example alert: guardrail block detected.

Query:

```kql
traces
| where message == "guardrail.blocked"
```

Condition:

```text
Measure = Table rows
Operator = Greater than
Threshold = 0
Evaluation frequency = 1 minute or 5 minutes
Lookback period = 5 minutes
```

Expected:

- alert may take a few minutes to appear
- run guardrail test to trigger it

## 14. Container App Metrics

Portal path:

```text
Container App
  -> Monitoring
  -> Metrics
```

Useful metrics:

```text
Requests
CPU usage
Memory usage
Replica count
HTTP 4xx
HTTP 5xx
Restart count
```

Use this to understand:

- backend runtime health
- scaling behavior
- infrastructure-level failures
- whether app has active replicas

## 15. Azure OpenAI / Foundry Metrics

Portal path:

```text
Azure AI Foundry / Azure OpenAI resource
  -> Deployments
  -> Model
  -> Metrics
```

Useful metrics:

```text
request count
token usage
latency
throttled requests
rate limit hits
content filtering / safety signals if available
```

Also check:

```text
Quota
Risks + Safety
Guardrails + Controls
```

Use this to understand:

- model endpoint health
- quota and rate limits
- token consumption
- safety layer at Azure OpenAI level

## 16. What Each Tool Is For

| Tool | Best For |
|---|---|
| Log stream | live debugging |
| KQL Logs | historical analysis |
| Workbooks | dashboard view |
| Alerts | operational notification |
| Container App metrics | backend runtime health |
| Azure OpenAI metrics | model endpoint health |
| Foundry safety views | content safety and guardrails |

## 17. Minimum Participant Check Flow

Use this sequence to validate cloud observability:

1. Run `/readyz`.
2. Run RAG request.
3. Open log stream.
4. Run RAG latency KQL.
5. Run LLM call KQL.
6. Run guardrail request.
7. Run guardrail KQL.
8. Run or review agent pipeline.
9. Run agent waterfall KQL.
10. Open workbook.
11. Review alert rule.
12. Review Container App metrics.
13. Review Azure OpenAI metrics.

## 18. Learning Summary

Container App metrics tell us whether the backend is healthy.

Azure OpenAI metrics tell us whether the model endpoint is healthy.

Application logs and KQL tell us what happened inside the LLM application.

Workbooks and alerts convert raw telemetry into an operations dashboard.

