"""Other-language calls (M6): TwiML, API gating and the translation guard."""
import os

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ["TWILIO_ACCOUNT_SID"] = ""
os.environ["GEMINI_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app import relay  # noqa: E402
from app.main import app, state  # noqa: E402
from app.translate import LANGS, lang_for, translation_guard  # noqa: E402

ES = LANGS["es-US"]


def test_twiml_language():
    assert 'language="en-US"' in relay.relay_twiml("s1")
    assert 'language="es-US"' in relay.relay_twiml("s1", language="es-US")


def test_lang_for():
    assert lang_for("") is None and lang_for("en-GB") is None
    assert lang_for("es-MX").code == "es-US"
    assert lang_for("xx-YY") is None


def test_health_lists_languages():
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["languages"]["available"] is False          # rules brain can't translate
        assert {l["code"] for l in h["languages"]["list"]} >= {"en-US", "es-US", "fr-FR", "pt-BR"}


def test_dial_in_spanish_needs_gemini():
    with TestClient(app) as c:
        r = c.post("/api/calls", json={"number": "4135550101", "language": "es-US"})
        assert r.status_code == 400 and "Gemini" in r.json()["detail"]
        r = c.post("/api/calls", json={"number": "4135550101", "language": "xx-YY"})
        assert r.status_code == 400
        # English still dials, through the fake Twilio.
        r = c.post("/api/calls", json={"number": "4135550101", "language": "en-US"})
        assert r.status_code == 200
        assert 'language="en-US"' in state["telephony"].calls[-1][2]


def test_intro_describes_the_user_as_they_chose():
    from app.translate import intro
    assert "I'm deaf" in intro(None, "deaf")
    assert "I can't speak" in intro(None, "nonspeaking") and "deaf" not in intro(None, "nonspeaking")
    assert "deaf" not in intro(None, "none") and "an app is voicing" in intro(None, "none")
    assert "pedido para recoger" in intro(ES, "hoh", order=True)
    assert intro(None, "bogus") == intro(None, "deaf")


def test_controller_uses_intro_style():
    import asyncio

    from app.ai import RulesBrain
    from app.controller import Contact, Controller

    async def go():
        sent = []
        c = Controller("t", Contact(name="Shop", kind="business"), RulesBrain(), direction="incoming",
                       intro_style="nonspeaking", time_scale=0.01)

        async def send(m):
            sent.append(m)
        await c.attach_relay(send, {"callSid": "CA1"})
        return sent
    sent = asyncio.run(go())
    assert sent and "I can't speak" in sent[0]


def test_send_retry_with_same_request_id_is_not_spoken_twice():
    import json as _json
    with TestClient(app) as c:
        sid = c.post("/api/calls", json={"number": "4135550101", "name": "Jo", "knows_sign": True}).json()["sid"]
        with c.websocket_connect(f"/ws/relay/{sid}") as relay_ws:
            from app.main import sessions
            relay_ws.send_text(_json.dumps({"type": "setup", "callSid": sessions[sid].call_sid}))
            import time as _t
            _t.sleep(0.1)
            body = {"text": "See you soon.", "source": "typed", "request_id": "req-1"}
            r1 = c.post(f"/api/calls/{sid}/send", json=body).json()
            r2 = c.post(f"/api/calls/{sid}/send", json=body).json()
            assert r1["ok"] and r1["request_id"] == "req-1" and "duplicate" not in r1
            assert r2["ok"] and r2.get("duplicate") is True
            msg = _json.loads(relay_ws.receive_text())
            assert msg["type"] == "text" and msg["token"] == "See you soon."
        c.post(f"/api/calls/{sid}/hangup")


def test_guard_numbers_days_negation():
    assert translation_guard("2 tacos at 7:30.", "2 tacos a las 7:30.", ES).ok
    assert not translation_guard("2 tacos at 7:30.", "2 tacos a las 8:30.", ES).ok
    assert translation_guard("It's $23.40.", "Son $23,40.", ES).ok
    assert not translation_guard("See you Sunday.", "Nos vemos el sábado.", ES).ok
    assert not translation_guard("No, thanks.", "Sí, gracias.", ES).ok
    assert not translation_guard("Okay.", "", ES).ok


