from __future__ import annotations

import json
import io
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

os.environ["ROOMPROOF_DATA_DIR"] = tempfile.mkdtemp(prefix="roomproof-eval-")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from benchmark_fixtures import build_benchmark  # noqa: E402
from main import ask_roomproof  # noqa: E402
from roomproof_graph import run_roomproof  # noqa: E402
from roomproof_schemas import EvidenceQuestion, RoomProofRequest  # noqa: E402


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 1.0


def run() -> int:
    fixtures = build_benchmark()
    results = []
    expected_conflicts = detected_conflicts = 0
    cited_supported = supported_total = 0
    correct_abstentions = 0

    for fixture in fixtures:
        report = run_roomproof(RoomProofRequest.model_validate(fixture["request"]))
        expected = fixture["expected"]
        actual_conflicts = {finding.id for finding in report.findings if finding.status == "conflict"}
        required_conflicts = set(expected["conflict_ids"])
        expected_conflicts += len(required_conflicts)
        detected_conflicts += len(required_conflicts & actual_conflicts)

        supported = [finding for finding in report.findings if finding.status == "supported"]
        supported_total += len(supported)
        cited_supported += sum(bool(finding.citations) for finding in supported)

        # Operational JSON logs are valuable in services but would obscure the
        # machine-readable benchmark summary on stdout.
        with redirect_stdout(io.StringIO()):
            answer = ask_roomproof(report.report_id, EvidenceQuestion(question=expected["question"]))
        abstention_correct = answer.abstained == expected["should_abstain"]
        correct_abstentions += int(abstention_correct)

        checks = {
            "status": report.status == expected["status"],
            "required_conflicts": required_conflicts.issubset(actual_conflicts),
            "unexpected_conflicts": not actual_conflicts - required_conflicts,
            "terms": all(report.extracted_terms.get(key) == value for key, value in expected["terms"].items()),
            "abstention": abstention_correct,
            "answer_citations": answer.abstained or bool(answer.citations),
        }
        results.append({"name": fixture["name"], "passed": all(checks.values()), "checks": checks})

    passed = sum(result["passed"] for result in results)
    payload = {
        "suite": "roomproof-grounding-v2",
        "passed": passed,
        "total": len(results),
        "expected_conflicts": expected_conflicts,
        "metrics": {
            "scenario_accuracy": round(_ratio(passed, len(results)), 4),
            "conflict_detection_recall": round(_ratio(detected_conflicts, expected_conflicts), 4),
            "supported_finding_citation_precision": round(_ratio(cited_supported, supported_total), 4),
            "abstention_accuracy": round(_ratio(correct_abstentions, len(results)), 4),
        },
        "failures": [result for result in results if not result["passed"]],
    }
    print(json.dumps(payload, indent=2))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(run())
