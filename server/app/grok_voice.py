"""Optional Grok (xAI) realtime voice engine: Twilio Media Streams <-> xAI Realtime API.

Off by default. VOICE_ENGINE=grok and XAI_API_KEY turn it on (see grok_enabled()).

    Twilio call --<Connect><Stream>--> /ws/grok-media/{sid} --> wss://api.x.ai/v1/realtime
    caller audio (G.711 u-law 8 kHz, base64) is forwarded as-is; Grok's audio comes back as-is.

Grok never answers for the signer. Whenever the caller asks something it calls the tool
get_reply(question); we show the question in the signer app and wait for deliver_reply().
Replies with facts in them (numbers, times, prices, bookings) are spoken word for word with
xAI's `force_message` item, so the model can't reword them.

Protocol names checked on 2026-11-14 against:
  https://docs.x.ai/developers/rest-api-reference/inference/voice.md   (event list)
  https://docs.x.ai/voice-realtime.ws.json                              (event schemas)
  https://docs.x.ai/developers/model-capabilities/audio/voice-agent    (session.update, force_message)
  github.com/xai-org/xai-cookbook examples/voice-agent-phone/xai/src/index.ts (Twilio bridge)
Lines marked UNVERIFIED are guesses the docs don't settle. Never run against the live API yet.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from twilio.twiml.voice_response import Connect, VoiceResponse

from .config import settings
from .latency import latency

log = logging.getLogger("grok_voice")

router = APIRouter()

# ---------------------------------------------------------------- settings (env, read at call time)

XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def voice_engine() -> str:
    return _env("VOICE_ENGINE", "relay").lower()


def grok_enabled() -> bool:
    return voice_engine() == "grok" and bool(_env("XAI_API_KEY"))


def grok_model() -> str:
    return _env("GROK_VOICE_MODEL", "grok-voice-latest")


def grok_voice() -> str:
    return _env("GROK_VOICE", "eve")


def realtime_url() -> str:
    # GROK_REALTIME_URL only exists so tests can point at a fake server.
    base = _env("GROK_REALTIME_URL", XAI_REALTIME_URL)
    return f"{base}?model={grok_model()}"


REPLY_TIMEOUT_S = float(_env("GROK_REPLY_TIMEOUT_S", "45"))
IDLE_WAIT_MAX_S = 10.0           # never stall a reply more than this waiting for playback marks
PRE_SESSION_BUFFER = 150         # ~3 s of 20 ms Twilio frames held until session.updated

# ---------------------------------------------------------------- wiring from main.py

Emit = Callable[[dict], Awaitable[Any]]
GetContext = Callable[[str], Optional[dict]]

_get_context: GetContext = lambda sid: None
_emit: Optional[Emit] = None
bridges: dict[str, "GrokBridge"] = {}


def configure(get_context: GetContext, emit: Emit) -> None:
    """main.py calls this once at startup. get_context(sid) -> {name, knows_sign, kind} or None."""
    global _get_context, _emit
    _get_context, _emit = get_context, emit


# ---------------------------------------------------------------- TwiML


def stream_twiml(sid: str) -> str:
    """<Connect><Stream> (bidirectional Media Stream) pointed at our Grok bridge."""
    r = VoiceResponse()
    c = Connect()
    s = c.stream(url=f"{settings.ws_base}/ws/grok-media/{sid}")
    s.parameter(name="sid", value=sid)
    r.append(c)
    return str(r)


# ---------------------------------------------------------------- facts: what must be said exactly

_NUM_WORDS = {
    "zero": 0, "oh": None, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_SCALES = {"hundred": 100, "thousand": 1000}
_NUMBER_WORD = r"(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" \
               r"sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|" \
               r"ninety|hundred|thousand)"
FACT_RE = re.compile(
    r"\d|[$£€]|\b(?:a\.?m\.?|p\.?m\.?|o'?clock|noon|midnight|dollars?|cents?|bucks|percent|"
    r"book(?:ed|ing)?|reserv(?:e|ed|ation)|confirm(?:ed|ation)?|appointment|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|"
    + _NUMBER_WORD + r")\b",
    re.I,
)


def needs_verbatim(text: str) -> bool:
    return bool(FACT_RE.search(text or ""))


def facts_of(text: str) -> set[str]:
    """Numbers (digits or words), am/pm and weekdays, normalised so '5:30' == 'five thirty'."""
    t = (text or "").lower().replace("-", " ")
    t = re.sub(r"(\d),(\d{3})", r"\1\2", t)                     # 1,200 -> 1200
    t = re.sub(r"\b([ap])\.?\s?m\b\.?", r" \1m ", t)
    out: set[str] = set()
    acc: Optional[int] = None
    for tok in re.findall(r"\d+(?:\.\d+)?|[a-z']+", t):
        if tok[0].isdigit():
            if acc is not None:
                out.add(str(acc)); acc = None
            out.add(str(int(float(tok))) if float(tok).is_integer() else tok)
            continue
        if tok in _NUM_WORDS and _NUM_WORDS[tok] is not None:
            v = _NUM_WORDS[tok]
            if acc is not None and acc % 10 == 0 and 20 <= acc < 100 and v < 10:
                acc += v                                          # forty five -> 45
            else:
                if acc is not None:
                    out.add(str(acc))
                acc = v
            continue
        if tok in _SCALES and acc is not None:
            acc *= _SCALES[tok]
            continue
        if acc is not None:
            out.add(str(acc)); acc = None
        if tok in ("am", "pm") or tok in ("monday", "tuesday", "wednesday", "thursday", "friday",
                                           "saturday", "sunday", "noon", "midnight"):
            out.add(tok)
    if acc is not None:
        out.add(str(acc))
    return out


# ---------------------------------------------------------------- prompt


def build_instructions(ctx: dict) -> str:
    name = (ctx.get("name") or "").strip()
    who = f"{name}, a Deaf person who signs" if name else "a Deaf person who signs"
    disclose = not ctx.get("knows_sign")
    lines = [
        f"You are the voice of {who}. You speak on a phone call as them, "
        "in the first person (I, me, my). Sound warm and natural: short sentences, contractions, no lists.",
        "You do NOT know their answers, plans, opinions, schedule, or any facts about them. "
        "Never guess or make anything up.",
        "Whenever the caller asks anything, or anything needs a decision or information from "
        "them, call the tool get_reply with the caller's exact question. Before calling it you may "
        "say ONE short holding phrase like \"mm, one sec\", then stay quiet until the tool returns.",
        "When get_reply returns, say exactly that meaning to the caller. Do not add, drop or change any "
        "fact, number, name, time, date, price or promise. If verbatim is true, say the text word for word.",
        "Without the tool you may only do small talk: say hi, ask the caller to say that again, "
        "say you're still here, or say thanks and bye.",
    ]
    if disclose:
        lines.append("Early in the call, mention once, casually, that you're deaf and an app voices "
                     "what you sign, so replies can take a few seconds. Don't repeat it.")
    else:
        lines.append("This caller already knows you sign. Don't explain how the call works.")
    return "\n".join(lines)


GET_REPLY_TOOL = {
    # Flat shape as in xAI's Twilio cookbook (index.ts). The ws.json schema also shows a nested
    # {"type":"function","function":{...}} form. UNVERIFIED which one the server prefers.
    "type": "function",
    "name": "get_reply",
    "description": "Ask the person you voice for their answer. Use for every question or decision. "
                   "Returns {text, verbatim}: what to say back.",
    "parameters": {
        "type": "object",
        "properties": {"question": {"type": "string", "description": "The caller's exact question."}},
        "required": ["question"],
    },
}


def session_update(ctx: dict) -> dict:
    session: dict[str, Any] = {
        "instructions": build_instructions(ctx),
        "voice": grok_voice(),
        "reasoning": {"effort": "none"},
        "turn_detection": {"type": "server_vad"},
        "audio": {
            "input": {"format": {"type": "audio/pcmu"}},
            "output": {"format": {"type": "audio/pcmu"}},
        },
        "tools": [GET_REPLY_TOOL],
    }
    if _env("GROK_LIVE_CAPTIONS") == "1":
        # Turns on cumulative conversation.item.input_audio_transcription.updated events.
        # Named on the voice-agent page; not in the ws.json transcription schema, so opt-in.
        session["audio"]["input"]["transcription"] = {"model": "grok-transcribe"}
    return {"type": "session.update", "session": session}


# ---------------------------------------------------------------- the bridge


async def _open_xai():
    from websockets.asyncio.client import connect
    return await connect(realtime_url(), additional_headers={"Authorization": f"Bearer {_env('XAI_API_KEY')}"},
                         open_timeout=10, max_size=None)


class GrokBridge:
    """One phone call. Owns the xAI socket; talks to Twilio through `twilio_send`."""

    def __init__(self, sid: str, ctx: dict, twilio_send: Callable[[dict], Awaitable[None]],
                 emit: Optional[Emit] = None) -> None:
        self.sid = sid
        self.ctx = ctx
        self._twilio_send = twilio_send
        self._emit_fn = emit
        self.stream_sid: Optional[str] = None
        self.xai = None
        self._reader: Optional[asyncio.Task] = None
        self._tasks: set[asyncio.Task] = set()
        self.session_ready = False
        self._pre_audio: list[str] = []
        # playback tracking
        self.response_active = False
        self.response_id: Optional[str] = None
        self._response_had_audio = False
        self._marked_this_response = False
        self._mark_n = 0
        self.marks_out: set[str] = set()
        self._idle = asyncio.Event(); self._idle.set()
        # tool flow
        self.pending: Optional[tuple[str, asyncio.Future]] = None   # (call_id, future)
        self.late_reply: Optional[asyncio.Future] = None             # reply after the tool timed out
        self._seen_calls: set[str] = set()
        self.force_verbatim = False
        # safety check + latency
        self._check: Optional[dict] = None    # {"approved", "buf", "rid", "verbatim"}
        self._lat_t0: Optional[float] = None
        self._lat_armed = False
        # captions
        self._caller_lines: dict[str, str] = {}
        self._me_text = ""
        self._me_id = 0
        self.closed = False

    # ---------------------------------------------------------- plumbing

    async def emit(self, msg: dict) -> None:
        msg.setdefault("sid", self.sid)
        fn = self._emit_fn or _emit
        if not fn:
            return
        try:
            await fn(msg)
        except Exception:
            log.exception("emit failed")

    async def to_twilio(self, msg: dict) -> None:
        try:
            await self._twilio_send(msg)
        except Exception:
            log.debug("twilio send failed (call gone?)", exc_info=True)

    async def to_xai(self, msg: dict) -> None:
        if self.xai is None or self.closed:
            return
        try:
            await self.xai.send(json.dumps(msg))
        except Exception:
            log.warning("xai send failed: %s", msg.get("type"))

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    def _update_idle(self) -> None:
        if not self.response_active and not self.marks_out:
            self._idle.set()
        else:
            self._idle.clear()

    async def wait_playback_idle(self) -> None:
        """Wait until Grok isn't generating and Twilio has played every chunk we sent (marks)."""
        try:
            await asyncio.wait_for(self._idle.wait(), IDLE_WAIT_MAX_S)
        except asyncio.TimeoutError:
            log.warning("[%s] playback marks never came back; speaking anyway", self.sid)
            self.marks_out.clear(); self._update_idle()

    # ---------------------------------------------------------- lifecycle

    async def start(self, stream_sid: str) -> None:
        self.stream_sid = stream_sid
        self.xai = await _open_xai()
        await self.to_xai(session_update(self.ctx))
        self._reader = asyncio.create_task(self._read_xai())
        self._spawn(self._session_ready_fallback())

    async def _session_ready_fallback(self) -> None:
        await asyncio.sleep(3)
        if not self.session_ready and not self.closed:
            log.warning("[%s] no session.updated after 3s; sending audio anyway", self.sid)
            await self._on_session_ready()

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        for fut in (self.pending[1] if self.pending else None, self.late_reply):
            if fut and not fut.done():
                fut.cancel()
        for t in list(self._tasks):
            t.cancel()
        if self._reader:
            self._reader.cancel()
        if self.xai is not None:
            try:
                await self.xai.close()
            except Exception:
                pass

    # ---------------------------------------------------------- Twilio -> xAI

    async def on_twilio_media(self, payload: str) -> None:
        if not payload:
            return
        if not self.session_ready:
            if len(self._pre_audio) < PRE_SESSION_BUFFER:
                self._pre_audio.append(payload)
            return
        await self.to_xai({"type": "input_audio_buffer.append", "audio": payload})

    async def on_twilio_mark(self, name: str) -> None:
        self.marks_out.discard(name)
        self._update_idle()

    async def _on_session_ready(self) -> None:
        if self.session_ready:
            return
        self.session_ready = True
        buffered, self._pre_audio = self._pre_audio, []
        for p in buffered:
            await self.to_xai({"type": "input_audio_buffer.append", "audio": p})

    # ---------------------------------------------------------- xAI -> us

    async def _read_xai(self) -> None:
        try:
            async for raw in self.xai:
                if isinstance(raw, bytes):
                    continue          # we asked for json transport; binary frames are unexpected
                try:
                    ev = json.loads(raw)
                except ValueError:
                    continue
                try:
                    await self.handle_xai(ev)
                except Exception:
                    log.exception("[%s] handling %s failed", self.sid, ev.get("type"))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("[%s] xai socket error", self.sid, exc_info=True)
        if not self.closed:
            await self.emit({"type": "notice", "kind": "voice_engine_down",
                             "text": "The Grok voice dropped. The caller may hear silence."})

    async def handle_xai(self, ev: dict) -> None:
        t = ev.get("type", "")
        if t == "session.updated":
            await self._on_session_ready()
        elif t in ("response.output_audio.delta", "response.audio.delta"):
            await self._on_audio_delta(ev)
        elif t == "input_audio_buffer.speech_started":
            await self._barge_in()
        elif t == "response.created":
            self.response_active = True
            self.response_id = (ev.get("response") or {}).get("id")
            self._response_had_audio = False
            self._marked_this_response = False
            if self._check is not None and self._check.get("rid") is None:
                self._check["rid"] = self.response_id or "?"
            self._update_idle()
        elif t == "response.output_audio.done":
            await self._send_mark()
        elif t in ("response.done", "response.cancelled"):  # response.cancelled: cookbook only, UNVERIFIED in ref
            if self._response_had_audio and not self._marked_this_response:
                await self._send_mark()
            self.response_active = False
            await self._finish_me_line()
            if self._check is not None and self._check.get("rid") is not None and self._rid_ok(ev):
                await self._run_check()
            self._update_idle()
        elif t == "response.output_audio_transcript.delta":
            await self._on_out_transcript(ev.get("delta") or "", ev)
        elif t == "response.output_audio_transcript.done":
            if self._check is not None and self._rid_ok(ev) and ev.get("transcript"):
                self._check["final"] = ev["transcript"]
        elif t == "conversation.item.input_audio_transcription.updated":
            await self._caller_caption(ev.get("item_id") or "", ev.get("transcript") or "", final=False)
        elif t == "conversation.item.input_audio_transcription.completed":
            await self._caller_caption(ev.get("item_id") or "", ev.get("transcript") or "", final=True)
        elif t == "response.function_call_arguments.done":
            await self._on_function_call(ev.get("call_id") or "", ev.get("name") or "", ev.get("arguments") or "{}")
        elif t == "response.output_item.done":
            item = ev.get("item") or {}
            if item.get("type") == "function_call":     # cookbook path; deduped by call_id
                await self._on_function_call(item.get("call_id") or "", item.get("name") or "",
                                             item.get("arguments") or "{}")
        elif t == "error":
            log.warning("[%s] xai error: %s", self.sid, ev.get("error"))

    def _rid_ok(self, ev: dict) -> bool:
        rid = ev.get("response_id") or (ev.get("response") or {}).get("id")
        want = self._check.get("rid") if self._check else None
        return not rid or not want or want == "?" or rid == want

    async def _on_audio_delta(self, ev: dict) -> None:
        payload = ev.get("delta") or ev.get("audio")
        if not payload or not self.stream_sid:
            return
        self._response_had_audio = True
        self.response_active = True
        self._update_idle()
        if self._lat_armed and self._lat_t0 is not None:
            ms = (time.monotonic() - self._lat_t0) * 1000
            self._lat_armed = False
            latency.record("grok_reply_to_first_audio", ms)
            await self.emit({"type": "latency", "metric": "reply_to_first_audio", "ms": round(ms, 1),
                             "engine": "grok"})
        await self.to_twilio({"event": "media", "streamSid": self.stream_sid, "media": {"payload": payload}})

    async def _send_mark(self) -> None:
        if not self.stream_sid or self._marked_this_response:
            return
        self._marked_this_response = True
        self._mark_n += 1
        name = f"g{self._mark_n}"
        self.marks_out.add(name)
        self._update_idle()
        await self.to_twilio({"event": "mark", "streamSid": self.stream_sid, "mark": {"name": name}})

    async def _barge_in(self) -> None:
        if self.stream_sid:
            await self.to_twilio({"event": "clear", "streamSid": self.stream_sid})
        if self.response_active:
            # Docs: in server_vad mode the server interrupts by itself; response.cancel is harmless extra.
            msg: dict = {"type": "response.cancel"}
            if self.response_id:
                msg["response_id"] = self.response_id
            await self.to_xai(msg)
        self.marks_out.clear()
        if self._me_text:
            await self._finish_me_line(status="interrupted")
        self._update_idle()

    # ---------------------------------------------------------- captions

    async def _caller_caption(self, item_id: str, text: str, final: bool) -> None:
        if not text:
            return
        cid = self._caller_lines.setdefault(item_id or f"x{len(self._caller_lines)}", f"gc{len(self._caller_lines)}")
        await self.emit({"type": "caption", "line": {"id": cid, "who": "caller", "text": text,
                                                     "status": "final" if final else "partial"}})

    async def _on_out_transcript(self, delta: str, ev: dict) -> None:
        if not delta:
            return
        if not self._me_text:
            self._me_id += 1
        self._me_text += delta
        if self._check is not None and self._rid_ok(ev) and self._check.get("rid") is not None:
            self._check["buf"].append(delta)
        await self.emit({"type": "line", "line": {"id": f"gm{self._me_id}", "who": "me", "text": self._me_text,
                                                  "status": "speaking", "kind": "grok"}})

    async def _finish_me_line(self, status: str = "spoken") -> None:
        if not self._me_text:
            return
        await self.emit({"type": "line", "line": {"id": f"gm{self._me_id}", "who": "me", "text": self._me_text,
                                                  "status": status, "kind": "grok"}})
        self._me_text = ""

    # ---------------------------------------------------------- get_reply tool

    async def _on_function_call(self, call_id: str, name: str, arguments: str) -> None:
        if not call_id or call_id in self._seen_calls:
            return
        self._seen_calls.add(call_id)
        if name != "get_reply":
            await self.to_xai({"type": "conversation.item.create", "item": {
                "type": "function_call_output", "call_id": call_id, "output": json.dumps({"error": "unknown tool"})}})
            return
        try:
            question = str(json.loads(arguments or "{}").get("question") or "").strip()
        except ValueError:
            question = arguments.strip()
        self._spawn(self._get_reply(call_id, question))

    async def _get_reply(self, call_id: str, question: str) -> None:
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        if self.pending and not self.pending[1].done():
            self.pending[1].cancel()       # Grok asked again; only the newest call gets the answer
        self.pending = (call_id, fut)
        await self.emit({"type": "caption", "line": {"id": f"gq-{call_id}", "who": "caller", "text": question,
                                                     "status": "final", "kind": "question"}})
        await self.emit({"type": "needs_reply", "question": question, "call_id": call_id, "engine": "grok"})
        try:
            text, verbatim = await asyncio.wait_for(asyncio.shield(fut), REPLY_TIMEOUT_S)
        except asyncio.TimeoutError:
            await self._hold_after_timeout(call_id, fut)
            return
        except asyncio.CancelledError:
            return
        await self._speak(text, verbatim, call_id)

    async def _hold_after_timeout(self, call_id: str, fut: asyncio.Future) -> None:
        """Close the tool call so the session isn't stuck, say a holding line, keep waiting."""
        self.pending = None
        self.late_reply = fut
        await self.emit({"type": "notice", "kind": "reply_timeout",
                         "text": "Still waiting on your reply. The caller heard: sorry, give me a moment."})
        await self.to_xai({"type": "conversation.item.create", "item": {
            "type": "function_call_output", "call_id": call_id,
            "output": json.dumps({"status": "not_ready", "text": "",
                                  "note": "No answer yet. Do not guess. Stay quiet; it will be said for you."})}})
        await self.wait_playback_idle()
        await self._force_message("Sorry, give me a moment.")
        try:
            text, verbatim = await fut
        except asyncio.CancelledError:
            return
        self.late_reply = None
        await self._speak(text, verbatim, None)

    async def deliver_reply(self, text: str, verbatim: bool = False) -> dict:
        """The signer approved `text`. Speak it as the answer to the open get_reply call (or on its own)."""
        text = (text or "").strip()
        if not text:
            return {"ok": False, "error": "empty"}
        self._lat_t0 = time.monotonic()
        self._lat_armed = False
        verbatim = bool(verbatim or self.force_verbatim or needs_verbatim(text))
        for fut in ((self.pending[1] if self.pending else None), self.late_reply):
            if fut is not None and not fut.done():
                fut.set_result((text, verbatim))
                return {"ok": True, "engine": "grok", "verbatim": verbatim, "answered": True}
        self._spawn(self._speak(text, verbatim, None))
        return {"ok": True, "engine": "grok", "verbatim": verbatim, "answered": False}

    async def _speak(self, text: str, verbatim: bool, call_id: Optional[str]) -> None:
        if call_id and self.pending and self.pending[0] == call_id:
            self.pending = None
        await self.wait_playback_idle()          # never talk over the holding phrase
        self._check = {"approved": text, "buf": [], "rid": None, "verbatim": verbatim}
        self._lat_armed = True
        if call_id:
            out = {"text": text, "verbatim": verbatim}
            if verbatim:
                out["note"] = "This is being spoken word for word for you right now. Do not repeat it."
            await self.to_xai({"type": "conversation.item.create", "item": {
                "type": "function_call_output", "call_id": call_id, "output": json.dumps(out)}})
            if verbatim:
                await self._force_message(text)
            else:
                await self.to_xai({"type": "response.create"})
        elif verbatim:
            await self._force_message(text)
        else:
            await self.to_xai({"type": "response.create", "response": {"instructions": (
                "Say this to the caller now, as me, in the first person. Same meaning; do not add, drop or "
                f"change any fact, number, name, time, price or promise: {text}")}})
        log.info("[%s] approved reply sent to grok (verbatim=%s): %r", self.sid, verbatim, text)

    async def _force_message(self, text: str) -> None:
        # xAI extension: server TTS speaks this exact text as a full response. No response.create after.
        await self.to_xai({"type": "conversation.item.create", "item": {
            "type": "force_message", "role": "assistant", "interruptible": True,
            "content": [{"type": "output_text", "text": text}]}})

    # ---------------------------------------------------------- safety check

    async def _run_check(self) -> None:
        chk, self._check = self._check, None
        if chk is None:
            return
        spoken = chk.get("final") or "".join(chk["buf"])
        if not spoken.strip():
            return                       # no transcript to compare (e.g. cancelled by barge-in)
        want, got = facts_of(chk["approved"]), facts_of(spoken)
        log.info("[%s] safety check approved=%r spoken=%r", self.sid, chk["approved"], spoken)
        if want != got:
            self.force_verbatim = True
            log.warning("[%s] SAFETY MISMATCH approved=%r spoken=%r (missing=%s extra=%s)",
                        self.sid, chk["approved"], spoken, sorted(want - got), sorted(got - want))
            await self.emit({"type": "notice", "kind": "safety_mismatch", "approved": chk["approved"],
                             "spoken": spoken, "missing": sorted(want - got), "extra": sorted(got - want),
                             "text": "The voice may have said a different number or time. "
                                     "Replies on this call are now read word for word."})


