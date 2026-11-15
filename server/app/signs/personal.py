"""Personal signs: the signer teaches the app their own signs, a few examples each.

Why: the pretrained model has never seen this signer's hands, camera or lighting, and it only
knows ASL Citizen glosses. A signer can teach any word in any sign language (ASL, BSL, ISL,
home signs, names) with about three examples, and those win over the pretrained guess when
they match well.

How (few-shot nearest neighbour, no GPU, instant):
- Each example becomes two descriptors:
  1. "model": SignBart's 2,730 logits, centred and L2-normalised. Similar movements land on
     similar logit patterns even for signs SignBart never learned.
  2. "shape": 12 time-resampled frames of both hands (21 points each, relative to the wrist,
     scaled by hand size) plus each wrist's position relative to the shoulders.
- Similarity to a taught sign = mean of the best two example similarities (one lucky example
  does not decide it). Score = W_MODEL * model + (1 - W_MODEL) * shape cosine.
- Examples are stored as landmarks only (never video) in model/data/personal.json.
"""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from typing import Optional

import numpy as np

STEPS = 12
W_MODEL = float(os.environ.get("PERSONAL_W_MODEL", "0.5"))


def _pts(f: dict, key: str, n: int) -> Optional[np.ndarray]:
    p = f.get(key)
    if not p:
        return None
    a = np.asarray(p, dtype=np.float32)[:n, :2]
    return a if a.shape[0] == n and np.isfinite(a).all() else None


def shape_descriptor(frames: list[dict], hand: str = "right") -> np.ndarray:
    """[STEPS * 2 hands * (42 shape + 2 position)] -> L2-normalised. Dominant hand first."""
    first, second = ("lh", "rh") if hand == "left" else ("rh", "lh")
    idx = np.linspace(0, len(frames) - 1, STEPS).round().astype(int)
    out = np.zeros((STEPS, 2, 44), dtype=np.float32)
    for t, i in enumerate(idx):
        f = frames[i]
        pose = _pts(f, "pose", 33)
        if pose is not None:
            ls, rs = pose[11], pose[12]
            centre = (ls + rs) / 2
            width = max(float(np.linalg.norm(ls - rs)), 1e-3)
        else:
            centre, width = np.array([0.5, 0.5], dtype=np.float32), 0.3
        for h, key in enumerate((first, second)):
            pts = _pts(f, key, 21)
            if pts is None:
                continue
            wrist = pts[0]
            size = max(float(np.linalg.norm(pts[9] - wrist)), 1e-3)     # wrist -> middle knuckle
            rel = (pts - wrist) / size
            if hand == "left":
                rel[:, 0] = -rel[:, 0]                                   # mirror so left == right
            pos = (wrist - centre) / width
            if hand == "left":
                pos[0] = -pos[0]
            out[t, h, :42] = rel.reshape(-1) * 0.5
            out[t, h, 42:] = pos * 2.0
    v = out.reshape(-1)
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def model_descriptor(logits: np.ndarray) -> np.ndarray:
    z = logits.astype(np.float32) - float(logits.mean())
    n = float(np.linalg.norm(z))
    return z / n if n > 0 else z


class PersonalSigns:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.examples: list[dict] = []          # {id, label, hand, t, frames, m, s}
        self._load()

    # ----------------------------------------------------------------- storage

    def _load(self) -> None:
        if not os.path.exists(self.path):
            return
        try:
            for e in json.load(open(self.path)):
                e["m"] = np.asarray(e["m"], dtype=np.float32) if e.get("m") is not None else None
                e["s"] = np.asarray(e["s"], dtype=np.float32)
                self.examples.append(e)
        except Exception:
            self.examples = []

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        data = [{**e, "m": e["m"].tolist() if e["m"] is not None else None, "s": e["s"].tolist()} for e in self.examples]
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, self.path)

    # ----------------------------------------------------------------- API

    def labels(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for e in self.examples:
            out[e["label"]] = out.get(e["label"], 0) + 1
        return out

    def add(self, label: str, frames: list[dict], hand: str, logits: Optional[np.ndarray]) -> dict:
        label = " ".join(label.strip().upper().split())[:40]
        e = {"id": secrets.token_hex(5), "label": label, "hand": hand, "t": time.time(), "frames": frames,
             "m": model_descriptor(logits) if logits is not None else None, "s": shape_descriptor(frames, hand)}
        with self._lock:
            self.examples.append(e)
            self._save()
        return {"ok": True, "id": e["id"], "label": label, "count": self.labels()[label]}

    def remove(self, label: str) -> int:
        label = " ".join(label.strip().upper().split())
        with self._lock:
            before = len(self.examples)
            self.examples = [e for e in self.examples if e["label"] != label]
            self._save()
        return before - len(self.examples)

    def remove_last(self, label: str) -> bool:
        label = " ".join(label.strip().upper().split())
        with self._lock:
            for i in range(len(self.examples) - 1, -1, -1):
                if self.examples[i]["label"] == label:
                    del self.examples[i]
                    self._save()
                    return True
        return False

    def score(self, frames: list[dict], hand: str, logits: Optional[np.ndarray]) -> list[tuple[str, float]]:
        """[(label, similarity 0..1)] best first. Empty when nothing is taught."""
        if not self.examples:
            return []
        s = shape_descriptor(frames, hand)
        m = model_descriptor(logits) if logits is not None else None
        per: dict[str, list[float]] = {}
        for e in self.examples:
            sim_s = float(e["s"] @ s)
            if m is not None and e["m"] is not None:
                sim = W_MODEL * float(e["m"] @ m) + (1 - W_MODEL) * sim_s
            else:
                sim = sim_s
            per.setdefault(e["label"], []).append(sim)
        out = []
        for label, sims in per.items():
            top = sorted(sims, reverse=True)[:2]
            out.append((label, sum(top) / len(top)))
        return sorted(out, key=lambda x: -x[1])
