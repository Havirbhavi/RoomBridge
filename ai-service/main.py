import os
import re

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


@app.middleware("http")
async def observe_requests(request, call_next):
    with LATENCY.labels(request.url.path).time():
        response = await call_next(request)
    REQUESTS.labels(request.url.path, request.method, response.status_code).inc()
    return response


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
    return run_graph(request)


@app.post("/assistant/chat", response_model=HomeAssistantResponse)
def home_assistant(request: HomeAssistantRequest):
    return answer_home_question(request)


@app.post("/roomproof/reports", response_model=RoomProofReport)
def create_roomproof_report(request: RoomProofRequest):
    try:
        return run_roomproof(request)
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
        return EvidenceAnswer(
            answer="The uploaded evidence does not contain enough grounded information to answer that question.",
            confidence=0.0,
            citations=[],
            abstained=True,
        )
    return EvidenceAnswer(
        answer=" ".join(finding["detail"] for finding in relevant),
        confidence=min(finding["confidence"] for finding in relevant),
        citations=[citation for finding in relevant for citation in finding["citations"]][:3],
        abstained=False,
    )
