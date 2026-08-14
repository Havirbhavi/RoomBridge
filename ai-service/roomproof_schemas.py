from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


EvidenceKind = Literal["lease", "image", "video", "audio", "message", "other"]


class EvidenceInput(BaseModel):
    kind: EvidenceKind
    filename: str = Field(min_length=1, max_length=180)
    media_type: str = Field(default="text/plain", max_length=120)
    text: Optional[str] = Field(default=None, max_length=250_000)
    content_base64: Optional[str] = None

    @model_validator(mode="after")
    def require_content(self):
        if not self.text and not self.content_base64:
            raise ValueError("Evidence requires text or base64 content")
        return self


class RoomProofRequest(BaseModel):
    listing: dict[str, Any]
    user_preferences: dict[str, Any] = Field(default_factory=dict)
    evidence: list[EvidenceInput] = Field(default_factory=list, max_length=20)


class Citation(BaseModel):
    evidence_id: str
    filename: str
    locator: str
    excerpt: str = Field(max_length=500)


class Finding(BaseModel):
    id: str
    category: Literal["lease", "visual", "consistency", "identity", "cost", "match"]
    severity: Literal["info", "low", "medium", "high"]
    title: str
    detail: str
    confidence: float = Field(ge=0, le=1)
    status: Literal["supported", "conflict", "missing", "uncertain"]
    citations: list[Citation] = Field(default_factory=list)


class RoomProofReport(BaseModel):
    report_id: str
    listing_id: str
    status: Literal["complete", "needs_review"]
    confidence_score: int = Field(ge=0, le=100)
    recommendation: str
    findings: list[Finding]
    extracted_terms: dict[str, Any]
    evidence_summary: dict[str, Any]
    model_manifest: dict[str, str]
    trace: list[dict[str, Any]]
    created_at: str


class EvidenceQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class EvidenceAnswer(BaseModel):
    answer: str
    confidence: float = Field(ge=0, le=1)
    citations: list[Citation]
    abstained: bool
