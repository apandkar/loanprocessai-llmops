"""Root orchestrator agent for the Commercial Lending Multi-Agent System.

The workflow is strictly sequential, end-to-end, and 100% LLM-driven
(no Python branching, no hardcoded business rules):

  Phase A (auto, fires on application submission / "process this case"):
      Document_Intake -> KYC -> Financial_Spreading -> Memo -> Decision
      (handled by `pre_approval_pipeline`, a SequentialAgent)

      The Decision Support Agent is the final step of Phase A. It
      produces an LLM recommendation and presents the manager with
      exactly two options: **Approve** or **Reject**.

  -- Human-in-the-loop: manager replies Approve or Reject --

  Phase B (runs on EITHER Approve or Reject):
      Closing_Package_Agent
      (handled by `post_approval_pipeline`, a SequentialAgent)

      The Closing Package Agent records the manager's decision via the
      `record_human_decision` tool and writes an LLM summary explaining
      why the case was approved or rejected. On approval it also
      assembles the closing package and checklist.

The Chatbot Agent is a standalone dashboard chatbot — it does NOT sit
inside any pipeline. The orchestrator routes general dashboard chat
("what's the next step?", "help me with this stage") to it.
"""

from google.adk import Agent

from prompts.root_agent_prompt import ROOT_AGENT_PROMPT
from sub_agents import ROOT_SUB_AGENTS
from sub_agents._config import MODEL
from tools import load_case_context


root_agent = Agent(
    model=MODEL,
    name="Commercial_Lending_Orchestrator",
    description=(
        "Root orchestrator that routes commercial loan processing requests "
        "to the pre-approval pipeline, the post-approval pipeline, or the "
        "dashboard progression chatbot."
    ),
    instruction=ROOT_AGENT_PROMPT,
    sub_agents=ROOT_SUB_AGENTS,
    before_agent_callback=load_case_context,
)
