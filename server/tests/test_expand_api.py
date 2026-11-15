import os

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["TWILIO_ACCOUNT_SID"] = ""
os.environ["GEMINI_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_expand_and_cors_for_meet():
    with TestClient(app) as c:
        r = c.post("/api/expand", json={"text": "yes tomorrow 5"}, headers={"Origin": "https://meet.google.com"})
        assert r.status_code == 200
        assert r.json()["text"] == "Yes, tomorrow at five works for me."
        assert r.headers["access-control-allow-origin"] == "https://meet.google.com"
        pre = c.options("/api/expand", headers={
            "Origin": "https://us05web.zoom.us", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true"})
        assert pre.headers["access-control-allow-origin"] == "https://us05web.zoom.us"
        assert pre.headers.get("access-control-allow-private-network") == "true"
        assert "access-control-allow-origin" not in c.post("/api/expand", json={"text": "hi"},
                                                           headers={"Origin": "https://evil.example"}).headers
        assert c.get("/ext-test").status_code == 200
