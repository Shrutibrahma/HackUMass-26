import base64
import os

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ["TWILIO_ACCOUNT_SID"] = ""

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import explain  # noqa: E402

IMG = base64.b64encode(b"\xff\xd8fake-jpeg").decode()


def client(monkeypatch, result):
    async def fake(img, mime, prompt):
        fake.prompt = prompt
        return result
    monkeypatch.setattr(explain, "engine", fake)
    monkeypatch.setattr(explain.settings, "gemini_api_key", "x")
    app = FastAPI()
    app.include_router(explain.router)
    return TestClient(app), fake


def test_items_are_deduped_clamped_and_capped(monkeypatch):
    r = explain.Explained(summary="This is my router.", items=[
        explain.Item(label="NET light", note="red", box_2d=[660, 330, 725, 370]),
        explain.Item(label="NET red indicator", note="same thing", box_2d=[665, 332, 724, 366]),   # duplicate
        explain.Item(label="Router", note="", box_2d=[-50, 80, 780, 1400]),                        # clamped
        explain.Item(label="", note="no label", box_2d=[0, 0, 10, 10]),                            # dropped
        explain.Item(label="Bad box", note="", box_2d=[500, 500, 400, 400]),                       # dropped
    ])
    c, fake = client(monkeypatch, r)
    out = c.post("/api/explain-frame", json={"image": "data:image/jpeg;base64," + IMG, "question": "which light"}).json()
    assert [i["label"] for i in out["items"]] == ["NET light", "Router"]
    assert out["items"][1]["box"] == [0, 80, 780, 1000]
    assert out["summary"] == "This is my router."
    assert "which light" in fake.prompt


def test_rejects_bad_image_and_needs_key(monkeypatch):
    c, _ = client(monkeypatch, explain.Explained())
    assert c.post("/api/explain-frame", json={"image": "not base64!!"}).status_code == 400
    monkeypatch.setattr(explain.settings, "gemini_api_key", "")
    assert c.post("/api/explain-frame", json={"image": IMG}).status_code == 503
