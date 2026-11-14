# Fingertip: every feature, what it's for, and what's new about it

Written 2026-11-14 for review by another agent or teammate. Every row names its code and its
evidence, so each claim can be checked. Status labels (spec §21):

- **Verified**: run and observed (offline, fake phone line or browser, as stated).
- **Unverified**: built and tested offline; needs a real service, device or person.
- **Blocked**: waiting on keys or accounts (`WHAT_I_NEED.md`).

"Novelty" is our honest claim. **Prior art has not been researched systematically.** Every
"novel" claim below must be checked before the pitch (see the reviewer checklist at the end).

**Nothing has run against real Twilio, real Gemini, a real meeting or a held-out signer yet.**

---

## What we set out to achieve

A Deaf, hard-of-hearing or nonspeaking person takes part in ordinary phone calls and existing
meetings their own way (signing, typing, tapping or showing), while the other person uses their
own phone or meeting app and installs nothing. The user stays in control: AI suggests and phrases,
code checks, and nothing is said without the user's approval.

---

## 1. Phone calls (the core)

| # | Feature | What it does | Goal | Novelty (claim) | Status | Code / evidence |
|---|---|---|---|---|---|---|
| 1.1 | Real PSTN calls via Twilio ConversationRelay | Outgoing and incoming calls to ordinary numbers; Twilio does speech-to-text, the voice and barge-in | The other person needs nothing but a phone | Not novel (captioned and typed calls exist: Rylo/Nagish, InnoCaption, CapTel, relay services) | **Blocked** (no Twilio) | `server/app/relay.py`, `main.py`; fake-Twilio e2e tests |
| 1.2 | Live captions, partial then final | Words appear while the caller talks | Follow without sound | Standard | Unverified | `controller.on_prompt`; `/#gallery` 7 |
| 1.3 | Typed replies as a first-class input | Type → guards → voice | Nonspeaking users, and anyone when signing fails | Standard | Verified (fake line) | `Call.tsx` composer |
| 1.4 | Custom quick replies | Your own one-tap phrases (Yes, No, Please repeat that...), editable and reorderable | Fast answers without AI | Standard (AAC apps do this) | Verified (browser) | `Setup.tsx Settings`, `data.ts DEFAULT_QUICK` |
| 1.5 | AI-suggested reply chips | The turn analyzer classifies the caller's question (yes/no, options, time, price...) and offers 2–4 replies; chips that invent facts are dropped | Answer in one tap, in context | Partly novel: suggestions are filtered by the fact guard | Verified offline (rules); Gemini unverified | `ai.py analyze_turn`, `controller._safe_chips` |
| 1.6 | Guards on every outgoing line | Fact (no invented numbers, names, days), negation (signed NO → says no), hedge (MAYBE stays maybe), commitment (money/booking → confirm sheet), duplicate (10 s) | The AI can't put words in your mouth | **Novel claim:** code-level, test-measured guards between an LLM and a live call | Verified offline: bench 40/40, 36/36 guard units | `guards.py`, `eval/bench.py`, `eval/results.md` |
| 1.7 | Hash-bound approvals | An approval is bound to the exact words + the current terms; if the caller changes the price, the approval is void | Never agree to something you didn't see | **Novel claim** | Verified offline | `guards.approval_hash`, bench "approval goes stale" |
| 1.8 | Confirm sheet for money and bookings | "This agrees to pay $23.40 and places the order. Yes / Change / Not yet" | Consent for consequential actions | Not novel as UI; novel combined with 1.7 | Verified (gallery, bench) | `Call.tsx` sheet |
| 1.9 | Fillers while you compose | "Mm, one sec..." after 2 s and 8 s, max 2 per turn, never while the caller talks | The caller doesn't hang up during signing | **Novel claim** for signed calls | Verified offline (bench) | `controller._filler_loop` |
| 1.10 | Barge-in keeps the unsaid rest | The caller talks over the voice → it stops → the unheard part becomes a draft: "Say the rest" / "Drop it" | Natural turn-taking | **Novel claim** | Unverified (bench passes; needs a real call) | `controller.on_interrupt` |
| 1.11 | Auto-handling of call mechanics | "Are you there?" → "Yep, still here", "say that again" → repeats your last line, hold music detection with flash + vibration when a person returns, "is this a robot?" chips | Fewer awkward moments | Partly novel | Verified offline (bench) | `ai.py` rules, `controller` |
| 1.12 | Errand note | Before a business call: "garlic bread and wings, name Shruti, tell me the total first". Safe facts are said automatically; money waits for you | Routine calls with less typing | **Novel claim** (pre-authorized facts + guarded rest) | Verified offline | `ai.parse_note`, `ErrandNote` |
| 1.13 | Honest heads-up, described your way | Strangers hear that an app is voicing; you choose Deaf / hard of hearing / don't speak / neutral (4 languages) | Honesty without forcing a label | Small novelty | Verified (fake line) | `translate.intro`, Settings |
| 1.14 | Talk style + tone | Casual for family, polite for businesses; tone tags for expressive voices | Sound like yourself | Standard | Verified offline | `controller.default_tone`, `relay.spoken_token` |
| 1.15 | Voice picker | 4 ElevenLabs voices through Twilio | Choose your voice | Standard | Unverified (voice IDs not checked) | `data.ts VOICES` (D-006) |
| 1.16 | Calls in Spanish, French, Portuguese | They hear their language; you read English with their words underneath; numbers, days and "no" are checked after translation | Talk across languages | **Novel claim:** translation guard on a live accessible call | Unverified (scripted-translator bench 6/6) | `translate.py`, D-034 |
| 1.17 | Real call progress | Dialing / Ringing / They picked up only from Twilio's own events | No fake statuses | Standard practice | Verified (fake line shows no fake progress) | `store.ts call_status` |
| 1.18 | Retry-safe Send | One request id per tap; a retry is answered, never spoken twice | Reliability on bad networks | Standard engineering | Verified (server test) | `main.send`, `api.ts` |
| 1.19 | Reconnects | App socket reconnects with a snapshot; Twilio re-dials our socket if it drops | A blip doesn't end the call | Standard | Verified offline (fake Twilio) | `api.ts Live`, `relay_ended` |
| 1.20 | After the call | Recap of what was agreed; transcript saved only on this phone if you tap Save | Remember plans and prices | Standard | Verified (gallery) | `ai.recap`, `AfterCall` |
| 1.21 | Contacts, recents, keypad, caption sizes (4) | Familiar phone app | Low learning curve | Standard | Verified (browser) | `Setup.tsx` |
| 1.22 | Safety and abuse limits | Twilio signature checks (HTTP + WebSocket), dial limits, max live calls, optional access key, emergency notice ("text 911") | Protect users and the account | Standard | Verified offline (tests) | `main.py`, D-033 |

