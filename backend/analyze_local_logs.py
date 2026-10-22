"""Summarize local LoanProcessAI JSONL logs for incident simulation.

Usage:
    python analyze_local_logs.py
    python analyze_local_logs.py --log logs/loanprocessai.jsonl --limit 20
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from typing import Any


DEFAULT_LOG = Path(__file__).resolve().parent / "logs" / "loanprocessai.jsonl"


def load_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def as_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def print_section(title: str) -> None:
    print(f"\n=== {title} ===")


def summarize(events: list[dict[str, Any]], limit: int) -> None:
    if not events:
        print("No local log events found.")
        return

    messages = Counter(str(event.get("message", "")) for event in events)
    status_codes = Counter(str(event.get("status_code", "")) for event in events if event.get("status_code"))

    print_section("Event Counts")
    for message, count in messages.most_common():
        print(f"{message}: {count}")

    print_section("HTTP Status Codes")
    for status, count in status_codes.most_common():
        print(f"{status}: {count}")

    error_events = [
        event for event in events
        if event.get("level") in {"ERROR", "CRITICAL"}
        or str(event.get("message", "")).endswith(".failed")
        or int(event.get("status_code") or 0) >= 500
    ]
    print_section("Recent Errors / Failures")
    if not error_events:
        print("No errors found.")
    else:
        for event in error_events[-limit:]:
            print(
                f"{event.get('timestamp')} | {event.get('message')} | "
                f"operation={event.get('operation')} | status={event.get('status_code')} | "
                f"error={event.get('llm_error_type', '')}"
            )

    rag_events = [event for event in events if event.get("message") == "rag.request.completed"]
    print_section("RAG Health")
    if not rag_events:
        print("No RAG events found.")
    else:
        retrieval_counts = [int(event.get("retrieval_count") or 0) for event in rag_events]
        search_latencies = [as_float(event.get("search_latency_ms")) for event in rag_events]
        model_latencies = [as_float(event.get("model_latency_ms")) for event in rag_events]
        search_latencies = [value for value in search_latencies if value is not None]
        model_latencies = [value for value in model_latencies if value is not None]
        no_retrieval = [event for event in rag_events if int(event.get("retrieval_count") or 0) == 0]
        print(f"RAG calls: {len(rag_events)}")
        print(f"No-retrieval calls: {len(no_retrieval)}")
        if search_latencies:
            print(f"Avg search latency ms: {round(mean(search_latencies), 2)}")
        if model_latencies:
            print(f"Avg model latency ms: {round(mean(model_latencies), 2)}")
        print(f"Last retrieval counts: {retrieval_counts[-limit:]}")

    llm_events = [event for event in events if event.get("message") == "llm.request.completed"]
    print_section("LLM Token / Finish Metadata")
    if not llm_events:
        print("No completed LLM events found.")
    else:
        total_tokens = [as_float(event.get("total_tokens")) for event in llm_events]
        input_tokens = [as_float(event.get("input_tokens")) for event in llm_events]
        output_tokens = [as_float(event.get("output_tokens")) for event in llm_events]
        total_tokens = [value for value in total_tokens if value is not None]
        input_tokens = [value for value in input_tokens if value is not None]
        output_tokens = [value for value in output_tokens if value is not None]
        finish_reasons = Counter(str(event.get("finish_reason", "unknown")) for event in llm_events)
        print(f"Completed LLM calls: {len(llm_events)}")
        if input_tokens:
            print(f"Input tokens total: {int(sum(input_tokens))}")
        if output_tokens:
            print(f"Output tokens total: {int(sum(output_tokens))}")
        if total_tokens:
            print(f"Total tokens: {int(sum(total_tokens))}")
        print(f"Finish reasons: {dict(finish_reasons)}")
        for event in llm_events[-limit:]:
            print(
                f"{event.get('timestamp')} | route={event.get('llm_route')} | "
                f"phase={event.get('llm_phase')} | tokens={event.get('total_tokens', 'n/a')} | "
                f"finish={event.get('finish_reason', 'n/a')}"
            )

    guardrail_events = [event for event in events if event.get("message") == "guardrail.blocked"]
    print_section("Guardrail Blocks")
    if not guardrail_events:
        print("No guardrail blocks found.")
    else:
        by_type = Counter(str(event.get("guardrail_type", "unknown")) for event in guardrail_events)
        for guardrail_type, count in by_type.most_common():
            print(f"{guardrail_type}: {count}")
        for event in guardrail_events[-limit:]:
            print(
                f"{event.get('timestamp')} | {event.get('guardrail_action')} | "
                f"{event.get('guardrail_type')} | {event.get('guardrail_reason')}"
            )

    evaluator_events = [event for event in rag_events if event.get("evaluation_safety") or event.get("evaluation_hallucination_risk")]
    print_section("Evaluator Risk Signals")
    if not evaluator_events:
        print("No evaluator fields found. LLM_EVALUATION_ENABLED may be false.")
    else:
        for event in evaluator_events[-limit:]:
            print(
                f"{event.get('timestamp')} | groundedness={event.get('evaluation_groundedness')} | "
                f"correctness={event.get('evaluation_correctness')} | "
                f"hallucination={event.get('evaluation_hallucination_risk')} | "
                f"safety={event.get('evaluation_safety')} | pii={event.get('evaluation_pii_risk')}"
            )

    simulation_events = [
        event for event in events
        if event.get("message") in {"agent.step.delay_simulated", "agent.context.corrupted"}
    ]
    print_section("Agent Incident Simulation Signals")
    if not simulation_events:
        print("No simulation signals found.")
    else:
        for event in simulation_events[-limit:]:
            print(
                f"{event.get('timestamp')} | {event.get('message')} | "
                f"case={event.get('case_id')} | agent={event.get('agent_name')} | "
                f"status={event.get('step_status')} | duration_ms={event.get('duration_ms', '')}"
            )

    agent_steps = [event for event in events if event.get("message") == "agent.step.completed"]
    print_section("Agent Step Waterfall")
    if not agent_steps:
        print("No agent step events found.")
    else:
        durations_by_agent: dict[str, list[float]] = defaultdict(list)
        missing_or_failed: list[dict[str, Any]] = []
        for event in agent_steps:
            agent_name = str(event.get("agent_name", "unknown"))
            duration = as_float(event.get("duration_ms"))
            if duration is not None:
                durations_by_agent[agent_name].append(duration)
            if event.get("step_status") != "success":
                missing_or_failed.append(event)
        for agent_name, durations in sorted(durations_by_agent.items(), key=lambda item: mean(item[1]), reverse=True):
            print(f"{agent_name}: avg {round(mean(durations), 2)} ms over {len(durations)} step(s)")
        if missing_or_failed:
            print("\nSteps with missing/failed output:")
            for event in missing_or_failed[-limit:]:
                print(
                    f"{event.get('timestamp')} | case={event.get('case_id')} | "
                    f"{event.get('agent_name')} | status={event.get('step_status')}"
                )

    print_section("Useful Diagnosis Prompts")
    print("1. Which component failed: RAG retrieval, model generation, guardrail, evaluator, or agent step?")
    print("2. Is this an availability incident or a quality/grounding incident?")
    print("3. What evidence supports the suspected root cause?")
    print("4. What remediation should be attempted first?")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", default=str(DEFAULT_LOG), help="Path to local JSONL log file.")
    parser.add_argument("--limit", type=int, default=10, help="Number of recent events to display per section.")
    args = parser.parse_args()

    log_path = Path(args.log)
    print(f"Reading: {log_path}")
    summarize(load_events(log_path), args.limit)


if __name__ == "__main__":
    main()