# ---------------------------------------------------------------- Twilio Media Stream socket


def _handshake_ok(ws: WebSocket, sid: str) -> bool:
    if not settings.validate_twilio_signature:
        return True
    from twilio.request_validator import RequestValidator
    sig = ws.headers.get("x-twilio-signature", "")
    validator = RequestValidator(settings.twilio_auth_token)
    q = f"?{ws.url.query}" if ws.url.query else ""
    for url in (f"{settings.ws_base}/ws/grok-media/{sid}{q}", f"{settings.public_url}/ws/grok-media/{sid}{q}"):
        if sig and validator.validate(url, {}, sig):
            return True
    return False


@router.websocket("/ws/grok-media/{sid}")
async def ws_grok_media(ws: WebSocket, sid: str) -> None:
    ctx = _get_context(sid)
    if ctx is None or not _handshake_ok(ws, sid):
        await ws.close(code=1008)
        return
    await ws.accept()
    lock = asyncio.Lock()

    async def twilio_send(msg: dict) -> None:
        async with lock:
            await ws.send_text(json.dumps(msg))

    bridge = GrokBridge(sid, ctx, twilio_send)
    old = bridges.get(sid)
    bridges[sid] = bridge
    if old:
        await old.close()
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            ev = msg.get("event")
            if ev == "media":
                media = msg.get("media") or {}
                if media.get("track", "inbound") == "inbound":
                    await bridge.on_twilio_media(media.get("payload") or "")
            elif ev == "mark":
                await bridge.on_twilio_mark((msg.get("mark") or {}).get("name") or "")
            elif ev == "start":
                start = msg.get("start") or {}
                p = (start.get("customParameters") or {}).get("sid")
                if p and p != sid:
                    log.warning("stream sid param %s != path %s", p, sid)
                try:
                    await bridge.start(start.get("streamSid") or msg.get("streamSid") or "")
                except Exception:
                    log.exception("[%s] couldn't open Grok realtime socket", sid)
                    await bridge.emit({"type": "notice", "kind": "voice_engine_down",
                                       "text": "Couldn't reach the Grok voice."})
                    break
            elif ev == "stop":
                break
            # "connected" and "dtmf" need nothing
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await bridge.close()
        if bridges.get(sid) is bridge:
            bridges.pop(sid, None)
        try:
            await ws.close()
        except Exception:
            pass
