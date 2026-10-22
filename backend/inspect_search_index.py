import json
import os
import urllib.request
from pathlib import Path


def load_dotenv_if_present():
    env_path = Path(__file__).with_name(".env")

    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)

        os.environ.setdefault(
            key.strip(),
            value.strip().strip('"').strip("'"),
        )


load_dotenv_if_present()

endpoint = os.environ["AZURE_SEARCH_ENDPOINT"].rstrip("/")
index_name = os.environ["AZURE_SEARCH_INDEX"]
api_key = os.environ["AZURE_SEARCH_API_KEY"]
api_version = os.getenv(
    "AZURE_SEARCH_API_VERSION",
    "2024-07-01",
)

url = (
    f"{endpoint}/indexes/{index_name}"
    f"?api-version={api_version}"
)

request = urllib.request.Request(
    url,
    headers={
        "api-key": api_key,
    },
)

with urllib.request.urlopen(request) as response:
    data = json.loads(
        response.read().decode("utf-8")
    )

print(f"Index: {data['name']}")
print()
print("Fields:")
print()

for field in data["fields"]:
    print(
        f"- {field['name']}"
        f" | type={field['type']}"
        f" | searchable={field.get('searchable')}"
        f" | filterable={field.get('filterable')}"
        f" | dimensions={field.get('dimensions')}"
    )
