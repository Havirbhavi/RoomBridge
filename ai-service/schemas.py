from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ListingFeatures(BaseModel):
    id: str
    title: str
    rent: float = Field(ge=0)
    commute_minutes: float = Field(default=0, ge=0)
    distance_miles: Optional[float] = Field(default=None, ge=0)
    room_type: Optional[str] = None
    furnished: bool = False
    utilities_included: list[str] = Field(default_factory=list)
    amenities: list[str] = Field(default_factory=list)
    pets: Optional[str] = None
    verified: bool = False

    @model_validator(mode="after")
    def normalize_text_lists(self):
        self.utilities_included = sorted(
            {str(item).strip() for item in self.utilities_included if str(item).strip()}
        )
        self.amenities = sorted(
            {str(item).strip() for item in self.amenities if str(item).strip()}
        )
        return self


class SwipeAction(BaseModel):
    action: Literal["like", "maybe", "pass"]
    listing: ListingFeatures


class CompareRequest(BaseModel):
    listings: list[ListingFeatures] = Field(min_length=1, max_length=20)
    preferences: Optional[dict[str, Any]] = None
    swipes: list[SwipeAction] = Field(default_factory=list)


class ListingComparison(BaseModel):
    listing_id: str
    title: str
    score: float = Field(ge=0, le=100)
    wins: list[str] = Field(default_factory=list)
    loses: list[str] = Field(default_factory=list)
    explanation: str


class CompareResponse(BaseModel):
    recommended_id: str
    comparisons: list[ListingComparison]
    inferred_preferences: dict[str, Any]
    grounding_passed: bool
    grounding_retries: int = Field(ge=0, le=2)
    explanation_source: Literal["anthropic", "deterministic"]
