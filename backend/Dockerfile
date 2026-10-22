FROM python:3.12-slim
WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Default port for Azure Container Apps, overridden by PORT at runtime.
ENV PORT 8080
EXPOSE 8080

# Command to run the FastAPI application using Uvicorn.
# Cloud Run injects PORT at runtime — the app MUST listen on it.
CMD exec uvicorn app:app --host 0.0.0.0 --port $PORT

