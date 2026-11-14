"""Reply suggestions: Gemini when a key is set, simple rules otherwise.

Every suggestion passes through guards.check_suggestion before the user sees it.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time

import httpx

from . import guards

log = logging.getLogger("ai")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_S = 4.0

# Short inputs that never need a model: answered instantly and exactly.
FIXED = {
    "yes": "Yes.",
    "no": "No.",
    "repeat": "Could you repeat that, please?",
    "wait": "One moment, please.",
    "thanks": "Thank you!",
    "thank you": "Thank you!",
    "hello": "Hello!",
    "bye": "Thank you, goodbye!",
    "slow": "Could you speak a little more slowly, please?",
    "help": "Sorry, I need a moment. Could you bear with me?",
}


def model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def has_key() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _is_question(t: str) -> bool:
    t = t.strip().lower()
    return t.endswith("?") or bool(re.match(r"^(are|is|do|does|did|can|could|will|would|should|have|has)\b", t))


def rules(caller_text: str, hint: str) -> list[str]:
    h = hint.strip().lower()
    if h in FIXED:
        return [FIXED[h]]
    if h:
        # Without a model, keep the user's own words, just tidied.
        s = hint.strip()
        s = s[0].upper() + s[1:]
        return [s if s[-1] in ".?!" else s + "."]
    if _is_question(caller_text):
        return ["Yes.", "No.", "Could you repeat that, please?"]
    return ["Okay.", "Thank you!", "Could you repeat that, please?"]


PROMPT = """You help a Deaf or nonspeaking person reply during a live phone call. They read captions
and answer by typing a few words or tapping. You turn their few words into a short, natural spoken reply.

Strict rules:
- Keep their meaning exactly. If they said no, the reply says no. If they hedged, keep the hedge.
- Never add a number, time, day, price, name or address that is not in their words or in what the caller said.
- Never agree to pay, order, book or sign up unless their words clearly say so.
- 1 or 2 short sentences, casual-polite, first person, as if speaking on the phone.
- If their words are empty, offer 3 different likely replies to the caller's last line.
- If their meaning is unclear, offer up to 3 different readings instead of guessing one.

Recent call (oldest first):
{history}

Caller just said: "{caller}"
User's words: "{hint}"

Answer with JSON only: {{"replies": ["...", "..."]}}"""


async def gemini(caller_text: str, hint: str, history: list[str]) -> list[str]:
    body = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT.format(
            history="\n".join(history[-8:]) or "(none)", caller=caller_text, hint=hint)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
        r = await c.post(GEMINI_URL.format(model=model()), json=body,
                         headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    r.raise_for_status()
    text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    replies = json.loads(text).get("replies", [])
    return [str(x) for x in replies if isinstance(x, str)][:3]


async def suggest(caller_text: str, hint: str, history: list[str]) -> dict:
    """Returns {"replies": [...], "source": "fixed|gemini|rules", "dropped": [...], "ms": int}."""
    t0 = time.perf_counter()
    h = hint.strip().lower()
    if h in FIXED:
        return {"replies": [FIXED[h]], "source": "fixed", "dropped": [], "ms": 0}
    source, raw = "rules", None
    if has_key():
        try:
            raw = await gemini(caller_text, hint, history)
            source = "gemini"
        except Exception as e:  # timeout, quota, bad JSON: fall back, never block the call
            log.warning("gemini failed, using rules: %s", e)
    if not raw:
        raw, source = rules(caller_text, hint), "rules"
    ok, dropped = [], []
    for s in raw:
        why = guards.check_suggestion(s, user_input=hint, context=[caller_text, *history[-8:]])
        (dropped if why else ok).append(s if not why else {"text": s, "why": why})
    if not ok:  # everything was unsafe: offer the user's own words instead
        ok = rules(caller_text, hint)
        source += "+rules"
    return {"replies": ok, "source": source, "dropped": dropped,
            "ms": int((time.perf_counter() - t0) * 1000)}


async def check_model() -> dict:
    """Health: does the configured model answer?"""
    if not has_key():
        return {"configured": False}
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.get(f"https://generativelanguage.googleapis.com/v1beta/models/{model()}",
                            headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        return {"configured": True, "model": model(), "ok": r.status_code == 200, "status": r.status_code}
    except Exception as e:
        return {"configured": True, "model": model(), "ok": False, "error": type(e).__name__}


