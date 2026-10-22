# Incident Analysis With GenAI Participant Guide

This guide helps you practice LLMOps incident analysis using local LoanProcessAI logs.

 First, you diagnose the incident using logs and evidence. Then you use GenAI to convert your diagnosis into a clear ServiceNow-style incident update.

## 1. Learning Goal

By the end of this exercise, you should be able to:

- identify the likely failing component
- support your diagnosis using telemetry evidence
- distinguish infrastructure issues from LLMOps quality issues
- write a clear incident summary
- use GenAI to improve incident communication

## 2. Two-Stage Workflow

Use this workflow:

```text
Stage 1: You diagnose the incident manually.
Stage 2: GenAI converts your diagnosis into a ServiceNow-ready update.
```

```

## 3. Collect Local Logs

Start backend and reproduce the issue.

Then view recent logs:

```powershell
Get-Content backend\logs\loanprocessai.jsonl -Tail 50
```

Or run the local analyzer:

```powershell
cd backend
python analyze_local_logs.py
```

The analyzer summarizes:

- recent errors
- RAG health
- search latency
- model latency
- retrieval count
- guardrail blocks
- evaluator risk signals
- agent step duration
- missing or failed agent steps

## 4. Stage 1: Manual Diagnosis

Complete this section as a group before using GenAI.

### Diagnosis Template

```text
Incident Title:

Incident Type:
RAG retrieval issue / model generation issue / guardrail issue / evaluator issue / agent workflow issue / document quality issue / frontend-backend routing issue

Affected Feature:
LoanAssist / RAG Q&A / Pre-approval pipeline / Post-approval pipeline / Guardrails / Evaluator

What Happened:
Describe what the user saw.

Evidence From Logs:
- Event name:
- Correlation ID:
- Error message:
- Status code:
- Search latency:
- Model latency:
- Retrieval count:
- Source titles:
- Guardrail type:
- Guardrail reason:
- Evaluator signal:
- Agent step:
- Step status:
- Output length:

Suspected Component:
Azure AI Search / Azure OpenAI / RAG prompt / RAG index / Guardrail / Evaluator / Agent step / Uploaded document / Frontend-backend routing

Why We Think This:
Explain the evidence in 2-3 lines.

Business Impact:
Explain what user or loan process is affected.

First Remediation:
What should be checked or fixed first?

Confidence:
High / Medium / Low
```

## 5. Evidence Guide

Use this table to connect symptoms to evidence.

| Symptom | Evidence To Check | Likely Area |
|---|---|---|
| RAG answer missing | `retrieval_count=0` | RAG retrieval |
| RAG answer irrelevant | source titles/chunks do not match question | RAG quality |
| Slow answer | high `search_latency_ms` or `model_latency_ms` | Search or model latency |
| Unsafe request blocked | `guardrail.blocked` | Guardrail |
| Good request blocked | `guardrail.blocked` with safe prompt | Guardrail false positive |
| Answer not grounded | evaluator groundedness low | RAG/evaluator quality |
| Hallucination risk high | evaluator hallucination high | Model quality |
| Agent step missing | `step_status=missing_output` | Agent workflow |
| One agent slow | high `duration_ms` for one `agent_name` | Agent bottleneck |
| Frontend failed but backend works | browser request differs from backend test | Frontend-backend path |
| Wrong document impact | agent output incomplete or irrelevant | Document quality |

## 6. Stage 1 Example

```text
Incident Title:
LoanAssist RAG answer failed due to missing retrieval evidence

Incident Type:
RAG retrieval issue

Affected Feature:
LoanAssist / RAG Q&A

What Happened:
The user asked for the minimum DSCR guideline, but the assistant could not provide an answer from policy context.

Evidence From Logs:
- Event name: rag.request.completed
- Retrieval count: 0
- Search latency: 730 ms
- Model latency: 0 ms
- Source titles: none
- Status code: 200

Suspected Component:
Azure AI Search retrieval or RAG index

Why We Think This:
The request reached the backend and Search returned successfully, but no chunks were retrieved. Since model latency is 0, the LLM was not called for grounded answer generation.

Business Impact:
Loan managers cannot get policy-grounded answers for underwriting questions.

First Remediation:
Check whether policy documents are indexed and whether the query wording matches indexed content. Test the same question in Azure AI Search explorer.

Confidence:
High
```

## 7. Stage 2: Use GenAI For ServiceNow-Ready Summary

After completing Stage 1, paste your diagnosis into ChatGPT or Copilot using this prompt.

### Prompt

```text
You are an LLMOps incident analyst.

Convert the following participant diagnosis into a ServiceNow-ready incident update.

Do not invent facts. Use only the evidence provided.
If evidence is missing, mention it as "Needs confirmation".

Create the output in this format:

1. Incident Title
2. Short Description
3. Affected Service
4. Impact
5. Suspected Component
6. Evidence Observed
7. Probable Root Cause
8. Immediate Remediation Steps
9. Work Notes
10. Customer/Stakeholder Update
11. Resolution Notes, if available

Participant diagnosis:
PASTE_STAGE_1_DIAGNOSIS_HERE
```

## 8. Stage 2 Example Output

Expected output style:

```text
1. Incident Title
LoanAssist RAG response missing policy evidence for DSCR question

2. Short Description
LoanAssist could not provide a grounded answer for a minimum DSCR guideline question because no RAG chunks were retrieved.

3. Affected Service
LoanProcessAI LoanAssist RAG Q&A

4. Impact
Loan managers may not receive policy-grounded underwriting guidance for DSCR-related questions.

5. Suspected Component
Azure AI Search retrieval or RAG index

6. Evidence Observed
The `rag.request.completed` event showed `retrieval_count=0`, no source titles, and `model_latency_ms=0`.

7. Probable Root Cause
The RAG index did not return relevant policy chunks for the user question. Needs confirmation in Azure AI Search explorer.

8. Immediate Remediation Steps
Validate index contents, test the query in Search explorer, confirm policy documents are indexed, and retry with alternate wording.

9. Work Notes
Backend was reachable and request completed. No grounded model generation occurred because retrieval returned zero chunks.

10. Customer/Stakeholder Update
We identified that the assistant did not find supporting policy evidence for the DSCR question. The team is validating the search index and policy document coverage.

11. Resolution Notes
Needs confirmation after index validation.
```

## 9. What GenAI Should And Should Not Do

GenAI should:

- improve wording
- organize the incident summary
- convert notes into ServiceNow format
- identify missing evidence
- suggest next checks

GenAI should not:

- invent log evidence
- invent root cause
- replace your diagnosis
- claim resolution without proof
- expose secrets or customer PII

## 10. Learning Summary

In LLMOps, incident analysis is not only about server errors.

You also diagnose:

- retrieval quality
- grounding quality
- hallucination risk
- guardrail behavior
- evaluator quality
- agent workflow failures
- document quality issues

Your job is to find evidence first. GenAI helps communicate the incident clearly after that.
