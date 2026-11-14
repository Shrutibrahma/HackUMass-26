"""Show it: video -> sections, transcripts, refined facts, ask-the-video. Gemini is replaced by a
scripted engine with the same methods, so these test our passes, safety rules and plumbing, not
Gemini's video understanding (that needs the real key)."""
import asyncio
import os
import time

os.environ["VALIDATE_TWILIO_SIGNATURE"] = "false"
os.environ.pop("TWILIO_ACCOUNT_SID", None)
os.environ.pop("GEMINI_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app.ai import RulesBrain  # noqa: E402
from app.controller import Contact, Controller  # noqa: E402
from app.show import (Answer, Refined, Section, ShowResult, ShowStore, TranscriptLine, VideoFact,  # noqa: E402
                      apply_refined, normalize, normalize_lines, normalize_sections, run_passes)

RAW = ShowResult(
    summary_say="My dishwasher leaks from the front-left corner of the door, and it shows error E24.",
    sections=[Section(start=0, end=6, title="Whole machine", summary="The dishwasher, door closed."),
              Section(start=6, end=10, title="The leak", summary="Water drips at the door."),
              Section(start=10, end=20, title="Panel and label", summary="Error code and model label.")],
    facts=[
        VideoFact(say="Water drips from the front-left corner of the door.", label="Drip starts here", kind="problem",
                  t=6.6, t_end=9.0, box=[600, 60, 800, 240]),
        VideoFact(say="The panel shows error code E24.", label="Error E24", kind="reading", t=11.0, t_end=14.0,
                  box=[100, 400, 180, 560]),
        VideoFact(say="The label says model DW80R5061.", label="Model label", kind="label", t=15.5, t_end=18.0,
                  box=[300, 700, 380, 900]),
    ],
    notes="Serial number too blurry to read.",
)


class Scripted:
    """Same interface as GeminiVideo."""
    name = "scripted"

    def __init__(self, fail_section: int | None = None, fail_overview=False):
        self.fail_section, self.fail_overview = fail_section, fail_overview
        self.released = 0

    def prepare(self, data, mime, path):
        return {"inline": data}

    def release(self, h):
        self.released += 1

    def overview(self, h, duration, context):
        if self.fail_overview:
            raise RuntimeError("boom")
        return RAW

    def transcribe(self, h, sec, n):
        if n == self.fail_section:
            raise RuntimeError("section failed")
        return [TranscriptLine(t=0.5, kind="action", text=f"Camera on {sec['title'].lower()}"),
                TranscriptLine(t=1.2, kind="text", text="E24") if "Panel" in sec["title"] else
                TranscriptLine(t=1.2, kind="sound", text="Dripping")]

    def refine(self, h, fact, a, b):
        if fact["say"].startswith("Water"):
            return Refined(t=(6.2 - a), box=[620, 80, 820, 260])      # clip-relative, tighter
        if "E24" in fact["say"]:
            return Refined(t=None)                                       # not found: keep coarse
        return Refined(t=99.0)                                           # outside window: rejected

    def ask(self, h, question):
        if "model" in question.lower():
            return Answer(found=True, say="It's model DW80R5061.", label="Model label", t=15.6, box=[300, 700, 380, 900])
        return Answer(found=False)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "shows", ShowStore(str(tmp_path / "shows")))
    with TestClient(main.app) as c:
        yield c


def upload(c, mime="video/mp4", data=b"\x00\x00\x00\x18ftypmp42fake", duration="20"):
    return c.post("/api/show", files={"file": ("clip.mp4", data, mime)}, data={"duration": duration, "title": "Dishwasher"})


def wait_done(c, sid, limit=5.0):
    t0 = time.time()
    while time.time() - t0 < limit:
        r = c.get(f"/api/show/{sid}").json()
        if r["status"] != "processing":
            return r
        time.sleep(0.05)
    raise AssertionError("job never finished")


# ------------------------------------------------------------------ pure helpers

def test_normalize_clamps_and_cleans():
    raw = ShowResult(facts=[
        VideoFact(say="  Too   late  ", t=99, t_end=120, box=[0, 0, 1200, 1200]),
        VideoFact(say="", t=1),
        VideoFact(say="Backwards box.", t=-3, t_end=-1, box=[500, 500, 400, 400]),
        VideoFact(say="Three numbers only.", box=[1, 2, 3]),
    ])
    out = normalize(raw, duration=20)
    a, b, c = out.facts
    assert [f.id for f in out.facts] == ["v1", "v2", "v3"]
    assert a.say == "Too late" and a.t == 20 and a.box == [0, 0, 1000, 1000]
    assert b.t == 0 and b.box is None and c.box is None and c.label == "Three numbers only"
    assert out.summary_say == "Too late Backwards box."
    assert [s.title for s in out.sections] == ["Whole clip"]        # no sections from the model


def test_sections_tile_the_clip():
    secs = normalize_sections([Section(start=5, end=12, title="B"), Section(start=0, end=6, title="A"),
                               Section(start=11, end=40, title="C"), Section(start=3, end=3)], duration=20)
    assert [(s.title, s.start, s.end) for s in secs] == [("A", 0, 6), ("B", 6, 12), ("C", 12, 20)]


def test_transcript_lines_relative_or_absolute():
    rel = normalize_lines([TranscriptLine(t=1.0, text="a"), TranscriptLine(t=0.2, text="b")], 10, 14)
    assert [l["t"] for l in rel] == [10.2, 11.0]
    ab = normalize_lines([TranscriptLine(t=11.0, text="a")], 10, 14)       # model answered in video time
    assert ab[0]["t"] == 11.0


