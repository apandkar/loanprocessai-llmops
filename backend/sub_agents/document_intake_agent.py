"""Document Intake & Validation Agent."""

from google.adk import Agent

from prompts.document_intake_prompt import DOCUMENT_INTAKE_PROMPT
from tools import make_attach_documents_callback, make_persist_callback
from sub_agents._config import MODEL

document_intake_agent = Agent(
    model=MODEL,
    name="Document_Intake_Agent",
    description="Classifies, validates and extracts fields from loan application documents.",
    instruction=DOCUMENT_INTAKE_PROMPT,
    output_key="document_intake_output",
    before_model_callback=make_attach_documents_callback(),
    after_agent_callback=make_persist_callback(
        "Document_Intake_Agent", "document_intake_output"
    ),
)
