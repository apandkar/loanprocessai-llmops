"""Chatbot Agent (standalone dashboard chatbot)."""

from google.adk import Agent

from prompts.chatbot_prompt import CHATBOT_PROMPT
from tools import make_persist_callback
from sub_agents._config import MODEL

chatbot_agent = Agent(
    model=MODEL,
    name="Chatbot_Agent",
    description="Dashboard chatbot that surfaces stage progression, next best actions and policy guidance.",
    instruction=CHATBOT_PROMPT,
    output_key="chatbot_output",
    after_agent_callback=make_persist_callback(
        "Chatbot_Agent", "chatbot_output"
    ),
)
