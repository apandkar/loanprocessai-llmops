"""Generate realistic historical loan ratio training data (1000 rows).

Creates training_data.csv with industry-specific distributions that
reflect real commercial lending patterns:
- ~95% normal loans (healthy ratios)
- ~5% anomalous loans (stressed / borderline defaults)

Each row represents a historical loan's financial ratios at origination
or annual review.
"""

import numpy as np
import pandas as pd

np.random.seed(42)

# ---------------------------------------------------------------------------
# Industry profiles: (mean, std) for each ratio
# Based on typical commercial lending benchmarks
# ---------------------------------------------------------------------------
INDUSTRY_PROFILES = {
    "MANUFACTURING": {
        "DSCR":          (1.55, 0.28),   # Debt Service Coverage
        "ICR":           (3.2,  0.75),   # Interest Coverage
        "Debt_Equity":   (1.45, 0.38),   # Leverage
        "Current_Ratio": (1.42, 0.22),   # Liquidity
        "EBITDA_Margin":  (18.5, 4.5),    # Profitability %
    },
    "TECHNOLOGY": {
        "DSCR":          (1.85, 0.42),
        "ICR":           (4.2,  1.1),
        "Debt_Equity":   (1.15, 0.45),
        "Current_Ratio": (2.1,  0.45),
        "EBITDA_Margin":  (24.0, 6.5),
    },
    "REAL_ESTATE": {
        "DSCR":          (1.48, 0.22),
        "ICR":           (2.6,  0.55),
        "Debt_Equity":   (2.4,  0.55),
        "Current_Ratio": (1.18, 0.18),
        "EBITDA_Margin":  (17.0, 3.8),
    },
    "HEALTHCARE": {
        "DSCR":          (1.65, 0.30),
        "ICR":           (3.5,  0.85),
        "Debt_Equity":   (1.30, 0.35),
        "Current_Ratio": (1.55, 0.25),
        "EBITDA_Margin":  (15.0, 4.0),
    },
    "RETAIL": {
        "DSCR":          (1.40, 0.32),
        "ICR":           (2.8,  0.70),
        "Debt_Equity":   (1.70, 0.42),
        "Current_Ratio": (1.35, 0.20),
        "EBITDA_Margin":  (12.0, 3.5),
    },
}

ROWS_PER_INDUSTRY = 200  # 5 industries × 200 = 1000 rows
ANOMALY_FRACTION = 0.05  # 5% anomalous loans per industry


def _generate_normal(profile: dict, n: int) -> dict:
    """Generate n rows of healthy loan ratios."""
    data = {}
    for metric, (mu, sigma) in profile.items():
        values = np.random.normal(mu, sigma, n)
        # Clip to realistic floors (no negative ratios)
        if metric == "DSCR":
            values = np.clip(values, 0.8, 4.0)
        elif metric == "ICR":
            values = np.clip(values, 0.5, 10.0)
        elif metric == "Debt_Equity":
            values = np.clip(values, 0.1, 6.0)
        elif metric == "Current_Ratio":
            values = np.clip(values, 0.4, 5.0)
        elif metric == "EBITDA_Margin":
            values = np.clip(values, -5.0, 50.0)
        data[metric] = np.round(values, 2)
    return data


def _generate_anomalous(profile: dict, n: int) -> dict:
    """Generate n rows of stressed / anomalous loans.

    Anomalies are created by:
    - Shifting means significantly (stressed borrowers)
    - Widening variance (volatile financials)
    - Introducing correlated stress (multiple ratios degrade together)
    """
    data = {}
    # Randomly pick an anomaly type per row
    anomaly_types = np.random.choice(
        ["stressed", "volatile", "inconsistent"], size=n
    )

    for metric, (mu, sigma) in profile.items():
        values = np.zeros(n)
        for i in range(n):
            if anomaly_types[i] == "stressed":
                # Systematically worse: lower coverage, higher leverage
                if metric in ("DSCR", "ICR", "Current_Ratio", "EBITDA_Margin"):
                    values[i] = np.random.normal(mu * 0.5, sigma * 0.8)
                else:  # Debt_Equity — higher is worse
                    values[i] = np.random.normal(mu * 2.0, sigma * 0.8)
            elif anomaly_types[i] == "volatile":
                # Extreme variance
                values[i] = np.random.normal(mu, sigma * 3.0)
            else:  # inconsistent
                # Some ratios healthy, some very off
                if np.random.random() > 0.5:
                    values[i] = np.random.normal(mu, sigma)
                else:
                    shift = np.random.choice([-1, 1]) * sigma * 3
                    values[i] = mu + shift

        # Clip to plausible extremes
        if metric == "DSCR":
            values = np.clip(values, 0.3, 5.0)
        elif metric == "ICR":
            values = np.clip(values, 0.2, 15.0)
        elif metric == "Debt_Equity":
            values = np.clip(values, 0.05, 10.0)
        elif metric == "Current_Ratio":
            values = np.clip(values, 0.2, 6.0)
        elif metric == "EBITDA_Margin":
            values = np.clip(values, -15.0, 60.0)

        data[metric] = np.round(values, 2)
    return data


def generate_dataset() -> pd.DataFrame:
    """Generate the full 1000-row training dataset."""
    all_rows = []

    for industry, profile in INDUSTRY_PROFILES.items():
        n_anomalous = int(ROWS_PER_INDUSTRY * ANOMALY_FRACTION)
        n_normal = ROWS_PER_INDUSTRY - n_anomalous

        # Normal loans
        normal_data = _generate_normal(profile, n_normal)
        normal_df = pd.DataFrame(normal_data)
        normal_df["industry_code"] = industry
        normal_df["loan_status"] = "PERFORMING"

        # Anomalous loans
        anomalous_data = _generate_anomalous(profile, n_anomalous)
        anomalous_df = pd.DataFrame(anomalous_data)
        anomalous_df["industry_code"] = industry
        anomalous_df["loan_status"] = "STRESSED"

        all_rows.append(normal_df)
        all_rows.append(anomalous_df)

    df = pd.concat(all_rows, ignore_index=True)
    # Shuffle rows
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)
    # Add a loan_id
    df.insert(0, "loan_id", [f"LOAN-{i+1:04d}" for i in range(len(df))])

    return df


if __name__ == "__main__":
    import os

    df = generate_dataset()
    out_path = os.path.join(os.path.dirname(__file__), "training_data.csv")
    df.to_csv(out_path, index=False)

    print(f"Generated {len(df)} rows -> {out_path}")
    print(f"\nIndustry breakdown:")
    print(df.groupby("industry_code")["loan_status"].value_counts().to_string())
    print(f"\nSample rows:")
    print(df.head(10).to_string(index=False))
    print(f"\nRatio statistics:")
    print(df[["DSCR", "ICR", "Debt_Equity", "Current_Ratio", "EBITDA_Margin"]].describe().round(2).to_string())
