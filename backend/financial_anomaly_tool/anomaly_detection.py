from models import IsolationForestModel
from data_loader import get_policy_thresholds


# ---------------------------------------------------------------------------
# Ratio calculation from raw financial line items
# ---------------------------------------------------------------------------
REQUIRED_FIELDS = [
    "revenue", "ebitda", "net_income", "interest_expense",
    "debt_service", "total_debt", "total_equity",
    "current_assets", "current_liabilities",
    "collateral_value", "loan_amount",
]


def calculate_ratios(financials: dict) -> dict:
    """Compute standard financial ratios from raw line items.

    Args:
        financials: dict with keys like revenue, ebitda, net_income,
            interest_expense, debt_service, total_debt, total_equity,
            current_assets, current_liabilities.

    Returns:
        dict of calculated ratios (None for any that can't be computed).
    """
    def safe_div(a, b):
        if a is None or b is None or b == 0:
            return None
        return round(a / b, 4)

    revenue = financials.get("revenue")
    ebitda = financials.get("ebitda")
    interest = financials.get("interest_expense")
    debt_service = financials.get("debt_service")
    total_debt = financials.get("total_debt")
    total_equity = financials.get("total_equity")
    current_assets = financials.get("current_assets")
    current_liabilities = financials.get("current_liabilities")

    ratios = {
        "DSCR": safe_div(ebitda, debt_service),
        "ICR": safe_div(ebitda, interest),
        "Debt_Equity": safe_div(total_debt, total_equity),
        "Current_Ratio": safe_div(current_assets, current_liabilities),
        "EBITDA_Margin": round(ebitda / revenue * 100, 2) if ebitda and revenue and revenue != 0 else None,
    }
    return ratios


# ---------------------------------------------------------------------------
# PD (Probability of Default) estimation from financial ratios
# ---------------------------------------------------------------------------
def estimate_pd(ratios: dict, anomaly_score: float) -> dict:
    """Estimate Probability of Default from financial ratios + anomaly score.

    Uses a scorecard approach:
    - DSCR, ICR, Current_Ratio: lower = riskier
    - Debt_Equity: higher = riskier
    - EBITDA_Margin: lower = riskier
    - anomaly_score: higher = riskier

    Returns PD (%) and risk classification per domain team thresholds.
    """
    score = 0.0
    weights_applied = 0.0

    # DSCR contribution (weight: 30%)
    dscr = ratios.get("DSCR")
    if dscr is not None:
        if dscr >= 1.5:
            score += 0.30 * 0.0  # very healthy
        elif dscr >= 1.25:
            score += 0.30 * 0.3
        elif dscr >= 1.0:
            score += 0.30 * 0.6
        else:
            score += 0.30 * 1.0  # distressed
        weights_applied += 0.30

    # ICR contribution (weight: 20%)
    icr = ratios.get("ICR")
    if icr is not None:
        if icr >= 3.0:
            score += 0.20 * 0.0
        elif icr >= 2.0:
            score += 0.20 * 0.3
        elif icr >= 1.5:
            score += 0.20 * 0.6
        else:
            score += 0.20 * 1.0
        weights_applied += 0.20

    # Debt/Equity contribution (weight: 20%)
    de = ratios.get("Debt_Equity")
    if de is not None:
        if de <= 1.5:
            score += 0.20 * 0.0
        elif de <= 2.5:
            score += 0.20 * 0.3
        elif de <= 4.0:
            score += 0.20 * 0.6
        else:
            score += 0.20 * 1.0
        weights_applied += 0.20

    # Current Ratio contribution (weight: 10%)
    cr = ratios.get("Current_Ratio")
    if cr is not None:
        if cr >= 1.5:
            score += 0.10 * 0.0
        elif cr >= 1.2:
            score += 0.10 * 0.3
        elif cr >= 1.0:
            score += 0.10 * 0.6
        else:
            score += 0.10 * 1.0
        weights_applied += 0.10

    # EBITDA Margin contribution (weight: 10%)
    em = ratios.get("EBITDA_Margin")
    if em is not None:
        if em >= 20.0:
            score += 0.10 * 0.0
        elif em >= 12.0:
            score += 0.10 * 0.3
        elif em >= 5.0:
            score += 0.10 * 0.6
        else:
            score += 0.10 * 1.0
        weights_applied += 0.10

    # Anomaly score contribution (weight: 10%)
    score += 0.10 * min(anomaly_score, 1.0)
    weights_applied += 0.10

    # Normalize if not all weights applied
    if weights_applied > 0:
        raw_score = score / weights_applied
    else:
        raw_score = 0.5  # uncertain

    # Map raw score (0-1) to PD percentage (0%-25%)
    pd_pct = round(raw_score * 25.0, 2)

    # Domain team classification
    if pd_pct <= 5.0:
        risk_level = "Low"
        recommendation = "Application can be considered"
    elif pd_pct <= 10.0:
        risk_level = "Moderate"
        recommendation = "Application can be considered with standard terms"
    elif pd_pct <= 15.0:
        risk_level = "High"
        recommendation = "Can be considered with higher interest rate (unsecured)"
    else:
        risk_level = "Very High"
        recommendation = "Generally rejected (unless LGD is lower)"

    return {
        "pd_percentage": pd_pct,
        "risk_level": risk_level,
        "recommendation": recommendation,
    }


