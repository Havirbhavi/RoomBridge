from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from roomproof_pipeline import analyze_evidence, extract_evidence, finalize_report, ingest_evidence
from roomproof_schemas import RoomProofReport, RoomProofRequest


class RoomProofState(TypedDict, total=False):
    request: RoomProofRequest
    artifacts: list[dict[str, Any]]
    extracted: list[dict[str, Any]]
    duplicates: list[dict[str, str]]
    findings: list[Any]
    terms: dict[str, Any]
    trace: list[dict[str, Any]]
    report: RoomProofReport


def intake_node(state: RoomProofState) -> RoomProofState:
    artifacts, graph_signals, trace = ingest_evidence(state["request"])
    return {**state, "artifacts": artifacts, "duplicates": graph_signals, "trace": trace}


def extraction_node(state: RoomProofState) -> RoomProofState:
    extracted, trace = extract_evidence(state["artifacts"])
    return {**state, "extracted": extracted, "trace": state["trace"] + trace}


def specialist_node(state: RoomProofState) -> RoomProofState:
    findings, terms, trace = analyze_evidence(
        state["request"], state["extracted"], state.get("duplicates", [])
    )
    return {**state, "findings": findings, "terms": terms, "trace": state["trace"] + trace}


def report_node(state: RoomProofState) -> RoomProofState:
    report = finalize_report(
        state["request"],
        state["extracted"],
        state["findings"],
        state["terms"],
        state["trace"],
    )
    return {**state, "report": report}


builder = StateGraph(RoomProofState)
builder.add_node("evidence_intake", intake_node)
builder.add_node("multimodal_extraction", extraction_node)
builder.add_node("specialist_agents", specialist_node)
builder.add_node("verification_critic", report_node)
builder.set_entry_point("evidence_intake")
builder.add_edge("evidence_intake", "multimodal_extraction")
builder.add_edge("multimodal_extraction", "specialist_agents")
builder.add_edge("specialist_agents", "verification_critic")
builder.add_edge("verification_critic", END)
roomproof_graph = builder.compile()


def run_roomproof(request: RoomProofRequest) -> RoomProofReport:
    result = roomproof_graph.invoke({"request": request})
    return result["report"]
