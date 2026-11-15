"""Grok voice bridge against a fake xAI realtime server and fake Twilio Media Stream events.

The fake xAI server is a real `websockets` server on 127.0.0.1 in its own thread, so the bridge's
real connect/auth path runs. Nothing here touches the live xAI API.
"""
import asyncio
import base64
import json
import os
import threading
import time

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ["XAI_API_KEY"] = "test-key"
os.environ["GROK_VOICE"] = "eve"

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

from app import grok_voice  # noqa: E402
from app.grok_voice import bridges, configure, facts_of, needs_verbatim, router, stream_twiml  # noqa: E402


class FakeXAI:
    """Speaks the documented server events. `say` overrides what the 'model' says in the next response."""

    def __init__(self) -> None:
        self.received: list[dict] = []
        self.headers: dict = {}
        self.path = ""
        self.ws = None
        self.say: str | None = None
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        self.n = 0
        threading.Thread(target=self._run, daemon=True).start()
        assert self.ready.wait(5)

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)

        async def main():
            async with serve(self._handler, "127.0.0.1", 0) as server:
                self.port = server.sockets[0].getsockname()[1]
                self.ready.set()
                await asyncio.Future()

        self.loop.run_until_complete(main())

    async def _handler(self, ws) -> None:
        self.ws = ws
        self.headers = dict(ws.request.headers)
        self.path = ws.request.path
        await ws.send(json.dumps({"type": "session.created", "session": {}}))
        await ws.send(json.dumps({"type": "conversation.created", "conversation": {"id": "conv1"}}))
        async for raw in ws:
            m = json.loads(raw)
            self.received.append(m)
            t = m["type"]
            if t == "session.update":
                await ws.send(json.dumps({"type": "session.updated", "session": m["session"]}))
            elif t == "conversation.item.create" and m["item"]["type"] == "force_message":
                text = m["item"]["content"][0]["text"]
                await self._respond(ws, self.say if self.say is not None else text)
                self.say = None
            elif t == "response.create":
                await self._respond(ws, self.say or "Okay.")
                self.say = None

    async def _respond(self, ws, transcript: str) -> None:
        self.n += 1
        rid = f"resp{self.n}"
        await ws.send(json.dumps({"type": "response.created", "response": {"id": rid}}))
        audio = base64.b64encode(transcript.encode()).decode()     # stands in for u-law bytes
        await ws.send(json.dumps({"type": "response.output_audio.delta", "response_id": rid, "delta": audio}))
        await ws.send(json.dumps({"type": "response.output_audio_transcript.delta", "response_id": rid,
                                  "delta": transcript}))
        await ws.send(json.dumps({"type": "response.output_audio.done", "response_id": rid}))
        await ws.send(json.dumps({"type": "response.output_audio_transcript.done", "response_id": rid,
                                  "transcript": transcript}))
        await ws.send(json.dumps({"type": "response.done", "response": {"id": rid}}))

    def send(self, msg: dict) -> None:
        asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(msg)), self.loop).result(5)

    def wait_for(self, pred, timeout=5.0) -> dict:
        end = time.time() + timeout
        while time.time() < end:
            for m in list(self.received):
                if pred(m):
                    return m
            time.sleep(0.01)
        raise AssertionError(f"fake xAI never got it; got {[m['type'] for m in self.received]}")


@pytest.fixture
def env():
    fake = FakeXAI()
    os.environ["GROK_REALTIME_URL"] = f"ws://127.0.0.1:{fake.port}/v1/realtime"
    os.environ["GROK_VOICE_MODEL"] = "grok-voice-latest"
    events: list[dict] = []

    async def emit(msg: dict) -> None:
        events.append(msg)

    ctx = {"s1": {"name": "Maya", "knows_sign": False, "kind": "business"}}
    configure(lambda sid: ctx.get(sid), emit)

    app = FastAPI()
    app.include_router(router)

    @app.post("/reply/{sid}")
    async def reply(sid: str, body: dict) -> dict:
        return await bridges[sid].deliver_reply(body["text"], body.get("verbatim", False))

    with TestClient(app) as client:
        yield client, fake, events
    os.environ.pop("GROK_REALTIME_URL", None)


def wait_event(events, pred, timeout=5.0) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        for e in list(events):
            if pred(e):
                return e
        time.sleep(0.01)
    raise AssertionError(f"never emitted; got {[e.get('type') for e in events]}")


def recv_until(tw, pred, limit=40):
    """Read Twilio-bound messages, echoing marks back like Twilio does after playback."""
    seen = []
    for _ in range(limit):
        m = tw.receive_json()
        seen.append(m)
        if m.get("event") == "mark":
            tw.send_json({"event": "mark", "streamSid": m["streamSid"], "sequenceNumber": "9", "mark": m["mark"]})
        if pred(m):
            return m, seen
    raise AssertionError(f"twilio never got it; saw {seen}")