# ---------------------------------------------------------------------------
# LGD (Loss Given Default) estimation
# ---------------------------------------------------------------------------
def estimate_lgd(financials: dict, loan_type: str = "corporate") -> dict:
    """Estimate Loss Given Default based on collateral coverage and loan type.

    Args:
        financials: Must include collateral_value and loan_amount.
        loan_type: One of 'secured', 'auto', 'corporate'.

    Returns LGD (%) and classification per domain team thresholds.
    """
    collateral = financials.get("collateral_value")
    loan_amount = financials.get("loan_amount")
    total_equity = financials.get("total_equity")
    total_debt = financials.get("total_debt")

    # LGD base ranges by loan type (from domain team)
    lgd_ranges = {
        "secured":   {"min": 10, "max": 40, "label": "Secured/Mortgage Loan"},
        "auto":      {"min": 20, "max": 50, "label": "Auto Loan"},
        "corporate": {"min": 30, "max": 60, "label": "Corporate Loan"},
    }
    lt = loan_type.lower() if loan_type else "corporate"
    range_info = lgd_ranges.get(lt, lgd_ranges["corporate"])

    # Estimate recovery rate from collateral coverage
    if collateral and loan_amount and loan_amount > 0:
        coverage_ratio = collateral / loan_amount
        # Higher coverage → lower LGD
        if coverage_ratio >= 1.5:
            lgd_position = 0.0  # best case → min LGD
        elif coverage_ratio >= 1.0:
            lgd_position = 0.3
        elif coverage_ratio >= 0.5:
            lgd_position = 0.6
        else:
            lgd_position = 1.0  # worst case → max LGD
    elif total_equity and total_debt and total_debt > 0:
        # Fallback: use equity cushion
        equity_ratio = total_equity / total_debt
        if equity_ratio >= 1.0:
            lgd_position = 0.1
        elif equity_ratio >= 0.5:
            lgd_position = 0.4
        elif equity_ratio >= 0.25:
            lgd_position = 0.7
        else:
            lgd_position = 0.95
    else:
        lgd_position = 0.5  # mid-range if no data

    lgd_pct = round(
        range_info["min"] + lgd_position * (range_info["max"] - range_info["min"]),
        2,
    )

    # Domain team classification
    if lgd_pct > 60:
        risk_level = "Reject"
        recommendation = "LGD above 60% — facility gets rejected"
    elif lgd_pct > 40:
        risk_level = "High"
        recommendation = "Higher LGD attracts higher interest rate"
    elif lgd_pct > 25:
        risk_level = "Moderate"
        recommendation = "Moderate LGD — standard interest rate applicable"
    else:
        risk_level = "Low"
        recommendation = "Low LGD — favorable terms possible"

    return {
        "lgd_percentage": lgd_pct,
        "loan_type": range_info["label"],
        "lgd_range": f"{range_info['min']}% - {range_info['max']}%",
        "risk_level": risk_level,
        "recommendation": recommendation,
        "collateral_coverage": round(collateral / loan_amount, 2) if collateral and loan_amount and loan_amount > 0 else None,
    }


