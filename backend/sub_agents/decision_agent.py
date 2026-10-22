"""Decision Support Agent (LLM recommendation only — no tool calls).

Runs as the final step of the pre-approval pipeline. Produces an
Approve / Reject / Approve-with-Conditions recommendation and presents
the manager with exactly two options to choose from. It does NOT record
the decision — that is the Closing Package Agent's job once the manager
replies.
"""

from google.adk import Agent

from prompts.decision_prompt import DECISION_PROMPT
from tools import make_persist_callback
from sub_agents._config import MODEL

decision_agent = Agent(
    model=MODEL,
    name="Decision_Support_Agent",
    description=(
        "Produces an LLM recommendation (Approve / Reject / Approve with "
        "Conditions) and presents the manager with two options."
    ),
    instruction=DECISION_PROMPT,
    output_key="decision_output",
    after_agent_callback=make_persist_callback(
        "Decision_Support_Agent", "decision_output"
    ),
)

