"""ADK-compatible financial analysis tool.

Accepts raw financial line items, calculates ratios, runs ML anomaly
detection, checks bank policy thresholds, estimates PD & LGD, and
produces a credit risk decision + confidence report.
"""

from data_loader import load_historical_ratios, get_policy_thresholds
from anomaly_detection import (
    calculate_ratios,
    check_threshold_breaches,
    compute_confidence,
    detect_anomalies,
    estimate_pd,
    estimate_lgd,
    combined_pd_lgd_decision,
)


def detect_financial_anomalies(
    financials: dict,
    industry_code: str,
    loan_type: str = "corporate",
) -> dict:
    """Full financial analysis pipeline for a single loan application.

    Args:
        financials: Raw financial line items with keys:
            revenue, ebitda, net_income, interest_expense, debt_service,
            total_debt, total_equity, current_assets, current_liabilities,
            collateral_value (optional), loan_amount (optional).
        industry_code: Industry classification (e.g. MANUFACTURING, TECHNOLOGY,
            REAL_ESTATE). Used for historical benchmarks and policy thresholds.
        loan_type: One of 'secured', 'auto', 'corporate'. Determines LGD range.

    Returns:
        Dict with:
          - calculated_ratios: computed financial ratios
          - threshold_breaches: policy violations
          - anomaly_detection: ML + statistical anomaly flags
          - pd_assessment: Probability of Default estimate + risk level
          - lgd_assessment: Loss Given Default estimate + risk level
          - credit_decision: Combined PD+LGD decision with interest rate impact
          - confidence_report: data quality assessment
    """
    # 1. Calculate ratios from raw line items
    ratios = calculate_ratios(financials)

    # 2. Check bank policy threshold breaches
    breaches = check_threshold_breaches(ratios, industry_code)

    # 3. Load historical benchmarks and run anomaly detection
    historical_df = load_historical_ratios(industry_code)
    overall_score, iforest_score, anomaly_flags = detect_anomalies(
        ratios, historical_df, industry_code
    )

    risk_summary = (
        "High financial volatility detected"
        if overall_score > 0.6
        else "Moderate anomalies observed"
        if overall_score > 0.3
        else "Financial trends are stable"
    )

    # 4. PD estimation (uses ratios + anomaly score)
    pd_result = estimate_pd(ratios, overall_score)

    # 5. LGD estimation (uses collateral coverage + loan type)
    lgd_result = estimate_lgd(financials, loan_type)

    # 6. Combined PD + LGD credit decision (domain team rules)
    credit_decision = combined_pd_lgd_decision(pd_result, lgd_result)

    # 7. Confidence report on data quality
    confidence = compute_confidence(financials, ratios)

    # 8. Policy thresholds used (for transparency)
    thresholds_used = get_policy_thresholds(industry_code)

    return {
        "calculated_ratios": ratios,
        "policy_thresholds": {
            k: v for k, v in thresholds_used.items() if k in ratios
        },
        "threshold_breaches": breaches,
        "anomaly_detection": {
            "overall_anomaly_score": overall_score,
            "multivariate_iforest_score": iforest_score,
            "risk_summary": risk_summary,
            "anomaly_flags": anomaly_flags,
        },
        "pd_assessment": pd_result,
        "lgd_assessment": lgd_result,
        "credit_decision": credit_decision,
        "confidence_report": confidence,
    }
