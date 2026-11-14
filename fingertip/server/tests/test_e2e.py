"""End-to-end through the real HTTP + WebSocket endpoints, with Twilio faked.

Simulates: incoming webhook -> app sees ringing -> Answer -> ConversationRelay
connects -> caller speaks -> app gets captions + chips -> signer sends ->
relay receives the text -> app reloads mid-call and reattaches -> hang up.
"""
import json
import os
import tempfile
import time

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ["TWILIO_ACCOUNT_SID"] = ""       # keep local tokens.env out of deterministic tests
os.environ["GEMINI_API_KEY"] = ""
os.environ["LOG_DIR"] = os.path.join(tempfile.gettempdir(), "talkbridge-test-logs")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, sessions, state  # noqa: E402


def recv_until(ws, pred, limit=50):
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if pred(m):
            return m, seen
    raise AssertionError(f"never got it; saw {[s.get('type') for s in seen]}")


def test_health():
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["ok"] and h["brain"] == "rules" and h["twilio"] is False


def test_twilio_signature_required():
    os.environ["VALIDATE_TWILIO_SIGNATURE"] = "true"
    from app import config
    config.settings.validate_twilio_signature = True
    try:
        with TestClient(app) as c:
            r = c.post("/twilio/voice", data={"CallSid": "CA1", "From": "+14135550101"})
            assert r.status_code == 403
    finally:
        config.settings.validate_twilio_signature = False


def test_incoming_call_full_loop():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/app") as appws:
            appws.send_json({"type": "hello", "voice_id": "VOICE123", "contacts": [
                {"id": "mom", "name": "Mom", "number": "(413) 555-0101", "knows_sign": True, "kind": "person"}]})
            time.sleep(0.05)
            r = c.post("/twilio/voice", data={"CallSid": "CAin1", "From": "+14135550101"})
            assert r.status_code == 200 and "<Play" in r.text and "ringback.wav" in r.text
            ring, _ = recv_until(appws, lambda m: m["type"] == "ringing")
            assert ring["contact"]["name"] == "Mom"
            sid = ring["sid"]
            assert len(sid) >= 20

            assert c.post(f"/api/calls/{sid}/answer").json()["ok"]
            fake = state["telephony"]
            kind, call_sid, twiml = fake.calls[-1]
            assert kind == "update" and call_sid == "CAin1"
            assert "ConversationRelay" in twiml and f"/ws/relay/{sid}" in twiml and "VOICE123" in twiml

            with c.websocket_connect(f"/ws/relay/{sid}") as relayws:
                relayws.send_text(json.dumps({"type": "setup", "callSid": "CAin1", "from": "+14135550101"}))
                hey = json.loads(relayws.receive_text())
                assert hey["type"] == "text" and hey["token"] == "Hey!" and hey["last"] is True

                relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Hi sweetie, are you", "last": False}))
                cap, _ = recv_until(appws, lambda m: m["type"] == "caption")
                assert cap["line"]["status"] == "partial"
                relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Hi sweetie, are you coming Sunday?",
                                              "last": True}))
                turn, _ = recv_until(appws, lambda m: m["type"] == "turn")
                assert turn["analysis"]["question_type"] == "yes_no" and turn["analysis"]["chips"]

                d = c.post(f"/api/calls/{sid}/signs", json={"signs": ["YES", "SUNDAY", "COME"], "tone": "warm"}).json()
                assert "Sunday" in d["draft"]["text"] and d["draft"]["level"] == "quick"
                r = c.post(f"/api/calls/{sid}/send", json={"text": d["draft"]["text"], "source": "draft",
                                                           "draft_id": d["draft"]["id"], "hash": d["draft"]["hash"]}).json()
                assert r["ok"]
                spoken = json.loads(relayws.receive_text())
                assert spoken["token"] == d["draft"]["text"]

                # Same line again within 10 s is refused.
                r2 = c.post(f"/api/calls/{sid}/send", json={"text": d["draft"]["text"], "source": "typed"}).json()
                assert r2["ok"] is False

        # App reload mid-call: a new socket gets the full snapshot.
        with c.websocket_connect("/ws/app") as appws2:
            snap, _ = recv_until(appws2, lambda m: m["type"] == "snapshot" and m["sid"] == sid)
            assert any("Sunday" in l["text"] for l in snap["lines"] if l["who"] == "me")
            assert any(l["who"] == "caller" for l in snap["lines"])

            assert c.post(f"/api/calls/{sid}/hangup").json()["ok"]
            ended, _ = recv_until(appws2, lambda m: m["type"] == "ended")
            assert ended["recap"]
        assert ("hangup", "CAin1") in state["telephony"].calls


