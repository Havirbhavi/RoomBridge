import os
import re
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from graph import run_graph
from schemas import CompareRequest, CompareResponse
from roomproof_graph import run_roomproof
from roomproof_schemas import EvidenceAnswer, EvidenceQuestion, RoomProofReport, RoomProofRequest
from roomproof_storage import get_report
from home_assistant import HomeAssistantRequest, HomeAssistantResponse, answer_home_question
from trust_graph import listing_subgraph, upsert_listing
from splunk_logging import emit_operational_event

app = FastAPI(
    title="RoomBridge AI Platform",
    version="2.0.0",
    description="Grounded comparison and multimodal rental evidence verification.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
REQUESTS = Counter("roombridge_ai_requests_total", "AI service requests", ["path", "method", "status"])
LATENCY = Histogram("roombridge_ai_request_duration_seconds", "AI service latency", ["path"])
COMPARE_RUNS = Counter(
    "roombridge_compare_runs_total",
    "Comparison workflow outcomes",
    ["grounding", "explanation_source"],
)
GROUNDING_RETRIES = Histogram(
    "roombridge_grounding_retries",
    "Grounding retries required by comparison workflows",
    buckets=(0, 1, 2),
)
ROOMPROOF_REPORTS = Counter(
    "roombridge_roomproof_reports_total",
    "RoomProof reports by final status",
    ["status"],
)
ROOMPROOF_FINDINGS = Counter(
    "roombridge_roomproof_findings_total",
    "RoomProof findings by evidence status and severity",
    ["finding_status", "severity"],
)
ROOMPROOF_EVIDENCE = Histogram(
    "roombridge_roomproof_evidence_items",
    "Evidence items processed per RoomProof report",
    buckets=(0, 1, 2, 3, 5, 10, 20),
)
ROOMPROOF_QUESTIONS = Counter(
    "roombridge_roomproof_questions_total",
    "RoomProof follow-up question outcomes",
    ["outcome"],
)


@app.middleware("http")
async def observe_requests(request, call_next):
    started = time.perf_counter()
    correlation_id = request.headers.get("x-correlation-id") or str(uuid4())
    status_code = 500
    try:
        with LATENCY.labels(request.url.path).time():
            response = await call_next(request)
        status_code = response.status_code
        response.headers["x-correlation-id"] = correlation_id
        return response
    finally:
        REQUESTS.labels(request.url.path, request.method, status_code).inc()
        emit_operational_event(
            "http_request_completed",
            correlation_id=correlation_id,
            path=request.url.path,
            method=request.method,
            status=status_code,
            latency_ms=round((time.perf_counter() - started) * 1_000, 2),
        )


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "roombridge-ai-platform",
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "roomproof": True,
    }


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/compare", response_model=CompareResponse)
def compare(request: CompareRequest):
    result = run_graph(request)
    COMPARE_RUNS.labels(
        "passed" if result.grounding_passed else "failed",
        result.explanation_source,
    ).inc()
    GROUNDING_RETRIES.observe(result.grounding_retries)
    emit_operational_event(
        "comparison_completed",
        listing_count=len(request.listings),
        grounding="passed" if result.grounding_passed else "failed",
        grounding_retries=result.grounding_retries,
        explanation_source=result.explanation_source,
    )
    return result


@app.post("/assistant/chat", response_model=HomeAssistantResponse)
def home_assistant(request: HomeAssistantRequest):
    return answer_home_question(request)


@app.post("/roomproof/reports", response_model=RoomProofReport)
def create_roomproof_report(request: RoomProofRequest):
    try:
        report = run_roomproof(request)
        ROOMPROOF_REPORTS.labels(report.status).inc()
        ROOMPROOF_EVIDENCE.observe(len(request.evidence))
        for finding in report.findings:
            ROOMPROOF_FINDINGS.labels(finding.status, finding.severity).inc()
        emit_operational_event(
            "roomproof_report_completed",
            report_id=report.report_id,
            status=report.status,
            evidence_count=len(request.evidence),
            finding_count=len(report.findings),
            conflict_count=sum(finding.status == "conflict" for finding in report.findings),
            high_severity_count=sum(finding.severity == "high" for finding in report.findings),
        )
        return report
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/roomproof/reports/{report_id}", response_model=RoomProofReport)
def read_roomproof_report(report_id: str):
    report = get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="RoomProof report not found")
    return report


@app.get("/roomproof/trust-graph/{listing_id}")
def read_trust_graph(listing_id: str):
    return listing_subgraph(listing_id)


@app.post("/roomproof/trust-graph/{listing_id}/index")
def index_trust_graph(listing_id: str, payload: dict):
    listings = payload.get("listings", [])
    if not isinstance(listings, list):
        raise HTTPException(status_code=422, detail="listings must be an array")
    for listing in listings[:500]:
        if isinstance(listing, dict):
            upsert_listing(listing, [])
    return listing_subgraph(listing_id)


@app.post("/roomproof/reports/{report_id}/questions", response_model=EvidenceAnswer)
def ask_roomproof(report_id: str, request: EvidenceQuestion):
    report = get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="RoomProof report not found")
    stopwords = {
        "does", "this", "that", "with", "from", "what", "when", "where", "which",
        "lease", "allow", "allowed",
    }
    query_terms = {
        term for term in re.findall(r"[a-z0-9]+", request.question.lower())
        if len(term) > 3 and term not in stopwords
    }
    scored = [
        (
            sum(
                term in f"{finding['category']} {finding['title']} {finding['detail']}".lower()
                for term in query_terms
            ),
            finding,
        )
        for finding in report["findings"]
        if finding["citations"]
    ]
    relevant = [finding for score, finding in sorted(scored, key=lambda item: item[0], reverse=True) if score > 0][:2]
    if not relevant or not query_terms:
        ROOMPROOF_QUESTIONS.labels("abstained").inc()
        emit_operational_event("roomproof_question_completed", report_id=report_id, outcome="abstained")
        return EvidenceAnswer(
            answer="The uploaded evidence does not contain enough grounded information to answer that question.",
            confidence=0.0,
            citations=[],
            abstained=True,
        )
    ROOMPROOF_QUESTIONS.labels("answered").inc()
    emit_operational_event("roomproof_question_completed", report_id=report_id, outcome="answered")
    return EvidenceAnswer(
        answer=" ".join(finding["detail"] for finding in relevant),
        confidence=min(finding["confidence"] for finding in relevant),
        citations=[citation for finding in relevant for citation in finding["citations"]][:3],
        abstained=False,
    )
