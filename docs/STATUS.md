# Feature status

Labels from the build spec (§21). **Nothing here has touched a real phone, a real meeting or a live
AI key yet**: the team hasn't provided Twilio, Gemini or Vultr credentials (see `WHAT_I_NEED.md`).
So nothing that needs them can be "Working and verified". Updated 2026-11-14.

- **Working and verified:** run and observed on this laptop.
- **Implemented but unverified:** code and offline tests exist; needs a real service, device or person.
- **In progress · Blocked · Cut:** as written.

## Phone (Surface 2)

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Real outbound PSTN call, typed text → voice, captions back, 5+ turns | **Blocked** (no Twilio account) | Code: `server/app/relay.py`, `scripts/live_check.py`. Fake-Twilio end-to-end tests pass |
| Incoming calls | Implemented but unverified | Rings only while the app is open (no push notifications) |
| Call progress (Dialing, Ringing, They picked up, Connected) from real carrier events | Implemented but unverified | Shows Twilio's status callbacks only; the fake line correctly stays at "Starting the call..." |
| Guards: no invented facts, "no" kept, hedges kept, money/bookings confirmed, no duplicates | Working and verified (offline) | `eval/bench.py`: 40/40 scripted calls, 36/36 guard units |
| Barge-in: caller talks over the voice, unsaid rest kept (also a reply still queued behind a filler, fixed 2026-11-14) | Implemented but unverified | Bench cases pass; needs a real call |
| Quick replies, customizable (Yes, No, Please repeat that, Give me a moment, …) | Working and verified (in browser) | Settings → Quick replies; always one tap away in a call |
| Typing as a first-class input | Working and verified (in browser, fake line) | |
| Caption size (Small → Extra large; 22 px+ at Medium) | Working and verified (in browser) | Extra large measured at 31.9 px |
| Heads-up describes the user as they choose (Deaf, hard of hearing, doesn't speak, neutral) | Working and verified (fake line) | A fake dial used the chosen line; 4 languages |
| Retry-safe Send (request id; a retried tap is never spoken twice) | Working and verified (server test) | `test_send_retry_with_same_request_id_is_not_spoken_twice` |
| Calls in Spanish, French, Portuguese | Implemented but unverified | Needs Gemini and a real call. Scripted-translator bench cases pass |
| Voice presets (4 ElevenLabs voices through Twilio) | Implemented but unverified | Voice IDs not checked against ElevenLabs |
| Native dialer replacement, cellular audio | Cut | Not possible in the time; it's a web app (PWA) using Twilio VoIP/PSTN |

## Show it (Gemini video → evidence-linked facts, D-035)

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Film a clip → background job (overview, section transcripts, precision pass) with live progress | Implemented; verified with a scripted engine | Progress shown live; failed sections/facts keep the coarse result. **Gemini itself never called** (no key) |
| Studio: AR boxes, draggable section rail, live transcript, key moments | Verified in browser (scripted engine, synthetic clip) | Box within ~4 px of the drawn shape; rail scrub highlights the right section and line |
| Ask the video (standalone and in a call) | Verified (tests + browser, scripted engine) | Unknown questions are refused, not guessed |
| Problem report (key frames with boxes, timeline; print or PDF) | Verified in browser | Frames are real video pixels |
| Use in a call: summary as a draft, "Say this" per fact, facts allowed for the guards | Implemented and tested (server tests + browser, fake line) | Attaching never skips ringing/connecting (bug found and fixed); invented numbers still blocked |
| Share link for the other person (off by default), delete now, 24 h expiry | Implemented and tested (server tests + browser) | |
| Latency and accuracy on real clips | Not measured | Needs the Gemini key and a few real clips |

## Signing

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Camera hand/body tracking (MediaPipe, in a Web Worker, video never leaves the device) | Implemented but unverified on the demo device | ~300 ms/frame on a GPU-less cloud CPU earlier; the browser pane here blocks the camera |
| Sign recognition: SignBart-ASL-2730, 59 active signs, one sign per pause | Implemented; measured on public signers only | 96% top-1 within our signs on ASL Citizen clips (may be training data). **No held-out signer yet** |
| Unsure sign → two choices, nothing said until the signer picks | Implemented (UI verified in gallery) | |
| Facial grammar, continuous ASL | Cut | Not claimed |

## Meetings (Surface 1)

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Meet extension: panel, sentence posted to Meet chat (everyone sees it), voice into the Meet mic | Implemented but unverified on real Meet | Tested on a stand-in page; Meet's chat selectors are best effort |
| Desktop bridge → VB-CABLE / BlackHole for Zoom, Teams, any app | Implemented but unverified | Protocol tested with `--dry-run`; audio never played |
| Local caption box on the Meet page (only you see it; movable, A−/A+, minimize, hide; says whether chat/mic delivery worked) | Working and verified (headless Chrome, stand-in Meet page) | `extension/content.js` `Captions`. Not yet tried on real Meet |
| Captions composited into a virtual camera for every participant | Not started | Today, shared text goes through Meet chat. Next step: a caption page captured by OBS Virtual Camera |
| Incoming meeting captions | Cut for now | Use the meeting's own captions |
| Speaker labels, lip reading, sound alerts | Cut | |

## Gesture Synth (Surface 3)

| Feature | Status | Evidence / what's missing |
|---|---|---|
| Living Aurora world: aurora sky, hand ribbons, note pulses, chord blooms, particles | Working and verified (touch, in browser) | Colour and shape both carry pitch; light follows the real audio level, measured before the mute |
| Gesture grammar: pinch = note, sideways = pitch, height = brightness, open palm = chord | Implemented; logic unit-tested (7/7) | Camera play not tried with a real hand (the browser pane blocks cameras) |
| Frame cost | Measured: 1.2–1.7 ms script time per frame at 1280×960 | 4 samples in a hidden pane; frame rate on the demo laptop not measured |
| Visual presets | Cut | One world, done well |

## Platform

| Feature | Status | Evidence |
|---|---|---|
| Docker image | Working and verified (local) | Builds, serves the app and `/api/health`, sign model loads |
| Vultr deploy | Blocked | No server or domain yet |
| Typed frontend/backend contract | Done | `app/src/contract.ts`, `docs/CONTRACT.md`; every event carries `eid` + `ts` |
| Product name | Done: **Fingertip** | Set in one place per surface (`app/src/brand.ts`). Web search found no communication app by that name; no trademark search done |