def test_outgoing_call_with_confirm():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "413-555-0103", "name": "Antonio's Pizza", "kind": "business",
                                       "note": "order garlic bread and wings, name Shruti, tell me the total first"})
        assert r.status_code == 200, r.text
        body = r.json()
        sid = body["sid"]
        assert any(f["key"] == "name" for f in body["note_facts"])
        kind, to, twiml = state["telephony"].calls[-1]
        assert kind == "dial" and to == "+14135550103"
        call_sid = sessions[sid].call_sid
        with c.websocket_connect("/ws/app") as appws, c.websocket_connect(f"/ws/relay/{sid}") as relayws:
            relayws.send_text(json.dumps({"type": "setup", "callSid": call_sid}))
            relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Antonio's, what can I get you?",
                                          "last": True}))
            intro = json.loads(relayws.receive_text())
            assert "deaf" in intro["token"]
            relayws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Your total is $23.40, okay?",
                                          "last": True}))
            recv_until(appws, lambda m: m["type"] == "turn" and m["analysis"]["involves_money"])
            r = c.post(f"/api/calls/{sid}/send", json={"text": "Yes, that's fine.", "source": "chip"}).json()
            assert r.get("confirm") is True
            conf, _ = recv_until(appws, lambda m: m["type"] == "confirm")
            assert "$23.40" in conf["summary"]
            assert c.post(f"/api/calls/{sid}/confirm", json={"decision": "yes"}).json()["ok"] is False   # no hash
            conf, _ = recv_until(appws, lambda m: m["type"] == "confirm")
            assert c.post(f"/api/calls/{sid}/confirm", json={"decision": "yes", "hash": conf["hash"]}).json()["ok"]


def test_relay_rejects_wrong_call_sid():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "4135550199"})
        sid = r.json()["sid"]
        with c.websocket_connect(f"/ws/relay/{sid}") as relayws:
            relayws.send_text(json.dumps({"type": "setup", "callSid": "CAnotthisone"}))
            try:
                relayws.receive_text()
                raise AssertionError("socket should have closed")
            except Exception as e:
                assert "1008" in repr(e) or "Disconnect" in type(e).__name__


def test_bad_number_plain_error():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "12"})
        assert r.status_code == 400 and "number" in r.json()["detail"]


def test_interrupt_keeps_the_rest():
    import asyncio
    from app.ai import RulesBrain
    from app.controller import Contact, Controller

    async def go():
        c = Controller("t", Contact(name="Mom", knows_sign=True), RulesBrain(), direction="incoming", time_scale=0.01)
        sent = []

        async def s(m):
            sent.append(m)
        await c.attach_relay(s, {"callSid": "CA"})
        await asyncio.sleep(0.05)
        await c.on_prompt("Are you coming Sunday?", True)
        await c.send("Yeah! I'll be there Sunday. What should I bring?", "typed")
        await c.on_interrupt("Yeah! I'll be there")
        line = [l for l in c.lines if l.who == "me"][-1]
        assert line.status == "interrupted" and line.heard == "Yeah! I'll be there"
        assert c.draft.text == "Sunday. What should I bring?"
        r = await c.send(c.draft.text, "draft", draft_id=c.draft.id, hash=c.draft.hash)
        assert r["ok"]
    asyncio.run(go())


def test_note_parse_endpoint():
    with TestClient(app) as c:
        r = c.post("/api/note/parse", json={"note": "order garlic bread and wings, name Shruti, tell me the total first"})
        j = r.json()
        assert {f["key"] for f in j["auto_facts"]} == {"order", "name"} and j["needs_confirmation"]


def test_relay_handshake_signature():
    """With validation on, the ConversationRelay socket needs a valid X-Twilio-Signature."""
    from twilio.request_validator import RequestValidator
    from app import config
    config.settings.validate_twilio_signature = True
    config.settings.twilio_auth_token = "secret-token"
    try:
        with TestClient(app) as c:
            config.settings.validate_twilio_signature = False
            sid = c.post("/api/calls", json={"number": "4135550198"}).json()["sid"]
            config.settings.validate_twilio_signature = True
            try:
                with c.websocket_connect(f"/ws/relay/{sid}") as ws:
                    ws.receive_text()
                raise AssertionError("unsigned handshake accepted")
            except AssertionError:
                raise
            except Exception:
                pass
            sig = RequestValidator("secret-token").compute_signature(f"wss://s2s.test/ws/relay/{sid}", {})
            with c.websocket_connect(f"/ws/relay/{sid}", headers={"X-Twilio-Signature": sig}) as ws:
                ws.send_text(json.dumps({"type": "setup", "callSid": sessions[sid].call_sid}))
    finally:
        config.settings.validate_twilio_signature = False
        config.settings.twilio_auth_token = ""


def test_voice_string_v4_and_tags():
    from app import config, relay
    s = config.settings
    old = (s.tts_model, s.tts_voice_settings)
    try:
        s.tts_model, s.tts_voice_settings = "v4", "1.1_0.5_0.8"
        assert s.voice_string("VID") == "VID-v4"            # no speed/settings with v4
        assert relay.spoken_token("Yeah!", "warm") == "[warmly] Yeah!"
        s.tts_model = "flash_v2_5"
        assert s.voice_string("VID") == "VID-flash_v2_5-1.1_0.5_0.8"
        assert relay.spoken_token("Yeah!", "warm") == "Yeah!"
        twiml = relay.relay_twiml("x")
        assert 'partialPrompts="true"' in twiml and 'interruptible="any"' in twiml and 'echoPromptFiltering="true"' in twiml
    finally:
        s.tts_model, s.tts_voice_settings = old


