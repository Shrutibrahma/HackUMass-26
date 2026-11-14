# Handoff: where Sign2Speak stands and what to do next

Written 2026-11-14 for the next agent or teammate. **Everything needed from the team: `WHAT_I_NEED.md`.**
Read this, then `MISSION.md` (goals and rules),
then `DECISIONS.md` (why things are the way they are). Repo: github.com/Shrutibrahma/HackUMass-26, branch `main`.

## 0. Blocking, before any code

1. **Hackathon rules.** Every commit here was made outside the hacking window or by an AI agent in a
   cloud session. The team must check HackUMass XIV's rules on pre-existing work and disclose or
   rebuild as required (`MISSION.md` §0). Don't rewrite git history.
2. **Nothing has ever touched a real phone, a real meeting, or a live AI key.** There are no Twilio,
   Gemini, ElevenLabs or Vultr credentials in this environment. Everything below marked "unverified"
   means exactly that.

## 1. Status

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Call controller, guards, hash-bound approvals, note parser, fillers, barge-in handling | Implemented and tested (offline) | `python eval/bench.py`: 34/34 cases, 27/27 guard units |
| Twilio ConversationRelay adapter | Implemented, **unverified live** | Checked line by line against Twilio's docs on Nov 14 (D-028). Never run against Twilio |
| Incoming + outgoing call flow, reconnects | Implemented, tested with a fake Twilio | `server/tests/test_e2e.py` (20 tests) |
| Gemini jobs (note parser, turn analyzer, reply writer, recap) | Implemented, **never called live** | Model IDs confirmed to exist in Google's docs; falls back to built-in rules |
| Signer app, all 22 design frames | Implemented and browser-tested | `/#gallery` |
| Sign recognition (SignBart-ASL-2730, 59 active signs) | Implemented; tested on **public** signers only | `eval/model_check.md`, `eval/pipeline_check.md`. No held-out teammate yet |
| Meet Chrome extension | Implemented; tested on a **stand-in** page | Not tried on real Google Meet |
| Desktop bridge (virtual mic for Zoom / Teams) | Implemented; protocol tested, **audio never played** | `bridge/sign2speak_bridge.py --dry-run` works; needs a laptop with VB-CABLE or BlackHole |
| Meeting voice via Gemini speech (or ElevenLabs) | Implemented, **unverified** | `/api/tts`; written from Google's current docs, never called |
| Meetings tab | Implemented and browser-tested | Status lines come from `/api/health` |
| Gesture Synth (Playground) | Implemented; touch play browser-tested, gesture logic unit-tested | Camera play not tried with a real hand |
| In-person mode | Implemented | Speech captions need Chrome; untested with a real microphone |
| Live-call checker | Implemented, self-tested with a fake Twilio | `scripts/live_check.py` |
| Docker image | Built and run locally (Nov 14, Windows + Docker Desktop 27.5) | `/` returns 200; `/api/health` shows `signs.ready: true`. Not yet deployed to Vultr |
| Calls in Spanish / French / Portuguese (M6, D-034) | Implemented, **unverified live** | Bench: 6 scripted-translator cases + 9 translation-guard units pass; needs Gemini + a real call |
| Sound alerts, facial grammar, speaker labels, lip reading | Not started | See §4 |
| Incoming meeting captions (tab capture + ASR) | Not started | Use the meeting's own captions for now |

## 2. First hour on site, in this order

1. **Deploy.** Vultr instance with Docker, DNS name, `cp .env.example .env`, fill in keys,
   `docker compose up -d --build`. Open `https://<domain>/api/health`.
   - `gemini.model_ok` must be `true`. `signs.ready` must be `true`.
   - The image has built and run locally (Nov 14); a Linux VM should behave the same, but check.
2. **Twilio console.** Upgrade from trial. Accept the "Predictive and Generative AI/ML Features
   Addendum" (Voice → Settings). Number's voice webhook: `POST https://<domain>/twilio/voice`;
   status callback: `POST https://<domain>/twilio/status`.
3. **M1 + M2: make a real phone ring.**
   ```bash
   pip install httpx websockets
   python scripts/live_check.py https://<domain> +1XXXXXXXXXX
   ```
   It dials, speaks a test sentence, shows captions, lets you type more turns, and appends what
   happened to `eval/live_calls.md`. Do not move on until this passes.
