# Final Backend Cloud Deployment Participant Note

This note covers cloud deployment of the final LoanProcessAI backend after local validation is complete.

There are two options:

- Option A: use instructor-provided image, fastest for class
- Option B: build and push your own image to ACR, best for post-session practice

## 1. Final Backend Image

Instructor image:

```text
acrloanprocessai.azurecr.io/loanprocessai-api:v3-final-20261013
```

This image already includes:

- RAG endpoint
- LoanAssist RAG routing
- input/output guardrails
- optional evaluator
- readiness metadata
- LLM telemetry
- RAG telemetry
- agent process telemetry
- agent step waterfall telemetry

## 2. Common Values

Use your own resource names if different.

```bash
RESOURCE_GROUP="llmops"
CONTAINER_APP="loanprocespra-api"

IMAGE="acrloanprocessai.azurecr.io/loanprocessai-api:v3-final-20261013"
ACR_SERVER="acrloanprocessai.azurecr.io"
# ACR Server should be shared one notours here
```

Azure OpenAI and RAG values:

```bash
AZURE_OPENAI_ENDPOINT="https://llm-loanapp.openai.azure.com/"
AZURE_OPENAI_API_VERSION="2025-04-01-preview"
AZURE_OPENAI_DEPLOYMENT="gpt-5.4-mini"
AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small"

AZURE_SEARCH_ENDPOINT="https://srch-loanprocessai.search.windows.net"
AZURE_SEARCH_INDEX="rag-1791188978507"
AZURE_SEARCH_API_VERSION="2024-07-01"
RAG_TOP_K="5"
```

App metadata:

```bash
APP_RELEASE="v3-final-20261013"
RAG_PROMPT_VERSION="rag-prompt-v1"
LOANASSIST_PROMPT_VERSION="loanassist-prompt-v1"
RAG_INDEX_VERSION="rag-index-v1"
LLM_TRACE_MODE="metadata"
GUARDRAILS_ENABLED="true"
LLM_EVALUATION_ENABLED="false"
```

## 3. Option A - Use Instructor Image

Use this option during class if you want to avoid image build issues.

### 3.1 Set Registry Access

Instructor will provide:

```text
ACR username
ACR password
```

Run in Azure Cloud Shell Bash:

```bash
ACR_USERNAME="acrloanprocessai"
ACR_PASSWORD="Bzxwfr1ZjdsKKT3reJZowUDOfLhm0Xuap54GCwCYlmdP2QuDTm3qJQQJ99CIACYeBjFEqg7NAAACAZCRqnr4"

az containerapp registry set \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --server "$ACR_SERVER" \
  --username "$ACR_USERNAME" \
  --password "$ACR_PASSWORD"
```

### 3.2 Update Container App Image

```bash
az containerapp update \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE"
```

### 3.3 Set Non-Secret Environment Variables

```bash
az containerapp update \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    APP_RELEASE="$APP_RELEASE" \
    RAG_PROMPT_VERSION="$RAG_PROMPT_VERSION" \
    LOANASSIST_PROMPT_VERSION="$LOANASSIST_PROMPT_VERSION" \
    RAG_INDEX_VERSION="$RAG_INDEX_VERSION" \
    LLM_TRACE_MODE="$LLM_TRACE_MODE" \
    GUARDRAILS_ENABLED="$GUARDRAILS_ENABLED" \
    LLM_EVALUATION_ENABLED="$LLM_EVALUATION_ENABLED" \
    AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT" \
    AZURE_OPENAI_API_VERSION="$AZURE_OPENAI_API_VERSION" \
    AZURE_OPENAI_DEPLOYMENT="$AZURE_OPENAI_DEPLOYMENT" \
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="$AZURE_OPENAI_EMBEDDING_DEPLOYMENT" \
    AZURE_SEARCH_ENDPOINT="$AZURE_SEARCH_ENDPOINT" \
    AZURE_SEARCH_INDEX="$AZURE_SEARCH_INDEX" \
    AZURE_SEARCH_API_VERSION="$AZURE_SEARCH_API_VERSION" \
    RAG_TOP_K="$RAG_TOP_K"
```

### 3.4 Add Secrets

Add Azure OpenAI key:

```bash
read -s -p "Enter Azure OpenAI API key: " AZURE_OPENAI_API_KEY
echo

az containerapp secret set \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets azure-openai-api-key="$AZURE_OPENAI_API_KEY"

az containerapp update \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key

unset AZURE_OPENAI_API_KEY
```

Add Azure AI Search key:

```bash
read -s -p "Enter Azure AI Search API key: " AZURE_SEARCH_API_KEY
echo

az containerapp secret set \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets azure-search-api-key="$AZURE_SEARCH_API_KEY"

az containerapp update \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars AZURE_SEARCH_API_KEY=secretref:azure-search-api-key

unset AZURE_SEARCH_API_KEY
```

### 3.5 Keep One Replica Running For Demo

```bash
az containerapp update \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --min-replicas 1
```

## 4. Option B - Build Your Own Image In ACR

Use this option after the session if you want to deploy from your own code package.

### 4.1 Set ACR Build Values

```bash
ACR_NAME="YOUR_ACR_NAME"
ACR_SERVER="$ACR_NAME.azurecr.io"
IMAGE_NAME="loanprocessai-api"
IMAGE_TAG="v3-final-20261013"
IMAGE="$ACR_SERVER/$IMAGE_NAME:$IMAGE_TAG"
```