def test_dial_rate_limit_and_bridge():
    from app import config, main
    main.recent_dials.clear()
    old = config.settings.dial_max_per_min, config.settings.max_live_calls
    config.settings.dial_max_per_min, config.settings.max_live_calls = 2, 99
    try:
        with TestClient(app) as c:
            assert c.post("/api/calls", json={"number": "4135550150"}).status_code == 200
            assert c.post("/api/calls", json={"number": "4135550151"}).status_code == 200
            r = c.post("/api/calls", json={"number": "4135550152"})
            assert r.status_code == 429 and "Wait" in r.json()["detail"]
            # Desktop bridge: an approved sentence reaches it once; a repeat within 10 s doesn't.
            with c.websocket_connect("/ws/bridge") as b:
                r = c.post("/api/meet/say", json={"text": "I think Friday works."}).json()
                assert r["ok"] and r["bridges"] == 1
                m = b.receive_json()
                assert m["type"] == "say" and m["text"] == "I think Friday works."
                assert c.post("/api/meet/say", json={"text": "I think Friday works."}).json()["ok"] is False
                assert c.get("/api/health").json()["bridges"] == 1
    finally:
        config.settings.dial_max_per_min, config.settings.max_live_calls = old
        main.recent_dials.clear()


def test_relay_ended_reconnects_only_on_failure():
    with TestClient(app) as c:
        from app import config, main
        main.recent_dials.clear()
        config.settings.max_live_calls = 99      # earlier tests leave calls open
        sid = c.post("/api/calls", json={"number": "4135550160"}).json()["sid"]
        r = c.post(f"/twilio/relay-ended/{sid}", data={"SessionStatus": "failed", "CallStatus": "in-progress", "ErrorCode": "64105"})
        assert "ConversationRelay" in r.text
        sid2 = c.post("/api/calls", json={"number": "4135550161"}).json()["sid"]
        r = c.post(f"/twilio/relay-ended/{sid2}", data={"SessionStatus": "completed", "CallStatus": "completed"})
        assert "ConversationRelay" not in r.text and sessions[sid2].state == "ENDED"


def test_modes_ai_preview_exact_and_captions_only():
    """Mode changes are server-enforced and do not reconnect the phone relay."""
    with TestClient(app) as c:
        from app import main
        main.recent_dials.clear()
        sid = c.post("/api/calls", json={"number": "4135550170", "name": "Mom", "knows_sign": True}).json()["sid"]
        with c.websocket_connect(f"/ws/relay/{sid}") as relay_ws:
            relay_ws.send_text(json.dumps({"type": "setup", "callSid": sessions[sid].call_sid}))

            mode = c.post(f"/api/calls/{sid}/mode", json={"mode": "ai_assist"}).json()
            assert mode == {"ok": True, "mode": "ai_assist"}
            preview = c.post(f"/api/calls/{sid}/compose", json={"text": "yes home 6", "mode": "ai_assist"}).json()
            assert preview["spoken"] is False and preview["requires_approval"] is True
            assert preview["draft"]["text"] == "Yes, Mom, I'll be home around six."

            # Approving the sealed draft sends exactly the displayed text.
            d = preview["draft"]
            sent = c.post(f"/api/calls/{sid}/send", json={"text": d["text"], "source": "draft",
                          "draft_id": d["id"], "hash": d["hash"], "mode": "ai_assist"}).json()
            assert sent["ok"]
            assert json.loads(relay_ws.receive_text())["token"] == d["text"]

            exact = "Coming home now."
            sent = c.post(f"/api/calls/{sid}/send", json={"text": exact, "source": "typed",
                          "mode": "exact_words"}).json()
            assert sent["ok"]
            assert json.loads(relay_ws.receive_text())["token"] == exact

            # Caption reaches app state only; there is no relay WebSocket text to consume.
            cap = c.post(f"/api/calls/{sid}/send", json={"text": "I am signing now.", "source": "typed",
                         "mode": "captions_only"}).json()
            assert cap == {"ok": True, "spoken": False, "caption": "I am signing now."}
            assert sessions[sid].lines[-1].kind == "caption"


def test_incoming_webhook_retry_is_idempotent():
    with TestClient(app) as c:
        before = len(sessions)
        first = c.post("/twilio/voice", data={"CallSid": "CAretry1", "From": "+14135550101"})
        second = c.post("/twilio/voice", data={"CallSid": "CAretry1", "From": "+14135550101"})
        assert first.status_code == second.status_code == 200
        assert len(sessions) == before + 1


def test_voice_string_v4_accepts_only_two_settings():
    from app import config
    s = config.settings
    old = (s.tts_model, s.tts_voice_settings)
    try:
        s.tts_model, s.tts_voice_settings = "v4", "0.45_0.80"
        assert s.voice_string("VID") == "VID-v4-0.45_0.80"
        s.tts_voice_settings = "1.0_0.45_0.80"  # speed is invalid for v4
        assert s.voice_string("VID") == "VID-v4"
    finally:
        s.tts_model, s.tts_voice_settings = old


