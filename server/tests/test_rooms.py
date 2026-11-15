from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.rooms import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _room():
    r = client.post("/api/rooms")
    assert r.status_code == 200
    return r.json()


def test_create_room():
    d = _room()
    assert d["join_url"].endswith("/v/" + d["room"])
    assert d["host_url"] == f"/v/{d['room']}?host=1"


def test_page_served():
    d = _room()
    r = client.get(f"/v/{d['room']}")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "not FaceTime" in r.text


def test_ice():
    r = client.get("/api/rooms/ice")
    assert r.json()[0]["urls"].startswith("stun:")


def test_offer_exchange_and_full():
    room = _room()["room"]
    with client.websocket_connect(f"/ws/room/{room}") as a:
        ja = a.receive_json()
        assert ja == {"type": "joined", "peers": 1, "polite": False}
        with client.websocket_connect(f"/ws/room/{room}") as b:
            jb = b.receive_json()
            assert jb["peers"] == 2 and jb["polite"] is True
            assert a.receive_json() == {"type": "peer-joined"}
            a.send_json({"type": "offer", "sdp": "x"})
            assert b.receive_json() == {"type": "offer", "sdp": "x"}
            b.send_json({"type": "answer", "sdp": "y"})
            assert a.receive_json() == {"type": "answer", "sdp": "y"}
            with client.websocket_connect(f"/ws/room/{room}") as c:
                assert c.receive_json() == {"type": "full"}
        assert a.receive_json() == {"type": "peer-left"}


def test_caption_post_delivered_to_both():
    room = _room()["room"]
    with client.websocket_connect(f"/ws/room/{room}") as a, \
            client.websocket_connect(f"/ws/room/{room}") as b:
        a.receive_json(); b.receive_json(); a.receive_json()  # joined, joined, peer-joined
        r = client.post(f"/api/rooms/{room}/caption", json={"text": "hi mom", "final": True})
        assert r.status_code == 200
        want = {"type": "caption", "text": "hi mom", "final": True, "from": "host"}
        assert a.receive_json() == want
        assert b.receive_json() == want


def test_unknown_room_404():
    r = client.post("/api/rooms/nope/caption", json={"text": "x", "final": True})
    assert r.status_code == 404


def test_same_tab_reconnect_replaces_stale_socket():
    room = _room()["room"]
    with client.websocket_connect(f"/ws/room/{room}?cid=tabA") as a:
        a.receive_json()
        with client.websocket_connect(f"/ws/room/{room}?cid=tabB") as b:
            b.receive_json(); a.receive_json()  # joined, peer-joined
            # tab B's network drops but its old socket is still open server-side; it reconnects
            with client.websocket_connect(f"/ws/room/{room}?cid=tabB") as b2:
                jb = b2.receive_json()
                assert jb["type"] == "joined" and jb["peers"] == 2
                assert a.receive_json() == {"type": "peer-joined"}
                b2.send_json({"type": "caption", "text": "back", "final": True})
                assert a.receive_json()["text"] == "back"
            assert a.receive_json() == {"type": "peer-left"}


def test_third_distinct_tab_still_full():
    room = _room()["room"]
    with client.websocket_connect(f"/ws/room/{room}?cid=x1") as a, \
            client.websocket_connect(f"/ws/room/{room}?cid=x2") as b:
        a.receive_json(); b.receive_json(); a.receive_json()
        with client.websocket_connect(f"/ws/room/{room}?cid=x3") as c:
            assert c.receive_json() == {"type": "full"}


def test_page_reads_fresh_and_is_guest_ui():
    d = _room()
    r = client.get(f"/v/{d['room']}")
    assert 'id="prejoin"' in r.text and "Live Captions" in r.text
