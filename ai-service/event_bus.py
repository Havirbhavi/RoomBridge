from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def publish(topic: str, payload: dict[str, Any]) -> str:
    """Publish to Kafka when configured; otherwise use a durable local outbox."""
    brokers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()
    if brokers:
        from kafka import KafkaProducer

        producer = KafkaProducer(
            bootstrap_servers=[item.strip() for item in brokers.split(",")],
            value_serializer=lambda value: json.dumps(value).encode("utf-8"),
            acks="all",
            retries=3,
        )
        producer.send(topic, payload).get(timeout=10)
        producer.flush()
        producer.close()
        return "kafka"

    outbox = Path(os.getenv("ROOMPROOF_DATA_DIR", Path(__file__).parent / "data")) / "outbox.jsonl"
    outbox.parent.mkdir(parents=True, exist_ok=True)
    with outbox.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"topic": topic, "payload": payload}) + "\n")
    return "local-outbox"
