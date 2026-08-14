from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any, Optional


DATA_DIR = Path(os.getenv("ROOMPROOF_DATA_DIR", Path(__file__).parent / "data"))
REPORTS_DIR = DATA_DIR / "reports"
ARTIFACTS_DIR = DATA_DIR / "artifacts"
INDEX_FILE = DATA_DIR / "artifact-index.json"
_lock = Lock()


def ensure_storage() -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        INDEX_FILE.write_text("{}", encoding="utf-8")


def save_artifact(evidence_id: str, content: bytes) -> str:
    ensure_storage()
    path = ARTIFACTS_DIR / evidence_id
    path.write_bytes(content)
    return str(path)


def register_hash(content_hash: str, listing_id: str, evidence_id: str) -> list[dict[str, str]]:
    ensure_storage()
    with _lock:
        index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        previous = list(index.get(content_hash, []))
        if not any(item["evidence_id"] == evidence_id for item in previous):
            index.setdefault(content_hash, []).append(
                {"listing_id": listing_id, "evidence_id": evidence_id}
            )
            INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
        return previous


def save_report(report: dict[str, Any]) -> None:
    ensure_storage()
    path = REPORTS_DIR / f"{report['report_id']}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def get_report(report_id: str) -> Optional[dict[str, Any]]:
    ensure_storage()
    path = REPORTS_DIR / f"{report_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