# ---------------------------------------------------------------------------
# Combined PD + LGD decision (domain team rules)
# ---------------------------------------------------------------------------
def combined_pd_lgd_decision(pd_result: dict, lgd_result: dict) -> dict:
    """Apply the domain team's combined PD + LGD decision matrix.

    Rules:
    - PD lower + LGD higher → consider with higher interest rate
    - PD higher + LGD lower → consider with normal interest rate
    - PD & LGD moderate     → consider with moderate interest rate
    - PD & LGD both high    → REJECT
    """
    pd_pct = pd_result["pd_percentage"]
    lgd_pct = lgd_result["lgd_percentage"]

    # Expected Loss = PD × LGD
    expected_loss = round((pd_pct / 100) * (lgd_pct / 100) * 100, 2)

    # Hard reject: LGD > 60% always
    if lgd_pct > 60:
        return {
            "decision": "REJECT",
            "reason": f"LGD ({lgd_pct}%) exceeds 60% threshold — automatic rejection",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "N/A",
        }

    # Hard reject: PD > 15% AND LGD not low
    if pd_pct > 15 and lgd_pct > 25:
        return {
            "decision": "REJECT",
            "reason": f"PD ({pd_pct}%) and LGD ({lgd_pct}%) are both elevated",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "N/A",
        }

    # PD > 15% but LGD is low → can consider
    if pd_pct > 15 and lgd_pct <= 25:
        return {
            "decision": "CONSIDER_WITH_CONDITIONS",
            "reason": f"PD is very high ({pd_pct}%) but LGD is low ({lgd_pct}%) — rare scenario, can consider",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "Normal (offset by low LGD)",
        }

    # PD low + LGD high → higher interest rate
    if pd_pct <= 10 and lgd_pct > 40:
        return {
            "decision": "APPROVE_WITH_HIGHER_RATE",
            "reason": f"PD is low ({pd_pct}%) but LGD is high ({lgd_pct}%)",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "Higher interest rate required",
        }

    # PD high + LGD low → normal interest rate
    if pd_pct > 10 and lgd_pct <= 25:
        return {
            "decision": "APPROVE_NORMAL_RATE",
            "reason": f"PD is elevated ({pd_pct}%) but offset by low LGD ({lgd_pct}%)",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "Normal interest rate",
        }

    # Both moderate
    if pd_pct <= 10 and lgd_pct <= 40:
        return {
            "decision": "APPROVE",
            "reason": f"PD ({pd_pct}%) and LGD ({lgd_pct}%) are within acceptable range",
            "expected_loss_pct": expected_loss,
            "interest_rate_impact": "Moderate interest rate" if (pd_pct > 5 or lgd_pct > 25) else "Standard interest rate",
        }

    # Fallback
    return {
        "decision": "REVIEW_REQUIRED",
        "reason": f"PD ({pd_pct}%) / LGD ({lgd_pct}%) combination requires manual review",
        "expected_loss_pct": expected_loss,
        "interest_rate_impact": "To be determined",
    }


