#!/usr/bin/env python3
"""Sign2Speak desktop bridge: your approved sentences, spoken into a virtual microphone.

Zoom, Teams and the Meet desktop apps can't be reached from a web page, so this small program
runs on the signer's laptop. It waits for sentences approved in the Sign2Speak app (Meetings tab),
fetches the voice from your Sign2Speak server, and plays it into a virtual audio cable. The meeting
app uses the other end of that cable as its microphone. Same engine as the phone path.

Setup (once):
  Windows: install VB-CABLE (vb-audio.com/Cable). In Zoom/Teams/Meet choose microphone "CABLE Output".
  macOS:   install BlackHole 2ch (existential.audio/blackhole). Choose microphone "BlackHole 2ch".
  pip install -r requirements.txt

Run:
  python sign2speak_bridge.py https://your-domain [--key APP_ACCESS_KEY] [--monitor]
  python sign2speak_bridge.py --list          # show audio devices

Notes:
  - While Sign2Speak is the meeting's microphone, the meeting hears only the generated voice.
  - It never captures meeting audio, so it can't cause echo.
  - The voice comes from your server: Gemini speech on the Gemini key, or ElevenLabs if that key is set.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
import time
import wave

CABLE_NAMES = ("cable input", "blackhole", "vb-audio", "loopback audio")


def find_device(sd, wanted: str | None):
    devs = [(i, d) for i, d in enumerate(sd.query_devices()) if d["max_output_channels"] > 0]
    if wanted:
        for i, d in devs:
            if wanted.lower() in d["name"].lower() or wanted == str(i):
                return i, d["name"]
        return None, None
    for i, d in devs:
        if any(n in d["name"].lower() for n in CABLE_NAMES):
            return i, d["name"]
    return None, None


async def run(a) -> int:
    import httpx
    import websockets

    sd = np = None
    device, name = None, "dry run (no audio)"
    if not a.dry_run:
        import numpy as np          # noqa: F811
        import sounddevice as sd    # noqa: F811
        device, name = find_device(sd, a.device)
        if device is None:
            print("No virtual audio cable found. Install VB-CABLE (Windows) or BlackHole (macOS),\n"
                  "or pass --device \"name\". Devices on this computer:")
            print(sd.query_devices())
            return 2
    print(f"Speaking into: {name}")
    print("In your meeting app, choose the cable's other end as the microphone "
          "(\"CABLE Output\" on Windows, \"BlackHole 2ch\" on macOS).")

    base = a.server.rstrip("/")
    q = f"?key={a.key}" if a.key else ""
    ws_url = base.replace("https://", "wss://").replace("http://", "ws://") + "/ws/bridge" + q
    seen: set[str] = set()                     # a sentence is never played twice (reconnects, retries)

    async with httpx.AsyncClient(timeout=20) as http:
        while True:
            try:
                async with websockets.connect(ws_url, ping_interval=20) as ws:
                    print("Connected. Waiting for sentences from the Sign2Speak Meetings tab... (Ctrl+C to quit)")
                    async for raw in ws:
                        m = json.loads(raw)
                        if m.get("type") != "say" or m["id"] in seen:
                            continue
                        seen.add(m["id"])
                        t0 = time.perf_counter()
                        ok, err = True, ""
                        try:
                            r = await http.post(f"{base}/api/tts{q}", json={"text": m["text"], "voice_id": m.get("voice_id")})
                            if r.status_code != 200:
                                raise RuntimeError(r.json().get("detail", f"voice error {r.status_code}"))
                            ms = (time.perf_counter() - t0) * 1000
                            if not a.dry_run:
                                with wave.open(io.BytesIO(r.content), "rb") as w:      # the server always sends WAV
                                    rate = w.getframerate()
                                    pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
                                sd.play(pcm, rate, device=device)
                                await asyncio.to_thread(sd.wait)
                                if a.monitor:               # then on your speakers, to check by ear
                                    sd.play(pcm, rate)
                                    await asyncio.to_thread(sd.wait)
                            print(f"  said ({ms:.0f} ms to first audio): {m['text']}")
                        except Exception as e:
                            ok, err, ms = False, str(e), (time.perf_counter() - t0) * 1000
                            print(f"  COULD NOT SAY: {m['text']}\n    {err}")
                        await ws.send(json.dumps({"type": "played", "id": m["id"], "ok": ok, "ms": ms, "device": name, "error": err}))
            except (OSError, websockets.WebSocketException) as e:
                print(f"Connection lost ({e.__class__.__name__}). Trying again in 2 s...")
                await asyncio.sleep(2)


def main() -> int:
    ap = argparse.ArgumentParser(description="Sign2Speak desktop bridge (virtual microphone)")
    ap.add_argument("server", nargs="?", help="https://your-domain")
    ap.add_argument("--key", default="")
    ap.add_argument("--device", help="output device name or number (default: first virtual cable found)")
    ap.add_argument("--monitor", action="store_true", help="also play on your speakers")
    ap.add_argument("--list", action="store_true", help="list audio devices and exit")
    ap.add_argument("--dry-run", action="store_true", help="no audio: just print what would be said")
    a = ap.parse_args()
    if a.list:
        import sounddevice as sd
        print(sd.query_devices())
        return 0
    if not a.server:
        ap.error("server is required")
    try:
        return asyncio.run(run(a))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())


