# TalkBridge

**Your hands. Your voice.** A Deaf, hard-of-hearing or nonspeaking person makes a real phone call from the
browser. The other person uses an ordinary phone and installs nothing.

- The caller's speech appears as live captions (partial, then final).
- You answer with one-tap quick replies, AI suggestions, or a few typed words ("yes 8 works") that become a
  natural sentence. **Nothing is spoken until you tap.**
- Safety guards sit between the AI and the call: suggestions that invent numbers, times or days are dropped,
  a "no" can't become a "yes", and anything about money, orders or bookings needs a confirm tap.
- A retried tap is never spoken twice. If the caller talks over your reply, it's marked "cut off" with
  "Say it again".

Built solo by Ganesh Munagala at HackUMass XIV (Nov 13–15, 2026).

## What's in this repo

| Folder | What | Author |
|---|---|---|
| `server/`, `web/`, `tests/` | TalkBridge call app (this README) | Ganesh Munagala, written at HackUMass XIV |
| `fingertip/` | **Fingertip**: signing recognition, call controller with guards, Show it (Gemini video), Meet extension, desktop bridge, Gesture Synth. See [fingertip/README.md](fingertip/README.md) |

## How it works

```
Browser ──/ws, /api──► FastAPI server ──REST──► Twilio Voice (dials the number)
                              ▲
                              └──/twilio/relay WebSocket── Twilio ConversationRelay ◄──► phone
```
Twilio ConversationRelay does speech-to-text (captions) and text-to-speech (your approved replies).
Gemini (optional) turns a few words into a sentence and suggests replies; without a key, simple rules are used.
All keys stay on the server.

## Run it

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r server/requirements.txt
cp .env.example .env          # fill in Twilio + Gemini
cloudflared tunnel --url http://localhost:8000   # copy the https URL into PUBLIC_URL in .env
uvicorn server.main:app --port 8000
```
Open http://localhost:8000. In the Twilio console, accept the Voice "Predictive and Generative AI/ML
Features Addendum" (required for ConversationRelay). Trial accounts can only call verified numbers.

## Tests

```bash
python -m pytest -q tests     # guards + an end-to-end flow with a fake Twilio relay socket
```

## Status (honest)

| Feature | Status |
|---|---|
| Captions, quick replies, typed replies, guards, confirm sheet, retry-safe send, cut-off marking | Tested with a fake Twilio relay |
| Real phone call through Twilio | Not yet run (needs keys) |
| Gemini suggestions | Not yet run (needs key); rules fallback tested |


