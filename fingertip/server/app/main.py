"""Sign2Speak backend: one FastAPI service.

HTTP
  POST /twilio/voice                 incoming call webhook (Twilio)
  POST /twilio/status/{sid}          call status callback (Twilio)
  POST /twilio/relay-ended/{sid}     <Connect action> when ConversationRelay ends (Twilio)
  POST /api/calls                    signer dials out
  POST /api/calls/{sid}/answer|decline|hangup|send|signs|confirm
  GET  /api/health                   what's configured, latency medians
WebSocket
  /ws/relay/{sid}                    Twilio ConversationRelay
  /ws/app                            the signer's app (events; reattaches to live calls)
"""
from __future__ import annotations

import asyncio
import io
import logging
import math
import json
import os
import random
import re
import secrets
import struct
import time
import wave
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from twilio.request_validator import RequestValidator

from . import grok_voice, relay, translate
from .ai import RulesBrain, make_brain

RulesBrainFallback = RulesBrain()
from .show import VIDEO_TYPES, ShowStore, ask_video, make_video_engine, public_record, run_job, shared_record
from .config import settings
from .controller import ENDED, RINGING, Contact, Controller
from .latency import latency
from .telephony import make_telephony

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")

COMMUNICATION_MODES = {"ai_assist", "sign_language", "exact_words", "captions_only"}


# ------------------------------------------------------------------ state

class Hub:
    """Signer app sockets. Single-user demo: every connected device sees every call."""

    def __init__(self) -> None:
        self.sockets: set[WebSocket] = set()
        self.contacts: list[dict] = []
        self.voice_id: Optional[str] = None
        self.intro_style = "deaf"          # how the heads-up describes the user (app Settings)
        self._eid = 0

    async def broadcast(self, msg: dict) -> None:
        # Every event carries an id and a server timestamp (docs/CONTRACT.md).
        self._eid += 1
        msg = {**msg, "eid": self._eid, "ts": round(time.time(), 3)}
        dead = []
        for ws in list(self.sockets):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.discard(ws)

    def contact_for(self, number: str) -> Contact:
        digits = re.sub(r"\D", "", number or "")[-10:]
        for c in self.contacts:
            if digits and re.sub(r"\D", "", c.get("number", ""))[-10:] == digits:
                return Contact(id=c.get("id", ""), name=c.get("name", number), number=number,
                               knows_sign=bool(c.get("knows_sign")), kind=c.get("kind", "person"),
                               style=c.get("style", ""), language=_language_or_english(c.get("language", "")))
        # Server-side names for demo callers: KNOWN_CALLERS="+14135550123=Mom,+1617...=Dad"
        for pair in os.getenv("KNOWN_CALLERS", "").split(","):
            num, _, name = pair.partition("=")
            if digits and name.strip() and re.sub(r"\D", "", num)[-10:] == digits:
                return Contact(name=name.strip(), number=number, kind="person", knows_sign=False)
        return Contact(name=_pretty(number), number=number, kind="person", knows_sign=False)


def _pretty(n: str) -> str:
    d = re.sub(r"\D", "", n or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else (n or "Unknown")


hub = Hub()
sessions: dict[str, Controller] = {}
by_call_sid: dict[str, str] = {}
relay_reconnects: dict[str, int] = {}
recent_dials: list[float] = []
bridges: set[WebSocket] = set()      # desktop bridges (virtual microphone for Zoom / Teams / Meet)
state = {"telephony": None, "brain": None, "signs": None, "video": None}
shows = ShowStore(settings.show_dir)


def new_session(contact: Contact, direction: str, note: str = "") -> Controller:
    sid = secrets.token_urlsafe(18)
    c = Controller(sid, contact, state["brain"], direction=direction, note=note, voice_id=hub.voice_id,
                   emit=hub.broadcast, intro_style=hub.intro_style)
    sessions[sid] = c
    return c


def twiml_for(c: Controller) -> str:
    if grok_voice.grok_enabled():
        # Grok realtime voice (VOICE_ENGINE=grok + XAI_API_KEY). Unverified on a live call.
        return grok_voice.stream_twiml(c.id)
    return relay.relay_twiml(c.id, c.voice_id, c.lang.code if c.lang else None)


def multilingual_ready() -> bool:
    """Other-language calls need a model that translates (Gemini). Rules can't."""
    return getattr(state["brain"], "name", "") == "gemini" and getattr(state["brain"], "ok", None) is not False


def _language_or_english(code: str) -> str:
    """Only keep a call language the server can actually handle; otherwise the call is English."""
    return code if code and translate.lang_for(code) and multilingual_ready() else ""


def get_session(sid: str) -> Controller:
    c = sessions.get(sid)
    if not c:
        raise HTTPException(404, "That call isn't active any more.")
    return c


async def _forget_later(sid: str, after_s: float = 600) -> None:
    await asyncio.sleep(after_s)
    c = sessions.pop(sid, None)
    if c:
        by_call_sid.pop(c.call_sid, None)
        relay_reconnects.pop(sid, None)


async def end_session(c: Controller, reason: str) -> None:
    if c.state != ENDED:
        await c.end(reason)
        asyncio.create_task(_forget_later(c.id))


# ------------------------------------------------------------------ ringback

def _ringback_wav() -> bytes:
    """US ringback: 440 + 480 Hz, 2 s on / 4 s off. 8 kHz mono 16-bit."""
    rate, buf = 8000, io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(rate * 6):
            t = i / rate
            v = 0.0 if t >= 2 else 0.25 * (math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 480 * t))
            frames += struct.pack("<h", int(v * 32767 / 2))
        w.writeframes(bytes(frames))
    return buf.getvalue()


