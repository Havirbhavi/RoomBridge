from collections import defaultdict
from typing import Any

from schemas import CompareRequest, ListingFeatures


DEFAULT_WEIGHTS = {
    "price": 0.30,
    "commute": 0.25,
    "amenities": 0.15,
    "room_type": 0.10,
    "furnished": 0.07,
    "pets": 0.05,
    "verified": 0.08,
}

MIN_BEHAVIOR_SAMPLES = 6
MIN_AMENITY_SIGNAL_GAP = 0.30


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    positive = {key: max(0.0, float(value)) for key, value in weights.items()}
    total = sum(positive.values()) or 1.0
    return {key: round(value / total, 4) for key, value in positive.items()}


def _feature_amenities(listing: ListingFeatures) -> set[str]:
    values = {item.lower() for item in listing.amenities + listing.utilities_included}
    if listing.furnished:
        values.add("furnished")
    if listing.verified:
        values.add("verified")
    if listing.pets and "no pet" not in listing.pets.lower():
        values.add("pet friendly")
    return values


def infer_preferences(request: CompareRequest) -> dict[str, Any]:
    explicit = dict(request.preferences or {})
    weights = dict(DEFAULT_WEIGHTS)

    explicit_weights = explicit.get("weights")
    if isinstance(explicit_weights, dict):
        for key in weights:
            if key in explicit_weights:
                weights[key] = float(explicit_weights[key])

    preferred_amenities = {
        str(item).strip().lower()
        for item in explicit.get("preferred_amenities", [])
        if str(item).strip()
    }
    behavioral_signals: list[str] = []

    decisive_swipes = [swipe for swipe in request.swipes if swipe.action in {"like", "pass"}]
    if len(decisive_swipes) >= MIN_BEHAVIOR_SAMPLES:
        liked = [swipe.listing for swipe in decisive_swipes if swipe.action == "like"]
        passed = [swipe.listing for swipe in decisive_swipes if swipe.action == "pass"]

        if liked and passed:
            liked_avg_rent = sum(item.rent for item in liked) / len(liked)
            passed_avg_rent = sum(item.rent for item in passed) / len(passed)
            if liked_avg_rent <= passed_avg_rent * 0.85:
                weights["price"] += 0.08
                behavioral_signals.append("lower price")

            liked_avg_commute = sum(item.commute_minutes for item in liked) / len(liked)
            passed_avg_commute = sum(item.commute_minutes for item in passed) / len(passed)
            if liked_avg_commute <= passed_avg_commute * 0.75:
                weights["commute"] += 0.08
                behavioral_signals.append("shorter commute")

            amenity_counts: dict[str, dict[str, int]] = defaultdict(
                lambda: {"liked": 0, "passed": 0}
            )
            for item in liked:
                for amenity in _feature_amenities(item):
                    amenity_counts[amenity]["liked"] += 1
            for item in passed:
                for amenity in _feature_amenities(item):
                    amenity_counts[amenity]["passed"] += 1

            for amenity, counts in amenity_counts.items():
                liked_rate = counts["liked"] / len(liked)
                passed_rate = counts["passed"] / len(passed)
                if liked_rate - passed_rate >= MIN_AMENITY_SIGNAL_GAP:
                    preferred_amenities.add(amenity)
                    behavioral_signals.append(amenity)

            if preferred_amenities:
                weights["amenities"] += min(0.10, len(preferred_amenities) * 0.02)

    return {
        "weights": _normalize_weights(weights),
        "max_rent": explicit.get("max_rent"),
        "max_commute_minutes": explicit.get("max_commute_minutes"),
        "preferred_room_type": explicit.get("preferred_room_type"),
        "preferred_amenities": sorted(preferred_amenities),
        "prefers_furnished": explicit.get("prefers_furnished"),
        "pet_preference": explicit.get("pet_preference"),
        "behavioral_signals": sorted(set(behavioral_signals)),
        "behavior_sample_size": len(decisive_swipes),
    }
