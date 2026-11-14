# Sign2Speak · Master Build Directive (handoff to Claude Fable)

HackUMass XIV · Nov 13–15, 2026 · hacking ends **Sun Nov 15, 10:00 AM ET**, judging 12:30 PM.

> **Your first job is not to impress anyone with an implementation plan. Your first job is to make a
> real phone ring and complete a two-way exchange. Then build the magic on top.**

You are the autonomous principal engineer of Sign2Speak: architect, AI researcher, accessibility
engineer, designer, QA lead. Execute; don't stop at plans. Make ordinary engineering decisions
yourself. Stop and ask only for credentials, purchases, external authorization, or product-owner
calls. Never fabricate a passing test, an API capability, an accuracy figure, or an integration.

---

## 0. Read this first: rules compliance (blocking)

Every commit in this repository was made **before hacking started** (first: Thu Nov 12, 11:48 PM ET;
last: Fri Nov 13, 8:53 AM ET; hacking began Fri 8:30 PM ET). Most MLH-style hackathons, likely
including HackUMass, require project code to be written during the event.

Before writing anything else, the team must read the HackUMass XIV rules and do one of these:
1. **Ask the organizers** whether this existing work may be used, disclosed as pre-existing, with
   only work done during the event judged; or
2. **Rebuild during the event**, using this repo only as a design reference (`git log` and file
   timestamps will show which is which); or
3. Enter it wherever the rules allow pre-existing projects.

Do not hide or rewrite history. If the rules require a rebuild, the fastest honest path is to
rebuild the same architecture (below) from the documented decisions, which the measured results
here make much faster.

---

## 1. Product

**Sign2Speak · Your language. Every conversation.**

An ASL-first, signer-controlled communication interface for ordinary phone calls and existing
meetings. The signer signs or types; the other person hears a natural voice on their own phone,
Google Meet, Zoom, or Teams; their reply comes back as live captions. The other person installs
nothing. Not a replacement for interpreters, VRS, or emergency services.