4. **If the call connects but there's no audio or the socket is refused:** look at the server log
   for "relay handshake rejected". The signature check tries the `wss://` URL and its `https://`
   form (`relay_handshake_ok` in `server/app/main.py`). If Twilio signs something else, fix it there.
   Do not turn validation off in production.

## 3. Things to verify on the first real call

- Partial captions arrive while the caller talks.
- A typed line is heard once, not twice.
- Talking over the voice stops it; the app shows "cut off" and offers "Say the rest".
- **Stop button** (`/stop` in the checker): we send a short pre-empting line. If speech doesn't
  stop, hide the Stop button (D-012).
- Voice quality and delay: `TTS_MODEL=flash_v2_5` vs `v4`. Write the result in DECISIONS D-005.
- Voice IDs in `app/src/data.ts` are unverified; "Priya" needs a real Indian English voice (D-006).
- A price triggers the confirm sheet, and a changed price voids the approval.

## 4. Remaining work, by priority

1. **Held-out signer (M3 acceptance).** On the demo device open `/#signs-lab`: check framing and
   frames per second (try `?tracker=lite` if low), set the dominant hand, record the demo phrases
   from one teammate, then `python eval/sign_eval.py --signer "<name>"`. Tune `SIGN_UNSURE_P`.
   Have a fluent signer check the sign forms.
2. **Live Gemini behind the guards (M4).** `python eval/bench.py --live`. If replies are poor, set
   `GEMINI_REPLY_MODEL=gemini-3.8-flash`. Record per-job latency from `/api/health`.
3. **Real meetings (M5).** Real Google Meet with a second person: load `extension/`, check chat
   posting (selectors in `extension/content.js` are best-effort) and the mic voice. Then Zoom and
   Teams through `bridge/` on a Windows laptop with VB-CABLE. Check for echo.
4. **Advanced feature (M6): calls in another language, built (D-034).** Verify only after 1–3 pass:
   set a contact's "They speak" to Español, call a Spanish-speaking teammate, check they hear
   Spanish, the captions are English with their words underneath, and a price still opens the
   confirm sheet. Then run `python eval/bench.py --live` (it does not yet send the language cases to
   Gemini; add that if translation quality is in doubt).
5. **Demo readiness (M8).** Rehearse the script in `MISSION.md` §11 three times, record the backup
   video of the real system, write the submission text.
6. Not done and probably should stay cut: speaker labels, lip reading, sound alerts, facial grammar.

## 5. Known gaps and risks

- Single-user demo: every open copy of the app sees every call. `APP_ACCESS_KEY` gates access.
- Incoming calls only ring while the app is open.
- SignBart has no declared license: demo use only; ask the authors before redistributing.
- Browser hand tracking ran at about 3 frames a second on a GPU-less cloud CPU. Real phones and
  laptops should be much faster, but that is unmeasured.
- While the desktop bridge is the meeting microphone, the meeting hears only the generated voice.
- `app/src/sign/realsigners.test.ts` needs the local server running and a phrases file; it skips
  without the file but fails if the server is down.
- README's status table is older than this file; update it once live results exist.

## 6. How to run and test locally

```bash
cd app && npm ci && npm run build
```
```bash
cd server && pip install -r requirements.txt && VALIDATE_TWILIO_SIGNATURE=false uvicorn app.main:app --port 8000
```
```bash
cd server && python -m pytest -q tests
```
```bash
python eval/bench.py
```
```bash
cd app && npx vitest run
```
Pages: `/` (Call, Meetings, Playground tabs) · `/#gallery` (all 22 frames) · `/#signs-lab` · `/#meet`
(extension panel). Without keys the server uses a fake Twilio and built-in rules: you can click
through everything, but no phone rings, and that never counts as a pass.

## 7. Map of the code

- `server/app/main.py` HTTP + WebSocket endpoints · `controller.py` call state machine ·
  `guards.py` safety checks · `ai.py` Gemini jobs + rule fallback · `relay.py` Twilio protocol ·
  `signs/` sign model service
- `app/src/screens/` Call, Setup (home, contacts, tabs), Meet (extension panel + Meetings tab),
  Playground, InPerson, SignsLab · `sign/` camera worker, segmenter, pipeline · `synth/` gesture logic
- `model/` SignBart reimplementation, ONNX, vocab · `eval/` bench and results · `extension/` Meet ·
  `bridge/` desktop virtual-mic bridge · `scripts/live_check.py`


