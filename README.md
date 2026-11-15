# Fingertip


**Your hands. Your voice. Your world.** (Formerly Sign2Speak. The name is set in one place per
surface: `app/src/brand.ts`, `extension/content.js`, server `APP_NAME`.)

> **Getting it running? Read [WHAT_I_NEED.md](WHAT_I_NEED.md) first.**
>
> **New to the team? Read [HANDOUT.md](HANDOUT.md): every feature, how to run it, who does what.**
>
> **Deploying or making the first real call? [HANDOFF.md](HANDOFF.md).** Every feature, its goal and novelty: [docs/FEATURES.md](docs/FEATURES.md). Status: [docs/STATUS.md](docs/STATUS.md). Event contract: [docs/CONTRACT.md](docs/CONTRACT.md).

**Communicate your way. Be understood anywhere.** A Deaf, hard-of-hearing or nonspeaking person
makes and takes real phone calls and joins existing meetings. They sign, type or tap a quick reply.
The other person hears a natural voice on their own phone or in their meeting, and their words
come back as live captions. The other person installs nothing.

Built at HackUMass XIV. Sponsor tech: **Vultr** (hosting), **Gemini API** (turn analysis, reply
writing, recap).

## Status

Labels as in `MISSION.md` §9. A mock never counts as a pass. Last checked 2026-11-14 on a
Windows 11 laptop (Python 3.13, Node 24); see `HANDOFF.md` for detail.

| Milestone | State | Evidence |
|---|---|---|
| M1 The phone rings | **Blocked** (no Twilio account, number or deploy yet) | `scripts/live_check.py` is ready |
| M2 Two-way call (captions, typing, interruptions, hang-up) | Implemented, unverified | Fake-Twilio e2e: `server/tests` 24 passed, 1 skipped |
| Guards, approvals, fillers, note parser (rules brain) | Implemented and tested (offline) | `eval/bench.py`: 40/40 cases, 36/36 guard units |
| M3 Sign recognition | Implemented; tested on public signers only | `eval/model_check.md`, `eval/pipeline_check.md`; **held-out teammate not measured** |
| M4 Live Gemini behind the guards | **Blocked** (no key) | `python eval/bench.py --live` |
| M5 Meetings: Meet extension, desktop bridge | Implemented, unverified | Stand-in Meet page; bridge `--dry-run` only |
| M6 Calls in Spanish / French / Portuguese | Implemented, unverified live | Bench: 6 language cases (scripted translator) + translation guard; needs Gemini (D-034) |
| M7 Gesture Synth (Playground) | Implemented; touch tested, camera play not tried | `app/src/synth` unit tests 7/7 |
| Signer app (22 frames, Call / Meetings / Playground) | Implemented and browser-tested | `npm run build` passes; `/#gallery` |
| Docker image | Implemented and tested locally; not yet on Vultr | Built on Docker 27.5; container serves `/` and `/api/health` with `signs.ready: true` |

What's honest to say today: phone calls with live captions, typed and quick-reply answers in a
natural voice, and a conversation-aware assistant that never agrees to money or bookings
without the signer's tap. Sign recognition: "a tested set of everyday signs, with typing for
the rest". The numbers below come from public ASL Citizen signers whose clips may be in the
model's training data; the held-out teammate number comes from `eval/sign_eval.py`.

### Sign recognition: what was measured
| Check | Result |
|---|---|
| 313 real ASL Citizen clips, 62 of our signs, hand setting matched | 96% top-1 within our signs, 85% top-1 of all 2,730 signs |
| Same, right-hand order only (no setting) | 83% within our signs |
| Frame rate | 98% at 15 fps, 95% at 10 fps, 93% at 6 fps |
| Real signer phrases through the app's own segmenter + pipeline | 22/24 signs, 8/12 phrases exact (21/24 at 10 fps) |
| Server classification time | ~8 ms per sign (CPU) |
| Browser tracking (headless, 4-core CPU, no GPU) | ~300 ms per frame, in a Web Worker; measure on the phone |

## How it works

- **Signer app** (`app/`): React + Vite + TypeScript PWA, phone-first. It talks to the server
  over one WebSocket (events) and REST (actions). The camera stays on the device: MediaPipe
  Holistic runs in a Web Worker and only x/y landmarks are sent, one sign per pause.
- **Sign model** (`model/`): SignBart-ASL-2730 (ASL Citizen), reimplemented and exported to ONNX
  (`model/signbart_model.py`), served by `server/app/signs/`. 59-sign active vocabulary in
  `model/vocab.json`. A dominant-hand setting lives in the Signs lab (`/#signs-lab`).
- **Meet extension** (`extension/`, stretch): signer-only. Opens the signing panel, posts each
  sentence to Meet chat, and plays the voice into the Meet mic when `ELEVENLABS_API_KEY` is set.
- **Backend** (`server/`): one FastAPI service. Twilio webhooks, the ConversationRelay
  WebSocket, a deterministic call controller, guards, and the Gemini jobs.
- **Telephony**: one Twilio number with ConversationRelay. Twilio does speech-to-text, turn
  detection, interruptions and ElevenLabs text-to-speech. The backend only sends and receives
  text.

See `docs/architecture.md` and `DECISIONS.md`.

### The rules the code enforces
- Nothing is spoken that the signer didn't approve, except Auto lines: intro, note facts,
  repeats, "still here", fillers.
