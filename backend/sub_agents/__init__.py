"""Sub-agents for the Commercial Lending Multi-Agent System."""

from .document_intake_agent import document_intake_agent
from .kyc_agent import kyc_agent
from .financial_agent import financial_agent
from .memo_agent import memo_agent
from .decision_agent import decision_agent
from .closing_agent import closing_agent
from .chatbot_agent import chatbot_agent
from .pipelines import pre_approval_pipeline, post_approval_pipeline

# What the root orchestrator can delegate to:
# - the two SequentialAgent pipelines (deterministic order)
# - the chatbot agent (standalone, for dashboard chat)
ROOT_SUB_AGENTS = [
    pre_approval_pipeline,
    post_approval_pipeline,
    chatbot_agent,
]

# Single-agent runners are exposed via /chat/{case_id}/agent/{name} on the
# FastAPI surface so the dashboard can re-run one tab at a time without
# delegating through the root orchestrator (which can only see the two
# pipelines + chatbot due to ADK's single-parent rule).
INDIVIDUAL_AGENTS = {
    "document_intake": document_intake_agent,
    "kyc": kyc_agent,
    "financial": financial_agent,
    "memo": memo_agent,
    "decision": decision_agent,
    "closing": closing_agent,
    "chatbot": chatbot_agent,
}

__all__ = [
    "document_intake_agent",
    "kyc_agent",
    "financial_agent",
    "memo_agent",
    "decision_agent",
    "closing_agent",
    "chatbot_agent",
    "pre_approval_pipeline",
    "post_approval_pipeline",
    "ROOT_SUB_AGENTS",
]
