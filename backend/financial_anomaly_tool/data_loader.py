import os
import pandas as pd
import numpy as np

_DIR = os.path.dirname(os.path.abspath(__file__))
TRAINING_DATA_PATH = os.path.join(_DIR, "training_data.csv")

# Cached DataFrame — loaded once per process
_training_df: pd.DataFrame | None = None

RATIO_COLUMNS = ["DSCR", "ICR", "Debt_Equity", "Current_Ratio", "EBITDA_Margin"]

# ---------------------------------------------------------------------------
# Bank policy thresholds by industry (configurable)
# ---------------------------------------------------------------------------
POLICY_THRESHOLDS = {
    "DEFAULT": {
        "DSCR":          {"min": 1.25, "label": "Debt Service Coverage Ratio"},
        "ICR":           {"min": 2.0,  "label": "Interest Coverage Ratio"},
        "Debt_Equity":   {"max": 3.0,  "label": "Debt-to-Equity Ratio"},
        "Current_Ratio": {"min": 1.2,  "label": "Current Ratio"},
        "EBITDA_Margin":  {"min": 10.0, "label": "EBITDA Margin (%)"},
    },
    "MANUFACTURING": {
        "DSCR":          {"min": 1.30, "label": "Debt Service Coverage Ratio"},
        "ICR":           {"min": 2.5,  "label": "Interest Coverage Ratio"},
        "Debt_Equity":   {"max": 2.5,  "label": "Debt-to-Equity Ratio"},
        "Current_Ratio": {"min": 1.3,  "label": "Current Ratio"},
        "EBITDA_Margin":  {"min": 12.0, "label": "EBITDA Margin (%)"},
    },
    "TECHNOLOGY": {
        "DSCR":          {"min": 1.20, "label": "Debt Service Coverage Ratio"},
        "ICR":           {"min": 2.0,  "label": "Interest Coverage Ratio"},
        "Debt_Equity":   {"max": 3.5,  "label": "Debt-to-Equity Ratio"},
        "Current_Ratio": {"min": 1.5,  "label": "Current Ratio"},
        "EBITDA_Margin":  {"min": 15.0, "label": "EBITDA Margin (%)"},
    },
    "REAL_ESTATE": {
        "DSCR":          {"min": 1.35, "label": "Debt Service Coverage Ratio"},
        "ICR":           {"min": 2.0,  "label": "Interest Coverage Ratio"},
        "Debt_Equity":   {"max": 4.0,  "label": "Debt-to-Equity Ratio"},
        "Current_Ratio": {"min": 1.0,  "label": "Current Ratio"},
        "EBITDA_Margin":  {"min": 8.0,  "label": "EBITDA Margin (%)"},
    },
}


def get_policy_thresholds(industry_code: str) -> dict:
    """Return policy thresholds for the given industry, falling back to DEFAULT."""
    key = industry_code.upper() if industry_code else "DEFAULT"
    return POLICY_THRESHOLDS.get(key, POLICY_THRESHOLDS["DEFAULT"])


# ---------------------------------------------------------------------------
# Historical ratio loader — CSV training data with BigQuery & synthetic fallback
# ---------------------------------------------------------------------------
def _load_training_csv() -> pd.DataFrame:
    """Load the 1000-row training CSV (cached after first load)."""
    global _training_df
    if _training_df is None:
        if os.path.exists(TRAINING_DATA_PATH):
            _training_df = pd.read_csv(TRAINING_DATA_PATH)
        else:
            raise FileNotFoundError(
                f"Training data not found at {TRAINING_DATA_PATH}. "
                f"Run `python generate_training_data.py` first."
            )
    return _training_df


def _load_from_bigquery(industry_code: str) -> pd.DataFrame | None:
    """Attempt to load historical ratios from BigQuery."""
    project = os.getenv("GCP_PROJECT")
    dataset = os.getenv("BQ_DS_APPLICATIONS", "loan_applications")
    if not project:
        return None
    try:
        from google.cloud import bigquery
        bq = bigquery.Client(project=project)
        query = (
            f"SELECT DSCR, ICR, Debt_Equity, Current_Ratio, EBITDA_Margin "
            f"FROM `{project}.{dataset}.historical_ratios` "
            f"WHERE industry_code = @industry "
            f"ORDER BY period_end DESC LIMIT 500"
        )
        job_config = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("industry", "STRING", industry_code.upper()),
        ])
        df = bq.query(query, job_config=job_config).to_dataframe()
        if len(df) >= 20:
            return df
    except Exception:
        pass
    return None


def load_historical_ratios(industry_code: str) -> pd.DataFrame:
    """Load historical ratios for the given industry.

    Priority:
    1. BigQuery (production — real MRA/FIS data)
    2. Local training_data.csv filtered by industry (1000-row dataset)
    """
    # 1. Try BigQuery first
    bq_df = _load_from_bigquery(industry_code)
    if bq_df is not None:
        return bq_df

    # 2. Load from training CSV
    full_df = _load_training_csv()
    key = industry_code.upper() if industry_code else "DEFAULT"
    industry_df = full_df[full_df["industry_code"] == key]

    if len(industry_df) >= 20:
        return industry_df[RATIO_COLUMNS].reset_index(drop=True)

    # Fallback: use all industries if specific one is too small
    return full_df[RATIO_COLUMNS].reset_index(drop=True)
