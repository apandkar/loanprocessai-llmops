"""Closing Package Agent.

Runs after the manager picks Approve or Reject. Records the decision via
the `record_human_decision` tool, then produces an LLM-written summary
explaining why the case was approved or rejected. On approval it also
assembles the closing package summary and checklist.
"""

from google.adk import Agent

from prompts.closing_prompt import CLOSING_PROMPT
from tools import (
    make_persist_callback,
    record_human_decision,
)
from sub_agents._config import MODEL

closing_agent = Agent(
    model=MODEL,
    name="Closing_Package_Agent",
    description=(
        "Records the manager's Approve/Reject decision and produces an "
        "LLM summary of why the case was approved or rejected; on "
        "approval also assembles the closing package."
    ),
    instruction=CLOSING_PROMPT,
    tools=[record_human_decision],
    output_key="closing_output",
    # No documents attached. Closing is a downstream consumer of the
    # upstream agent outputs already in session state — it does not read
    # source documents directly.
    after_agent_callback=make_persist_callback(
        "Closing_Package_Agent", "closing_output"
    ),
)

