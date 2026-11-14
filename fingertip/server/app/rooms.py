"""Browser video-call rooms: WebSocket signaling relay + caption broadcast."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .config import settings

router = APIRouter()

_PAGE = (Path(__file__).parent / "static" / "video.html").read_text(encoding="utf-8")

MAX_PEERS = 2
# room id -> list of connected sockets
_rooms: dict[str, list[WebSocket]] = {}
_known: set[str] = set()


class CaptionBody(BaseModel):
    text: str
    final: bool = True


@router.post("/api/rooms")
async def create_room():
    room = secrets.token_urlsafe(8)
    _known.add(room)
    return {
        "room": room,
        "join_url": f"{settings.public_url}/v/{room}",
        "host_url": f"/v/{room}?host=1",
    }


@router.get("/api/rooms/ice")
async def ice_servers():
    servers: list[dict] = [{"urls": "stun:stun.l.google.com:19302"}]
    url = os.getenv("TURN_URL")
    if url:
        servers.append({
            "urls": url,
            "username": os.getenv("TURN_USERNAME", ""),
            "credential": os.getenv("TURN_CREDENTIAL", ""),
        })
    return servers


@router.get("/v/{room}", response_class=HTMLResponse)
async def room_page(room: str):
    return HTMLResponse(_PAGE, headers={"Cache-Control": "no-store"})


@router.post("/api/rooms/{room}/caption")
async def push_caption(room: str, body: CaptionBody):
    if room not in _known and room not in _rooms:
        raise HTTPException(404, "unknown room")
    msg = {"type": "caption", "text": body.text, "final": body.final, "from": "host"}
    for ws in list(_rooms.get(room, [])):
        try:
            await ws.send_json(msg)
        except Exception:
            pass
    return {"ok": True}


@router.websocket("/ws/room/{room}")
async def room_ws(ws: WebSocket, room: str):
    await ws.accept()
    peers = _rooms.setdefault(room, [])
    if len(peers) >= MAX_PEERS:
        await ws.send_json({"type": "full"})
        await ws.close()
        return
    others = list(peers)
    peers.append(ws)
    _known.add(room)
    # The first peer is polite=False (initiates on peer-joined); the second is polite.
    await ws.send_json({"type": "joined", "peers": len(peers), "polite": len(others) > 0})
    for o in others:
        try:
            await o.send_json({"type": "peer-joined"})
        except Exception:
            pass
    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            for o in list(_rooms.get(room, [])):
                if o is not ws:
                    try:
                        await o.send_json(msg)
                    except Exception:
                        pass
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        lst = _rooms.get(room, [])
        if ws in lst:
            lst.remove(ws)
        for o in list(lst):
            try:
                await o.send_json({"type": "peer-left"})
            except Exception:
                pass
        if not lst:
            _rooms.pop(room, None)
