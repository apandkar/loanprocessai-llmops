"""KYC Concierge Agent."""

from google.adk import Agent

from prompts.kyc_prompt import KYC_PROMPT
from tools import make_attach_documents_callback, make_persist_callback
from sub_agents._config import MODEL

kyc_agent = Agent(
    model=MODEL,
    name="KYC_Concierge_Agent",
    description="Performs KYC, AML and sanctions review for the applicant and related parties.",
    instruction=KYC_PROMPT,
    output_key="kyc_output",
    # KYC Concierge only receives KYC-related documents:
    #   - Government Photo ID (Passport, Driver's License)
    #   - Proof of Address (Utility Bill, Bank Statement)
    #   - Business EIN / Tax ID Certificate
    #   - Certificate of Incorporation
    before_model_callback=make_attach_documents_callback(
        doc_type_prefixes=(
            "government",           # Government Photo ID
            "passport",             # Passport
            "driver",               # Driver's License
            "utility",              # Utility Bill (Proof of Address)
            "bank statement",       # Bank Statement (Proof of Address)
            "proof of address",     # Generic Proof of Address
            "business ein",         # Business EIN Certificate
            "tax id",               # Tax ID Certificate
            "certificate of",       # Certificate of Incorporation
            "incorporation",        # Certificate of Incorporation
        ),
        # Fallback: when uploads land as doc_type="Other" the filename
        # almost always still identifies the KYC artefact.
        filename_keywords=(
            "government", "photo_id", "photo id",
            "passport",
            "driver", "license", "licence",
            "utility", "bill",
            "bank_statement", "bank statement",
            "proof_of_address", "proof of address", "address",
            "ein",
            "tax_id", "tax id",
            "certificate", "incorporation",
            "kyc",
        ),
    ),
    after_agent_callback=make_persist_callback("KYC_Concierge_Agent", "kyc_output"),
)
