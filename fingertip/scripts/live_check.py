#!/usr/bin/env python3
"""M1 + M2 on a real phone, in one command. Run it against the DEPLOYED server.

    python scripts/live_check.py https://your-domain  +14135550123  [--key APP_ACCESS_KEY]

What it does:
  1. Reads /api/health and tells you what isn't configured (Twilio, Gemini model, sign model).
  2. Dials the number through the real server. The phone must belong to someone next to you who agreed.
  3. When they answer and say hello, speaks a test sentence and shows their words as captions.
  4. Lets you type more lines (M2: several turns). Type /stop to test cutting speech off, /end to hang up.
  5. Asks what you actually heard and appends the result to eval/live_calls.md.

Nothing here is simulated: if Twilio isn't configured, it stops at step 1.
Needs: pip install httpx websockets
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import sys
import time

import httpx
import websockets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ask(q: str) -> str:
    return input(q).strip()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("server", help="https://your-domain (the deployed Sign2Speak server)")
    ap.add_argument("number", help="phone to call, e.g. +14135550123 (its owner is present and agreed)")
    ap.add_argument("--key", default=os.environ.get("APP_ACCESS_KEY", ""))
    ap.add_argument("--say", default="Hi! This is a Sign2Speak test call. Can you hear me clearly?")
    ap.add_argument("--knows-sign", action="store_true", help="skip the heads-up intro")
    ap.add_argument("--dev", action="store_true", help=argparse.SUPPRESS)   # self-test against a fake Twilio; never a pass
    a = ap.parse_args()
    base = a.server.rstrip("/")
    q = {"key": a.key} if a.key else {}

    async with httpx.AsyncClient(timeout=20) as http:
        try:
            h = (await http.get(f"{base}/api/health")).json()
        except Exception as e:
            print(f"Can't reach {base}/api/health: {e}")
            return 2
        print(f"Server ok. brain={h['brain']}  voice={h['voice']}")
        problems = []
        if not h["twilio"]:
            problems.append("Twilio isn't configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_NUMBER).")
        if not base.startswith("https://"):
            problems.append("The server must be on https:// so Twilio can open wss:// to it.")
        g = h["gemini"]
        if not g["configured"]:
            print("  note: Gemini key not set. Calls still work (typing, chips, guards); AI writing uses the built-in rules.")
        elif g["model_ok"] is False:
            print(f"  WARNING: Gemini model '{g['model']}' was not found: {g['error']}")
        if not (h.get("signs") or {}).get("ready"):
            print("  note: sign model not loaded; typing works.")
        if problems and a.dev:
            print("DEV MODE: fake Twilio. This run proves nothing about real calls and is not logged.")
        elif problems:
            print("\nCan't place a real call yet:\n  - " + "\n  - ".join(problems))
            return 2

        if ask(f"\nCall {a.number} now? Its owner is here and agreed. [y/N] ").lower() != "y":
            return 1

        ws_url = base.replace("https://", "wss://").replace("http://", "ws://") + "/ws/app" + (f"?key={a.key}" if a.key else "")
        t = {"dial": time.time()}
        heard: list[str] = []
        spoken: list[str] = []
        sid = ""
        state = "?"

        async with websockets.connect(ws_url) as ws:
            r = await http.post(f"{base}/api/calls", params=q, json={
                "number": a.number, "name": "Live check", "knows_sign": a.knows_sign, "kind": "person"})
            if r.status_code != 200:
                print("Dial failed:", r.json().get("detail", r.text))
                return 2
            sid = r.json()["sid"]
            print("Dialing... (answer the phone and say hello)")
            sent_test = False

            async def reader() -> None:
                nonlocal state, sent_test
                async for raw in ws:
                    m = json.loads(raw)
                    if m.get("sid") != sid:
                        continue
                    ty = m["type"]
                    if ty == "call_status":
                        print(f"  [twilio] {m['status']}")
                        t.setdefault(m["status"], time.time())
                    elif ty == "state":
                        state = m["state"]
                        if state == "CONNECTED":
                            t["connected"] = time.time()
                            print(f"  [connected] {t['connected'] - t['dial']:.1f} s after dialing")
                    elif ty == "caption":
                        print(f"\r  them (live): {m['line']['text'][:100]}", end="", flush=True)
                    elif ty == "line":
                        l = m["line"]
                        if l["who"] == "caller" and l["status"] == "final":
                            heard.append(l["text"])
                            print(f"\r  THEM: {l['text']}" + " " * 20)
                            if not sent_test:
                                sent_test = True
                                t["send"] = time.time()
                                rr = await http.post(f"{base}/api/calls/{sid}/send", params=q, json={"text": a.say, "source": "typed"})
                                print(f"  -> sent test line ({rr.json()})")
                        elif l["who"] == "me" and l["status"] == "speaking":
                            spoken.append(l["text"])
                            print(f"  YOU ({l['kind']}): {l['text']}")
                        elif l["who"] == "me" and l["status"] == "interrupted":
                            print(f"  [they talked over it; heard so far: {l.get('heard') or '?'}]")
                    elif ty == "confirm":
                        print(f"  [confirm sheet] {m['summary']}: \"{m['sentence']}\"")
                        if ask("  approve? [y/N] ").lower() == "y":
                            await http.post(f"{base}/api/calls/{sid}/confirm", params=q, json={"decision": "yes", "hash": m["hash"]})
                        else:
                            await http.post(f"{base}/api/calls/{sid}/confirm", params=q, json={"decision": "later"})
                    elif ty == "ended":
                        print(f"  [ended] {m['reason']}")
                        return

            async def typer() -> None:
                loop = asyncio.get_running_loop()
                print("Type a line + Enter to speak it. /stop cuts speech off. /end hangs up.\n")
                while True:
                    line = (await loop.run_in_executor(None, sys.stdin.readline)).strip()
                    if not line:
                        continue
                    if line == "/end":
                        await http.post(f"{base}/api/calls/{sid}/hangup", params=q)
                        return
                    if line == "/stop":
                        await http.post(f"{base}/api/calls/{sid}/stop", params=q)
                        continue
                    rr = (await http.post(f"{base}/api/calls/{sid}/send", params=q, json={"text": line, "source": "typed"})).json()
                    if not rr.get("ok"):
                        print("  not sent:", rr.get("reason"))

            rd = asyncio.create_task(reader())
            ty = asyncio.create_task(typer())
            await asyncio.wait([rd, ty], return_when=asyncio.FIRST_COMPLETED)
            await asyncio.sleep(1.5)
            for x in (rd, ty):
                x.cancel()

        h2 = (await http.get(f"{base}/api/health")).json()

    print("\nNow the part only a person can check:")
    rang = ask("Did the phone ring? [y/n] ")
    voice = ask("Did they hear the test sentence clearly in a natural voice? [y/n] ")
    delay = ask("Roughly how long from Enter to hearing the voice? (seconds, or ?) ")
    stop_ok = ask("If you tried /stop: did the voice cut off? [y/n/skip] ")
    notes = ask("Anything odd (duplicate lines, missed words, robotic voice)? ")

    if a.dev:
        return 0
    path = os.path.join(ROOT, "eval", "live_calls.md")
    new = not os.path.exists(path)
    with open(path, "a") as f:
        if new:
            f.write("# Live call log (real phones, real Twilio)\n\nAppended by `scripts/live_check.py`. Nothing here is simulated.\n")
        f.write(f"\n## {datetime.datetime.now().isoformat(timespec='minutes')} · {base}\n\n"
                f"- Voice: `{h['voice']}` · brain: {h['brain']}\n"
                f"- Rang: **{rang}** · heard clearly: **{voice}** · felt delay: {delay} s · Stop cut speech: {stop_ok}\n"
                f"- Connected {t.get('connected', 0) - t['dial']:.1f} s after dialing · lines spoken: {len(spoken)} · caller lines captioned: {len(heard)}\n"
                f"- Server latency medians: `{json.dumps(h2.get('latency', {}))}`\n"
                f"- Notes: {notes or '-'}\n")
    print(f"\nSaved to {path}. M1 passes if it rang and the sentence was heard; M2 if 5+ turns worked with no duplicates.")
    return 0 if rang == "y" and voice == "y" else 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)