RINGBACK = _ringback_wav()


# ------------------------------------------------------------------ app

@asynccontextmanager
async def lifespan(app: FastAPI):
    latency.configure(settings.log_dir)
    state["telephony"] = make_telephony()
    state["brain"] = make_brain()
    state["video"] = make_video_engine()
    from .signs.service import SignService
    state["signs"] = await asyncio.to_thread(SignService)
    if hasattr(state["brain"], "check"):
        asyncio.create_task(state["brain"].check())
    def _grok_ctx(sid: str):
        c = sessions.get(sid)
        if not c or c.state == ENDED:
            return None
        return {"name": os.getenv("SIGNER_NAME", ""), "knows_sign": c.contact.knows_sign, "kind": c.contact.kind}
    grok_voice.configure(_grok_ctx, hub.broadcast)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# The Meet/Zoom extension's content script calls /api/signs/sentence and /api/tts from the meeting page.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://meet.google.com"],
    allow_origin_regex=r"https://([a-z0-9-]+\.)?zoom\.us|http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    """Chrome asks before a public HTTPS page (Meet) calls a local server. Say yes for the extension's calls."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


async def twilio_form(request: Request) -> dict:
    form = dict((await request.form()).items())
    if settings.validate_twilio_signature:
        url = settings.public_url + request.url.path + (f"?{request.url.query}" if request.url.query else "")
        sig = request.headers.get("X-Twilio-Signature", "")
        if not RequestValidator(settings.twilio_auth_token).validate(url, form, sig):
            log.warning("bad Twilio signature on %s", request.url.path)
            raise HTTPException(403, "Invalid signature")
    return form


def xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


def check_key(key: Optional[str]) -> None:
    if settings.app_access_key and not secrets.compare_digest(key or "", settings.app_access_key):
        raise HTTPException(401, "This app needs its access link.")


@app.get("/static-audio/ringback.wav")
async def ringback() -> Response:
    return Response(RINGBACK, media_type="audio/wav")


@app.get("/api/health")
async def health() -> dict:
    brain = state["brain"]
    return {
        "ok": True,
        "twilio": settings.twilio_ready,
        "gemini": {"configured": settings.gemini_ready, "model": settings.gemini_model,
                   "model_ok": getattr(brain, "ok", None), "error": getattr(brain, "last_error", "")},
        "brain": getattr(brain, "name", "?"),
        "languages": {"available": multilingual_ready(), "list": translate.languages()},
        "show": {"available": state.get("video") is not None, "model": settings.gemini_video_model},
        "voice": settings.voice_string(hub.voice_id),
        "voice_provider": settings.tts_provider,
        "voice_model": settings.tts_model,
        "webhooks": {
            "incoming_voice": f"{settings.public_url}/twilio/voice",
            "incoming_status": f"{settings.public_url}/twilio/status",
        },
        "active_calls": sum(1 for c in sessions.values() if c.state != ENDED),
        "app_connected": len(hub.sockets),
        "bridges": len(bridges),
        "meet_voice": tts_provider() or None,
        "signs": state["signs"].config() if state["signs"] else None,
        "latency": latency.summary(),
        "demo_available": True,
    }


# ---------------------------------------------------------------- Twilio webhooks

@app.post("/twilio/voice")
async def twilio_voice(request: Request) -> Response:
    form = await twilio_form(request)
    call_sid, caller = form.get("CallSid", ""), form.get("From", "")
    # Twilio may retry a webhook. Keep it idempotent so one PSTN call creates one UI call.
    existing = sessions.get(by_call_sid.get(call_sid, ""))
    if existing:
        return xml(relay.ringback_twiml(existing.id))
    c = new_session(hub.contact_for(caller), "incoming")
    c.call_sid = call_sid
    by_call_sid[call_sid] = c.id
    await hub.broadcast({"type": "ringing", "sid": c.id, "contact": asdict(c.contact)})
    asyncio.create_task(_ring_timeout(c))
    log.info("incoming %s from %s -> session %s", call_sid, caller, c.id)
    return xml(relay.ringback_twiml(c.id))


async def _ring_timeout(c: Controller) -> None:
    await asyncio.sleep(settings.ring_timeout_s)
    if c.state == RINGING:
        try:
            await state["telephony"].update_twiml(
                c.call_sid, relay.goodbye_twiml("Sorry, they can't pick up right now. Please try again later."))
        except Exception:
            log.exception("ring timeout")
        await end_session(c, "missed")


@app.post("/twilio/status/{sid}")
async def twilio_status(sid: str, request: Request) -> Response:
    form = await twilio_form(request)
    status = form.get("CallStatus", "")
    c = sessions.get(sid)
    if c:
        if form.get("CallSid") and not c.call_sid:
            c.call_sid = form["CallSid"]
            by_call_sid[c.call_sid] = sid
        await hub.broadcast({"type": "call_status", "sid": sid, "status": status})
        if status in {"completed", "busy", "no-answer", "failed", "canceled"}:
            await end_session(c, {"completed": "hangup"}.get(status, status))
    return Response(status_code=204)


@app.post("/twilio/status")
async def twilio_status_incoming(request: Request) -> Response:
    """Status callback configured on the phone number (incoming calls)."""
    form = await twilio_form(request)
    sid = by_call_sid.get(form.get("CallSid", ""))
    c = sessions.get(sid or "")
    if c and form.get("CallStatus") in {"completed", "busy", "no-answer", "failed", "canceled"}:
        await end_session(c, "hangup")
    return Response(status_code=204)