def test_refine_only_inside_its_window():
    f = {"t": 6.6, "t_end": 9.0, "box": [600, 60, 800, 240]}
    assert apply_refined(f, Refined(t=1.1, box=[620, 80, 820, 260]), 5.1, 8.1) and f["t"] == 6.2 and f["box"][0] == 620
    g = {"t": 6.6, "t_end": 9.0, "box": None}
    assert not apply_refined(g, Refined(t=40.0), 5.1, 8.1) and g["t"] == 6.6
    assert not apply_refined(g, None, 5.1, 8.1)


def test_passes_survive_one_failed_section():
    out = run_passes(Scripted(fail_section=2), {}, 20, "", lambda m: None)
    lines = [len(s["lines"]) for s in out["sections"]]
    assert lines == [2, 0, 2]                     # section 2 failed, the others are transcribed
    drip = next(f for f in out["facts"] if f["say"].startswith("Water"))
    assert drip["t"] == 6.2 and drip["refined"] and out["refined"] == 1


# ------------------------------------------------------------------ endpoints

def test_needs_gemini(client):
    main.state["video"] = None
    r = upload(client)
    assert r.status_code == 400 and "Gemini" in r.json()["detail"]
    assert client.get("/api/health").json()["show"]["available"] is False


def test_job_progress_then_result_share_delete(client):
    eng = Scripted()
    main.state["video"] = eng
    r = upload(client)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["status"] == "processing" and first["facts"] == []
    rec = wait_done(client, first["id"])
    assert rec["status"] == "done" and len(rec["facts"]) == 3 and len(rec["sections"]) == 3
    assert rec["sections"][2]["lines"][1] == {"t": 11.2, "kind": "text", "text": "E24"}
    assert eng.released == 1 and "path" not in rec
    sid, token = rec["id"], rec["share_token"]

    v = client.get(f"/api/show/{sid}/video")
    assert v.status_code == 200 and v.content.startswith(b"\x00\x00\x00\x18ftyp")
    assert client.get(f"/api/shared/{token}").status_code == 404
    client.post(f"/api/show/{sid}/share", json={"share": True})
    shared = client.get(f"/api/shared/{token}").json()
    assert len(shared["sections"]) == 3 and "context" not in shared and "share_token" not in shared
    assert client.delete(f"/api/show/{sid}").json()["ok"]
    assert client.get(f"/api/show/{sid}").status_code == 404


def test_failed_overview_marks_job_failed(client):
    main.state["video"] = Scripted(fail_overview=True)
    rec = wait_done(client, upload(client).json()["id"])
    assert rec["status"] == "failed" and rec["error"]


def test_ask_the_video(client):
    main.state["video"] = Scripted()
    sid = wait_done(client, upload(client).json()["id"])["id"]
    yes = client.post(f"/api/show/{sid}/ask", json={"question": "What's the model number?"}).json()
    assert yes["found"] and yes["fact"]["kind"] == "answer" and yes["fact"]["box"] == [300, 700, 380, 900]
    no = client.post(f"/api/show/{sid}/ask", json={"question": "How old is it?"}).json()
    assert no["found"] is False
    assert len(client.get(f"/api/show/{sid}").json()["facts"]) == 4


def test_rejects_non_video_and_too_big(client, monkeypatch):
    main.state["video"] = Scripted()
    assert upload(client, mime="image/png").status_code == 400
    monkeypatch.setattr(main.settings, "show_max_mb", 0)
    assert upload(client).status_code == 413


def test_bad_ids_are_404(client):
    assert client.get("/api/show/no.such!id").status_code == 404
    assert client.get("/api/show/no.such!id/video").status_code == 404
    assert client.get("/api/shared/short").status_code == 404


# ------------------------------------------------------------------ in a call

def test_attach_and_ask_during_call(client):
    main.state["video"] = Scripted()
    show = upload(client).json()
    sid = client.post("/api/calls", json={"number": "4135550101", "name": "Landlord", "kind": "business"}).json()["sid"]
    assert client.post(f"/api/calls/{sid}/show/{show['id']}").status_code in (200, 409)   # maybe still processing
    wait_done(client, show["id"])
    r = client.post(f"/api/calls/{sid}/show/{show['id']}").json()
    assert r["ok"] and r["facts"] == 3 and r["draft"]["source"] == "video" and not r["draft"]["blocked"]
    c = main.sessions[sid]
    assert c.spoken_log == [] and c.state == "RINGING"
    a = client.post(f"/api/calls/{sid}/ask-video", json={"question": "what model is it"}).json()
    assert a["found"] and any(f["kind"] == "answer" for f in c.video_facts)
    assert c.spoken_log == []                                        # the answer is offered, not said
    ok = c._check_draft("It's model DW80R5061.", ["NAME"], source="signs")
    assert not ok.blocked
    client.post(f"/api/calls/{sid}/hangup")


def test_video_facts_are_allowed_sources_but_inventions_are_not():
    async def go():
        c = Controller("t", Contact(name="Shop", kind="business"), RulesBrain(), direction="outgoing", time_scale=0.01)
        await c.attach_video([f.model_dump() for f in normalize(RAW, 20).facts],
                             "The dishwasher shows error E24 and leaks at the door.", "show1")
        return (c, c._check_draft("It's model DW80R5061, and it says E24.", ["NAME"], source="signs"),
                c._check_draft("It's model DW90 and it's 12 years old.", ["NAME"], source="signs"),
                c._check_draft("It has leaked since March 3.", [], source="video"))
    c, ok, bad, made_up = asyncio.run(go())
    assert c.draft is not None and not c.draft.blocked
    assert not ok.blocked and bad.blocked and made_up.blocked


