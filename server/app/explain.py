"""Point and explain: one camera frame -> what is being shown, with labelled boxes for tooltips.

The signer holds something up (or points their camera at it) during a meeting or call and taps Explain.
Gemini finds the thing and its important parts; the extension draws the labels as callouts into the
outgoing camera video, so everyone in the meeting sees them. Only that one still frame is sent.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .config import settings
from .latency import latency
from .show import _box

log = logging.getLogger("explain")
router = APIRouter()

PROMPT = """A Deaf person in a video meeting is showing this to the other people and wants to explain it.
Find the main thing being shown and up to {n} of its most important parts or details someone should notice.
For each item give:
- "label": 1-4 words, plain (what it is)
- "note": at most 12 words: why it matters or what is happening there, only what is visible
- "box_2d": [ymin, xmin, ymax, xmax] normalized 0-1000, tight around it
Also "summary": one short sentence the person could say about it, first person ("This is ...").
Only describe what is visible. Never guess brands, prices, names or numbers you cannot read.
{q}Return JSON only."""


class Item(BaseModel):
    label: str
    note: str = ""
    box_2d: Optional[list[float]] = None


class Explained(BaseModel):
    summary: str = ""
    items: list[Item] = []


class ExplainIn(BaseModel):
    image: str                       # JPEG/PNG as base64 (optionally a data: URL)
    question: str = ""               # optional: "what's wrong with this?", "point at the error"
    max_items: int = 4


async def _gemini(img: bytes, mime: str, prompt: str) -> Explained:
    from google import genai
    from google.genai import types

    global _client
    _client = _client or genai.Client(api_key=settings.gemini_api_key)   # one client: keeps the connection warm
    client = _client
    last: Exception | None = None
    # Measured 2026-11-14 on a test diagram: flash-lite + minimal thinking 1.3 s with the same box accuracy as
    # gemini-3.8-flash (3.8 s at LOW thinking, 12 s default). Fast model first; the bigger one is the fallback.
    import os
    plan = [(os.getenv("EXPLAIN_MODEL", settings.gemini_model), "MINIMAL"), (settings.gemini_video_model, "LOW")]
    for model, think in plan:
        cfg = dict(response_mime_type="application/json", response_schema=Explained, temperature=0.2)
        if think:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_level=think)
        try:
            resp = await asyncio.wait_for(client.aio.models.generate_content(
                model=model, contents=[types.Part.from_bytes(data=img, mime_type=mime), prompt],
                config=types.GenerateContentConfig(**cfg)), timeout=8)
            parsed = resp.parsed
            return parsed if isinstance(parsed, Explained) else Explained.model_validate_json(resp.text)
        except Exception as e:  # noqa: BLE001
            last = e
            log.warning("explain with %s failed: %s", model, e)
    raise last or RuntimeError("no model")


def _overlap(a: list[int], b: list[int]) -> float:
    """Intersection over union: near 1.0 only for (almost) the same box. A part inside a bigger whole
    (a light on a router) scores low, so both are kept."""
    y0, x0 = max(a[0], b[0]), max(a[1], b[1])
    y1, x1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, y1 - y0) * max(0, x1 - x0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0


engine = _gemini      # tests replace this
_client = None


async def warm_up() -> None:
    """The first Gemini image call after start-up measured ~23 s vs ~3 s warm. Pay that cost at boot."""
    if not settings.gemini_ready:
        return
    try:
        tiny = base64.b64decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDrKKKKACiiigAooooAKKKKAP/Z")   # 32x32 grey JPEG
        t0 = time.perf_counter()
        await engine(tiny, "image/jpeg", PROMPT.format(n=1, q=""))
        log.info("explain warm-up %.0f ms", (time.perf_counter() - t0) * 1000)
    except Exception as e:  # noqa: BLE001
        log.info("explain warm-up skipped: %s", e)


@router.post("/api/explain-frame")
async def explain_frame(body: ExplainIn) -> dict:
    if not settings.gemini_ready:
        raise HTTPException(503, "Explain needs the Gemini key on the server.")
    data = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
    mime = "image/png" if body.image.startswith("data:image/png") else "image/jpeg"
    try:
        img = base64.b64decode(data, validate=True)
    except Exception:
        raise HTTPException(400, "That image couldn't be read.")
    if len(img) > 4_000_000:
        raise HTTPException(413, "That image is too large.")
    n = max(1, min(6, body.max_items))
    q = f"They asked: {body.question.strip()[:200]!r}. Focus on that.\n" if body.question.strip() else ""
    t0 = time.perf_counter()
    try:
        r = await engine(img, mime, PROMPT.format(n=n, q=q))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, "Couldn't explain that right now. Try again.") from e
    ms = (time.perf_counter() - t0) * 1000
    latency.record("explain_ms", ms)
    items = []
    for it in r.items:
        b = _box(it.box_2d)
        if not b or not it.label.strip():
            continue
        # The model sometimes names the same thing twice ("NET light", "NET red indicator"): keep the first.
        if any(_overlap(b, other["box"]) > 0.5 for other in items):
            continue
        items.append({"label": it.label.strip()[:40], "note": it.note.strip()[:90], "box": b})
        if len(items) == n:
            break
    return {"summary": r.summary.strip()[:200], "items": items, "ms": round(ms)}