**The magic-trick test:** a judge takes part in something that seems impossible ("You're not
talking, I installed nothing, how am I hearing you on my own phone?"), and it works, for real,
in front of them. No prerecorded output, no hidden triggers, no fake statuses.

---

## 2. Starting point: what already exists (verify, don't assume)

Repo layout: `app/` (React + Vite + TS PWA), `server/` (FastAPI), `model/` (sign model), `eval/`,
`extension/` (Meet), `docs/`. Read `README.md` and `DECISIONS.md` (D-001..D-027) before changing
architecture.

| Area | State | Evidence |
|---|---|---|
| Twilio ConversationRelay adapter, webhooks, signature checks (HTTP + WS handshake) | Implemented, **never run against real Twilio** | `server/app/relay.py`, `server/tests/test_e2e.py` (fake Twilio) |
| Call controller: states, fillers, interruptions (keeps unsaid rest), hold, repeats, intro | Implemented and tested offline | `eval/bench.py`: 26/26 cases |
| Guards: fact, negation, hedge, commitment, duplicate; hash-bound approvals | Implemented and tested offline | 27/27 guard units |
| Gemini jobs with deterministic fallback | Implemented; **never called live** (no key) | `server/app/ai.py` |
| Signer app: all 22 design frames, call flow, reconnect, in-person mode | Implemented; tested in headless Chromium against fake Twilio | `/#gallery`, e2e UI script |
| Sign recognition: SignBart-ASL-2730 → ONNX, MediaPipe Holistic in a Web Worker, pause segmenter | Implemented; tested on **public** signers only | `eval/model_check.md`, `eval/pipeline_check.md` |
| Meet extension: panel → Meet chat + voice into the Meet mic | Implemented; tested on a **stand-in** Meet page | `extension/`, D-026 |
| Deploy: Docker + Caddy on Vultr | Written; image **never built** (no Docker daemon); layout simulated | `Dockerfile`, `docker-compose.yml` |

Measured (public ASL Citizen signers who may be in the model's training data, so not held-out):
96% top-1 within our 62 signs with the hand setting matched; 85% across all 2,730 signs; 95% at
10 fps; real phrases through the app pipeline 22/24 signs, 8/12 exact. Browser tracking ~300 ms
per frame on a 4-core CPU without a GPU. **No held-out signer, no real call, and no real meeting
has been measured yet.**

---

## 3. Priorities (in this order, each gated by its acceptance test)

| # | Milestone | Done when (real, observed, written down) |
|---|---|---|
| **M1** | The phone rings | A teammate's ordinary phone rings, they answer, and they hear a generated sentence. |
| **M2** | Two-way call | Typed text is heard; their reply appears as captions; 5+ turns, an interruption, hang-up; no duplicate or missed lines. |
| **M3** | Real signing in the call | A supported phrase signed on the demo laptop/phone becomes an editable draft, is approved, and is heard. Held-out teammate accuracy measured. |
| M4 | Reliability + intelligence | Live Gemini (or better) behind the guards; bench passes with the live model; latency logged per stage. |
| M5 | Existing meetings | Generated speech audible to another participant in a **real** Google Meet; then Zoom and Teams on Windows via virtual mic. |
| M6 | One advanced surprise | Pick the one that actually works best (see §6). |
| M7 | Gesture Synth | Separate Playground mode; a judge plays in seconds. |
| M8 | Demo ready | Script rehearsed 3×, backup video of the real system, submission text, honest limits. |

Never skip ahead because the next milestone is more fun. If M1 is blocked, everything else waits.

### Credentials and accounts the team must provide (blockers)
- Twilio: upgraded (not trial) account, a voice number, **ConversationRelay onboarding completed and
  the "Predictive and Generative AI/ML Features Addendum" accepted**.
- Vultr instance + a DNS name pointing at it.
- Gemini API key (and any alternative model keys you choose to test).
- ElevenLabs key only if you use it outside Twilio (Meet voice, voice previews).
- The phone numbers of people in the room who agreed to be called.

---

## 4. Architecture: one engine, many outputs

```
CAMERA ─▶ MediaPipe (browser, Web Worker) ─▶ one sign per pause ─▶ classifier (server, ONNX)
                                                        │
                       glosses + classifier confidence ─┤
                                                        ▼
                     signer review: approve / edit / cancel  ◀── typed text, quick replies
                                                        │
              LLM: gloss → sentence (only when needed) ─┤── guards (fact/negation/hedge/commitment/dup)
                                                        ▼        approval hash = text + current terms
                                                 OUTPUT ROUTER
                              ┌─────────────────────────┼──────────────────────────┐
                    Twilio ConversationRelay      Meet extension (mic mixer)   Desktop bridge → VB-CABLE /
                    (PSTN, TTS + STT + barge-in)  + Meet chat                  BlackHole → Zoom / Teams / Meet app
                              │                         │                          │
INCOMING ◀── Twilio partial/final transcripts     Meet native captions /     loopback or tab capture →
                                                  tab capture → ASR            streaming ASR
```

Rules that keep it reliable:
- Telephony, recognition, captions, and the LLM are separate lifecycles. A failure in one never
  ends the call or blocks typing.
- Every event carries session ID, event ID, timestamp, type, state transition, error, latency.
- Outgoing speech goes through one function with duplicate suppression, a one-line queue, and
  cancellation. Superseded or cancelled lines are never sent.
- Classifier confidence and LLM output are never mixed: the UI shows recognized signs as chips;
  an LLM never reports a "confidence".

### Decisions you may revisit (with evidence, logged in DECISIONS.md)
- **Telephony:** ConversationRelay (Twilio does STT, TTS, turn detection, interruptions). Only add
  Pipecat or Media Streams if a measured limitation requires it.
- **Sign model:** SignBart-ASL-2730 was chosen by coverage of our signs on real signers (D-020).
  Re-check Hugging Face/GitHub for newer landmark models (OneSign, Google sign-to-text releases,
  newer ASL Citizen/WLASL models) and swap only if they beat it **on our held-out teammate**,
  have usable weights and a license, and run on CPU. Raw video never leaves the device.
- **Language model:** Gemini Flash-Lite with minimal thinking now; benchmark alternatives (Grok,
  Nemotron, Claude, newer Gemini) on `eval/bench.py --live` for meaning preservation and latency.
  The LLM never speaks on its own and never adds facts.
- **TTS:** ElevenLabs through ConversationRelay; measure v4 vs Flash 2.5 latency on a real call.
- **Meetings:** extension for Meet in Chrome (built). Zoom/Teams desktop apps need a virtual mic:
  see §5.

---

## 5. Meetings (M5): what's real and what isn't

- A web page cannot create a system microphone. Don't claim otherwise.
- **Meet in Chrome:** the existing extension wraps Meet's `getUserMedia`, mixing the signer's mic
  with Sign2Speak's voice, and posts each sentence to Meet chat. Test it on real Meet with a second
  person; fix chat selectors if Meet's markup differs.
- **Zoom / Teams / any app (Windows first):** install VB-CABLE; build a small local bridge (Python
  or a tiny Electron/Tauri app) that receives approved sentences from the server over WSS, fetches
  TTS audio, and plays it to **CABLE Input**. The user picks **CABLE Output** as the mic in the
  meeting app. Same engine as the phone path. macOS equivalent: BlackHole. Mix the real mic in only
  if a passthrough is reliable; otherwise document "voice-only mic while Sign2Speak is active".
- **Incoming meeting speech:** prefer the platform's own captions shown to the signer. Tab capture
  (`chrome.tabCapture`) → streaming ASR in the extension is the next option. Don't route meeting
  audio through the server without consent.
- Check echo: the bridge must never play meeting audio back into the cable.
- No iOS system-wide mic claims.

Acceptance: another real participant hears the voice in real Google Meet; the meeting shows the
expected mic; no echo; typing and signing both work; then the same for Zoom and Teams.

---

## 6. Advanced features: pick by verified impact, one at a time

| Candidate | Value | Risk | Rule |
|---|---|---|---|
| Barge-in (caller interrupts, rest kept) | High, already built | Needs real-call verification | Verify in M2 |
| Multilingual: approved English → Spanish voice; Spanish speech → English captions | High wow, simple via LLM + `language` attribute | Cascaded errors | Only after English is solid; show both texts |
| Environmental sound alerts (YAMNet / MediaPipe Audio Classifier, in browser) | Useful, independent | False alarms | Visual only, never "safety system" |
| Facial grammar (eyebrows for questions, head shake for negation) | Deep ASL value | Hard to validate | Only claim what the held-out test shows; off by default |
| Speaker labels in meetings (Sortformer / pyannote) | Nice | Needs reliable incoming audio | "Speaker 1/2", never names |
| Lip reading (Auto-AVSR) | Flashy | Unreliable | Isolated experiment or cut |

---

## 7. Gesture Synth (M7): Playground

- Separate top-level mode; its hand tracking never runs during a call; it can't emit speech.
- Reuse the MediaPipe worker. Tone.js (pin an exact version) + Canvas.
- Right hand: x = pitch on a pentatonic scale (so anything sounds good), y = filter/volume.
  Pinch = note, open palm = chord, left hand = effects. One Euro smoothing, debounce on triggers.
- Show every note as light and shape, and pulse the phone's vibration on the beat: made for
  people who see and feel music, not only hear it.
- First-time player makes music within 5 seconds without instructions.
- Language: "Deaf" and "hard of hearing", never "dumb" or "mute". Don't claim Deaf people "can't
  play music"; Deaf musicians exist. Pitch it as making feedback visual and physical. Show it to at
  least one Deaf or hard-of-hearing person and use their words.

---

## 8. UX

Three top-level experiences: **Call**, **Meetings**, **Playground**. The 22 existing frames are
the reference for Call. Real telemetry only: no fake waveforms, statuses, or transcripts. Keyboard
access, strong contrast, captions ≥ 22 px, buttons ≥ 44 px, obvious camera/mic state, plain-language
errors. A first-time user understands the screen in under 10 seconds.

---

## 9. Tests (alongside the code, not at the end)

- **Telephony (real):** outbound answered, failed/busy, TTS heard, captions, 5+ turns,
  interruption, hang-up, reconnect, duplicate suppression, provider error. Record results in
  `eval/live_calls.md` with date, phones, carrier, and what was heard.
- **Semantic safety:** keep `eval/bench.py` green; extend to 33+ cases (names, prices, dates,
  quantities, appointments, commitments, repeats, uncertain recognition, cancellations); run it
  against the live LLM too.
- **ASL:** held-out teammate via `/#signs-lab` + `eval/sign_eval.py`: per-sign accuracy, phrase
  success, confusions, unknown-sign rejection, inference time. Never report training accuracy as
  real-world accuracy.
- **Meetings:** real participants, as in §5.
- **Latency:** camera→landmarks, recognition, LLM, TTS start, captions, end-to-end. Note hardware
  and network. `/api/health` shows medians.

Maintain the feature-status table in README: Implemented and tested · Implemented, unverified ·
In progress · Planned · Blocked · Cut. A mock never counts as a pass.

---

## 10. Privacy, safety, compliance

No raw video leaves the device; no recordings; transcripts only on the signer's phone if they tap
Save; keys server-side; TLS; Twilio signatures checked; app access key; rate-limit dialing; only
call people present who agreed. Strangers and businesses always hear the honest AI heads-up. No
emergency-call claims. Model licenses: SignBart has none declared (demo use only; ask the authors);
record every new model's license in DECISIONS.md.

---

## 11. Demo (90–120 s), only with what actually works

1. **The real phone.** With consent, call a judge's phone. They answer. The signer signs "YES SUNDAY
   COME"; the draft shows the recognized signs; approve; the judge hears "Yeah! I'll be there
   Sunday." The judge replies; captions appear.
2. **Uncertainty.** The caller offers "six or twelve?" and the signer's sign is unclear. Two
   choices appear; nothing is said until the signer taps. A price triggers the confirm sheet.
3. **Same engine in a meeting.** Real Google Meet: the other participant hears the voice and sees
   the chat line. Skip this scene if it isn't stable that day.
4. **One surprise** that works (multilingual voice, barge-in, sound alerts).
5. **Gesture Synth.** Hand the judge the camera; music starts immediately.

Backup: a video of this exact flow on the real system, recorded after freeze. Never present the
video as live.

Positioning: Rylo (formerly Nagish) does captioned calls with typed replies; Google's sign-to-text
works as text, in person. Sign2Speak lets you sign during a real phone call and in existing
meetings, with a natural voice and an assistant that never agrees to anything without you.
Research Sign-Speak, Talksign, Convo, Sorenson and platform features before the pitch, and separate
shipped features from marketing claims.

---

## 12. Team split

Telephony/backend · AI/CV · Frontend/UX · Integration/testing/demo. Freeze features at
**Sun 6:30 AM ET**; bug fixes only after that. Protect the 10:00 AM deadline.

## 13. Deliverables

Working code (app, server, model, extension, desktop bridge if built, Playground), Docker + Vultr
instructions, `.env.example`, tests, measured results (`eval/*.md`), model-selection notes,
architecture diagram, privacy notes, demo script, submission text (problem, what works, what was
measured, limits, sponsor tech: Vultr, Gemini, and any others actually used), and an honest
limitations section.

**Begin now: §0, then M1.**


