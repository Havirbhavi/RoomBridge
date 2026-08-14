from typing import Any

from langgraph.graph import END, StateGraph

from grounding import check_grounding
from preference_inference import infer_preferences
from schemas import CompareRequest, CompareResponse, ListingComparison
from scoring import compare_listings, score_listings
from synthesis import deterministic_explanations, synthesize_explanations


def infer_preferences_node(state: dict[str, Any]) -> dict[str, Any]:
    request: CompareRequest = state["request"]
    return {**state, "inferred_prefs": infer_preferences(request)}


def score_node(state: dict[str, Any]) -> dict[str, Any]:
    request: CompareRequest = state["request"]
    scores = score_listings(request.listings, state["inferred_prefs"])
    comparisons = compare_listings(request.listings, scores)
    return {**state, "scores": scores, "comparisons": comparisons}


def synthesize_node(state: dict[str, Any]) -> dict[str, Any]:
    feedback = "; ".join(state.get("grounding_failures", [])) or None
    try:
        explanations, source = synthesize_explanations(
            state["comparisons"], retry_feedback=feedback
        )
    except Exception as exc:
        explanations = deterministic_explanations(state["comparisons"])
        source = "deterministic"
        return {
            **state,
            "explanations": explanations,
            "explanation_source": source,
            "synthesis_error": str(exc),
        }
    return {
        **state,
        "explanations": explanations,
        "explanation_source": source,
    }


def grounding_node(state: dict[str, Any]) -> dict[str, Any]:
    passed, failures = check_grounding(state["explanations"], state["comparisons"])
    retries = state.get("retries", 0)

    if not passed and retries + 1 >= 2:
        fallback = deterministic_explanations(state["comparisons"])
        fallback_passed, fallback_failures = check_grounding(
            fallback, state["comparisons"]
        )
        return {
            **state,
            "explanations": fallback,
            "explanation_source": "deterministic",
            "grounding_passed": fallback_passed,
            "grounding_failures": fallback_failures,
            "retries": 2,
        }

    return {
        **state,
        "grounding_passed": passed,
        "grounding_failures": failures,
        "retries": retries + (0 if passed else 1),
    }


def grounding_route(state: dict[str, Any]) -> str:
    return "done" if state["grounding_passed"] or state["retries"] >= 2 else "retry"


builder = StateGraph(dict)
builder.add_node("infer_preferences", infer_preferences_node)
builder.add_node("score", score_node)
builder.add_node("synthesize", synthesize_node)
builder.add_node("check_grounding", grounding_node)
builder.set_entry_point("infer_preferences")
builder.add_edge("infer_preferences", "score")
builder.add_edge("score", "synthesize")
builder.add_edge("synthesize", "check_grounding")
builder.add_conditional_edges(
    "check_grounding",
    grounding_route,
    {"retry": "synthesize", "done": END},
)
compare_graph = builder.compile()


def run_graph(request: CompareRequest) -> CompareResponse:
    state = compare_graph.invoke(
        {
            "request": request,
            "inferred_prefs": {},
            "scores": [],
            "comparisons": [],
            "explanations": [],
            "retries": 0,
            "grounding_passed": False,
            "grounding_failures": [],
            "explanation_source": "deterministic",
        }
    )
    explanations = {
        item["listing_id"]: item["explanation"] for item in state["explanations"]
    }
    comparisons = [
        ListingComparison(
            listing_id=item["listing_id"],
            title=item["title"],
            score=item["score"],
            wins=item["wins"],
            loses=item["loses"],
            explanation=explanations[item["listing_id"]],
        )
        for item in state["comparisons"]
    ]
    return CompareResponse(
        recommended_id=state["scores"][0]["listing_id"],
        comparisons=comparisons,
        inferred_preferences=state["inferred_prefs"],
        grounding_passed=state["grounding_passed"],
        grounding_retries=state["retries"],
        explanation_source=state["explanation_source"],
    )
