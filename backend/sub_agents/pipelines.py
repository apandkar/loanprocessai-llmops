"""Sequential pipelines for the deterministic phases of the workflow.

Phase A (pre-approval) runs strictly, end-to-end, as soon as the customer
submits an application:
    Document_Intake -> KYC -> Financial_Spreading -> Memo -> Decision
The Decision agent produces an LLM recommendation and presents the manager
with exactly two options: **Approve** or **Reject**.

Phase B (post-decision) runs strictly after the manager picks Approve or
Reject:
    Closing_Package_Agent
The Closing agent records the human decision via its tool and produces a
manager-facing summary explaining *why* the case was approved or rejected
(reasoning composed by the LLM from the upstream agent outputs).

The Chatbot Agent is intentionally NOT in any pipeline — it is a
standalone dashboard chatbot the manager can chat with at any time.
"""

from google.adk.agents import SequentialAgent

from .document_intake_agent import document_intake_agent
from .kyc_agent import kyc_agent
from .financial_agent import financial_agent
from .memo_agent import memo_agent
from .decision_agent import decision_agent
from .closing_agent import closing_agent


pre_approval_pipeline = SequentialAgent(
    name="Pre_Approval_Pipeline",
    description=(
        "Runs the full automated review in strict order on application "
        "submission: Document Intake -> KYC -> Financial Spreading -> "
        "Memo -> Decision (LLM recommendation + Approve/Reject options)."
    ),
    sub_agents=[
        document_intake_agent,
        kyc_agent,
        financial_agent,
        memo_agent,
        decision_agent,
    ],
)


post_approval_pipeline = SequentialAgent(
    name="Post_Approval_Pipeline",
    description=(
        "Runs after the manager picks Approve or Reject. The Closing "
        "Package Agent records the human decision and produces an LLM "
        "summary explaining why the case was approved or rejected."
    ),
    sub_agents=[closing_agent],
)