# ---------------------------------------------------------------------------
# Policy threshold breach detection
# ---------------------------------------------------------------------------
def check_threshold_breaches(ratios: dict, industry_code: str) -> list[dict]:
    """Compare calculated ratios against bank policy thresholds.

    Returns a list of breaches with metric, value, threshold, and direction.
    """
    thresholds = get_policy_thresholds(industry_code)
    breaches = []
    for metric, value in ratios.items():
        if value is None or metric not in thresholds:
            continue
        rule = thresholds[metric]
        if "min" in rule and value < rule["min"]:
            breaches.append({
                "metric": metric,
                "label": rule["label"],
                "value": round(value, 2),
                "threshold": rule["min"],
                "direction": "below_minimum",
                "gap": round(rule["min"] - value, 2),
            })
        if "max" in rule and value > rule["max"]:
            breaches.append({
                "metric": metric,
                "label": rule["label"],
                "value": round(value, 2),
                "threshold": rule["max"],
                "direction": "above_maximum",
                "gap": round(value - rule["max"], 2),
            })
    return breaches


# ---------------------------------------------------------------------------
# Confidence scoring (data quality / completeness)
# ---------------------------------------------------------------------------
def compute_confidence(financials: dict, ratios: dict) -> dict:
    """Produce a confidence report based on data completeness and quality.

    This is distinct from anomaly severity — it measures how much we trust
    the input data itself.
    """
    # 1. Completeness: how many required fields are present and non-None
    present = sum(1 for f in REQUIRED_FIELDS if financials.get(f) is not None)
    completeness = round(present / len(REQUIRED_FIELDS), 2)

    # 2. Computability: how many ratios could actually be calculated
    computable = sum(1 for v in ratios.values() if v is not None)
    computability = round(computable / max(len(ratios), 1), 2)

    # 3. Overall confidence
    score = round(0.6 * completeness + 0.4 * computability, 2)

    if score >= 0.8:
        level = "High"
    elif score >= 0.5:
        level = "Medium"
    else:
        level = "Low"

    missing = [f for f in REQUIRED_FIELDS if financials.get(f) is None]

    return {
        "confidence_score": score,
        "confidence_level": level,
        "data_completeness": completeness,
        "ratio_computability": computability,
        "missing_fields": missing,
        "fields_provided": present,
        "fields_required": len(REQUIRED_FIELDS),
    }


# ---------------------------------------------------------------------------
# Statistical + ML anomaly detection (existing logic, now uses cached model)
# ---------------------------------------------------------------------------
def z_score(value, mean, std):
    return abs((value - mean) / std) if std else 0


def detect_anomalies(current_ratios: dict, historical_df, industry_code: str):
    """Run Z-score + Isolation Forest anomaly detection.

    Uses cached model per industry to avoid retraining on every call.
    """
    # Filter to only computable ratios
    computable = {k: v for k, v in current_ratios.items() if v is not None and k in historical_df.columns}
    if not computable:
        return 0.0, 0.0, []

    model = IsolationForestModel.get_or_train(industry_code, historical_df)

    # Build full vector for model scoring — fill missing ratios with historical means
    full_ratios = {}
    for col in model.columns:
        if col in computable:
            full_ratios[col] = computable[col]
        else:
            full_ratios[col] = float(historical_df[col].mean())

    # Multivariate anomaly score
    iforest_score = model.score_multivariate(full_ratios)

    # Metric-level statistical checks
    anomalies = []
    for metric, value in computable.items():
        mean = historical_df[metric].mean()
        std = historical_df[metric].std()
        stat_score = z_score(value, mean, std)

        if stat_score > 3:
            severity = "High"
        elif stat_score > 2:
            severity = "Medium"
        else:
            severity = "Low"

        anomalies.append({
            "metric": metric,
            "value": round(value, 2),
            "historical_mean": round(mean, 2),
            "z_score": round(stat_score, 2),
            "severity": severity,
        })

    # Combined anomaly score
    overall_score = round(
        0.6 * iforest_score
        + 0.4 * (
            sum(
                1 if a["severity"] == "High"
                else 0.5 if a["severity"] == "Medium"
                else 0
                for a in anomalies
            )
            / len(anomalies)
        ),
        2,
    )

    return overall_score, iforest_score, anomalies