## 2. Signing

| # | Feature | What it does | Goal | Novelty (claim) | Status | Code / evidence |
|---|---|---|---|---|---|---|
| 2.1 | On-device tracking | MediaPipe Holistic in a Web Worker; raw video never leaves the device | Privacy + speed | Standard technique | Unverified on the demo device | `app/src/sign/` |
| 2.2 | Sign recognition | SignBart (ASL Citizen, 2,730 signs) via ONNX on the server; 59 everyday signs active; one sign per pause | Sign during a real call | Model not ours; **novel claim:** recognized signs flow into a guarded live phone call | Public signers: 96% top-1 within our signs (may be training data). **No held-out signer** | `model/`, `eval/model_check.md`, `pipeline_check.md` |
| 2.3 | Signs → editable draft | Signs shown as chips, the sentence drafted from them, ready before you tap Send | You see what was recognized vs what was phrased | Recognition confidence and LLM phrasing kept separate | Verified (gallery, bench) | `controller.draft_from_signs` |
| 2.4 | Unsure sign → two choices | Nothing is said until you pick | No guessing | Small novelty | Verified (gallery) | `useSigning.unsure` |
| 2.5 | Signs lab | Record a teammate, measure accuracy, tune the threshold | Honest, held-out numbers | Tooling | Built; not yet used on a real person | `/#signs-lab`, `eval/sign_eval.py` |
| 2.6 | Face-to-tone (experimental, off) | Facial expression suggests a tone | Expressiveness | Risky (eyebrows are ASL grammar) | Off by default | `FACE_TONE` |

