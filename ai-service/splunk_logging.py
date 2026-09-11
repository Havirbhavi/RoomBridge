"""Non-blocking, privacy-safe operational event delivery to Splunk HEC."""

from __future__ import annotations

import json
import os
import queue
import threading
import time
from typing import Any
from urllib import request


_HEC_URL = os.getenv("SPLUNK_HEC_URL", "").strip()
_HEC_TOKEN = os.getenv("SPLUNK_HEC_TOKEN", "").strip()
_EVENT_QUEUE: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1_000)


def _deliver(event: dict[str, Any]) -> None:
    payload = json.dumps(
        {
            "time": time.time(),
            "host": os.getenv("HOSTNAME", "roombridge-local"),
            "source": "roombridge-ai",
            "sourcetype": "roombridge:json",
            "event": event,
        }
    ).encode("utf-8")
    hec_request = request.Request(
        _HEC_URL,
        data=payload,
        headers={
            "Authorization": f"Splunk {_HEC_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with request.urlopen(hec_request, timeout=2) as response:
        if response.status >= 300:
            raise RuntimeError(f"Splunk HEC returned {response.status}")


def _worker() -> None:
    while True:
        event = _EVENT_QUEUE.get()
        try:
            _deliver(event)
        except Exception:
            # Observability must never make the application unavailable. The
            # JSON stdout record remains available to the container runtime.
            pass
        finally:
            _EVENT_QUEUE.task_done()


if _HEC_URL and _HEC_TOKEN:
    threading.Thread(target=_worker, name="splunk-hec", daemon=True).start()


def emit_operational_event(event_type: str, **fields: Any) -> None:
    """Emit metadata only; callers must not pass document or question text."""
    event = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "service": "roombridge-ai-platform",
        "environment": os.getenv("APP_ENV", "development"),
        "event_type": event_type,
        **fields,
    }
    print(json.dumps(event, separators=(",", ":")), flush=True)
    if not (_HEC_URL and _HEC_TOKEN):
        return
    try:
        _EVENT_QUEUE.put_nowait(event)
    except queue.Full:
        # Keep request processing non-blocking during a collector outage.
        pass