- Money, payment, bookings, final confirmations and info not in the note open the confirm
  sheet. The approval is bound to a hash of the exact sentence and the current terms. An edit,
  or a new price from the caller, voids it.
- Every number, price, day, time and name in an AI-written sentence must come from the signs,
  a chip, the note or the caller (fact guard). Signed NO means the sentence says no (negation
  guard). "Maybe" only if MAYBE was signed (hedge guard). No line is repeated within 10 s.
- Strangers and businesses always hear a short, honest heads-up.

## Run locally

```bash
cd server && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
```

```bash
cd app && npm ci && npm run build
```

```bash
cd server && VALIDATE_TWILIO_SIGNATURE=false uvicorn app.main:app --port 8000
```

Open http://localhost:8000 for the app, http://localhost:8000/#gallery for all 22 screens,
http://localhost:8000/#signs-lab for the sign recognition lab (camera, framing, hand setting,
held-out recordings).
Without keys the server uses a fake Twilio and the rules brain, so you can click through
everything but no phone rings.

Tests and the test bench:

```bash
cd server && python -m pytest -q tests
```

```bash
python eval/bench.py
```

Add `--live` to `eval/bench.py` to also run against Gemini (needs `GEMINI_API_KEY`).

Sign recognition checks:

```bash
cd app && npx vitest run
```

```bash
python eval/sign_eval.py --signer "<held-out teammate>"
```

`model/validate_aslcitizen.py <dir of .pose files>` re-runs the real-signer check (needs
`pip install pose-format` and ASL Citizen poses from HF `SorensenAI/asl-citizen-poses`).

### Meet extension (stretch)
Chrome → Extensions → Developer mode → Load unpacked → `extension/`. Set your server URL in
the extension's options. In Meet, tap **Sign2Speak** (bottom right). Chat selectors in
`extension/content.js` are best-effort; Meet's markup isn't a public API.

## Deploy (Vultr)

1. Create a Vultr instance with Docker. Point a DNS A record (e.g. `sign2speak.example.com`) at it.
2. `cp .env.example .env` and fill it in (keys stay on the server).
3. Start it:

```bash
docker compose up -d --build
```

Caddy gets the HTTPS/WSS certificate automatically. Check `https://<domain>/api/health`. It
shows whether Twilio and Gemini are configured, whether the Gemini model exists, and latency
medians.

### Twilio setup (M0)
1. Upgrade the account from trial (trial accounts only call verified numbers and play a notice).
2. **Complete the ConversationRelay onboarding steps in the Twilio Console, and accept the
   "Predictive and Generative AI/ML Features Addendum".** Upgrading alone isn't enough.
3. Buy a number. Voice webhook: `POST https://<domain>/twilio/voice`. Status callback:
   `POST https://<domain>/twilio/status`.
4. Every webhook and the ConversationRelay WebSocket handshake are checked against
   `X-Twilio-Signature`. Keep `VALIDATE_TWILIO_SIGNATURE=true` in production.
5. Put the real phone numbers of the people in the room into the app's contacts (tap a contact
   → tap the number). **Only call phones whose owners are present and have agreed.**

### M0 checklist (what the build environment couldn't verify)
- [ ] A test call reaches ConversationRelay and speaks in an ElevenLabs voice.
- [ ] ConversationRelay message shapes match `server/app/relay.py` (DECISIONS D-003).
- [ ] The WebSocket handshake signature validates (D-003).
- [ ] v4 vs Flash 2.5 latency measured and written to DECISIONS D-005.
- [ ] Stop cuts off speech (D-012).
- [ ] Voice IDs and samples picked (D-006).
- [ ] Gemini model IDs exist (`/api/health` → `gemini.model_ok`).
- [ ] Demo phone framing on the stand: hands, face and upper body in view (`/#signs-lab` checks it).
- [ ] Frames per second on the demo phone (`/#signs-lab`); try `?tracker=lite` if it's low.
- [ ] Dominant-hand setting for the demo signer (`/#signs-lab`).
- [ ] Held-out teammate: record the demo phrases, run `eval/sign_eval.py`, tune `SIGN_UNSURE_P`.
- [ ] SignBart has no declared license: fine for the hackathon demo; ask the authors before redistributing.

## Limits
- Incoming calls only ring while the app is open (no lock-screen ringing).
- Single-user demo: every open copy of the app sees every call.
- English only. No emergency calls, no payment card handling.
- Sign recognition covers a tested set of everyday signs (59 active); typing and quick replies cover the rest.
- One sign per pause: the signer pauses briefly between signs. Not continuous ASL.

## Why this, not existing tools
Rylo (formerly Nagish) gives Deaf users captioned phone calls, but replies are typed. Google's
SL2T brings sign-to-text to Pixel 11 apps, but as text, in person, on one phone. Sign2Speak
lets you sign during a real phone call, on any phone, with a natural voice and a
conversation-aware assistant that never agrees to anything without you.

## Repo
```
app/      signer PWA (React + Vite + TS); /#gallery shows all 22 frames
server/   FastAPI: Twilio webhooks, ConversationRelay, controller, guards, Gemini, tests
model/    SignBart reimplementation + ONNX, vocab, real-signer check, plan, data card
extension/ Google Meet extension (stretch)
eval/     test bench (bench.py) and results.md
docs/     architecture
```