## 3. Show it (Gemini video)

| # | Feature | What it does | Goal | Novelty (claim) | Status | Code / evidence |
|---|---|---|---|---|---|---|
| 3.1 | Film instead of describe | 10–60 s clip → Gemini reads it in passes, as a background job with live progress | Calls about physical problems without speaking | **Novel claim** for Deaf/nonspeaking callers (Be My Eyes/Be My AI describe images for *blind* users: check) | Plumbing verified (scripted engine); **Gemini unverified** | `server/app/show.py`, D-035 |
| 3.2 | Section timeline + full transcript | Pass 1: sections that tile the clip. Pass 2 (parallel, one clip per section at 8 fps): everything in each section as timed lines (what happens, on-screen text copied exactly, speech word for word, sounds) | Slide to any part and read exactly what's in it (the Process-Annotation experience) | Process-Annotation's step + transcript passes applied to accessibility | Verified in browser (scripted engine): dragging the rail to 11.2 s showed "Panel and label", highlighted "On screen · E24", boxed E24 | `run_passes`, `ShowPlayer` |
| 3.3 | Precision pass | A 3 s window at 10 fps around each fact; kept only if the answer falls inside its window | Tight times and boxes | From Process-Annotation's refine pass | Verified (tests, browser: 6.8 s → 6.2 s, box tightened) | `apply_refined` |
| 3.4 | Studio player with AR overlays | Boxes + tooltips follow the playhead; section rail you can drag; numbered fact pins; chapter label; Timeline / Key moments views | Check every fact against what the camera saw | Evidence-linked AI output | Verified in browser (box within ~4 px of the drawn shape) | `screens/Show.tsx` |
| 3.5 | Ask the video | Any question ("what's the model number?") is answered only from the clip, with its moment and box; "doesn't clearly show that" otherwise. In a call: one tap checks the caller's last question | Answer follow-ups without guessing | **Novel claim** | Verified (tests, browser: pin 4 at 15.6 s; unknown question refused) | `ask_video`, `/api/calls/{sid}/ask-video` |
| 3.6 | Facts in the call | Summary as a draft (fact-guarded), "Say this" per fact, facts are allowed sources for the guards, nothing auto-spoken | Talk about it with approval | **Novel claim** | Verified (tests + browser, fake line) | `controller.attach_video`, `add_video_fact` |
| 3.7 | Problem report | One printable page: key frames grabbed from the clip with their boxes drawn, timestamps, the summary, the full timeline table. Print or save as PDF | Send to a landlord, insurer or repair shop (like the work chart) | Small novelty | Verified in browser (frames contain real video pixels + box) | `ShowReport` |
| 3.8 | Share link / delete / expiry | Opt-in link: the other person gets the same studio and report; delete now; 24 h expiry | The landlord sees what you saw | Small novelty | Verified (tests) | `/api/shared/*`, `#s/<token>` |

**Still open on Show it:** real Gemini quality, box accuracy and wait time (needs the key and 3–4
real clips); boxes that move with the object between `t` and `t_end` (a box per sampled frame);
whether `start_offset`/`end_offset` clipping works with inline (under 18 MB) video, which isn't
verified, so if it fails, switch those passes to the Files API (`GeminiVideo.prepare`).

## 4. Meetings

