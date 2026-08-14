from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

os.environ["ROOMPROOF_DATA_DIR"] = tempfile.mkdtemp(prefix="roomproof-graph-eval-")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from trust_graph import listing_subgraph, upsert_listing  # noqa: E402


def image_artifact(color: tuple[int, int, int], name: str) -> dict:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buffer, format="PNG")
    raw = buffer.getvalue()
    return {
        "id": name,
        "filename": name,
        "media_type": "image/png",
        "bytes": raw,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def run() -> int:
    first = {
        "id": "graph-a",
        "title": "Furnished graduate room near campus",
        "description": "Quiet furnished private room with desk laundry and campus shuttle access",
        "address": "100 College Ave, State College, PA",
        "postedBy": "Alex Host",
        "contactPhone": "814-555-0100",
    }
    second = {
        "id": "graph-b",
        "title": "Graduate room close to campus",
        "description": "Quiet furnished private room with desk laundry and campus shuttle access",
        "address": "100 College Avenue, State College, PA",
        "postedBy": "Different Name",
        "contactPhone": "814-555-0100",
    }
    upsert_listing(first, [image_artifact((120, 140, 160), "first.png")])
    signals, graph = upsert_listing(second, [image_artifact((122, 142, 162), "second.png")])
    signal_types = {signal["type"] for signal in signals}
    checks = {
        "shared_phone": "shared_phone" in signal_types,
        "similar_description": "similar_description" in signal_types,
        "visual_similarity": "visually_similar_image" in signal_types,
        "graph_has_both_listings": len([node for node in graph["nodes"] if node["kind"] == "listing"]) == 2,
        "graph_has_edges": len(graph["edges"]) >= 4,
    }
    result = {
        "suite": "roomtrust-graph-v1",
        "passed": all(checks.values()),
        "checks": checks,
        "signals": sorted(signal_types),
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
    }
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(run())
