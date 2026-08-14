from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from PIL import Image
from io import BytesIO

from roomproof_storage import DATA_DIR, ensure_storage


GRAPH_FILE = DATA_DIR / "trust-graph.json"
_lock = Lock()


def _empty_graph() -> dict[str, Any]:
    return {"version": 1, "nodes": {}, "edges": [], "listing_features": {}}


def _load() -> dict[str, Any]:
    ensure_storage()
    if not GRAPH_FILE.exists():
        return _empty_graph()
    try:
        return json.loads(GRAPH_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _empty_graph()


def _save(graph: dict[str, Any]) -> None:
    GRAPH_FILE.write_text(json.dumps(graph, indent=2), encoding="utf-8")


def _normalize(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _node_id(kind: str, value: str) -> str:
    digest = hashlib.sha256(f"{kind}:{value}".encode()).hexdigest()[:16]
    return f"{kind}:{digest}"


def _tokens(text: str) -> set[str]:
    stop = {"the", "and", "with", "this", "that", "room", "near", "for", "from", "apartment"}
    return {term for term in re.findall(r"[a-z0-9]+", text.lower()) if len(term) > 2 and term not in stop}


def _jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / len(left | right) if left or right else 0


def _average_hash(raw: bytes) -> str | None:
    try:
        with Image.open(BytesIO(raw)) as image:
            grayscale = image.convert("L").resize((8, 8))
            pixels = list(grayscale.getdata())
        average = sum(pixels) / len(pixels)
        bits = "".join("1" if pixel >= average else "0" for pixel in pixels)
        return f"{int(bits, 2):016x}"
    except Exception:
        return None


def _hamming_similarity(left: str, right: str) -> float:
    distance = bin(int(left, 16) ^ int(right, 16)).count("1")
    return 1 - distance / 64


def _add_node(graph: dict[str, Any], kind: str, value: str, label: str | None = None) -> str:
    node_id = _node_id(kind, value)
    graph["nodes"][node_id] = {
        "id": node_id,
        "kind": kind,
        "value": value,
        "label": label or value,
    }
    return node_id


def _add_edge(graph: dict[str, Any], source: str, target: str, relation: str) -> None:
    edge = {"source": source, "target": target, "relation": relation}
    if edge not in graph["edges"]:
        graph["edges"].append(edge)


def upsert_listing(
    listing: dict[str, Any],
    artifacts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    listing_id = str(listing.get("id") or "unknown")
    listing_node = f"listing:{listing_id}"
    signals: list[dict[str, Any]] = []
    with _lock:
        graph = _load()
        graph["nodes"][listing_node] = {
            "id": listing_node,
            "kind": "listing",
            "value": listing_id,
            "label": str(listing.get("title") or listing_id),
        }

        entity_fields = {
            "address": listing.get("address"),
            "unit": listing.get("unit") or listing.get("unitNumber"),
            "host": listing.get("postedBy") or listing.get("host"),
            "phone": listing.get("phone") or listing.get("contactPhone"),
            "email": listing.get("email") or listing.get("contactEmail"),
        }
        for kind, raw_value in entity_fields.items():
            value = _normalize(raw_value)
            if not value:
                continue
            entity_node = _add_node(graph, kind, value, str(raw_value))
            connected_listings = _connected_listings(graph, entity_node)
            for related_id in connected_listings - {listing_id}:
                signals.append({
                    "type": f"shared_{kind}",
                    "severity": "high" if kind in {"phone", "email"} else "medium",
                    "related_listing_id": related_id,
                    "confidence": 1.0,
                    "detail": f"This {kind} is also connected to listing {related_id}.",
                })
            _add_edge(graph, listing_node, entity_node, f"has_{kind}")

        description = _normalize(f"{listing.get('title', '')} {listing.get('description', '')}")
        description_tokens = _tokens(description)
        for related_id, features in graph.get("listing_features", {}).items():
            if related_id == listing_id:
                continue
            similarity = _jaccard(description_tokens, set(features.get("description_tokens", [])))
            if similarity >= .82 and len(description_tokens) >= 6:
                signals.append({
                    "type": "similar_description",
                    "severity": "medium",
                    "related_listing_id": related_id,
                    "confidence": round(similarity, 3),
                    "detail": f"Listing language is {similarity:.0%} similar to listing {related_id}.",
                })

        image_hashes = []
        for artifact in artifacts:
            artifact_node = _add_node(graph, "artifact", artifact["sha256"], artifact["filename"])
            connected_listings = _connected_listings(graph, artifact_node)
            for related_id in connected_listings - {listing_id}:
                signals.append({
                    "type": "exact_artifact_reuse",
                    "severity": "high",
                    "related_listing_id": related_id,
                    "confidence": 1.0,
                    "detail": f"An identical file is connected to listing {related_id}.",
                })
            _add_edge(graph, listing_node, artifact_node, "submitted_evidence")

            if artifact["media_type"].startswith("image/"):
                perceptual_hash = _average_hash(artifact["bytes"])
                if perceptual_hash:
                    image_hashes.append(perceptual_hash)
                    for related_id, features in graph.get("listing_features", {}).items():
                        if related_id == listing_id:
                            continue
                        similarities = [
                            _hamming_similarity(perceptual_hash, candidate)
                            for candidate in features.get("image_hashes", [])
                        ]
                        similarity = max(similarities, default=0)
                        if similarity >= .9:
                            signals.append({
                                "type": "visually_similar_image",
                                "severity": "high",
                                "related_listing_id": related_id,
                                "confidence": round(similarity, 3),
                                "detail": f"A property image is {similarity:.0%} visually similar to an image from listing {related_id}.",
                            })

        graph.setdefault("listing_features", {})[listing_id] = {
            "description_tokens": sorted(description_tokens),
            "image_hashes": image_hashes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _save(graph)

    unique = {
        (signal["type"], signal["related_listing_id"]): signal
        for signal in signals
    }
    signals = list(unique.values())
    return signals, listing_subgraph(listing_id)


def _connected_listings(graph: dict[str, Any], node_id: str) -> set[str]:
    listing_ids = set()
    for edge in graph["edges"]:
        if edge["target"] == node_id and edge["source"].startswith("listing:"):
            listing_ids.add(edge["source"].split(":", 1)[1])
    return listing_ids


def listing_subgraph(listing_id: str) -> dict[str, Any]:
    with _lock:
        graph = _load()
    listing_node = f"listing:{listing_id}"
    first_edges = [
        edge for edge in graph["edges"]
        if listing_node in {edge["source"], edge["target"]}
    ]
    adjacent = {
        endpoint
        for edge in first_edges
        for endpoint in [edge["source"], edge["target"]]
    }
    second_edges = [
        edge for edge in graph["edges"]
        if edge["target"] in adjacent and edge["source"].startswith("listing:")
    ]
    edges = first_edges + [edge for edge in second_edges if edge not in first_edges]
    node_ids = {
        endpoint
        for edge in edges
        for endpoint in [edge["source"], edge["target"]]
    } | {listing_node}
    return {
        "listing_id": listing_id,
        "nodes": [graph["nodes"][node_id] for node_id in node_ids if node_id in graph["nodes"]],
        "edges": edges,
    }
