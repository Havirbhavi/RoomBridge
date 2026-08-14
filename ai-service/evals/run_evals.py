from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from roomproof_graph import run_roomproof  # noqa: E402
from roomproof_schemas import RoomProofRequest  # noqa: E402


def run() -> int:
    fixtures = json.loads((Path(__file__).parent / "fixtures.json").read_text())
    results = []
    for fixture in fixtures:
        report = run_roomproof(RoomProofRequest.model_validate(fixture["request"]))
        expected = fixture["expected"]
        finding_ids = {finding.id for finding in report.findings}
        required = set(expected.get("finding_ids", []))
        forbidden = set(expected.get("forbidden_finding_ids", []))
        supported = [finding for finding in report.findings if finding.status == "supported"]
        citation_precision = (
            sum(bool(finding.citations) for finding in supported) / len(supported)
            if supported else 1.0
        )
        checks = {
            "status": report.status == expected["status"],
            "required_findings": required.issubset(finding_ids),
            "forbidden_findings": not forbidden.intersection(finding_ids),
            "terms": all(report.extracted_terms.get(key) == value for key, value in expected["terms"].items()),
            "citation_precision": citation_precision >= expected["minimum_citation_precision"],
        }
        results.append({
            "name": fixture["name"],
            "passed": all(checks.values()),
            "checks": checks,
            "citation_precision": round(citation_precision, 3),
            "finding_count": len(report.findings),
        })

    payload = {
        "suite": "roomproof-grounding-v1",
        "passed": sum(result["passed"] for result in results),
        "total": len(results),
        "results": results,
    }
    print(json.dumps(payload, indent=2))
    return 0 if payload["passed"] == payload["total"] else 1


if __name__ == "__main__":
    raise SystemExit(run())
