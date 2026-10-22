import json
from adk_tool import detect_financial_anomalies

if __name__ == '__main__':
    # Raw financial line items (as extracted from financial statements)
    financials = {
        "revenue": 50_000_000,
        "ebitda": 7_250_000,        # 14.5% margin
        "net_income": 3_500_000,
        "interest_expense": 3_295_000,  # ICR = 2.2
        "debt_service": 6_590_000,      # DSCR = 1.1
        "total_debt": 36_000_000,       # D/E = 2.4
        "total_equity": 15_000_000,
        "current_assets": 10_000_000,   # Current Ratio = 1.0
        "current_liabilities": 10_000_000,
        "collateral_value": 25_000_000, # Collateral for LGD
        "loan_amount": 30_000_000,      # Requested loan
    }

    result = detect_financial_anomalies(financials, "MANUFACTURING", "corporate")

    print("=" * 60)
    print("FINANCIAL ANALYSIS RESULT")
    print("=" * 60)
    print(json.dumps(result, indent=2))
