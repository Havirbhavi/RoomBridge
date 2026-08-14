import re
from typing import Any


MONEY_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)")
MINUTES_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:minute|minutes|min)\b", re.I)
SCORE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*/\s*100")
AMENITY_TERMS = {
    "furnished",
    "verified",
    "pet friendly",
    "in-unit laundry",
    "laundry",
    "internet",
    "water",
    "electricity",
    "utilities",
    "parking",
    "gym",
    "pool",
}


def _close_to_any(value: float, allowed: set[float], tolerance: float = 0.11) -> bool:
    return any(abs(value - candidate) <= tolerance for candidate in allowed)


def check_grounding(
    explanations: list[dict[str, str]], comparisons: list[dict[str, Any]]
) -> tuple[bool, list[str]]:
    comparison_by_id = {item["listing_id"]: item for item in comparisons}
    failures: list[str] = []

    for generated in explanations:
        listing_id = generated.get("listing_id")
        item = comparison_by_id.get(listing_id)
        if not item:
            failures.append(f"Unknown listing id {listing_id}")
            continue

        text = generated.get("explanation", "")
        listing = item["listing"]
        allowed_money = {float(listing.rent)}
        allowed_minutes = {float(listing.commute_minutes)}
        allowed_scores = {float(item["score"])}
        computed_facts = " ".join(item["wins"] + item["loses"])
        allowed_money.update(
            float(raw.replace(",", "")) for raw in MONEY_RE.findall(computed_facts)
        )
        allowed_minutes.update(
            float(raw) for raw in MINUTES_RE.findall(computed_facts)
        )
        allowed_amenities = {
            value.lower()
            for value in listing.amenities + listing.utilities_included
        }
        if listing.furnished:
            allowed_amenities.add("furnished")
        if listing.verified:
            allowed_amenities.add("verified")

        for raw in MONEY_RE.findall(text):
            value = float(raw.replace(",", ""))
            if not _close_to_any(value, allowed_money, tolerance=0.51):
                failures.append(f"{listing_id}: unsupported dollar amount ${value:g}")

        for raw in MINUTES_RE.findall(text):
            if not _close_to_any(float(raw), allowed_minutes, tolerance=0.51):
                failures.append(f"{listing_id}: unsupported commute {raw} minutes")

        for raw in SCORE_RE.findall(text):
            if not _close_to_any(float(raw), allowed_scores):
                failures.append(f"{listing_id}: unsupported score {raw}/100")

        lowered = text.lower()
        for amenity in AMENITY_TERMS:
            if amenity in lowered and amenity not in allowed_amenities:
                if amenity == "utilities" and listing.utilities_included:
                    continue
                failures.append(f"{listing_id}: unsupported amenity '{amenity}'")

    return not failures, failures