def start_call(tw, fake):
    tw.send_json({"event": "connected", "protocol": "Call", "version": "1.0.0"})
    tw.send_json({"event": "start", "sequenceNumber": "1", "streamSid": "MZ1",
                  "start": {"streamSid": "MZ1", "callSid": "CA1", "tracks": ["inbound"],
                            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
                            "customParameters": {"sid": "s1"}}})
    return fake.wait_for(lambda m: m["type"] == "session.update")


def ask(fake, call_id, question):
    fake.send({"type": "response.created", "response": {"id": f"q-{call_id}"}})
    fake.send({"type": "response.function_call_arguments.done", "response_id": f"q-{call_id}", "call_id": call_id,
               "name": "get_reply", "arguments": json.dumps({"question": question})})
    fake.send({"type": "response.done", "response": {"id": f"q-{call_id}"}})


# ---------------------------------------------------------------- unit bits


def test_stream_twiml_and_facts():
    x = stream_twiml("s1")
    assert '<Connect><Stream url="wss://s2s.test/ws/grok-media/s1"><Parameter name="sid" value="s1" />' in x
    assert facts_of("5:30") == facts_of("five thirty") == {"5", "30"}
    assert facts_of("$45") == facts_of("forty-five dollars") == {"45"}
    assert needs_verbatim("See you at 5:30") and needs_verbatim("my booking") and not needs_verbatim("Sure, thanks!")


def test_enabled_flag(monkeypatch):
    monkeypatch.setenv("VOICE_ENGINE", "relay")
    assert not grok_voice.grok_enabled()
    monkeypatch.setenv("VOICE_ENGINE", "grok")
    assert grok_voice.grok_enabled()
    monkeypatch.setenv("XAI_API_KEY", "")
    assert not grok_voice.grok_enabled()


def test_unknown_session_rejected(env):
    client, fake, events = env
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/grok-media/nope") as tw:
            tw.receive_json()


# ---------------------------------------------------------------- through the sockets