| # | Feature | What it does | Goal | Novelty (claim) | Status | Code / evidence |
|---|---|---|---|---|---|---|
| 4.1 | Google Meet extension | A Fingertip button in Meet opens the signing panel; approved sentences go to Meet chat and, if voice is set up, into your Meet mic (mixed with your real mic) | Same engine in meetings people already use | Partly novel (mixing generated voice into the Meet mic from an extension) | Unverified (stand-in page only) | `extension/` |
| 4.2 | Desktop bridge | Plays approved sentences into VB-CABLE / BlackHole → Zoom, Teams, any app | Works everywhere | Standard technique | Unverified (`--dry-run` only) | `bridge/` |
| 4.3 | Meetings tab | Real setup status from the server (voice, bridge), say something into the meeting | Clear setup | Standard | Verified (browser) | `screens/Meet.tsx` |
| 4.4 | Meeting voice | Gemini speech (or ElevenLabs) for meetings | Natural voice outside phone calls | Standard | Unverified | `/api/tts` |
| 4.5 | Captions as video for every participant | Not built (shared text goes through Meet chat today) | | | Not started | |

## 5. In person

| # | Feature | What it does | Goal | Status | Code |
|---|---|---|---|---|---|
| 5.1 | Flip the phone | Your sentence shown big for the other person; their speech captioned (Chrome speech recognition) | Face-to-face conversations | Unverified with a real microphone | `screens/InPerson.tsx` |

## 6. Gesture Synth (Playground)

| # | Feature | What it does | Goal | Novelty (claim) | Status | Code / evidence |
|---|---|---|---|---|---|---|
| 6.1 | Hand-played music | Pinch = note, sideways = pitch (pentatonic, can't sound wrong), height = brightness, open palm = chord; touch works too | Joy and play; a judge plays in seconds | Not novel as an idea (gesture instruments exist) | Logic unit-tested 7/7; camera play untested | `synth/mapping.ts` |
| 6.2 | Living Aurora visuals | Aurora sky tinted by recent notes, ribbons that swell on held notes, pulses, chord blooms, particles; pitch shown by colour AND shape | Music you can see | Made for Deaf and hard-of-hearing players: playable with sound off, light follows the real audio level metered before the mute, vibration on every note | Verified (touch, browser); 1.2–1.7 ms/frame script time | `synth/aurora.ts` |

## 7. Platform and quality

| # | Feature | Status | Code / evidence |
|---|---|---|---|
| 7.1 | Docker + Caddy (HTTPS) deploy | Built and run locally; Vultr blocked | `Dockerfile`, `docker-compose.yml` |
| 7.2 | `/api/health` with latency medians per stage | Verified | `main.health`, `latency.py` |
| 7.3 | Typed frontend/backend contract; events carry id + timestamp | Done | `app/src/contract.ts`, `docs/CONTRACT.md` |
| 7.4 | Safety bench (40 scripted calls, 36 guard units), `--live` mode for Gemini | Verified offline; live blocked | `eval/bench.py` |
| 7.5 | Real-call checker that logs to `eval/live_calls.md` | Built; never run | `scripts/live_check.py` |
| 7.6 | Design gallery: every screen with fixture data | Verified | `/#gallery` (27 frames) |
| 7.7 | Installable web app (PWA), name Fingertip | Verified (manifest) | `app/public/manifest.webmanifest` |
| 7.8 | Tests: server 40 + 1 skipped, app 12 + 1 skipped | Verified 2026-11-14 | `server/tests`, `app/src/**/*.test.ts` |

---

## Reviewer checklist (for the supervising agent)

1. **Check every "Verified" row** by running it: `python eval/bench.py`, `cd server && python -m pytest -q tests`, `cd app && npx vitest run && npm run build`, and open `/#gallery`.
2. **Check every "Novelty" claim** against prior art: Rylo (formerly Nagish), InnoCaption, CapTel, Sorenson, Convo, Purple VRS, Google Live Transcribe and Project Activate, Apple Live Speech, Be My Eyes / Be My AI, Sign-Speak, SignAll, AAC apps (Proloquo, Spoken). Downgrade any claim a shipped product already covers.
3. **Look for overclaiming** in `README.md`, `docs/SUBMISSION.md` and the UI text: nothing unverified may be described as working.
4. **Re-check the privacy promises:** raw sign video stays on the device; Show it clips go to Google and are deleted after 24 h; transcripts are saved only on tap.
5. **Once keys exist:** update every Blocked/Unverified row from real results (`eval/live_calls.md`, `eval/sign_eval.py`, Show it on 3–4 real clips) before submission.


