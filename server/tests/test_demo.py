"""SIMULATED demo mode: no Twilio, scripted caller, every event tagged demo:true."""
import os
import tempfile
import time

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["PUBLIC_URL"] = "https://s2s.test"
os.environ["TWILIO_ACCOUNT_SID"] = ""
os.environ["GEMINI_API_KEY"] = ""
os.environ["LOG_DIR"] = os.path.join(tempfile.gettempdir(), "talkbridge-test-logs")
os.environ["DEMO_SPEED"] = "0.02"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, sessions, state  # noqa: E402


def recv_until(ws, pred, limit=80):
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if pred(m):
            return m, seen
    raise AssertionError(f"never got it; saw {[s.get('type') for s in seen]}")


def is_final_caller(text):
    return lambda m: m["type"] == "line" and m["line"]["who"] == "caller" and m["line"]["text"] == text


def test_health_reports_demo():
    with TestClient(app) as c:
        assert c.get("/api/health").json()["demo_available"] is True


def test_demo_incoming_full_script():
    with TestClient(app) as c, c.websocket_connect("/ws/app") as appws:
        time.sleep(0.05)
        before = len(state["telephony"].calls)
        sid = c.post("/api/demo/incoming", json={"name": "Mom", "number": "+14135550123"}).json()["sid"]
        ring, _ = recv_until(appws, lambda m: m["type"] == "ringing")
        assert ring["demo"] is True and ring["sid"] == sid and ring["contact"]["name"] == "Mom"
        assert sessions[sid].call_sid.startswith("CADEMO")

        assert c.post(f"/api/calls/{sid}/answer").json()["ok"]
        st, seen = recv_until(appws, lambda m: m["type"] == "state" and m["state"] == "CONNECTED")
        assert st["demo"] is True

        cap, _ = recv_until(appws, lambda m: m["type"] == "caption")
        assert cap["demo"] is True and cap["line"]["status"] == "partial"
        first, _ = recv_until(appws, is_final_caller("Hi sweetie, it's Mom! When will you be home tonight?"))
        assert first["demo"] is True

        for reply, nxt in [("Yes, I will be there!", "Perfect. Can you pick up some milk on the way?"),
                           ("Around six.", "Thank you! Oh, and are you still coming Sunday?"),
                           ("Sure, no problem.", "Wonderful. Love you, see you soon!")]:
            r = c.post(f"/api/calls/{sid}/send", json={"text": reply, "source": "typed",
                                                       "mode": "exact_words"}).json()
            assert r["ok"], r
            line, seen = recv_until(appws, is_final_caller(nxt))
            assert line["demo"] is True
            assert all(m.get("demo") is True for m in seen)
            time.sleep(0.6)   # let the spoken-line timer finish before the next reply

        assert c.post(f"/api/calls/{sid}/hangup").json()["ok"]
        ended, _ = recv_until(appws, lambda m: m["type"] == "ended")
        assert ended["demo"] is True
        # Twilio was never touched for this session.
        assert len(state["telephony"].calls) == before
        assert not any(call[1] == sessions[sid].call_sid for call in state["telephony"].calls)


def test_demo_decline_skips_twilio():
    with TestClient(app) as c, c.websocket_connect("/ws/app") as appws:
        time.sleep(0.05)
        before = len(state["telephony"].calls)
        sid = c.post("/api/demo/incoming", json={}).json()["sid"]
        recv_until(appws, lambda m: m["type"] == "ringing")
        assert c.post(f"/api/calls/{sid}/decline").json()["ok"]
        ended, _ = recv_until(appws, lambda m: m["type"] == "ended")
        assert ended["demo"] is True and ended["reason"] == "declined"
        assert len(state["telephony"].calls) == before


def test_demo_outgoing_connects_and_says_hello():
    with TestClient(app) as c, c.websocket_connect("/ws/app") as appws:
        time.sleep(0.05)
        before = len(state["telephony"].calls)
        sid = c.post("/api/demo/outgoing", json={"name": "Mom", "number": "+14135550123"}).json()["sid"]
        snap, _ = recv_until(appws, lambda m: m["type"] == "snapshot" and m["sid"] == sid)
        assert snap["demo"] is True and snap["state"] == "RINGING" and snap["direction"] == "outgoing"
        recv_until(appws, lambda m: m["type"] == "state" and m["state"] == "CONNECTED")
        hello, _ = recv_until(appws, is_final_caller("Hello?"))
        assert hello["demo"] is True
        assert c.post(f"/api/calls/{sid}/hangup").json()["ok"]
        recv_until(appws, lambda m: m["type"] == "ended")
        assert len(state["telephony"].calls) == before
