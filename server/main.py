"""TalkBridge server: one live phone call at a time, for one user.

Browser  <-- /ws -->  this server  <-- /twilio/relay (ConversationRelay WebSocket) -->  Twilio  <-->  phone
Twilio does speech-to-text (caller -> captions) and text-to-speech (approved text -> caller).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from twilio.request_validator import RequestValidator
from twilio.rest import Client
from twilio.twiml.voice_response import Connect, VoiceResponse

from . import ai, guards

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("talkbridge")

SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
FROM = os.getenv("TWILIO_NUMBER", "")
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
VALIDATE = os.getenv("VALIDATE_TWILIO_SIGNATURE", "true").lower() != "false"
GREETING = os.getenv("GREETING", "Hi! I'm Deaf, so an app is reading your words to me and speaking my typed "
                                 "replies. Please give me a moment to answer.")
DIAL_COOLDOWN_S = 10
E164 = re.compile(r"^\+[1-9]\d{7,14}$")

app = FastAPI(title="TalkBridge")


# ---------------------------------------------------------------- state (single user)

class CallState:
    def __init__(self) -> None:
        self.reset()
        self.last_dial = 0.0

    def reset(self) -> None:
        self.sid: str | None = None
        self.to: str = ""
        self.status: str = "idle"          # idle | queued | ringing | in-progress | completed | failed ...
        self.started: float | None = None
        self.relay: WebSocket | None = None
        self.turns: list[dict] = []        # {"who": "them"|"me", "text", "ts", "state"}
        self.partial: str = ""
        self.sent_ids: dict[str, dict] = {}  # request id -> result (a retried tap is never spoken twice)
        self.speaking_turn: dict | None = None

    def history(self) -> list[str]:
        return [f'{"Caller" if t["who"] == "them" else "Me"}: {t["text"]}' for t in self.turns[-10:]]

    def last_caller_line(self) -> str:
        for t in reversed(self.turns):
            if t["who"] == "them":
                return t["text"]
        return ""

    def snapshot(self) -> dict:
        return {"type": "snapshot", "sid": self.sid, "to": self.to, "status": self.status,
                "started": self.started, "turns": self.turns, "partial": self.partial,
                "relay": self.relay is not None}


call = CallState()
browsers: set[WebSocket] = set()


async def push(msg: dict) -> None:
    msg.setdefault("ts", time.time())
    for ws in list(browsers):
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            browsers.discard(ws)


def twilio_client() -> Client:
    if not (SID and TOKEN and FROM):
        raise HTTPException(503, "Twilio isn't configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER in .env)")
    return Client(SID, TOKEN)


def require_public_url() -> str:
    if not PUBLIC_URL.startswith("https://"):
        raise HTTPException(503, "PUBLIC_URL must be the public https:// address of this server (e.g. the cloudflared tunnel)")
    return PUBLIC_URL


async def check_twilio_signature(request: Request) -> dict[str, Any]:
    form = dict(await request.form())
    if not VALIDATE:
        return form
    url = PUBLIC_URL + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    sig = request.headers.get("X-Twilio-Signature", "")
    if not RequestValidator(TOKEN).validate(url, form, sig):
        log.warning("rejected webhook with bad signature for %s", url)
        raise HTTPException(403, "bad signature")
    return form


# ---------------------------------------------------------------- browser API

class DialIn(BaseModel):
    to: str


class SayIn(BaseModel):
    text: str
    request_id: str
    confirmed: bool = False


class SuggestIn(BaseModel):
    hint: str = ""


@app.get("/api/health")
async def health() -> dict:
    return {
        "twilio": bool(SID and TOKEN and FROM),
        "public_url": PUBLIC_URL or None,
        "validate_signatures": VALIDATE,
        "gemini": await ai.check_model(),
        "call": {"status": call.status, "relay": call.relay is not None},
    }


@app.post("/api/call")
async def dial(body: DialIn) -> dict:
    to = re.sub(r"[\s().-]", "", body.to)
    if not E164.match(to):
        raise HTTPException(400, "Use the full number with country code, like +14135550123")
    if call.status in ("queued", "initiated", "ringing", "in-progress"):
        raise HTTPException(409, "A call is already active")
    if time.time() - call.last_dial < DIAL_COOLDOWN_S:
        raise HTTPException(429, "Please wait a few seconds before dialing again")
    base = require_public_url()
    client = twilio_client()
    call.reset()
    call.last_dial = time.time()
    call.to = to
    try:
        c = await asyncio.to_thread(
            client.calls.create, to=to, from_=FROM, url=f"{base}/twilio/twiml",
            status_callback=f"{base}/twilio/status",
            status_callback_event=["initiated", "ringing", "answered", "completed"],
        )
    except Exception as e:
        call.status = "failed"
        await push({"type": "status", "status": "failed", "error": str(e)[:200]})
        raise HTTPException(502, f"Twilio refused the call: {str(e)[:200]}")
    call.sid = c.sid
    call.status = "queued"
    await push({"type": "status", "status": "queued", "sid": c.sid, "to": to})
    return {"sid": c.sid}


@app.post("/api/hangup")
async def hangup() -> dict:
    if not call.sid:
        return {"ok": True}
    try:
        await asyncio.to_thread(twilio_client().calls(call.sid).update, status="completed")
    except Exception as e:
        log.warning("hangup: %s", e)
    return {"ok": True}


@app.post("/api/say")
async def say(body: SayIn) -> dict:
    """Speak an approved line to the caller. Money/bookings need confirmed=true."""
    if body.request_id in call.sent_ids:
        return call.sent_ids[body.request_id]          # retry of the same tap: never spoken twice
    text = body.text.strip()[:400]
    if not text:
        raise HTTPException(400, "Nothing to say")
    if guards.needs_confirmation(text) and not body.confirmed:
        return {"ok": False, "needs_confirm": True,
                "reason": "This mentions money, an order or a booking. Confirm you want to say it."}
    if not call.relay:
        raise HTTPException(409, "The call isn't connected")
    await call.relay.send_text(json.dumps({"type": "text", "token": text, "last": True}))
    turn = {"who": "me", "text": text, "ts": time.time(), "state": "spoken"}
    call.turns.append(turn)
    call.speaking_turn = turn
    await push({"type": "turn", "turn": turn})
    res = {"ok": True}
    call.sent_ids[body.request_id] = res
    return res


@app.post("/api/suggest")
async def suggest(body: SuggestIn) -> dict:
    return await ai.suggest(call.last_caller_line(), body.hint[:200], call.history())


@app.websocket("/ws")
async def browser_ws(ws: WebSocket) -> None:
    await ws.accept()
    browsers.add(ws)
    await ws.send_text(json.dumps(call.snapshot()))
    try:
        while True:
            await ws.receive_text()   # browser only listens; actions go through the HTTP API
    except WebSocketDisconnect:
        pass
    finally:
        browsers.discard(ws)


# ---------------------------------------------------------------- Twilio

@app.post("/twilio/twiml")
async def twiml(request: Request) -> Response:
    await check_twilio_signature(request)
    r = VoiceResponse()
    c = Connect()
    c.conversation_relay(
        url=require_public_url().replace("https://", "wss://") + "/twilio/relay",
        welcome_greeting=GREETING,
        partial_prompts=True,
        interruptible="speech",
    )
    r.append(c)
    return Response(str(r), media_type="application/xml")


@app.post("/twilio/status")
async def status(request: Request) -> dict:
    form = await check_twilio_signature(request)
    if form.get("CallSid") != call.sid:
        return {"ok": True}
    st = str(form.get("CallStatus", ""))
    call.status = st
    if st == "in-progress" and not call.started:
        call.started = time.time()
    await push({"type": "status", "status": st, "started": call.started})
    return {"ok": True}


@app.websocket("/twilio/relay")
async def relay(ws: WebSocket) -> None:
    if VALIDATE:
        sig = ws.headers.get("x-twilio-signature", "")
        url = PUBLIC_URL.replace("https://", "wss://") + "/twilio/relay"
        v = RequestValidator(TOKEN)
        if not (v.validate(url, {}, sig) or v.validate(url.replace("wss://", "https://"), {}, sig)):
            log.warning("relay handshake rejected (bad signature)")
            await ws.close(code=1008)
            return
    await ws.accept()
    call.relay = ws
    await push({"type": "relay", "connected": True})
    try:
        while True:
            m = json.loads(await ws.receive_text())
            kind = m.get("type")
            if kind == "setup":
                log.info("relay setup for %s", m.get("callSid"))
            elif kind == "prompt":
                text = (m.get("voicePrompt") or "").strip()
                if m.get("last"):
                    call.partial = ""
                    if text:
                        turn = {"who": "them", "text": text, "ts": time.time(), "state": "final"}
                        call.turns.append(turn)
                        await push({"type": "turn", "turn": turn})
                else:
                    call.partial = text
                    await push({"type": "partial", "text": text})
            elif kind == "interrupt":
                t = call.speaking_turn
                if t and t["who"] == "me":
                    t["state"] = "cut off"
                    t["heard"] = m.get("utteranceUntilInterrupt", "")
                    await push({"type": "interrupted", "turn": t})
            elif kind == "error":
                log.warning("relay error: %s", m.get("description"))
                await push({"type": "error", "message": m.get("description", "Call error")})
    except WebSocketDisconnect:
        pass
    finally:
        if call.relay is ws:
            call.relay = None
        await push({"type": "relay", "connected": False})


# ---------------------------------------------------------------- web app

WEB = ROOT / "web"
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


