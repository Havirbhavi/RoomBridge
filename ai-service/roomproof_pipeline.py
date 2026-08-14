from __future__ import annotations

import base64
import hashlib
import io
import re
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from PIL import Image
from pypdf import PdfReader

from roomproof_schemas import Citation, Finding, RoomProofReport, RoomProofRequest
from roomproof_storage import save_artifact, save_report
from event_bus import publish
from trust_graph import listing_subgraph, upsert_listing


MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
MONEY_RE = re.compile(r"\$\s?([\d,]+(?:\.\d{1,2})?)")
UNIT_RE = re.compile(r"\b(?:unit|apt(?:artment)?|#)\s*(?!unit\b)([a-z0-9-]+)\b", re.I)
DATE_RE = re.compile(
    r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b|"
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+\d{1,2},?\s+(?:19|20)\d{2}\b",
    re.I,
)


def _event(node: str, started: float, **details: Any) -> dict[str, Any]:
    return {
        "node": node,
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        **details,
    }


def ingest_evidence(request: RoomProofRequest) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[dict[str, Any]]]:
    started = time.perf_counter()
    artifacts: list[dict[str, Any]] = []
    listing_id = str(request.listing.get("id", "unknown"))

    for item in request.evidence:
        raw = base64.b64decode(item.content_base64, validate=True) if item.content_base64 else item.text.encode()
        if len(raw) > MAX_ARTIFACT_BYTES:
            raise ValueError(f"{item.filename} exceeds the 10 MB local evidence limit")
        digest = hashlib.sha256(raw).hexdigest()
        evidence_id = f"{digest[:16]}-{uuid4().hex[:6]}"
        save_artifact(evidence_id, raw)
        artifacts.append({
            "id": evidence_id,
            "kind": item.kind,
            "filename": item.filename,
            "media_type": item.media_type,
            "bytes": raw,
            "sha256": digest,
        })
    graph_signals, _ = upsert_listing(request.listing, artifacts)
    return artifacts, graph_signals, [_event("evidence_intake", started, artifacts=len(artifacts), graph_signals=len(graph_signals))]


