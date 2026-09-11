"""Generated, human-readable scenarios for the deterministic RoomProof benchmark."""

from __future__ import annotations

from typing import Any


def _fixture(name: str, index: int, listing: dict[str, Any], lease_text: str | None,
             status: str, conflicts: list[str], terms: dict[str, Any]) -> dict[str, Any]:
    evidence = [] if lease_text is None else [{
        "kind": "lease", "filename": f"benchmark-{index:02d}.txt",
        "media_type": "text/plain", "text": lease_text,
    }]
    return {
        "name": name,
        "request": {"listing": {"id": f"benchmark-{index:02d}", **listing}, "evidence": evidence},
        "expected": {
            "status": status, "conflict_ids": conflicts, "terms": terms,
            "question": "What is the monthly rent?", "should_abstain": lease_text is None,
        },
    }


def build_benchmark() -> list[dict[str, Any]]:
    fixtures: list[dict[str, Any]] = []
    index = 0

    for offset in range(8):
        index += 1
        rent, deposit, unit = 820 + offset * 35, 350 + offset * 20, 100 + offset
        fixtures.append(_fixture(
            f"consistent lease {offset + 1}", index,
            {"title": f"Campus Court – Unit {unit}", "unit": str(unit), "rent": rent, "deposit": deposit},
            f"Unit {unit}. Monthly rent is ${rent}. Security deposit is ${deposit}. Lease begins September 1, 2026.",
            "complete", [], {"monthly_rent": rent, "security_deposit": deposit, "unit_number": str(unit)},
        ))

    for offset in range(6):
        index += 1
        fixtures.append(_fixture(
            f"missing evidence {offset + 1}", index,
            {"title": f"Unverified listing {offset + 1}", "rent": 700 + offset * 25},
            None, "complete", [], {},
        ))

    for offset in range(8):
        index += 1
        listed, documented, unit = 900 + offset * 30, 950 + offset * 30, 200 + offset
        fixtures.append(_fixture(
            f"rent conflict {offset + 1}", index,
            {"title": f"River House – Unit {unit}", "unit": str(unit), "rent": listed},
            f"Unit {unit}. Monthly rent is ${documented}. Unique reference R{index}.",
            "needs_review", ["rent-conflict"], {"monthly_rent": documented, "unit_number": str(unit)},
        ))

    for offset in range(7):
        index += 1
        rent, documented, unit = 980 + offset * 20, 575 + offset * 15, 300 + offset
        fixtures.append(_fixture(
            f"deposit conflict {offset + 1}", index,
            {"title": f"Park Place – Unit {unit}", "unit": str(unit), "rent": rent, "deposit": 400},
            f"Unit {unit}. Monthly rent is ${rent}. Security deposit is ${documented}. Reference D{index}.",
            "needs_review", ["deposit-conflict"],
            {"monthly_rent": rent, "security_deposit": documented, "unit_number": str(unit)},
        ))

    for offset in range(7):
        index += 1
        rent, listed_unit, documented_unit = 1_050 + offset * 25, 400 + offset, 500 + offset
        fixtures.append(_fixture(
            f"unit conflict {offset + 1}", index,
            {"title": f"Union Flats – Unit {listed_unit}", "unit": str(listed_unit), "rent": rent},
            f"Unit {documented_unit}. Monthly rent is ${rent}. Reference U{index}.",
            "needs_review", ["unit-conflict"], {"monthly_rent": rent, "unit_number": str(documented_unit)},
        ))

    utilities = ["water", "electricity", "internet", "gas", "sewer", "trash", "water"]
    for offset, utility in enumerate(utilities):
        index += 1
        rent, unit = 1_000 + offset * 20, 600 + offset
        fixtures.append(_fixture(
            f"utility conflict {offset + 1}", index,
            {"title": f"College View – Unit {unit}", "unit": str(unit), "rent": rent,
             "utilitiesIncluded": [utility]},
            f"Unit {unit}. Monthly rent is ${rent}. Tenant pays {utility}. Reference T{index}.",
            "needs_review", ["utilities-conflict"], {"monthly_rent": rent, "unit_number": str(unit)},
        ))

    for offset in range(7):
        index += 1
        rent, unit = 1_100 + offset * 20, 700 + offset
        fixtures.append(_fixture(
            f"pet policy conflict {offset + 1}", index,
            {"title": f"Modern Lofts – Unit {unit}", "unit": str(unit), "rent": rent, "pets": "Pet friendly"},
            f"Unit {unit}. Monthly rent is ${rent}. No pets are permitted. Reference P{index}.",
            "needs_review", ["pets-conflict"],
            {"monthly_rent": rent, "unit_number": str(unit), "pet_policy": "prohibited"},
        ))

    assert len(fixtures) == 50
    return fixtures