@app.post("/twilio/relay-ended/{sid}")
async def relay_ended(sid: str, request: Request) -> Response:
    """ConversationRelay finished. If we didn't mean it to, reconnect once."""
    form = await twilio_form(request)
    c = sessions.get(sid)
    log.info("relay ended %s: %s", sid, {k: v for k, v in form.items() if k.startswith(("Session", "Handoff"))})
    # Twilio sends SessionStatus = ended (we sent "end"), completed (caller hung up) or failed (error).
    if c and c.state != ENDED and form.get("SessionStatus") == "failed" and form.get("CallStatus") == "in-progress":
        n = relay_reconnects.get(sid, 0)
        if n < 2:
            relay_reconnects[sid] = n + 1
            await hub.broadcast({"type": "notice", "sid": sid, "kind": "reconnecting",
                                 "text": "Reconnecting the call..."})
            return xml(twiml_for(c))
    if c:
        await end_session(c, "hangup")
    return xml(relay.goodbye_twiml(""))


# ---------------------------------------------------------------- ConversationRelay socket

def relay_handshake_ok(ws: WebSocket, sid: str) -> bool:
    """Twilio signs the ConversationRelay WebSocket handshake with X-Twilio-Signature over the URL."""
    if not settings.validate_twilio_signature:
        return True
    sig = ws.headers.get("x-twilio-signature", "")
    validator = RequestValidator(settings.twilio_auth_token)
    q = f"?{ws.url.query}" if ws.url.query else ""
    for url in (f"{settings.ws_base}/ws/relay/{sid}{q}", f"{settings.public_url}/ws/relay/{sid}{q}"):
        if sig and validator.validate(url, {}, sig):
            return True
    return False


@app.websocket("/ws/relay/{sid}")
async def ws_relay(ws: WebSocket, sid: str) -> None:
    c = sessions.get(sid)
    if not c or not relay_handshake_ok(ws, sid):
        log.warning("relay handshake rejected for %s", sid)
        await ws.close(code=1008)
        return
    await ws.accept()
    lock = asyncio.Lock()

    async def send(text: str) -> None:
        async with lock:
            await ws.send_text(text)

    try:
        while True:
            ev = relay.parse(await ws.receive_text())
            if ev.type == "setup":
                if c.call_sid and ev.raw.get("callSid") and ev.raw["callSid"] != c.call_sid:
                    log.warning("relay setup callSid mismatch for %s", sid)
                    await ws.close(code=1008)
                    return
                if ev.raw.get("callSid"):
                    by_call_sid[ev.raw["callSid"]] = sid
                await c.attach_relay(send, ev.raw)
            elif ev.type == "prompt":
                await c.on_prompt(ev.text, ev.last)
            elif ev.type == "interrupt":
                await c.on_interrupt(ev.raw.get("utteranceUntilInterrupt", ""))
            elif ev.type == "error":
                log.error("relay error %s: %s", sid, ev.raw)
            else:
                log.debug("relay %s ignored %s", sid, ev.type)
    except WebSocketDisconnect:
        log.info("relay socket closed for %s", sid)
    finally:
        c.detach_relay()


# ---------------------------------------------------------------- signer app socket

@app.websocket("/ws/app")
async def ws_app(ws: WebSocket, key: Optional[str] = None) -> None:
    if settings.app_access_key and not secrets.compare_digest(key or "", settings.app_access_key):
        await ws.close(code=1008)
        return
    await ws.accept()
    hub.sockets.add(ws)
    try:
        # Reattach: send every live (or just-ended) call so a reload picks up where it was.
        for c in list(sessions.values()):
            if c.state == RINGING and c.direction == "incoming":
                await ws.send_json({"type": "ringing", "sid": c.id, "contact": asdict(c.contact), "demo": c.demo})
            elif c.state != ENDED or (c.started_at and time.time() - c.started_at < 900):
                await ws.send_json(c.snapshot())
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "hello":
                hub.contacts = msg.get("contacts", [])[:200]
                hub.voice_id = msg.get("voice_id") or hub.voice_id
                if msg.get("intro_style") in translate.INTRO_STYLES:
                    hub.intro_style = msg["intro_style"]
            elif msg.get("type") == "ping":
                await ws.send_json({"type": "pong", "t": msg.get("t")})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.sockets.discard(ws)


# ---------------------------------------------------------------- signer actions

class DialIn(BaseModel):
    number: str
    name: str = ""
    contact_id: str = ""
    knows_sign: bool = False
    kind: str = "person"
    style: str = ""
    note: str = ""
    language: str = ""


def _e164(n: str) -> str:
    d = re.sub(r"[^\d+]", "", n)
    if d.startswith("+"):
        return d
    d = re.sub(r"\D", "", d)
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    raise HTTPException(400, "That number doesn't look right. Use a 10-digit US number.")