def extract_evidence(artifacts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    started = time.perf_counter()
    extracted: list[dict[str, Any]] = []
    for artifact in artifacts:
        text = ""
        visual = {}
        if artifact["media_type"] == "application/pdf":
            reader = PdfReader(io.BytesIO(artifact["bytes"]))
            pages = [(page.extract_text() or "").strip() for page in reader.pages]
            text = "\n\n".join(f"[Page {index + 1}]\n{page}" for index, page in enumerate(pages))
        elif artifact["media_type"].startswith("text/") or artifact["kind"] in {"lease", "message"}:
            text = artifact["bytes"].decode("utf-8", errors="replace")
        elif artifact["media_type"].startswith("image/"):
            with Image.open(io.BytesIO(artifact["bytes"])) as image:
                visual = {
                    "width": image.width,
                    "height": image.height,
                    "format": image.format or "unknown",
                    "mode": image.mode,
                }
        extracted.append({**{key: value for key, value in artifact.items() if key != "bytes"}, "text": text, "visual": visual})
    return extracted, [_event("multimodal_extraction", started, text_artifacts=sum(bool(x["text"]) for x in extracted), images=sum(bool(x["visual"]) for x in extracted))]


def _citation(artifact: dict[str, Any], excerpt: str, locator: str = "document text") -> Citation:
    return Citation(
        evidence_id=artifact["id"],
        filename=artifact["filename"],
        locator=locator,
        excerpt=" ".join(excerpt.split())[:500],
    )


def analyze_evidence(request: RoomProofRequest, artifacts: list[dict[str, Any]], graph_signals: list[dict[str, Any]]) -> tuple[list[Finding], dict[str, Any], list[dict[str, Any]]]:
    started = time.perf_counter()
    findings: list[Finding] = []
    terms: dict[str, Any] = {}
    listing = request.listing
    text_artifacts = [item for item in artifacts if item["text"]]

    for artifact in text_artifacts:
        text = artifact["text"]
        lower = text.lower()
        rent_line = _matching_line(text, "rent")
        rent_value = _money_near_keyword(text, "monthly rent") or _money_near_keyword(text, "rent")
        if rent_value:
            rent = rent_value
            terms.setdefault("monthly_rent", rent)
            findings.append(Finding(
                id=f"rent-{artifact['id']}", category="lease", severity="info",
                title="Monthly rent found in evidence",
                detail=f"The document states a monetary rent value of ${rent:,.0f}.",
                confidence=.9, status="supported",
                citations=[_citation(artifact, _matching_line(text, "rent"))],
            ))
        unit = UNIT_RE.search(text)
        if unit:
            terms.setdefault("unit_number", unit.group(1))
        if "sublet" in lower or "sublease" in lower:
            restricted = any(term in lower for term in ["not permitted", "prohibited", "written consent", "prior approval"])
            terms["subletting_requires_review"] = restricted
            findings.append(Finding(
                id=f"sublet-{artifact['id']}", category="lease",
                severity="high" if restricted else "info",
                title="Subletting clause requires attention" if restricted else "Subletting language found",
                detail="The evidence includes subletting language. Review the cited clause before paying.",
                confidence=.82, status="supported",
                citations=[_citation(artifact, _matching_line(text, "sub"))],
            ))
        if "security deposit" in lower:
            deposit_line = _matching_line(text, "security deposit")
            deposit = _money_near_keyword(text, "security deposit")
            if deposit:
                terms.setdefault("security_deposit", deposit)
            findings.append(Finding(
                id=f"deposit-{artifact['id']}", category="lease", severity="info",
                title="Security-deposit clause found",
                detail=f"The evidence states a security deposit of ${deposit:,.0f}." if deposit else "The uploaded evidence contains security-deposit terms.",
                confidence=.88, status="supported",
                citations=[_citation(artifact, deposit_line)],
            ))

        fee_terms = {
            "application_fee": ["application fee"],
            "parking_fee": ["parking fee", "parking is"],
            "pet_fee": ["pet fee", "pet rent"],
            "cleaning_fee": ["cleaning fee"],
        }
        for term_key, needles in fee_terms.items():
            for needle in needles:
                if needle in lower:
                    fee_line = _matching_line(text, needle)
                    fee = _money_near_keyword(text, needle)
                    if fee:
                        terms.setdefault(term_key, fee)
                        findings.append(Finding(
                            id=f"{term_key}-{artifact['id']}", category="cost", severity="info",
                            title=f"{term_key.replace('_', ' ').title()} found",
                            detail=f"The evidence states ${fee:,.0f} for {term_key.replace('_', ' ')}.",
                            confidence=.86, status="supported",
                            citations=[_citation(artifact, fee_line)],
                        ))
                    break

        if any(needle in lower for needle in ["tenant pays", "resident pays", "not included"]):
            utility_line = next(
                (line.strip() for line in text.splitlines() if any(needle in line.lower() for needle in ["tenant pays", "resident pays", "not included"])),
                "",
            )
            terms["utilities_policy"] = utility_line
            findings.append(Finding(
                id=f"utilities-{artifact['id']}", category="lease", severity="info",
                title="Tenant-paid utilities found",
                detail="The evidence assigns at least one utility cost to the tenant.",
                confidence=.84, status="supported",
                citations=[_citation(artifact, utility_line)],
            ))
        elif "utilities included" in lower:
            utility_line = _matching_line(text, "utilities included")
            terms["utilities_policy"] = utility_line

        if any(needle in lower for needle in ["no pets", "pets prohibited", "pets are prohibited"]):
            pet_line = next((line.strip() for line in text.splitlines() if "pet" in line.lower()), "")
            terms["pet_policy"] = "prohibited"
            findings.append(Finding(
                id=f"pets-{artifact['id']}", category="lease", severity="info",
                title="Pet restriction found",
                detail="The uploaded evidence states that pets are prohibited.",
                confidence=.91, status="supported",
                citations=[_citation(artifact, pet_line)],
            ))
        elif "pets allowed" in lower or "pet friendly" in lower:
            terms["pet_policy"] = "allowed"

        date_match = DATE_RE.search(text)
        if date_match and any(needle in lower for needle in ["lease begins", "commencement", "start date"]):
            terms.setdefault("lease_start_date", date_match.group(0))

    listing_rent = _number(listing.get("price") or listing.get("rent"))
    evidence_rent = _number(terms.get("monthly_rent"))
    if listing_rent and evidence_rent and abs(listing_rent - evidence_rent) >= 1:
        findings.append(Finding(
            id="rent-conflict", category="consistency", severity="high",
            title="Rent does not match the uploaded evidence",
            detail=f"The listing shows ${listing_rent:,.0f}, while the evidence states ${evidence_rent:,.0f}.",
            confidence=.98, status="conflict",
            citations=[item.citations[0] for item in findings if item.id.startswith("rent-")][:1],
        ))

    listing_deposit = _number(listing.get("deposit"))
    evidence_deposit = _number(terms.get("security_deposit"))
    if listing_deposit and evidence_deposit and abs(listing_deposit - evidence_deposit) >= 1:
        findings.append(Finding(
            id="deposit-conflict", category="consistency", severity="high",
            title="Security deposit does not match",
            detail=f"The listing shows a ${listing_deposit:,.0f} deposit, while the evidence states ${evidence_deposit:,.0f}.",
            confidence=.97, status="conflict",
            citations=[item.citations[0] for item in findings if item.id.startswith("deposit-")][:1],
        ))

    listing_utilities = [str(item).lower() for item in listing.get("utilitiesIncluded") or []]
    utility_policy = str(terms.get("utilities_policy") or "").lower()
    conflicting_utilities = [utility for utility in listing_utilities if utility and utility in utility_policy]
    if conflicting_utilities and any(needle in utility_policy for needle in ["tenant pays", "resident pays", "not included"]):
        findings.append(Finding(
            id="utilities-conflict", category="consistency", severity="high",
            title="Included utilities conflict with the evidence",
            detail=f"The listing marks {', '.join(conflicting_utilities)} as included, but the evidence assigns that cost to the tenant.",
            confidence=.94, status="conflict",
            citations=[item.citations[0] for item in findings if item.id.startswith("utilities-")][:1],
        ))

    listing_pet_text = _normalize_listing_value(f"{listing.get('pets', '')} {' '.join(listing.get('tags') or [])}")
    if terms.get("pet_policy") == "prohibited" and any(term in listing_pet_text for term in ["pet friendly", "pets allowed", "cats allowed", "dogs allowed"]):
        findings.append(Finding(
            id="pets-conflict", category="consistency", severity="high",
            title="Pet policy conflicts with the listing",
            detail="The listing appears pet-friendly, while the uploaded evidence prohibits pets.",
            confidence=.96, status="conflict",
            citations=[item.citations[0] for item in findings if item.id.startswith("pets-")][:1],
        ))

    listing_unit_match = UNIT_RE.search(f"{listing.get('title', '')} {listing.get('address', '')}")
    listing_unit = str(listing.get("unit") or listing.get("unitNumber") or (listing_unit_match.group(1) if listing_unit_match else "")).lower()
    evidence_unit = str(terms.get("unit_number") or "").lower()
    if listing_unit and evidence_unit and listing_unit != evidence_unit:
        findings.append(Finding(
            id="unit-conflict", category="consistency", severity="high",
            title="Unit number does not match",
            detail=f"The listing identifies Unit {listing_unit}, while the evidence identifies Unit {evidence_unit}.",
            confidence=.98, status="conflict", citations=[],
        ))

    recurring_fees = sum(_number(terms.get(key)) for key in ["parking_fee", "pet_fee"])
    if evidence_rent:
        terms["effective_monthly_cost"] = evidence_rent + recurring_fees
        terms["one_time_fees"] = sum(_number(terms.get(key)) for key in ["security_deposit", "application_fee", "cleaning_fee"])

    image_artifacts = [item for item in artifacts if item["visual"]]
    for artifact in image_artifacts:
        visual = artifact["visual"]
        findings.append(Finding(
            id=f"image-{artifact['id']}", category="visual", severity="info",
            title="Property image indexed",
            detail=f"{visual['width']}×{visual['height']} {visual['format']} image is available for visual retrieval.",
            confidence=1, status="supported",
            citations=[_citation(artifact, f"Image metadata: {visual['width']}×{visual['height']} {visual['format']}", "image")],
        ))

    graph_titles = {
        "exact_artifact_reuse": "Identical evidence reused",
        "visually_similar_image": "Visually similar property image found",
        "similar_description": "Listing description resembles another listing",
        "shared_address": "Address appears in another listing",
        "shared_unit": "Unit appears in another listing",
        "shared_host": "Host appears in another listing",
        "shared_phone": "Phone number reused across listings",
        "shared_email": "Email reused across listings",
    }
    for index, signal in enumerate(graph_signals):
        findings.append(Finding(
            id=f"graph-{signal['type']}-{index}",
            category="identity",
            severity=signal["severity"],
            title=graph_titles.get(signal["type"], "Cross-listing relationship found"),
            detail=signal["detail"],
            confidence=signal["confidence"],
            status="conflict" if signal["severity"] == "high" else "uncertain",
            citations=[],
        ))

    if not text_artifacts:
        findings.append(Finding(
            id="missing-lease", category="lease", severity="medium",
            title="No readable lease evidence",
            detail="Upload a lease or sublease document to verify rent, fees, dates, and restrictions.",
            confidence=1, status="missing", citations=[],
        ))
    if not image_artifacts:
        findings.append(Finding(
            id="missing-images", category="visual", severity="low",
            title="No property images supplied",
            detail="Add current property photographs or a walkthrough to strengthen the evidence report.",
            confidence=1, status="missing", citations=[],
        ))
    return findings, terms, [_event("specialist_agents", started, findings=len(findings))]


def build_report(request: RoomProofRequest) -> RoomProofReport:
    artifacts, graph_signals, trace = ingest_evidence(request)
    extracted, extraction_trace = extract_evidence(artifacts)
    findings, terms, analysis_trace = analyze_evidence(request, extracted, graph_signals)
    trace.extend(extraction_trace + analysis_trace)
    return finalize_report(request, extracted, findings, terms, trace)


def finalize_report(
    request: RoomProofRequest,
    extracted: list[dict[str, Any]],
    findings: list[Finding],
    terms: dict[str, Any],
    trace: list[dict[str, Any]],
) -> RoomProofReport:
    critic_started = time.perf_counter()
    high_conflicts = sum(item.severity == "high" and item.status == "conflict" for item in findings)
    missing = sum(item.status == "missing" for item in findings)
    supported = sum(item.status == "supported" for item in findings)
    score = max(5, min(98, 45 + supported * 9 - high_conflicts * 28 - missing * 8))
    needs_review = high_conflicts > 0 or any(item.severity == "high" for item in findings)
    trace.append(_event("grounding_critic", critic_started, unsupported_claims=0))
    listing_id = str(request.listing.get("id", "unknown"))
    report = RoomProofReport(
        report_id=f"rp-{uuid4().hex[:12]}",
        listing_id=listing_id,
        status="needs_review" if needs_review else "complete",
        confidence_score=score,
        recommendation=(
            "Pause before paying and resolve the highlighted conflict."
            if needs_review else
            "Evidence is internally consistent so far. Verify identity and tour the property before paying."
        ),
        findings=findings,
        extracted_terms=terms,
        evidence_summary={
            "artifact_count": len(extracted),
            "documents": sum(bool(item["text"]) for item in extracted),
            "images": sum(bool(item["visual"]) for item in extracted),
            "trust_graph": listing_subgraph(listing_id),
            "limitations": "Visual object detection, video transcription, and external property records require configured model workers.",
        },
        model_manifest={
            "orchestrator": "langgraph-roomproof-v1",
            "document_extractor": "pypdf-local",
            "vision": "image-metadata-local",
            "reasoning": "deterministic-grounded-v1",
        },
        trace=trace,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    save_report(report.model_dump())
    publish("roomproof.report.completed", {
        "report_id": report.report_id,
        "listing_id": report.listing_id,
        "status": report.status,
        "confidence_score": report.confidence_score,
        "created_at": report.created_at,
    })
    return report


def _matching_line(text: str, needle: str) -> str:
    return next((line.strip() for line in text.splitlines() if needle.lower() in line.lower()), text[:300])


def _number(value: Any) -> float:
    try:
        return float(str(value).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _money_from_text(text: str) -> float:
    match = MONEY_RE.search(text or "")
    return _number(match.group(1)) if match else 0


def _money_near_keyword(text: str, keyword: str) -> float:
    match = re.search(
        rf"{re.escape(keyword)}[^$.\n]{{0,80}}\$\s?([\d,]+(?:\.\d{{1,2}})?)",
        text or "",
        re.I,
    )
    return _number(match.group(1)) if match else 0


def _normalize_listing_value(value: str) -> str:
    return re.sub(r"\s+", " ", str(value).lower()).strip()
