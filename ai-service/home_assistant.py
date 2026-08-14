from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str = Field(min_length=1, max_length=2000)


class HomeAssistantRequest(BaseModel):
    message: str = Field(min_length=2, max_length=1000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    listings: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class ListingSuggestion(BaseModel):
    id: str
    title: str
    rent: Optional[float] = None
    area: str = ""
    university: str = ""


class HomeAssistantResponse(BaseModel):
    answer: str
    suggestions: list[ListingSuggestion] = Field(default_factory=list)
    follow_up_prompts: list[str] = Field(default_factory=list)
    grounded: bool = True


def _rent(listing: dict[str, Any]) -> float:
    try:
        return float(listing.get("rent") or listing.get("price") or 0)
    except (TypeError, ValueError):
        return 0


def _listing_text(listing: dict[str, Any]) -> str:
    fields = [
        listing.get("title"), listing.get("city"), listing.get("state"),
        listing.get("area"), listing.get("university"), listing.get("roomType"),
        listing.get("pets"), " ".join(listing.get("tags") or []),
        " ".join(listing.get("utilitiesIncluded") or []),
        "furnished" if listing.get("furnished") else "",
    ]
    return " ".join(str(field or "") for field in fields).lower()


def answer_home_question(request: HomeAssistantRequest) -> HomeAssistantResponse:
    question = request.message.strip()
    lower = question.lower()
    listings = list(request.listings)
    filtered = listings

    budget_match = re.search(r"(?:under|below|max(?:imum)?|budget(?: of)?)\s*\$?\s*([\d,]+)", lower)
    if budget_match:
        ceiling = float(budget_match.group(1).replace(",", ""))
        filtered = [listing for listing in filtered if 0 < _rent(listing) <= ceiling]

    terms = {
        "pet": ["pet", "cat", "dog"],
        "laundry": ["laundry", "washer", "dryer"],
        "furnished": ["furnished"],
        "utilities": ["utilities", "water", "internet", "electric"],
        "studio": ["studio"],
        "private": ["private room", "private"],
    }
    active_groups = [
        keywords for keywords in terms.values()
        if any(keyword in lower for keyword in keywords)
    ]
    for keywords in active_groups:
        filtered = [
            listing for listing in filtered
            if any(keyword in _listing_text(listing) for keyword in keywords)
        ]

    place_aliases: list[tuple[str, str]] = []
    for listing in listings:
        for value in [listing.get("city"), listing.get("area"), listing.get("university")]:
            if not value:
                continue
            canonical = str(value).lower()
            aliases = {canonical, canonical.replace(" university", "").strip()}
            place_aliases.extend((alias, canonical) for alias in aliases if len(alias) >= 4)
    matched_places = {
        canonical for alias, canonical in place_aliases
        if re.search(rf"\b{re.escape(alias)}\b", lower)
    }
    if matched_places:
        filtered = [
            listing for listing in filtered
            if any(place in _listing_text(listing) for place in matched_places)
        ]

    filtered.sort(key=lambda listing: (_rent(listing) <= 0, _rent(listing)))
    suggestions = [
        ListingSuggestion(
            id=str(listing.get("id")),
            title=str(listing.get("title") or "Available room"),
            rent=_rent(listing) or None,
            area=str(listing.get("area") or listing.get("city") or ""),
            university=str(listing.get("university") or ""),
        )
        for listing in filtered[:3]
    ]

    if any(term in lower for term in ["scam", "safe", "deposit", "verify", "legit"]):
        return HomeAssistantResponse(
            answer=(
                "Before paying, confirm the address and host identity, request a live video tour, "
                "and review the lease. Never treat a listing badge as a guarantee. Open a room and "
                "use RoomProof to check uploaded lease terms against the listing."
            ),
            follow_up_prompts=["How does RoomProof work?", "Show verified listings", "What should I check in a lease?"],
        )

    if any(term in lower for term in ["how", "what is roombridge", "help", "start"]):
        return HomeAssistantResponse(
            answer=(
                "RoomBridge helps students search rooms near campus, filter by budget and amenities, "
                "save Like or Maybe options, compare a shortlist, and review lease evidence with RoomProof."
            ),
            follow_up_prompts=["Find rooms under $1,200", "Show furnished rooms", "How do I verify a listing?"],
        )

    if not listings:
        return HomeAssistantResponse(
            answer="I can help with room search, comparison, leases, and rental-safety questions. Listing data is temporarily unavailable, so I cannot recommend a specific room yet.",
            grounded=False,
            follow_up_prompts=["How do I verify a listing?", "What should I check in a lease?"],
        )

    if suggestions:
        scope = f" matching that request" if filtered != listings else ""
        return HomeAssistantResponse(
            answer=f"I found {len(filtered)} room{'s' if len(filtered) != 1 else ''}{scope}. Here are the strongest available options to open in Browse.",
            suggestions=suggestions,
            follow_up_prompts=["Only show furnished rooms", "Which is cheapest?", "How should I verify these?"],
        )

    return HomeAssistantResponse(
        answer="I couldn’t find a current listing matching all of those details. Try increasing the budget, removing one amenity, or asking for a nearby area.",
        follow_up_prompts=["Show all available rooms", "Find the cheapest rooms", "Show rooms near campus"],
    )