@app.post("/api/calls")
async def dial(body: DialIn, key: Optional[str] = None) -> dict:
    check_key(key)
    to = _e164(body.number)
    now = time.time()
    recent_dials[:] = [t for t in recent_dials if now - t < 60]
    if len(recent_dials) >= settings.dial_max_per_min:
        raise HTTPException(429, "Too many calls in a row. Wait a minute and try again.")
    if sum(1 for s in sessions.values() if s.state != ENDED) >= settings.max_live_calls:
        raise HTTPException(429, "Another call is still going. End it first.")
    if body.language and not body.language.lower().startswith("en"):
        if not translate.lang_for(body.language):
            raise HTTPException(400, "That language isn't supported yet.")
        if not multilingual_ready():
            raise HTTPException(400, "Calls in other languages need the Gemini key on the server.")
    recent_dials.append(now)
    contact = Contact(id=body.contact_id, name=body.name or _pretty(to), number=to,
                      knows_sign=body.knows_sign, kind=body.kind, style=body.style,
                      language=_language_or_english(body.language))
    c = new_session(contact, "outgoing", note=body.note)
    await c.load_note()
    try:
        c.call_sid = await state["telephony"].dial(
            to, twiml_for(c), f"{settings.public_url}/twilio/status/{c.id}")
    except Exception as e:
        log.exception("dial failed")
        sessions.pop(c.id, None)
        raise HTTPException(502, "Couldn't start the call. Check the number and try again.") from e
    by_call_sid[c.call_sid] = c.id
    await hub.broadcast(c.snapshot())
    return {"sid": c.id, "note_facts": c.note_facts, "note_confirm": c.note_confirm,
            "first_words": None if c.intro_done else c.intro_text}


