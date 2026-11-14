"""Live sign recognition: one sign per pause-delimited segment (the browser segments).

- Recognition is restricted to the active vocabulary (model/vocab.json, measured on real signers).
- The signer's dominant hand ("right" | "left") picks the hand order; "auto" uses the more confident one.
- When the caller named options ("six or twelve?"), those signs get a boost when re-ranking the
  top guesses. Recognition is never restricted to them.
- Below the confidence bar the result is "unsure": the app shows the top two and says nothing
  until the signer picks.
- Team recordings (landmarks only) go to model/data/recordings.jsonl for the held-out evaluation.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import threading
import time
from typing import Optional

from .models import MODEL_DIR, Guess, SignBartModel

log = logging.getLogger("signs")

UNSURE_P = float(os.environ.get("SIGN_UNSURE_P", "0.45"))       # tune on held-out data (eval/sign_eval.py)
UNSURE_MARGIN = float(os.environ.get("SIGN_UNSURE_MARGIN", "0.15"))
BOOST = 1.6
DATA_DIR = os.path.join(MODEL_DIR, "data")

_NUM = {"zero": "ZERO", "one": "ONE", "two": "TWO", "three": "THREE", "four": "FOUR", "five": "FIVE", "six": "SIX",
        "seven": "SEVEN", "eight": "EIGHT", "nine": "NINE", "ten": "TEN", "eleven": "ELEVEN", "twelve": "TWELVE"}


def option_glosses(options: list[str]) -> set[str]:
    """Caller's words -> glosses: 'six or twelve' -> {SIX, TWELVE}; '6' -> SIX; 'Sunday' -> SUNDAY."""
    out: set[str] = set()
    inv = {str(i): g for i, g in enumerate(_NUM.values())}
    for o in options:
        for w in re.findall(r"[A-Za-z]+|\d+", o):
            lw = w.lower()
            out.add(_NUM.get(lw) or inv.get(lw) or w.upper())
    return out


def _swap(frames: list[dict]) -> list[dict]:
    return [{**f, "lh": f.get("rh"), "rh": f.get("lh")} for f in frames]


class SignService:
    def __init__(self) -> None:
        self.model: Optional[SignBartModel] = None
        self.error = ""
        self.active: list[str] = []
        self._lock = threading.Lock()
        try:
            self.model = SignBartModel()
            vocab = json.load(open(os.path.join(MODEL_DIR, "vocab.json")))
            self.active = list(vocab["active"])
            log.info("sign model ready: %s, %d active signs", self.model.name, len(self.active))
        except Exception as e:  # the call still works by typing
            self.error = f"sign model not loaded: {e}"
            log.warning(self.error)

    @property
    def ready(self) -> bool:
        return self.model is not None

    def config(self) -> dict:
        return {"ready": self.ready, "model": self.model.name if self.model else None, "vocab": self.active,
                "error": self.error}

    def classify(self, frames: list[dict], hand: str = "right", options: Optional[list[str]] = None) -> dict:
        if not self.model:
            return {"ok": False, "reason": "Signing isn't available right now. You can type instead."}
        if len(frames) < 4:
            return {"ok": False, "reason": "too short"}
        allowed = set(self.active) or None
        t0 = time.perf_counter()
        with self._lock:
            variants = []
            if hand in ("right", "auto"):
                variants.append(self.model.predict(frames, k=5, allowed=allowed))
            if hand in ("left", "auto"):
                variants.append(self.model.predict(_swap(frames), k=5, allowed=allowed))
        guesses = max(variants, key=lambda g: g[0].p)
        boost = option_glosses(options or []) & (allowed or set())
        if boost:
            guesses = [Guess(g.sign, g.p * (BOOST if g.sign in boost else 1.0)) for g in guesses]
            z = sum(g.p for g in guesses) or 1.0
            guesses = sorted((Guess(g.sign, g.p / z) for g in guesses), key=lambda g: -g.p)
        ms = (time.perf_counter() - t0) * 1000
        top, second = guesses[0], guesses[1] if len(guesses) > 1 else Guess("", 0.0)
        unsure = top.p < UNSURE_P or (top.p - second.p) < UNSURE_MARGIN
        return {"ok": True, "sign": top.sign, "unsure": unsure,
                "options": [top.sign, second.sign] if unsure and second.sign else [top.sign],
                "ms": round(ms, 1), "_p": [round(g.p, 3) for g in guesses[:3]], "_top": [g.sign for g in guesses[:3]]}

    # ------------------------------------------------------------ team recordings (landmarks only)

    def record(self, signer: str, label: str, segments: list[list[dict]], kind: str) -> dict:
        os.makedirs(DATA_DIR, exist_ok=True)
        rec = {"id": secrets.token_hex(6), "t": time.time(), "signer": signer.strip()[:40] or "anon",
               "kind": kind, "label": label.strip().upper()[:120], "segments": segments}
        with open(os.path.join(DATA_DIR, "recordings.jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")
        return {"ok": True, "id": rec["id"]}

    def recordings_summary(self) -> dict:
        path = os.path.join(DATA_DIR, "recordings.jsonl")
        counts: dict[str, dict[str, int]] = {}
        if os.path.exists(path):
            for line in open(path):
                r = json.loads(line)
                counts.setdefault(r["signer"], {}).setdefault(r["label"], 0)
                counts[r["signer"]][r["label"]] += 1
        return {"signers": counts}


