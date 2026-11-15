"""Show it: a phone video becomes an evidence-linked, scrubbable record of what it shows.

Someone who can't easily describe a problem out loud (a leak, a warning light, a damaged parcel)
films it. Gemini watches it in passes, the way the team's Process-Annotation engine does:

1. Overview (whole clip): sections that cover it end to end, the key facts, a summary to open
   the call with. Each fact has WHEN (seconds) and WHERE (box, 0-1000: [ymin, xmin, ymax, xmax]).
2. Section transcripts (one clip per section, higher fps, in parallel): everything that happens,
   every bit of text on screen copied exactly, anything said, notable sounds, each line timed.
3. Precision pass (a 3 s window at high fps around each fact, in parallel): tightens the moment
   and the box. Kept only when the answer falls inside its window.
Later, "ask the video": a question from the call is answered only from the clip, with its frame.

The app plays the clip with the boxes as tooltips and a section rail with a live transcript, so
the user can slide to any part and check every fact against what the camera saw. Nothing is said
without approval; video facts become allowed sources for the guards and nothing else.

Gemini only (long video, timestamps, boxes, audio in one model). Without GEMINI_API_KEY the
feature says so; the product has no fake engine. Clips go to Google for analysis, stay on our
server for SHOW_TTL_HOURS so they can be replayed and shared, then are deleted.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .config import settings
from .latency import latency

log = logging.getLogger("show")

Kind = Literal["problem", "reading", "label", "object", "action", "answer", "other"]
LineKind = Literal["action", "speech", "text", "sound"]


class VideoFact(BaseModel):
    id: str = ""
    say: str = Field(description="one short spoken sentence stating only this fact, first person")
    label: str = Field(default="", description="2-5 word tooltip")
    kind: Kind = "other"
    t: float = 0.0
    t_end: float = 0.0
    box: Optional[list[int]] = None
    sure: bool = True
    refined: bool = False


class Section(BaseModel):
    id: str = ""
    start: float = 0.0
    end: float = 0.0
    title: str = ""
    summary: str = ""
    lines: list[dict] = Field(default_factory=list)


class ShowResult(BaseModel):
    summary_say: str = ""
    facts: list[VideoFact] = Field(default_factory=list)
    sections: list[Section] = Field(default_factory=list)
    notes: str = ""


class TranscriptLine(BaseModel):
    t: float = 0.0
    text: str = ""
    kind: LineKind = "action"


class Transcript(BaseModel):
    lines: list[TranscriptLine] = Field(default_factory=list)


class Refined(BaseModel):
    t: Optional[float] = None
    box: Optional[list[int]] = None


class Answer(BaseModel):
    found: bool = False
    say: str = ""
    label: str = ""
    t: Optional[float] = None
    box: Optional[list[int]] = None


# ------------------------------------------------------------------ prompts

OVERVIEW_PROMPT = """You are helping a Deaf or nonspeaking person explain something on a phone call. They
filmed it instead of describing it. Watch the whole clip ({DURATION} s) and produce:

1. `sections`: 2-8 sections that cover the clip end to end, in order, no gaps, no overlaps. Each:
   `start`, `end` (seconds, one decimal), a 2-6 word `title`, and a one-sentence `summary`.
2. `facts`: what a helpful person on the phone (landlord, mechanic, store, support desk) needs to
   know. At most 10, in the order they appear, the problem first. Each fact:
   - `say`: a short, natural first-person sentence the user could approve and have spoken,
     e.g. "The dishwasher leaks from the front-left corner of the door."
   - `label`: a 2-5 word tooltip, e.g. "Drip starts here"
   - `kind`: problem | reading | label | object | action | other
   - `t` when first clearly visible and `t_end` when it stops being visible (seconds, one decimal)
   - `box`: [ymin, xmin, ymax, xmax] normalized to 0-1000, where it is in the frame at `t`;
     null when it isn't one place (e.g. "it happens every few seconds")
   - `sure`: false if blurry, partly hidden or uncertain
3. `summary_say`: one or two sentences to open the call, using only the facts you listed.
4. `notes`: anything you couldn't see or read clearly.