def test_session_and_audio_passthrough_both_ways(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        su = start_call(tw, fake)
        assert fake.headers.get("authorization") == "Bearer test-key"
        assert "model=grok-voice-latest" in fake.path
        s = su["session"]
        assert s["audio"]["input"]["format"]["type"] == "audio/pcmu"
        assert s["audio"]["output"]["format"]["type"] == "audio/pcmu"
        assert s["turn_detection"]["type"] == "server_vad"
        assert s["voice"] == "eve" and s["reasoning"] == {"effort": "none"}
        assert s["tools"][0]["name"] == "get_reply"
        assert "Maya" in s["instructions"] and "deaf" in s["instructions"].lower()

        payload = base64.b64encode(bytes(range(0, 160))).decode()    # 20 ms of u-law
        tw.send_json({"event": "media", "streamSid": "MZ1", "media": {"track": "inbound", "payload": payload}})
        got = fake.wait_for(lambda m: m["type"] == "input_audio_buffer.append")
        assert got["audio"] == payload                                # byte-identical, no transcoding

        out = base64.b64encode(bytes(range(255, 95, -1))).decode()
        fake.send({"type": "response.created", "response": {"id": "r1"}})
        fake.send({"type": "response.output_audio.delta", "response_id": "r1", "delta": out})
        m, _ = recv_until(tw, lambda m: m.get("event") == "media")
        assert m == {"event": "media", "streamSid": "MZ1", "media": {"payload": out}}

        fake.send({"type": "conversation.item.input_audio_transcription.completed", "item_id": "i1",
                   "transcript": "Hi, this is the dentist."})
        e = wait_event(events, lambda e: e["type"] == "caption")
        assert e["line"]["text"] == "Hi, this is the dentist." and e["line"]["who"] == "caller" and e["sid"] == "s1"
        tw.send_json({"event": "stop", "streamSid": "MZ1"})


def test_barge_in_clears_twilio_and_cancels(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        fake.send({"type": "response.created", "response": {"id": "r9"}})
        fake.send({"type": "response.output_audio.delta", "response_id": "r9", "delta": "AAAA"})
        recv_until(tw, lambda m: m.get("event") == "media")
        fake.send({"type": "input_audio_buffer.speech_started", "item_id": "i2", "audio_start_ms": 100})
        m, _ = recv_until(tw, lambda m: m.get("event") == "clear")
        assert m == {"event": "clear", "streamSid": "MZ1"}
        c = fake.wait_for(lambda m: m["type"] == "response.cancel")
        assert c.get("response_id") == "r9"


def test_get_reply_then_plain_reply(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        ask(fake, "c1", "Do you want the window seat?")
        e = wait_event(events, lambda e: e["type"] == "needs_reply")
        assert e["question"] == "Do you want the window seat?" and e["sid"] == "s1"
        assert wait_event(events, lambda e: e["type"] == "caption" and e["line"].get("kind") == "question")

        fake.say = "Yes please, the window seat."
        r = client.post("/reply/s1", json={"text": "Yes please, window seat"}).json()
        assert r["answered"] and r["verbatim"] is False
        out = fake.wait_for(lambda m: m["type"] == "conversation.item.create"
                            and m["item"]["type"] == "function_call_output")
        assert out["item"]["call_id"] == "c1"
        assert json.loads(out["item"]["output"]) == {"text": "Yes please, window seat", "verbatim": False}
        fake.wait_for(lambda m: m["type"] == "response.create")
        recv_until(tw, lambda m: m.get("event") == "media")
        lat = wait_event(events, lambda e: e["type"] == "latency")
        assert lat["metric"] == "reply_to_first_audio" and lat["ms"] >= 0
        time.sleep(0.2)
        assert not [e for e in events if e.get("kind") == "safety_mismatch"]


def test_verbatim_for_time(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        ask(fake, "c2", "What time works?")
        wait_event(events, lambda e: e["type"] == "needs_reply")
        r = client.post("/reply/s1", json={"text": "5:30 on Tuesday works"}).json()
        assert r["verbatim"] is True
        fm = fake.wait_for(lambda m: m["type"] == "conversation.item.create" and m["item"]["type"] == "force_message")
        assert fm["item"]["role"] == "assistant"
        assert fm["item"]["content"] == [{"type": "output_text", "text": "5:30 on Tuesday works"}]
        out = fake.wait_for(lambda m: m["type"] == "conversation.item.create"
                            and m["item"]["type"] == "function_call_output")
        assert json.loads(out["item"]["output"])["verbatim"] is True
        # the tool output came before the force_message, and no response.create follows a force_message
        idx = {id(m): i for i, m in enumerate(fake.received)}
        assert idx[id(out)] < idx[id(fm)]
        recv_until(tw, lambda m: m.get("event") == "media")
        time.sleep(0.2)
        assert not [m for m in fake.received if m["type"] == "response.create"]


def test_waits_for_playback_before_speaking(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        # Grok says the holding phrase and calls the tool in the same response.
        fake.send({"type": "response.created", "response": {"id": "h1"}})
        fake.send({"type": "response.output_audio.delta", "response_id": "h1", "delta": "SE9MRA=="})
        fake.send({"type": "response.output_audio.done", "response_id": "h1"})
        fake.send({"type": "response.function_call_arguments.done", "response_id": "h1", "call_id": "c3",
                   "name": "get_reply", "arguments": json.dumps({"question": "Name for the booking?"})})
        fake.send({"type": "response.done", "response": {"id": "h1"}})
        wait_event(events, lambda e: e["type"] == "needs_reply")
        mark = tw.receive_json()
        while mark.get("event") != "mark":
            mark = tw.receive_json()
        client.post("/reply/s1", json={"text": "Maya Lin"})
        time.sleep(0.3)
        assert not [m for m in fake.received if m["type"] == "conversation.item.create"]   # still playing
        tw.send_json({"event": "mark", "streamSid": "MZ1", "mark": mark["mark"]})          # playback done
        fake.wait_for(lambda m: m["type"] == "conversation.item.create")


def test_mismatch_forces_verbatim(env):
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        ask(fake, "c4", "Can you come in?")
        wait_event(events, lambda e: e["type"] == "needs_reply")
        fake.say = "Yes, I can come in at 3."            # model invents a time
        client.post("/reply/s1", json={"text": "Yes I can come in"})
        recv_until(tw, lambda m: m.get("event") == "mark")       # played; echoed back to the bridge
        n = wait_event(events, lambda e: e.get("kind") == "safety_mismatch")
        assert n["approved"] == "Yes I can come in" and n["extra"] == ["3"]
        assert bridges["s1"].force_verbatim

        ask(fake, "c5", "Anything else?")
        wait_event(events, lambda e: e["type"] == "needs_reply" and e["call_id"] == "c5")
        r = client.post("/reply/s1", json={"text": "No that's all, thanks"}).json()
        assert r["verbatim"] is True
        fake.wait_for(lambda m: m["type"] == "conversation.item.create" and m["item"]["type"] == "force_message")


def test_reply_timeout_holds_then_speaks_late(env, monkeypatch):
    monkeypatch.setattr(grok_voice, "REPLY_TIMEOUT_S", 0.3)
    client, fake, events = env
    with client.websocket_connect("/ws/grok-media/s1") as tw:
        start_call(tw, fake)
        ask(fake, "c6", "Is Friday ok?")
        wait_event(events, lambda e: e.get("kind") == "reply_timeout")
        hold = fake.wait_for(lambda m: m["type"] == "conversation.item.create" and m["item"]["type"] == "force_message")
        assert "give me a moment" in hold["item"]["content"][0]["text"].lower()
        recv_until(tw, lambda m: m.get("event") == "mark")
        client.post("/reply/s1", json={"text": "Friday is fine"})
        fake.wait_for(lambda m: m["type"] == "conversation.item.create" and m["item"]["type"] == "force_message"
                      and m["item"]["content"][0]["text"] == "Friday is fine")