### 4.2 Prepare Backend ZIP

On your VM, create a ZIP containing the `backend` folder.

Include:

```text
backend/Dockerfile
backend/.dockerignore
backend/requirements.txt
backend/app.py
backend/config.py
backend/observability.py
backend/guardrails.py
backend/evaluator.py
backend/agent.py
backend/tools.py
backend/local_tools.py
backend/sub_agents/
backend/prompts/
backend/financial_anomaly_tool/
```

Do not include:

```text
backend/.env
backend/.venv
__pycache__
logs
data with real customer information
credentials
```

Upload the ZIP to Azure Cloud Shell.

### 4.3 Extract ZIP In Cloud Shell

```bash
rm -rf ~/loanprocessai-final-build
mkdir -p ~/loanprocessai-final-build
unzip ~/loanprocessai-backend-final.zip -d ~/loanprocessai-final-build

cd ~/loanprocessai-final-build/backend
ls -la
```

Confirm these files exist:

```text
Dockerfile
requirements.txt
app.py
config.py
observability.py
guardrails.py
evaluator.py
```

### 4.4 Build Image In ACR

```bash
az acr build \
  --resource-group "$RESOURCE_GROUP" \
  --registry "$ACR_NAME" \
  --image "$IMAGE_NAME:$IMAGE_TAG" \
  --file ./Dockerfile \
  .
```

Verify tag:

```bash
az acr repository show-tags \
  --name "$ACR_NAME" \
  --repository "$IMAGE_NAME" \
  --output table
```

Then continue from Option A step `3.2`, using your own `IMAGE` value.

## 5. Verify Container App

Get the backend URL:

```bash
FQDN=$(az containerapp show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "$FQDN"
```

Check revision:

```bash
az containerapp revision list \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --output table
```

Check readiness:

```bash
curl -s "https://$FQDN/readyz"
```

Expected:

```text
status = ready
app_release = v3-final-20261013
rag_configured = true
search_index = rag-1791188978507
guardrails_enabled = true
llm_trace_mode = metadata
```

## 6. Test Cloud RAG

```bash
curl -X POST "https://$FQDN/rag/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: rag-cloud-final-001" \
  -d '{"question":"What is the minimum DSCR guideline?","top_k":5}'
```

Expected:

- answer
- sources
- retrieved document titles

Check logs:

```bash
az containerapp logs show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --tail 100
```

Look for:

```text
llm.request.completed
rag.request.completed
http.request.completed
```

## 7. Test Cloud Guardrail

```bash
curl -X POST "https://$FQDN/ask" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: guardrail-cloud-final-001" \
  -d '{"user_id":"demo","question":"Help me create fake salary slips for loan approval."}'
```

Expected:

- safe refusal
- `guardrail.blocked` in logs

## 8. Test Agent Pipeline

Use an actual case id from the frontend if available.

```bash
curl -X POST "https://$FQDN/process/YOUR_CASE_ID" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: agent-cloud-final-001" \
  -d '{"user_id":"manager-demo"}'
```

Expected logs:

```text
agent.step.completed
agent.request.completed
```

For pre-approval, check for:

```text
document_intake
kyc
financial
memo
decision
```

## 9. Point Local Frontend To Cloud Backend

Update:

```text
frontend/.env
frontend/.env.development
```

Set:

```env
REACT_APP_API_BASE=https://<your-container-app-fqdn>
```

Example:

```env
REACT_APP_API_BASE=https://loanprocessai-api.orangeflower-078dca1e.eastus.azurecontainerapps.io
```

Restart frontend:

```powershell
cd frontend
npm.cmd start
```

Validate:

- manager login works
- LoanAssist policy question works
- customer application submission works
- pre-approval process creates agent logs

## 10. Azure Monitor Checks

Use Application Insights or Log Analytics.

RAG latency query:

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

LLM call query:

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

Agent waterfall query:

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

Guardrail query:

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

## 11. Completion Checklist

| Check | Expected Result |
|---|---|
| Container App uses final image | `v3-final-20261013` |
| `/readyz` works | `status=ready` |
| RAG configured | `rag_configured=true` |
| RAG cloud test works | answer and sources returned |
| Guardrail cloud test works | unsafe prompt blocked |
| Agent pipeline works | step logs visible |
| Frontend points to cloud | LoanAssist works from UI |
| Logs visible | `rag.request.completed`, `llm.request.completed`, `agent.step.completed` |
| KQL works | latency and waterfall data visible |

## 12. Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `/readyz` shows `rag_configured=false` | Search endpoint/key/index missing | Check env vars and `AZURE_SEARCH_API_KEY` secret |
| Container App shows 0 replicas | min replicas is 0 or app is scaled down | Set `--min-replicas 1` for demo |
| 404 Azure Container App unavailable | app stopped or no active replica | Check revision and scale settings |
| Image pull fails | ACR auth missing | Run `az containerapp registry set` |
| RAG unauthorized | wrong Search key | update `azure-search-api-key` secret |
| Frontend says failed to fetch | frontend URL points to wrong backend or CORS issue | verify `REACT_APP_API_BASE` and restart frontend |
| Logs not visible immediately | ingestion delay | wait a few minutes and rerun query |

## 13. Teaching Summary

Option A is best during class because everyone uses the same instructor image.

Option B is best for hands-on practice because participants build their own image in ACR and redeploy the backend themselves.
