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

from .models import MODEL_DIR, Guess, IslrModel, SignBartModel
from .personal import PersonalSigns

log = logging.getLogger("signs")

UNSURE_P = float(os.environ.get("SIGN_UNSURE_P", "0.45"))       # tune on held-out data (eval/sign_eval.py)
UNSURE_MARGIN = float(os.environ.get("SIGN_UNSURE_MARGIN", "0.15"))
# Below this the segment is noise (hands settling, a scratch), not a sign: say nothing.
# Real-signer pipeline check: spurious segments scored 0.11-0.29, real signs 0.43+.
NOISE_P = float(os.environ.get("SIGN_NOISE_P", "0.3"))
BOOST = 1.6
# Personal signs (taught by this signer). Calibrated in eval/conversation50.md on real clips
# taught by one person and signed by others (harder than the same signer):
# >= 0.70: 29% of taught signs fire, 2% wrong, 0.8% of untaught signs fire by mistake.
# >= 0.55: offered as an option next to the model's guess, never said without a tap.
PERSONAL_SURE = float(os.environ.get("PERSONAL_SURE", "0.70"))
PERSONAL_MAYBE = float(os.environ.get("PERSONAL_MAYBE", "0.55"))
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
        self.islr: Optional[IslrModel] = None
        self.error = ""
        self.active: list[str] = []
        self.conversation: list[str] = []
        self._lock = threading.Lock()
        self.personal = PersonalSigns(os.path.join(DATA_DIR, "personal.json"))
        try:
            self.model = SignBartModel()
            vocab = json.load(open(os.path.join(MODEL_DIR, "vocab.json")))
            self.active = list(vocab["active"])
            self.conversation = list(vocab.get("conversation", []))
            # Primary engine: Google ISLR (Kaggle 1st place), trained on MediaPipe Holistic landmarks
            # from Deaf signers' own phone/webcam videos. SIGN_ENGINE=signbart switches back.
            if os.environ.get("SIGN_ENGINE", "islr") == "islr" and vocab.get("islr_conversation"):
                try:
                    self.islr = IslrModel()
                    self.conversation = list(vocab["islr_conversation"])
                    self.active = list(self.conversation)
                    log.info("ISLR engine ready: %d signs", len(self.active))
                except Exception as e:
                    log.warning("ISLR not loaded, using SignBart: %s", e)
            log.info("sign model ready: %s, %d active signs", self.model.name, len(self.active))
        except Exception as e:  # the call still works by typing
            self.error = f"sign model not loaded: {e}"
            log.warning(self.error)

    @property
    def ready(self) -> bool:
        return self.model is not None

    def config(self) -> dict:
        return {"ready": self.ready, "model": (self.islr or self.model).name if self.ready else None, "vocab": self.active,
                "conversation": self.conversation, "personal": self.personal.labels(), "error": self.error}

    def classify(self, frames: list[dict], hand: str = "right", options: Optional[list[str]] = None) -> dict:
        if not self.model:
            return {"ok": False, "reason": "Signing isn't available right now. You can type instead."}
        if len(frames) < 4:
            return {"ok": False, "reason": "too short"}
        allowed = set(self.active) or None
        t0 = time.perf_counter()
        with self._lock:
            variants = []   # (guesses, logits, frames, hand)
            if hand in ("right", "auto"):
                lg = self.model.logits(frames)
                variants.append((self.model.from_logits(lg, k=5, allowed=allowed), lg, frames, "right"))
            if hand in ("left", "auto"):
                sw = _swap(frames)
                lg = self.model.logits(sw)
                variants.append((self.model.from_logits(lg, k=5, allowed=allowed), lg, frames, "left"))
        best = max(variants, key=lambda v: v[0][0].p)
        if self.islr:
            # ISLR decides. SignBart's logits stay as the descriptor for the signer's own taught signs.
            with self._lock:
                ig = self.islr.predict(frames, k=5, allowed=allowed)
            best = (ig,) + best[1:]
        personal = self.personal.score(best[2], best[3], best[1])
        guesses = best[0]
        boost = option_glosses(options or []) & (allowed or set())
        if boost:
            guesses = [Guess(g.sign, g.p * (BOOST if g.sign in boost else 1.0)) for g in guesses]
            z = sum(g.p for g in guesses) or 1.0
            guesses = sorted((Guess(g.sign, g.p / z) for g in guesses), key=lambda g: -g.p)
        ms = (time.perf_counter() - t0) * 1000
        top, second = guesses[0], guesses[1] if len(guesses) > 1 else Guess("", 0.0)
        unsure = top.p < UNSURE_P or (top.p - second.p) < UNSURE_MARGIN
        source = "model"
        if personal:
            pl, ps = personal[0]
            p2 = personal[1][1] if len(personal) > 1 else 0.0
            if ps >= PERSONAL_SURE and ps - p2 >= 0.03:
                if pl != top.sign:
                    second, top = top, Guess(pl, ps)
                unsure, source = False, "personal"
            elif ps >= PERSONAL_MAYBE and pl != top.sign and (unsure or ps >= PERSONAL_SURE):
                second, top, unsure, source = top, Guess(pl, ps), True, "personal"
            elif ps >= PERSONAL_MAYBE and pl == top.sign:
                unsure = False                 # the signer's own examples agree with the model
        if source == "model" and top.p < NOISE_P:
            return {"ok": False, "reason": "unclear", "ms": round(ms, 1), "_p": [round(g.p, 3) for g in guesses[:3]],
                    "_top": [g.sign for g in guesses[:3]]}
        return {"ok": True, "source": source, "sign": top.sign, "unsure": unsure,
                "options": [top.sign, second.sign] if unsure and second.sign else [top.sign],
                "ms": round(ms, 1), "_p": [round(g.p, 3) for g in guesses[:3]], "_top": [g.sign for g in guesses[:3]]}

    # ------------------------------------------------------------ personal signs (taught by the signer)

    def teach(self, label: str, frames: list[dict], hand: str = "right") -> dict:
        if len(frames) < 4:
            return {"ok": False, "reason": "That was too short. Sign it once, then lower your hands."}
        if not label.strip():
            return {"ok": False, "reason": "Type the word first."}
        logits = None
        if self.model:
            with self._lock:
                logits = self.model.logits(_swap(frames) if hand == "left" else frames)
        r = self.personal.add(label, frames, "left" if hand == "left" else "right", logits)
        # How well the examples agree with each other, so the app can say "sign it once more".
        if r["count"] >= 2:
            others = [e for e in self.personal.examples if e["label"] == r["label"] and e["id"] != r["id"]]
            mine = self.personal.examples[-1]
            sims = [float(o["s"] @ mine["s"]) for o in others]
            r["consistency"] = round(max(sims), 2)
        return r

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


