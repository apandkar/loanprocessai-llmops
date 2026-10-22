from sklearn.ensemble import IsolationForest
import numpy as np

# Module-level cache: trained models keyed by industry_code.
_MODEL_CACHE: dict[str, "IsolationForestModel"] = {}


class IsolationForestModel:
    def __init__(self):
        self.model = IsolationForest(
            n_estimators=200,
            contamination=0.05,
            random_state=42
        )
        self.trained = False

    def train(self, df):
        self.model.fit(df.values)
        self.columns = df.columns.tolist()
        self.trained = True

    def score_multivariate(self, ratio_dict: dict):
        """
        Scores the entire ratio vector at once.
        """
        if not self.trained:
            raise RuntimeError("Model must be trained before scoring")

        vector = [[ratio_dict[col] for col in self.columns]]
        score = -self.model.decision_function(vector)[0]
        return round(float(score), 2)

    @classmethod
    def get_or_train(cls, industry_code: str, df) -> "IsolationForestModel":
        """Return a cached model for the industry, training once if needed."""
        if industry_code not in _MODEL_CACHE:
            m = cls()
            m.train(df)
            _MODEL_CACHE[industry_code] = m
        return _MODEL_CACHE[industry_code]