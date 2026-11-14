"""Latency log: appends to logs/latency.jsonl and keeps medians in memory."""
from __future__ import annotations

import json
import os
import statistics
import time
from collections import defaultdict


class Latency:
    def __init__(self) -> None:
        self.samples: dict[str, list[float]] = defaultdict(list)
        self.path: str | None = None

    def configure(self, log_dir: str) -> None:
        os.makedirs(log_dir, exist_ok=True)
        self.path = os.path.join(log_dir, "latency.jsonl")

    def record(self, metric: str, ms: float) -> None:
        self.samples[metric].append(ms)
        if self.path:
            try:
                with open(self.path, "a") as f:
                    f.write(json.dumps({"t": time.time(), "metric": metric, "ms": round(ms, 1)}) + "\n")
            except OSError:
                pass

    def summary(self) -> dict:
        return {k: {"n": len(v), "median_ms": round(statistics.median(v), 1)} for k, v in self.samples.items() if v}


latency = Latency()