@app.post("/api/calls/{sid}/answer")
async def answer(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    if c.state != RINGING:
        return {"ok": True}
    if c.demo:
        c.started_at = c.started_at or time.time()
        await demo_start(c)
        await hub.broadcast(c.snapshot())
        return {"ok": True}
    try:
        await state["telephony"].update_twiml(c.call_sid, twiml_for(c))
    except Exception as e:
        log.exception("answer failed")
        await end_session(c, "failed")
        raise HTTPException(502, "Couldn't pick up. The caller may have hung up.") from e
    c.started_at = c.started_at or time.time()
    await c._set_state("CONNECTED")
    await hub.broadcast(c.snapshot())
    return {"ok": True}


@app.post("/api/calls/{sid}/decline")
async def decline(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    try:
        if not c.demo:
            await state["telephony"].update_twiml(
                c.call_sid, relay.goodbye_twiml("Sorry, they can't pick up right now. Please try again later."))
    except Exception:
        log.exception("decline")
    await end_session(c, "declined")
    return {"ok": True}


@app.post("/api/calls/{sid}/hangup")
async def hangup(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    if c._relay_send:
        try:
            await c._relay_send(relay.end_message("hangup"))
        except Exception:
            pass
    if c.call_sid and not c.demo:
        await state["telephony"].hangup(c.call_sid)
    await end_session(c, "hangup")
    return {"ok": True, "recap": c.recap}


class NoteIn(BaseModel):
    note: str


# ---------------------------------------------------------------- SIMULATED demo mode
# For when Twilio is unavailable. No telephony is touched; a scripted fake caller talks to the
# signer. Every event and snapshot for these sessions carries "demo": true (Controller.emit).

DEMO_SCRIPTS = {
    "mom": ["Hi sweetie, it's Mom! When will you be home tonight?",
            "Perfect. Can you pick up some milk on the way?",
            "Thank you! Oh, and are you still coming Sunday?",
            "Wonderful. Love you, see you soon!"],
}


def _demo_script(name: str, outgoing: bool) -> list[str]:
    lines = DEMO_SCRIPTS.get(name.strip().lower())
    if lines is None:
        lines = [f"Hi, it's {name}! Do you have a minute?", "Great! How's your day going?",
                 "Nice! Want to catch up later this week?", "Sounds good, talk soon!"]
    return (["Hello?"] + lines[1:]) if outgoing else list(lines)


def _demo_speed() -> float:
    try:
        return max(0.0, float(os.getenv("DEMO_SPEED", "1")))
    except ValueError:
        return 1.0


class DemoRunner:
    """In-process fake ConversationRelay + scripted caller."""

    def __init__(self, c: Controller, lines: list[str]) -> None:
        self.c, self.lines, self.idx = c, lines, 0
        self.started = self.pending = self.owed = False
        self.sent: list[str] = []          # what the signer "spoke" (no audio is produced)
        self.task: Optional[asyncio.Task] = None

    async def send(self, text: str) -> None:
        try:
            m = json.loads(text)
        except ValueError:
            return
        if m.get("type") != "text":
            return
        self.sent.append(m.get("token", ""))
        if self.c.spoken_log and self.c.spoken_log[-1][1] == "reply":     # not intro/filler/etc.
            self.advance()

    def advance(self) -> None:
        if not self.started or self.idx >= len(self.lines):
            return
        if self.pending:
            self.owed = True
            return
        self.pending = True
        self.task = asyncio.create_task(self._deliver())

    async def _deliver(self) -> None:
        c, speed = self.c, _demo_speed()
        try:
            await asyncio.sleep(random.uniform(1.2, 2.0) * speed)
            if c.state == ENDED or self.idx >= len(self.lines):
                return
            line = self.lines[self.idx]
            self.idx += 1
            words = line.split()
            await c.on_prompt(" ".join(words[:max(1, len(words) // 2)]), False)
            await asyncio.sleep(0.4 * speed)
            if c.state == ENDED:
                return
            await c.on_prompt(line, True)
        finally:
            self.pending = False
            if self.owed and c.state != ENDED:
                self.owed = False
                self.advance()


async def demo_start(c: Controller) -> None:
    """Attach the fake relay, then queue the caller's first line."""
    r: DemoRunner = c.demo_runner
    await c.attach_relay(r.send, {"callSid": c.call_sid})
    r.started = True
    r.pending = True
    r.task = asyncio.create_task(r._deliver())
    # Typed "captions only" sends never reach the relay; still move the script along.
    orig = c.caption_only

    async def caption_only(text: str, source: str = "typed") -> dict:
        res = await orig(text, source)
        if res.get("ok"):
            r.advance()
        return res

    c.caption_only = caption_only


class DemoIn(BaseModel):
    name: str = "Mom"
    number: str = "+14135550123"


def _demo_session(body: DemoIn, direction: str) -> Controller:
    name = (body.name or "Mom").strip()[:60] or "Mom"
    contact = Contact(name=name, number=body.number, kind="person", knows_sign=False)
    c = new_session(contact, direction)
    c.demo = True
    c.call_sid = "CADEMO" + secrets.token_hex(8)
    c.demo_runner = DemoRunner(c, _demo_script(name, direction == "outgoing"))
    by_call_sid[c.call_sid] = c.id
    return c


@app.post("/api/demo/incoming")
async def demo_incoming(body: Optional[DemoIn] = None, key: Optional[str] = None) -> dict:
    check_key(key)
    c = _demo_session(body or DemoIn(), "incoming")
    await hub.broadcast({"type": "ringing", "sid": c.id, "contact": asdict(c.contact), "demo": True})
    return {"sid": c.id}


async def _demo_connect_outgoing(c: Controller) -> None:
    await asyncio.sleep(2.0 * _demo_speed())
    if c.state == RINGING:
        c.started_at = c.started_at or time.time()
        await demo_start(c)
        await hub.broadcast(c.snapshot())


@app.post("/api/demo/outgoing")
async def demo_outgoing(body: Optional[DemoIn] = None, key: Optional[str] = None) -> dict:
    check_key(key)
    c = _demo_session(body or DemoIn(), "outgoing")
    await hub.broadcast(c.snapshot())          # state RINGING, demo true
    c.demo_task = asyncio.create_task(_demo_connect_outgoing(c))
    return {"sid": c.id}


@app.post("/api/note/parse")
async def parse_note(body: NoteIn, key: Optional[str] = None) -> dict:
    """Live preview on the errand-note screen: what can be said vs. checked first."""
    check_key(key)
    p = await state["brain"].parse_note(body.note[:1000])
    return {"auto_facts": [f.model_dump() for f in p.auto_facts], "needs_confirmation": p.needs_confirmation}


@app.post("/api/calls/{sid}/draft/clear")
async def clear_draft(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    await get_session(sid).clear_draft()
    return {"ok": True}


class SendIn(BaseModel):
    text: str
    source: str = "typed"           # typed | chip | draft
    draft_id: Optional[str] = None
    signs: list[str] = []
    force: bool = False
    hash: Optional[str] = None      # required for source=draft: the hash shown with that draft
    tone: str = ""
    request_id: str = ""            # client-made; a retry with the same id is answered, not re-spoken
    mode: str = ""                  # ai_assist | sign_language | exact_words | captions_only


sent_requests: dict[str, dict] = {}     # request_id -> the answer it got (bounded)


@app.post("/api/calls/{sid}/send")
async def send(sid: str, body: SendIn, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    mode = body.mode or c.mode
    if mode not in COMMUNICATION_MODES:
        raise HTTPException(400, "Unknown communication mode.")
    if mode != c.mode:
        await c.set_mode(mode)
    rid = body.request_id[:80]
    if rid and rid in sent_requests:
        return {**sent_requests[rid], "request_id": rid, "duplicate": True}
    if mode == "captions_only":
        r = await c.caption_only(body.text, body.source)
    elif body.mode == "ai_assist" and body.source == "typed":
        # Only an explicit AI Assist request may rewrite. A typed send with no mode is spoken as typed.
        # First tap creates a visible/editable preview. A second, explicit approval sends source=draft+hash.
        draft = await c.draft_from_text(body.text, mode, body.tone)
        r = {"ok": True, "spoken": False, "requires_approval": True, "draft": asdict(draft)}
    else:
        bridge = grok_voice.bridges.get(sid)
        if bridge is not None:
            # Grok engine: the approved text answers Grok's pending get_reply (numbers/times go word for word).
            r = await bridge.deliver_reply(body.text, mode == "exact_words")
        else:
            r = await c.send(body.text, body.source, body.signs, body.draft_id, body.force, body.hash, body.tone)
    if rid:
        sent_requests[rid] = r
        while len(sent_requests) > 500:
            sent_requests.pop(next(iter(sent_requests)))
    return {**r, "request_id": rid} if rid else r


class ModeIn(BaseModel):
    mode: str


@app.post("/api/calls/{sid}/mode")
async def set_mode(sid: str, body: ModeIn, key: Optional[str] = None) -> dict:
    check_key(key)
    if body.mode not in COMMUNICATION_MODES:
        raise HTTPException(400, "Unknown communication mode.")
    c = get_session(sid)
    await c.set_mode(body.mode)
    return {"ok": True, "mode": c.mode}


class ComposeIn(BaseModel):
    text: str
    mode: str = "ai_assist"
    tone: str = ""


@app.post("/api/calls/{sid}/compose")
async def compose(sid: str, body: ComposeIn, key: Optional[str] = None) -> dict:
    """Generate an editable preview. This endpoint never sends audio."""
    check_key(key)
    if body.mode not in COMMUNICATION_MODES:
        raise HTTPException(400, "Unknown communication mode.")
    c = get_session(sid)
    await c.set_mode(body.mode)
    draft = await c.draft_from_text(body.text, body.mode, body.tone)
    return {"ok": True, "mode": body.mode, "requires_approval": body.mode == "ai_assist",
            "spoken": False, "draft": asdict(draft)}


class SignsIn(BaseModel):
    signs: list[str]
    tone: str = ""                  # "" = from the contact's talk style
    tone_source: str = "signer"     # signer | face (face is ignored unless FACE_TONE=true)


@app.post("/api/calls/{sid}/signs")
async def signs(sid: str, body: SignsIn, key: Optional[str] = None) -> dict:
    check_key(key)
    c = get_session(sid)
    tone = body.tone if (body.tone_source != "face" or settings.face_tone) else ""
    d = await c.draft_from_signs(body.signs, tone)
    return {"draft": asdict(d)}


class ConfirmIn(BaseModel):
    decision: str                   # yes | change | later
    hash: Optional[str] = None      # required for yes


@app.post("/api/calls/{sid}/confirm")
async def confirm(sid: str, body: ConfirmIn, key: Optional[str] = None) -> dict:
    check_key(key)
    return await get_session(sid).confirm(body.decision, body.hash)


@app.post("/api/calls/{sid}/stop")
async def stop(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    await get_session(sid).stop_speaking()
    return {"ok": True}


# ---------------------------------------------------------------- sign recognition
# The browser runs MediaPipe Holistic, segments one sign per pause and sends landmarks only.

@app.get("/api/signs/config")
async def signs_config(key: Optional[str] = None) -> dict:
    check_key(key)
    return state["signs"].config()


class ClassifyIn(BaseModel):
    frames: list[dict]
    hand: str = "right"             # right | left | auto
    sid: Optional[str] = None       # live call: the caller's named options boost those signs


@app.post("/api/signs/classify")
async def signs_classify(body: ClassifyIn, key: Optional[str] = None) -> dict:
    check_key(key)
    options: list[str] = []
    c = sessions.get(body.sid or "")
    if c and c.analysis:
        options = c.analysis.options
    r = await asyncio.to_thread(state["signs"].classify, body.frames[:240], body.hand, options)
    if r.get("ok"):
        latency.record("sign_classify_ms", r["ms"])
        log.info("sign %s unsure=%s top=%s p=%s", r["sign"], r["unsure"], r.pop("_top"), r.pop("_p"))
    return r


class RecordIn(BaseModel):
    signer: str
    label: str                      # a gloss, or a phrase like "YES SUNDAY COME"
    kind: str = "sign"              # sign | phrase
    segments: list[list[dict]]


@app.post("/api/signs/record")
async def signs_record(body: RecordIn, key: Optional[str] = None) -> dict:
    check_key(key)
    return state["signs"].record(body.signer, body.label, [s[:240] for s in body.segments[:12]], body.kind)


@app.get("/api/signs/recordings")
async def signs_recordings(key: Optional[str] = None) -> dict:
    check_key(key)
    return state["signs"].recordings_summary()


class SentenceIn(BaseModel):
    signs: list[str]
    style: str = "casual"


class ExpandIn(BaseModel):
    text: str
    context: str = ""               # what the other person just said, if known
    style: str = "casual"           # casual | polite


@app.post("/api/expand")
async def expand_text(body: ExpandIn, key: Optional[str] = None) -> dict:
    """AI Assist outside a phone call (meeting extension): shorthand -> one natural sentence, guarded."""
    check_key(key)
    from . import guards
    hint = body.text.strip()[:300]
    ctx = {"contact_name": "people in a meeting", "casual": body.style != "polite", "note_facts": [], "recent": []}
    t0 = time.perf_counter()
    text = await state["brain"].write_typed_reply(hint, body.context[:400], ctx, "neutral")
    problems = guards.fact_guard(text, [hint, body.context]).problems
    if problems:
        text = await RulesBrainFallback.write_typed_reply(hint, body.context, ctx, "neutral")
    latency.record("expand_ms", (time.perf_counter() - t0) * 1000)
    return {"text": text, "ms": round((time.perf_counter() - t0) * 1000), "guarded": bool(problems)}


@app.post("/api/signs/sentence")
async def signs_sentence(body: SentenceIn, key: Optional[str] = None) -> dict:
    """In-person mode: signs -> one sentence, with the same fact/negation/hedge guards."""
    check_key(key)
    from . import guards
    ctx = {"contact_name": "someone in person", "casual": body.style == "casual", "note_facts": [], "recent": []}
    t0 = time.perf_counter()
    text = await state["brain"].write_reply(body.signs, "", ctx, "warm" if body.style == "casual" else "neutral")
    src = [guards.gloss_text(body.signs)]
    problems = (guards.fact_guard(text, src).problems + guards.negation_guard(text, body.signs).problems
                + guards.hedge_guard(text, body.signs).problems)
    if problems and getattr(state["brain"], "fallback", None):
        text = await state["brain"].fallback.write_reply(body.signs, "", ctx, "neutral")
        problems = []
    latency.record("draft_ms", (time.perf_counter() - t0) * 1000)
    return {"text": text, "problems": problems}


# ---------------------------------------------------------------- Meet extension voice (stretch)

# ---------------------------------------------------------------- Show it (video -> facts + overlays)

@app.post("/api/show")
async def show_create(file: UploadFile = File(...), duration: float = Form(0.0), context: str = Form(""),
                      title: str = Form(""), key: Optional[str] = None) -> dict:
    """A short clip -> facts tied to a time and a place in the frame. Needs Gemini."""
    check_key(key)
    engine = state.get("video")
    if engine is None:
        raise HTTPException(400, "Show it needs the Gemini key on the server.")
    mime = (file.content_type or "").split(";")[0].lower()
    ext = VIDEO_TYPES.get(mime)
    if not ext:
        raise HTTPException(400, "That file isn't a video we can read (MP4, MOV or WebM).")
    data = await file.read(settings.show_max_mb * 1024 * 1024 + 1)
    if len(data) > settings.show_max_mb * 1024 * 1024:
        raise HTTPException(413, f"That video is too big. Keep it under {settings.show_max_mb} MB (about a minute).")
    if not data:
        raise HTTPException(400, "The video was empty.")
    sid, path = shows.new(data, ext)
    record = {"id": sid, "share_token": secrets.token_urlsafe(18), "share": False, "created": time.time(),
              "duration": duration, "title": title[:80], "context": context[:300], "mime": mime,
              "status": "processing", "progress": "Sending the video", "summary_say": "", "facts": [],
              "sections": [], "notes": ""}
    shows.save(sid, record)
    # Several Gemini passes: run in the background; the app polls GET /api/show/{id} for progress.
    task = asyncio.create_task(run_job(engine, shows, sid, data, mime, path, duration, context))
    show_jobs.add(task)
    task.add_done_callback(show_jobs.discard)
    return public_record(record)


show_jobs: set = set()


class AskIn(BaseModel):
    question: str


@app.post("/api/show/{sid}/ask")
async def show_ask(sid: str, body: AskIn, key: Optional[str] = None) -> dict:
    """Ask the video: answered only from what the clip shows, with the moment and spot."""
    check_key(key)
    engine = state.get("video")
    if engine is None:
        raise HTTPException(400, "Show it needs the Gemini key on the server.")
    _show(sid)
    q = body.question.strip()
    if not q:
        raise HTTPException(400, "Ask a question first.")
    try:
        fact = await ask_video(engine, shows, sid, q)
    except Exception as e:
        log.warning("ask video failed: %s", str(e)[:300])
        raise HTTPException(502, "Couldn't check the video just now. Try again.") from e
    return {"ok": True, "found": fact is not None, "fact": fact}


def _show(sid: str) -> dict:
    try:
        return shows.load(sid)
    except KeyError:
        raise HTTPException(404, "That video isn't here any more.")


@app.get("/api/show/{sid}")
async def show_get(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    return public_record(_show(sid))


@app.get("/api/show/{sid}/video")
async def show_video(sid: str, key: Optional[str] = None) -> FileResponse:
    check_key(key)
    r = _show(sid)
    return FileResponse(shows.video(sid), media_type=r.get("mime", "video/mp4"))


class ShareIn(BaseModel):
    share: bool


@app.post("/api/show/{sid}/share")
async def show_share(sid: str, body: ShareIn, key: Optional[str] = None) -> dict:
    """Off by default. On: anyone with the link can watch this one clip and its facts."""
    check_key(key)
    r = _show(sid)
    r["share"] = body.share
    shows.save(sid, r)
    return {"ok": True, "share": r["share"], "share_token": r["share_token"] if r["share"] else None}


@app.delete("/api/show/{sid}")
async def show_delete(sid: str, key: Optional[str] = None) -> dict:
    check_key(key)
    _show(sid)
    shows.delete(sid)
    return {"ok": True}


@app.get("/api/shared/{token}")
async def shared_get(token: str) -> dict:
    try:
        return shared_record(shows.by_share(token))
    except KeyError:
        raise HTTPException(404, "This link has expired or was turned off.")


@app.get("/api/shared/{token}/video")
async def shared_video(token: str) -> FileResponse:
    try:
        r = shows.by_share(token)
    except KeyError:
        raise HTTPException(404, "This link has expired or was turned off.")
    return FileResponse(shows.video(r["id"]), media_type=r.get("mime", "video/mp4"))


@app.post("/api/calls/{sid}/show/{show_id}")
async def show_attach(sid: str, show_id: str, key: Optional[str] = None) -> dict:
    """Use a clip's facts in this call: they become approvable replies and allowed facts for the guards."""
    check_key(key)
    c = get_session(sid)
    r = _show(show_id)
    if r.get("status") != "done":
        raise HTTPException(409, "That video is still being read. Try again in a moment.")
    return await c.attach_video(r["facts"], r["summary_say"], show_id)


class AskCallIn(BaseModel):
    question: str = ""          # "" = what the caller just said


@app.post("/api/calls/{sid}/ask-video")
async def call_ask_video(sid: str, body: AskCallIn, key: Optional[str] = None) -> dict:
    """The caller asked something the clip might answer: check the video and offer the answer as a
    fact to approve (with its frame). Nothing is said here."""
    check_key(key)
    c = get_session(sid)
    engine = state.get("video")
    if engine is None or not c.video_id:
        raise HTTPException(400, "Attach a video to this call first.")
    q = (body.question or c._last_caller_text).strip()
    if not q:
        raise HTTPException(400, "There's no question to check yet.")
    try:
        fact = await ask_video(engine, shows, c.video_id, q)
    except KeyError:
        raise HTTPException(404, "That video isn't here any more.")
    except Exception as e:
        log.warning("call ask video failed: %s", str(e)[:300])
        raise HTTPException(502, "Couldn't check the video just now. Try again.") from e
    if fact is None:
        return {"ok": True, "found": False, "question": q}
    await c.add_video_fact(fact)
    return {"ok": True, "found": True, "fact": fact, "question": q}


@app.websocket("/ws/bridge")
async def ws_bridge(ws: WebSocket, key: Optional[str] = None) -> None:
    """The desktop bridge (bridge/sign2speak_bridge.py) waits here for sentences to speak into a virtual mic."""
    if settings.app_access_key and not secrets.compare_digest(key or "", settings.app_access_key):
        await ws.close(code=1008)
        return
    await ws.accept()
    bridges.add(ws)
    await hub.broadcast({"type": "bridge", "count": len(bridges)})
    try:
        while True:
            m = await ws.receive_json()
            if m.get("type") == "played":
                latency.record("bridge_play_ms", float(m.get("ms", 0)))
                await hub.broadcast({"type": "bridge_played", "id": m.get("id"), "ok": bool(m.get("ok", True)),
                                     "device": str(m.get("device", ""))[:80]})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        bridges.discard(ws)
        await hub.broadcast({"type": "bridge", "count": len(bridges)})


class SayIn(BaseModel):
    text: str
    voice_id: Optional[str] = None


_meet_dup: dict[str, float] = {}


@app.post("/api/meet/say")
async def meet_say(body: SayIn, key: Optional[str] = None) -> dict:
    """An approved sentence for the meeting: every connected desktop bridge speaks it into its virtual mic."""
    check_key(key)
    text = body.text.strip()[:500]
    if not text:
        raise HTTPException(400, "Nothing to say.")
    from . import guards
    k, now = guards.normalize_line(text), time.time()
    if now - _meet_dup.get(k, 0) < 10:
        return {"ok": False, "reason": "You just said that.", "bridges": len(bridges)}
    _meet_dup[k] = now
    msg = {"type": "say", "id": secrets.token_hex(4), "text": text, "voice_id": body.voice_id or hub.voice_id}
    dead = []
    for b in list(bridges):
        try:
            await b.send_json(msg)
        except Exception:
            dead.append(b)
    for b in dead:
        bridges.discard(b)
    return {"ok": True, "id": msg["id"], "bridges": len(bridges)}


class TtsIn(BaseModel):
    text: str
    voice_id: Optional[str] = None
    style: str = ""                 # e.g. "warm and friendly" (Gemini speech style)


def _wav(pcm: bytes, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def tts_provider() -> str:
    if settings.elevenlabs_api_key:
        return "elevenlabs"
    if settings.gemini_api_key:
        return "gemini"
    return ""


@app.post("/api/tts")
async def tts(body: TtsIn, key: Optional[str] = None) -> Response:
    """Speech for meetings (Meet extension mic, desktop bridge). Phone calls don't use this: Twilio speaks there.
    Returns a WAV file. Uses ElevenLabs if ELEVENLABS_API_KEY is set (the signer's chosen voice),
    otherwise Gemini speech generation on the Gemini key."""
    check_key(key)
    import base64

    import httpx
    provider = tts_provider()
    if not provider:
        raise HTTPException(503, "The meeting voice isn't set up on the server (it needs a Gemini or ElevenLabs key).")
    text = body.text.strip()[:500]
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            if provider == "elevenlabs":
                vid = body.voice_id or hub.voice_id or settings.default_voice_id
                r = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{vid}", params={"output_format": "pcm_22050"},
                    headers={"xi-api-key": settings.elevenlabs_api_key},
                    json={"text": text, "model_id": settings.elevenlabs_model})
                r.raise_for_status()
                audio = _wav(r.content, 22050)
            else:
                # Gemini Interactions API, per ai.google.dev/gemini-api/docs/speech-generation (checked 2026-11-14).
                content: dict = {"type": "text", "text": text}
                if body.style:
                    content["annotations"] = [{"type": "speech_metadata", "style": body.style[:80]}]
                r = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/interactions",
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json={"model": settings.gemini_tts_model,
                          "input": [{"type": "user_input", "content": [content]}],
                          "response_format": {"type": "audio"},
                          "generation_config": {"speech_config": [{"voice": settings.gemini_tts_voice}]}})
                r.raise_for_status()
                parts = [c for st in r.json().get("steps", []) if st.get("type") == "model_output"
                         for c in st.get("content", []) if c.get("type") == "audio"]
                audio = base64.b64decode(parts[-1]["data"])
    except Exception as e:
        log.warning("tts (%s) failed: %s", provider, str(e)[:300])
        raise HTTPException(502, "Couldn't make the voice just now. Try again, or type in the meeting chat.") from e
    latency.record(f"tts_{provider}_ms", (time.perf_counter() - t0) * 1000)
    return Response(audio, media_type="audio/wav")


@app.exception_handler(Exception)
async def plain_errors(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled")
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


# ---------------------------------------------------------------- static app

@app.get("/ext-test")
async def ext_test() -> Response:
    """Stand-in meeting page for testing the Chrome extension (it matches /ext-test like Meet)."""
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "ext-test.html"))


from .rooms import router as rooms_router  # noqa: E402  browser video calls (must precede the SPA catch-all)

app.include_router(rooms_router)
app.include_router(grok_voice.router)

_static = settings.static_dir or os.path.join(os.path.dirname(__file__), "..", "..", "app", "dist")
if os.path.isdir(_static):
    app.mount("/assets", StaticFiles(directory=os.path.join(_static, "assets")), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str) -> FileResponse:
        f = os.path.normpath(os.path.join(_static, path))
        if path and f.startswith(os.path.normpath(_static)) and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(_static, "index.html"))


