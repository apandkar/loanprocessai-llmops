"""Financial Spreading Agent."""

from google.adk import Agent

from prompts.financial_prompt import FINANCIAL_PROMPT
from tools import (
    make_attach_documents_callback,
    make_persist_callback,
    detect_financial_anomalies,
    calculate_financial_ratios,
)
from sub_agents._config import MODEL

financial_agent = Agent(
    model=MODEL,
    name="Financial_Spreading_Agent",
    description="Spreads financial statements and produces ratio insights via reasoning.",
    instruction=FINANCIAL_PROMPT,
    output_key="financial_output",
    tools=[detect_financial_anomalies, calculate_financial_ratios],
    # Financial Spreading only receives the 2 financial uploads:
    #   "Financial Statements"  → P&L / Balance Sheet / Cash Flow
    #   "Tax Returns"           → most recent business tax returns
    before_model_callback=make_attach_documents_callback(
        doc_type_prefixes=(
            "financial statements",
            "tax returns",
        ),
        # Fallback: when uploads land as doc_type="Other" the filename
        # often still tells us this is a financial document. Match on
        # common patterns we see from borrowers.
        filename_keywords=(
            "financ",          # financial / financials / financing
            "statement",       # financial statement / income statement
            "balance",         # balance sheet
            "income",          # income statement
            "cash_flow", "cash flow",
            "p&l", "pnl", "profit",
            "annual", "10-k", "10k",
            "audited", "auditor",
            "tax_return", "tax return", "1120", "1065",
            "periodic review", "credit review", "credit memo",
            "sample",          # reference files are named *_Sample*.pdf
        ),
    ),
    after_agent_callback=make_persist_callback(
        "Financial_Spreading_Agent", "financial_output"
    ),
)
