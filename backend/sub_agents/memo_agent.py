"""Credit Memo / Narrative Drafting Agent."""

from google.adk import Agent

from prompts.memo_prompt import MEMO_PROMPT
from tools import make_persist_callback
from sub_agents._config import MODEL

memo_agent = Agent(
    model=MODEL,
    name="Credit_Memo_Agent",
    description="Drafts the credit memo and underwriting narrative.",
    instruction=MEMO_PROMPT,
    output_key="memo_output",
    after_agent_callback=make_persist_callback("Credit_Memo_Agent", "memo_output"),
)
