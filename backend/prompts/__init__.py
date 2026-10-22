"""Prompt modules for the Commercial Lending Multi-Agent System."""

from .document_intake_prompt import DOCUMENT_INTAKE_PROMPT
from .kyc_prompt import KYC_PROMPT
from .financial_prompt import FINANCIAL_PROMPT
from .memo_prompt import MEMO_PROMPT
from .decision_prompt import DECISION_PROMPT
from .closing_prompt import CLOSING_PROMPT
from .chatbot_prompt import CHATBOT_PROMPT
from .root_agent_prompt import ROOT_AGENT_PROMPT

__all__ = [
    "DOCUMENT_INTAKE_PROMPT",
    "KYC_PROMPT",
    "FINANCIAL_PROMPT",
    "MEMO_PROMPT",
    "DECISION_PROMPT",
    "CLOSING_PROMPT",
    "CHATBOT_PROMPT",
    "ROOT_AGENT_PROMPT",
]
