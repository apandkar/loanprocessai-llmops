"""Observability primitives shared by the LoanProcessAI API.

Console logs are structured JSON for local development and Azure Container
Apps. Azure Monitor export is deliberately optional: set the Application
Insights connection string only in the target environment.
"""

from __future__ import annotations

import contextvars
import functools
import json
import logging
import os
import sys
import time
import uuid
from typing import Any, Awaitable, Callable, TypeVar

_correlation_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlation_id", default=""
)
_configured = False
logger = logging.getLogger("loanprocessai")
F = TypeVar("F", bound=Callable[..., Awaitable[Any]])


class JsonFormatter(logging.Formatter):
    """Write one JSON object per log line for Container Apps / Log Analytics."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": current_correlation_id(),
        }
        for key in (
            "operation",
            "method",
            "path",
            "status_code",
            "duration_ms",
            "trace_id",
            "top_k",
            "retrieval_count",
            "search_latency_ms",
            "model_latency_ms",
            "question_length",
            "prompt_length",
            "response_length",
            "model_deployment",
            "source_titles",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def current_correlation_id() -> str:
    return _correlation_id.get()


def new_correlation_id(candidate: str | None = None) -> str:
    """Accept a bounded caller ID or generate an opaque request identifier."""
    if candidate and len(candidate) <= 128 and candidate.replace("-", "").replace("_", "").isalnum():
        return candidate
    return str(uuid.uuid4())


def set_correlation_id(correlation_id: str) -> contextvars.Token[str]:
    return _correlation_id.set(correlation_id)


def reset_correlation_id(token: contextvars.Token[str]) -> None:
    _correlation_id.reset(token)


def trace_id() -> str | None:
    """Return the active W3C trace ID when OpenTelemetry is installed."""
    try:
        from opentelemetry import trace

        context = trace.get_current_span().get_span_context()
        return format(context.trace_id, "032x") if context.is_valid else None
    except ImportError:
        return None


def configure_observability() -> None:
    """Configure JSON logs and optional Azure Monitor OpenTelemetry export."""
    global _configured
    if _configured:
        return
    _configured = True

    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    logger.propagate = False
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)

    connection_string = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        logger.info("observability.configured", extra={"operation": "console_only"})
        return

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=connection_string,
            logger_name="loanprocessai",
            enable_trace_based_sampling_for_logs=True,
        )
        logger.info("observability.configured", extra={"operation": "azure_monitor"})
    except ImportError:
        logger.warning("azure_monitor_not_installed", extra={"operation": "console_only"})


def observe_operation(operation: str) -> Callable[[F], F]:
    """Create a business span and duration metric around an async endpoint."""
    def decorate(function: F) -> F:
        @functools.wraps(function)
        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            try:
                from opentelemetry import metrics, trace

                tracer = trace.get_tracer("loanprocessai.operations")
                meter = metrics.get_meter("loanprocessai.operations")
                duration = meter.create_histogram("loanprocessai.operation.duration", unit="ms")
                calls = meter.create_counter("loanprocessai.operation.calls")
                with tracer.start_as_current_span(operation) as span:
                    span.set_attribute("loanprocessai.operation", operation)
                    result = await function(*args, **kwargs)
                    elapsed = round((time.perf_counter() - started) * 1000, 2)
                    duration.record(elapsed, {"operation": operation, "outcome": "success"})
                    calls.add(1, {"operation": operation, "outcome": "success"})
                    return result
            except ImportError:
                return await function(*args, **kwargs)
            except Exception:
                elapsed = round((time.perf_counter() - started) * 1000, 2)
                logger.exception(
                    "operation.failed",
                    extra={"operation": operation, "duration_ms": elapsed, "trace_id": trace_id()},
                )
                raise

        return wrapped  # type: ignore[return-value]

    return decorate
