from typing import Any

from schemas import ListingFeatures


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _lower_is_better(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 1.0
    return _clamp(1 - ((value - minimum) / (maximum - minimum)))


def _amenities(listing: ListingFeatures) -> set[str]:
    values = {item.lower() for item in listing.amenities + listing.utilities_included}
    if listing.furnished:
        values.add("furnished")
    if listing.verified:
        values.add("verified")
    if listing.pets and "no pet" not in listing.pets.lower():
        values.add("pet friendly")
    return values


def _component_scores(
    listing: ListingFeatures,
    listings: list[ListingFeatures],
    preferences: dict[str, Any],
) -> dict[str, float]:
    rents = [item.rent for item in listings]
    commutes = [item.commute_minutes for item in listings]

    max_rent = preferences.get("max_rent")
    if max_rent:
        price_score = 1.0 if listing.rent <= float(max_rent) else _clamp(
            1 - ((listing.rent - float(max_rent)) / max(float(max_rent), 1))
        )
    else:
        price_score = _lower_is_better(listing.rent, min(rents), max(rents))

    max_commute = preferences.get("max_commute_minutes")
    if max_commute:
        commute_score = (
            1.0
            if listing.commute_minutes <= float(max_commute)
            else _clamp(
                1
                - (
                    (listing.commute_minutes - float(max_commute))
                    / max(float(max_commute), 1)
                )
            )
        )
    else:
        commute_score = _lower_is_better(
            listing.commute_minutes, min(commutes), max(commutes)
        )

    preferred_amenities = set(preferences.get("preferred_amenities") or [])
    listing_amenities = _amenities(listing)
    amenities_score = (
        len(preferred_amenities & listing_amenities) / len(preferred_amenities)
        if preferred_amenities
        else 0.65
    )

    preferred_room_type = str(preferences.get("preferred_room_type") or "").lower()
    room_type_score = (
        1.0
        if not preferred_room_type
        or preferred_room_type in str(listing.room_type or "").lower()
        else 0.25
    )

    prefers_furnished = preferences.get("prefers_furnished")
    furnished_score = (
        0.65
        if prefers_furnished is None
        else (1.0 if listing.furnished == bool(prefers_furnished) else 0.1)
    )

    pet_preference = str(preferences.get("pet_preference") or "").lower()
    pet_score = 0.65
    if pet_preference:
        pet_score = 1.0 if pet_preference in str(listing.pets or "").lower() else 0.2

    return {
        "price": price_score,
        "commute": commute_score,
        "amenities": amenities_score,
        "room_type": room_type_score,
        "furnished": furnished_score,
        "pets": pet_score,
        "verified": 1.0 if listing.verified else 0.35,
    }


def score_listings(
    listings: list[ListingFeatures], preferences: dict[str, Any]
) -> list[dict[str, Any]]:
    weights = preferences["weights"]
    scored: list[dict[str, Any]] = []

    for listing in listings:
        components = _component_scores(listing, listings, preferences)
        raw_score = sum(components[key] * weights[key] for key in weights)
        scored.append(
            {
                "listing_id": listing.id,
                "title": listing.title,
                "score": round(raw_score * 100, 1),
                "components": {key: round(value * 100, 1) for key, value in components.items()},
            }
        )

    scored.sort(key=lambda item: (-item["score"], item["listing_id"]))
    return scored


def compare_listings(
    listings: list[ListingFeatures], scores: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    listing_by_id = {listing.id: listing for listing in listings}
    score_by_id = {score["listing_id"]: score for score in scores}
    cheapest = min(listings, key=lambda item: item.rent)
    closest = min(listings, key=lambda item: item.commute_minutes)

    comparisons: list[dict[str, Any]] = []
    for score in scores:
        listing = listing_by_id[score["listing_id"]]
        wins: list[str] = []
        loses: list[str] = []

        if listing.id == cheapest.id:
            wins.append(f"Lowest rent at ${listing.rent:,.0f}/month")
        else:
            loses.append(f"${listing.rent - cheapest.rent:,.0f} more than the cheapest option")

        if listing.id == closest.id:
            wins.append(f"Shortest commute at {listing.commute_minutes:,.0f} minutes")
        else:
            loses.append(
                f"{listing.commute_minutes - closest.commute_minutes:,.0f} minutes longer than the closest option"
            )

        if listing.verified:
            wins.append("Verified listing")
        else:
            loses.append("Verification is not confirmed")

        if listing.furnished:
            wins.append("Furnished")
        if listing.utilities_included:
            wins.append(f"Includes {', '.join(listing.utilities_included[:3])}")

        comparisons.append(
            {
                **score,
                "wins": wins[:4],
                "loses": loses[:3],
                "listing": listing,
                "rank": scores.index(score) + 1,
            }
        )

    return comparisons
