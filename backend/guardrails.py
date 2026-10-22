""" app-level guardrails for LoanProcessAI  flows.

These checks are intentional and explainable. They block
high-risk inputs before the request reaches RAG, agents, or the LLM.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class GuardrailResult:
    allowed: bool
    guardrail_type: str | None = None
    reason: str | None = None
    safe_response: str | None = None


_PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", re.IGNORECASE)
_AADHAAR_RE = re.compile(r"\b(?:\d{4}[\s-]?){2}\d{4}\b")
_IFSC_RE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_INDIA_MOBILE_RE = re.compile(r"(?:\+91[\s-]?)?\b[6-9]\d{9}\b")
_BANK_ACCOUNT_RE = re.compile(r"\b\d{11,18}\b")


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in phrases)


def check_guardrails(user_text: str) -> GuardrailResult:
    """Return a blocking decision for unsafe or sensitive user input."""
    text = " ".join((user_text or "").split())
    lowered = text.lower()

    if not text:
        return GuardrailResult(allowed=True)

    if _contains_any(
        lowered,
        (
            "ignore previous instructions",
            "ignore all previous instructions",
            "ignore safety rules",
            "reveal your system prompt",
            "show me your system prompt",
            "hidden system prompt",
            "developer message",
            "bypass guardrails",
            "disable guardrails",
        ),
    ):
        return GuardrailResult(
            allowed=False,
            guardrail_type="prompt_injection",
            reason="Prompt attempts to override instructions or reveal hidden system content.",
            safe_response=(
                "I cannot follow instructions that try to override safety rules or reveal hidden "
                "system content. Please ask a loan, policy, or application question I can help with."
            ),
        )

    if _contains_any(
        lowered,
        (
            "fake salary slip",
            "fake income document",
            "fake bank statement",
            "fabricate income",
            "forge document",
            "bypass underwriting",
            "bypass fraud check",
            "hide debt",
            "misrepresent income",
        ),
    ):
        return GuardrailResult(
            allowed=False,
            guardrail_type="loan_fraud_or_misuse",
            reason="Prompt asks for help with fraudulent or deceptive loan activity.",
            safe_response=(
                "I cannot help create or hide false information for a loan application. I can help "
                "with legitimate documentation requirements, policy guidance, or review checklists."
            ),
        )

    pii_matches = []
    for label, pattern in (
        ("pan", _PAN_RE),
        ("aadhaar", _AADHAAR_RE),
        ("ifsc", _IFSC_RE),
        ("email", _EMAIL_RE),
        ("indian_mobile", _INDIA_MOBILE_RE),
        ("bank_account_like_number", _BANK_ACCOUNT_RE),
    ):
        if pattern.search(text):
            pii_matches.append(label)

    if pii_matches:
        return GuardrailResult(
            allowed=False,
            guardrail_type="pii_detected",
            reason="Prompt appears to contain sensitive personal or financial identifiers.",
            safe_response=(
                "Please do not share sensitive identifiers such as PAN, Aadhaar, account numbers, "
                "phone numbers, or email addresses in chat. Remove the sensitive data and ask again."
            ),
        )

    if _contains_any(
        lowered,
        (
            "seriously hurt someone",
            "harm myself",
            "illegal harm",
            "write a hateful message",
            "explicit sexual content involving a minor",
        ),
    ):
        return GuardrailResult(
            allowed=False,
            guardrail_type="unsafe_content",
            reason="Prompt asks for unsafe or harmful content.",
            safe_response=(
                "I cannot help with harmful or unsafe content. I can continue with loan operations, "
                "policy, monitoring, or compliance-related questions."
            ),
        )

    return GuardrailResult(allowed=True)


def check_output_guardrails(output_text: str) -> GuardrailResult:
    """Return a blocking decision for risky model output."""
    text = " ".join((output_text or "").split())
    lowered = text.lower()

    if not text:
        return GuardrailResult(allowed=True)

    pii_patterns = (
        _PAN_RE,
        _AADHAAR_RE,
        _IFSC_RE,
        _EMAIL_RE,
        _INDIA_MOBILE_RE,
        _BANK_ACCOUNT_RE,
    )
    if any(pattern.search(text) for pattern in pii_patterns):
        return GuardrailResult(
            allowed=False,
            guardrail_type="output_pii_detected",
            reason="Model output appears to contain sensitive personal or financial identifiers.",
            safe_response=(
                "I cannot return sensitive personal or financial identifiers in the response. "
                "Please use secure internal systems for customer-specific details."
            ),
        )

    if _contains_any(
        lowered,
        (
            "system prompt",
            "developer message",
            "hidden instructions",
            "ignore previous instructions",
        ),
    ):
        return GuardrailResult(
            allowed=False,
            guardrail_type="output_instruction_leakage",
            reason="Model output appears to expose internal instruction details.",
            safe_response=(
                "I cannot return hidden system or developer instructions. Please ask a loan, "
                "policy, or application question I can help with."
            ),
        )

    if _contains_any(
        lowered,
        (
            "fake salary slip",
            "fake income document",
            "bypass underwriting",
            "bypass fraud check",
            "forge document",
        ),
    ):
        return GuardrailResult(
            allowed=False,
            guardrail_type="output_loan_misuse",
            reason="Model output appears to provide loan fraud or misuse guidance.",
            safe_response=(
                "I cannot provide guidance that enables loan fraud or policy misuse. I can help "
                "with legitimate documentation and compliance guidance."
            ),
        )

    return GuardrailResult(allowed=True)
