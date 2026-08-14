from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

SYSTEM_PROMPT = """You write concise RoomBridge housing comparison explanations.
You receive scores, wins, and trade-offs that have already been computed.
Never redo the math. Never invent rent, commute time, amenities, verification, or rankings.
Use only facts in the supplied JSON.
Return valid JSON with one key, "comparisons", containing objects with listing_id and explanation.
Each explanation must be 2-3 short sentences and clearly explain why the option ranks where it does."""


def deterministic_explanations(comparisons: list[dict[str, Any]]) -> list[dict[str, str]]:
    results = []
    for item in comparisons:
        wins = item["wins"]
        loses = item["loses"]
        opening = (
            f"{item['title']} scores {item['score']:.1f}/100 and ranks "
            f"#{item['rank']} in this shortlist."
        )
        win_text = f"Its strongest points are {'; '.join(wins)}." if wins else ""
        lose_text = f"Main trade-offs: {'; '.join(loses)}." if loses else ""
        results.append(
            {
                "listing_id": item["listing_id"],
                "explanation": " ".join(part for part in [opening, win_text, lose_text] if part),
            }
        )
    return results


def synthesize_explanations(
    comparisons: list[dict[str, Any]], retry_feedback: str | None = None
) -> tuple[list[dict[str, str]], str]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return deterministic_explanations(comparisons), "deterministic"

    from anthropic import Anthropic

    serializable = [
        {
            "listing_id": item["listing_id"],
            "title": item["title"],
            "score": item["score"],
            "rank": item["rank"],
            "wins": item["wins"],
            "loses": item["loses"],
        }
        for item in comparisons
    ]
    feedback = f"\nPrevious grounding failure: {retry_feedback}" if retry_feedback else ""
    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=1200,
        temperature=0,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Write explanations for this computed comparison JSON:\n{json.dumps(serializable)}{feedback}",
            }
        ],
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    parsed = json.loads(text)
    return parsed["comparisons"], "anthropic"