Rules: only state what is visible, readable or audible. Copy text, codes, numbers and labels
exactly, digits as digits. Never guess a model number, price, date or name.
Return JSON only: {"sections": [...], "facts": [...], "summary_say": str, "notes": str}"""

SECTION_PROMPT = """This clip is section {N} of a phone video, "{TITLE}", from {START} s to {END} s of
the full video ({LEN} s long). Transcribe EVERYTHING in it, in order, as short lines:
- kind "action": what happens or changes (what moves, drips, blinks, opens, breaks; what the
  camera is showing). Name things by what they look like if you don't know the name.
- kind "text": any text, numbers, codes or labels on screen, copied exactly.
- kind "speech": anything anyone says, word for word.
- kind "sound": notable sounds (dripping, beeping, grinding, clicking).
Ignore camera shake; don't repeat a line just because the view moved. Only describe what is there.
For each line give "t": seconds from the START of this clip (one decimal).
Return JSON only: {"lines": [{"t": 0.0, "kind": "action", "text": "..."}]}"""

REFINE_PROMPT = """This {LEN} s clip is a close-up in time around one moment of a phone video:
"{SAY}". Find when it first becomes clearly visible in this clip.
Give "t": seconds FROM THE START OF THIS CLIP (0.1 s precision), or null if it isn't in this clip,
and "box": [ymin, xmin, ymax, xmax] normalized to 0-1000 where it is at that moment, or null.
Return JSON only: {"t": 1.4, "box": [500, 100, 700, 300]}"""

ASK_PROMPT = """Someone on a phone call asked: {Q}
Answer only from what this video shows, reads or sounds like. If the video doesn't clearly show the
answer, set "found": false and leave the rest empty. Otherwise:
- "say": one short, natural first-person sentence answering it, e.g. "The light is blinking orange."
- "label": a 2-5 word tooltip; "t": seconds when the answer is visible (one decimal);
- "box": [ymin, xmin, ymax, xmax] normalized to 0-1000, or null if it isn't one place.
Copy any text or numbers exactly. Never guess.
Return JSON only: {"found": true, "say": "...", "label": "...", "t": 3.2, "box": [..]}"""


# ------------------------------------------------------------------ normalizing model output

def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _box(b: Optional[list]) -> Optional[list[int]]:
    if not b or len(b) != 4:
        return None
    try:
        y0, x0, y1, x1 = [max(0, min(1000, int(round(float(v))))) for v in b]
    except (TypeError, ValueError):
        return None
    return [y0, x0, y1, x1] if y1 > y0 and x1 > x0 else None


def normalize(raw: ShowResult, duration: float) -> ShowResult:
    """Make model output safe to draw and to speak: clamp times and boxes, drop empty facts,
    give stable ids, sections that tile the clip, a summary built only from facts."""
    dur = duration if duration and duration > 0 else None
    out: list[VideoFact] = []
    for f in raw.facts[:12]:
        say = _clean(f.say)
        if not say:
            continue
        t = max(0.0, float(f.t or 0.0))
        if dur is not None:
            t = min(t, dur)
        t_end = max(t + 0.5, float(f.t_end or 0.0))
        if dur is not None:
            t_end = min(max(t_end, t), dur)
        label = _clean(f.label) or " ".join(say.rstrip(".").split()[:4])
        out.append(VideoFact(id=f"v{len(out) + 1}", say=say[:240], label=label[:48], kind=f.kind,
                             t=round(t, 1), t_end=round(t_end, 1), box=_box(f.box), sure=bool(f.sure),
                             refined=bool(f.refined)))
    summary = _clean(raw.summary_say)
    if not summary and out:
        summary = " ".join(f.say for f in out[:2])
    return ShowResult(summary_say=summary[:400], facts=out, sections=normalize_sections(raw.sections, duration),
                      notes=_clean(raw.notes)[:400])


def normalize_sections(sections: list[Section], duration: float) -> list[Section]:
    """Sorted, clamped, non-overlapping sections; one 'Whole clip' section when the model gave none."""
    end_all = duration if duration and duration > 0 else max([s.end for s in sections] + [0.0])
    good = sorted((s for s in sections if s.end > s.start), key=lambda s: s.start)
    out: list[Section] = []
    for s in good[:8]:
        start = max(0.0, s.start, out[-1].end if out else 0.0)
        end = min(s.end, end_all) if end_all else s.end
        if end - start < 0.3:
            continue
        out.append(Section(id=f"s{len(out) + 1}", start=round(start, 1), end=round(end, 1),
                           title=_clean(s.title)[:60] or f"Part {len(out) + 1}", summary=_clean(s.summary)[:240],
                           lines=list(s.lines)))
    if not out and end_all:
        out = [Section(id="s1", start=0.0, end=round(end_all, 1), title="Whole clip")]
    return out


def normalize_lines(lines: list[TranscriptLine], start: float, end: float) -> list[dict]:
    """Absolute-time lines inside the section. Accepts clip-relative or absolute times (models do both)."""
    length = end - start
    ts = [ln.t for ln in lines]
    absolute = bool(ts) and start > length + 1 and all(start - 0.5 <= t <= end + 0.5 for t in ts)
    out = []
    for ln in lines:
        text = _clean(ln.text)
        if not text:
            continue
        t = ln.t if absolute else start + ln.t
        out.append({"t": round(min(max(t, start), end), 1), "kind": ln.kind, "text": text[:300]})
    out.sort(key=lambda x: x["t"])
    return out[:80]


def apply_refined(fact: dict, r: Optional[Refined], a: float, b: float) -> bool:
    """Accept a precision-pass answer only if it lands inside its window. Clip-relative or absolute."""
    if r is None or r.t is None:
        return False
    v = float(r.t)
    if a - 0.5 <= v <= b + 0.5 and v > (b - a) + 1:      # answered in video time
        t = v
    elif 0 <= v <= (b - a) + 0.2:
        t = a + v
    else:
        return False
    fact["t"] = round(t, 1)
    fact["t_end"] = round(max(fact.get("t_end", t), t + 0.5), 1)
    nb = _box(r.box)
    if nb:
        fact["box"] = nb
    fact["refined"] = True
    return True


def _extract_json(text: str) -> Any:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-z]*\s*|\s*```$", "", t)
    a, b = t.find("{"), t.rfind("}")
    return json.loads(t[a:b + 1] if a >= 0 and b > a else t)


# ------------------------------------------------------------------ Gemini engine

class GeminiVideo:
    """Upload once per job (Files API), then targeted passes with clip offsets and fps."""

    name = "gemini"
    INLINE_MAX = 18 * 1024 * 1024

    def __init__(self) -> None:
        from google import genai
        from google.genai import types

        self.types = types
        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.model = settings.gemini_video_model

    # -- media
    def prepare(self, data: bytes, mime: str, path: Path) -> dict:
        if len(data) <= self.INLINE_MAX:
            return {"inline": data, "mime": mime}
        f = self.client.files.upload(file=str(path))
        deadline = time.monotonic() + 300
        while str(getattr(f, "state", "")).upper().endswith("PROCESSING"):
            if time.monotonic() > deadline:
                raise RuntimeError("Gemini took too long to process the video.")
            time.sleep(2)
            f = self.client.files.get(name=f.name)
        if not str(getattr(f, "state", "")).upper().endswith("ACTIVE"):
            raise RuntimeError("Gemini couldn't process that video.")
        return {"file": f, "mime": mime}

    def release(self, h: dict) -> None:
        f = h.get("file")
        if f is not None:
            try:
                self.client.files.delete(name=f.name)
            except Exception:
                log.warning("show: couldn't delete the uploaded file from Gemini")

    def _part(self, h: dict, fps: float, a: Optional[float] = None, b: Optional[float] = None):
        t = self.types
        meta = {"fps": fps}
        if a is not None and b is not None:
            meta.update(start_offset=f"{a:.2f}s", end_offset=f"{b:.2f}s")
        vm = t.VideoMetadata(**meta)
        if "inline" in h:
            return t.Part(inline_data=t.Blob(data=h["inline"], mime_type=h["mime"]), video_metadata=vm)
        f = h["file"]
        return t.Part(file_data=t.FileData(file_uri=f.uri, mime_type=h["mime"]), video_metadata=vm)

    def _json(self, parts: list, cls: type[BaseModel], what: str):
        cfg = self.types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1)
        last: Exception | None = None
        for _ in range(2):
            t0 = time.perf_counter()
            resp = self.client.models.generate_content(model=self.model, contents=parts, config=cfg)
            latency.record(f"show_{what}_ms", (time.perf_counter() - t0) * 1000)
            try:
                return cls.model_validate(_extract_json(resp.text or ""))
            except (ValueError, ValidationError) as e:
                last = e
                log.warning("show %s: malformed output, retrying: %s", what, str(e)[:200])
        raise RuntimeError(f"The model returned malformed {what} results twice: {last}")

    # -- passes
    def overview(self, h: dict, duration: float, context: str) -> ShowResult:
        prompt = OVERVIEW_PROMPT.replace("{DURATION}", f"{duration:.1f}")
        if context.strip():
            prompt += f"\nWhat the call is about (from the user): {context[:300]!r}"
        return self._json([self._part(h, settings.show_fps), prompt], ShowResult, "overview")

    def transcribe(self, h: dict, sec: dict, n: int) -> list[TranscriptLine]:
        a, b = sec["start"], sec["end"]
        prompt = (SECTION_PROMPT.replace("{N}", str(n)).replace("{TITLE}", sec["title"])
                  .replace("{START}", f"{a:.1f}").replace("{END}", f"{b:.1f}").replace("{LEN}", f"{b - a:.1f}"))
        return self._json([self._part(h, settings.show_section_fps, a, b), prompt], Transcript, "section").lines

    def refine(self, h: dict, fact: dict, a: float, b: float) -> Refined:
        prompt = REFINE_PROMPT.replace("{LEN}", f"{b - a:.1f}").replace("{SAY}", fact["say"])
        return self._json([self._part(h, settings.show_refine_fps, a, b), prompt], Refined, "refine")

    def ask(self, h: dict, question: str) -> Answer:
        return self._json([self._part(h, settings.show_fps), ASK_PROMPT.replace("{Q}", repr(question[:300]))],
                          Answer, "ask")


def make_video_engine():
    return GeminiVideo() if settings.gemini_ready else None


# ------------------------------------------------------------------ the job

Progress = Callable[[str], None]


def run_passes(engine, h: dict, duration: float, context: str, progress: Progress) -> dict:
    """Overview, then section transcripts and the precision pass in parallel. One failed section or
    fact keeps its coarse result; only a failed overview fails the job. Engine-agnostic (tests use a
    scripted engine with the same methods)."""
    progress("Watching the whole clip")
    res = normalize(engine.overview(h, duration, context), duration)
    sections = [s.model_dump() for s in res.sections]
    facts = [f.model_dump() for f in res.facts]
    jobs: list[tuple[str, Any]] = [("section", (i, s)) for i, s in enumerate(sections)]
    half = settings.show_refine_window / 2
    for f in facts:
        a, b = max(0.0, f["t"] - half), (min(duration, f["t"] + half) if duration else f["t"] + half)
        if b - a >= 0.5:
            jobs.append(("refine", (f, a, b)))
    total = len(jobs)
    n_sec = len(sections)
    done = refined = 0
    progress(f"Transcribing {n_sec} section{'s' if n_sec != 1 else ''} and checking {total - n_sec} moments")

    def one(kind: str, arg):
        if kind == "section":
            i, s = arg
            return kind, arg, engine.transcribe(h, s, i + 1)
        f, a, b = arg
        return kind, arg, engine.refine(h, f, a, b)

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one, k, a) for k, a in jobs]
        for fut in as_completed(futs):
            try:
                kind, arg, out = fut.result()
                if kind == "section":
                    i, s = arg
                    s["lines"] = normalize_lines(out, s["start"], s["end"])
                else:
                    f, a, b = arg
                    refined += apply_refined(f, out, a, b)
            except Exception as e:
                log.warning("show pass failed (kept the coarse result): %s", str(e)[:200])
            done += 1
            progress(f"Transcribing and checking ({done} of {total})")
    facts.sort(key=lambda f: f["t"])
    return {"summary_say": res.summary_say, "facts": facts, "sections": sections, "notes": res.notes,
            "refined": refined}


async def run_job(engine, store: "ShowStore", sid: str, data: bytes, mime: str, path: Path,
                  duration: float, context: str) -> None:
    """Background job: updates the stored record with progress, then the result (or the failure)."""
    t0 = time.perf_counter()
    rec = store.load(sid)

    def progress(msg: str) -> None:
        rec["progress"] = msg
        try:
            store.save(sid, rec)
        except Exception:
            pass

    def work() -> dict:
        h = engine.prepare(data, mime, path)
        try:
            return run_passes(engine, h, duration, context, progress)
        finally:
            engine.release(h)

    try:
        out = await asyncio.wait_for(asyncio.to_thread(work), timeout=settings.show_timeout_s)
        rec.update(out, status="done", progress="", seconds=round(time.perf_counter() - t0, 1))
    except Exception as e:
        log.warning("show job failed: %s", str(e)[:300])
        rec.update(status="failed", progress="",
                   error="Couldn't read that video. Try again, or film a little closer and steadier.")
    finally:
        latency.record("show_job_ms", (time.perf_counter() - t0) * 1000)
        try:
            store.save(sid, rec)
        except KeyError:
            pass                                     # deleted while it was running


async def ask_video(engine, store: "ShowStore", sid: str, question: str) -> Optional[dict]:
    """Answer one question from the stored clip. Returns a new fact (kind 'answer') or None."""
    rec = store.load(sid)
    path = store.video(sid)
    data = path.read_bytes()

    def work() -> Answer:
        h = engine.prepare(data, rec.get("mime", "video/mp4"), path)
        try:
            return engine.ask(h, question)
        finally:
            engine.release(h)

    ans = await asyncio.wait_for(asyncio.to_thread(work), timeout=settings.show_timeout_s)
    say = _clean(ans.say)
    if not ans.found or not say:
        return None
    dur = rec.get("duration") or 0
    t = max(0.0, float(ans.t or 0.0))
    if dur:
        t = min(t, dur)
    fact = VideoFact(id=f"a{len([f for f in rec.get('facts', []) if f['id'].startswith('a')]) + 1}",
                     say=say[:240], label=(_clean(ans.label) or "Answer")[:48], kind="answer",
                     t=round(t, 1), t_end=round(min(t + 2.0, dur) if dur else t + 2.0, 1),
                     box=_box(ans.box), sure=True).model_dump()
    fact["question"] = question[:300]
    rec.setdefault("facts", []).append(fact)
    store.save(sid, rec)
    return fact


# ------------------------------------------------------------------ storage

class ShowStore:
    """Clips and their records on disk, deleted after SHOW_TTL_HOURS. Ids are unguessable; the
    share token is a separate secret that only grants read access to one clip."""

    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir(self, sid: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", sid or ""):
            raise KeyError(sid)
        return self.root / sid

    def new(self, data: bytes, ext: str) -> tuple[str, Path]:
        self.cleanup()
        sid = secrets.token_urlsafe(12)
        d = self._dir(sid)
        d.mkdir()
        p = d / f"clip.{ext}"
        p.write_bytes(data)
        return sid, p

    def save(self, sid: str, record: dict) -> None:
        d = self._dir(sid)
        if not d.exists():
            raise KeyError(sid)
        tmp = d / "show.json.tmp"
        tmp.write_text(json.dumps(record), encoding="utf-8")
        tmp.replace(d / "show.json")

    def load(self, sid: str) -> dict:
        p = self._dir(sid) / "show.json"
        if not p.exists():
            raise KeyError(sid)
        return json.loads(p.read_text(encoding="utf-8"))

    def by_share(self, token: str) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", token or ""):
            raise KeyError(token)
        for d in self.root.iterdir():
            p = d / "show.json"
            if p.exists():
                r = json.loads(p.read_text(encoding="utf-8"))
                if r.get("share") and secrets.compare_digest(r.get("share_token", ""), token):
                    return r
        raise KeyError(token)

    def video(self, sid: str) -> Path:
        clips = list(self._dir(sid).glob("clip.*"))
        if not clips:
            raise KeyError(sid)
        return clips[0]

    def delete(self, sid: str) -> None:
        d = self._dir(sid)
        for p in d.glob("*"):
            p.unlink(missing_ok=True)
        d.rmdir()

    def cleanup(self) -> None:
        cutoff = time.time() - settings.show_ttl_hours * 3600
        for d in self.root.iterdir():
            if d.is_dir() and d.stat().st_mtime < cutoff:
                for p in d.glob("*"):
                    p.unlink(missing_ok=True)
                d.rmdir()


VIDEO_TYPES = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp",
               "video/x-matroska": "mkv"}

_PUBLIC = ("id", "share", "share_token", "created", "duration", "title", "context", "mime", "status", "progress",
           "error", "summary_say", "facts", "sections", "notes", "refined", "seconds")


def public_record(r: dict) -> dict:
    """What the user's own app gets."""
    return {k: r[k] for k in _PUBLIC if k in r}


def shared_record(r: dict) -> dict:
    """What the other person sees through a share link: the clip, facts and timeline, nothing about the call."""
    return {k: r.get(k) for k in ("id", "facts", "sections", "summary_say", "duration", "created", "title")}


