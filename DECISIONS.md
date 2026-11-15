# Decisions

Short log of choices made when something was ambiguous. Newest last. "Verify" marks
things that could not be checked from the build environment and must be confirmed
against the live service in M0.

## D-001 · One service, in-memory sessions
FastAPI serves the Twilio webhooks, both WebSockets, the REST actions and the built app.
Call state lives in memory per call and is dropped 10 minutes after the call ends.
Nothing is written to disk except `logs/latency.jsonl` (numbers only, no text).

## D-002 · Single-user demo, every device sees every call
Every connected copy of the app gets every ring and call event. There's no account system.
`APP_ACCESS_KEY` (opened once as `/?key=...`) stops strangers from using the app.

## D-003 · ConversationRelay protocol lives in `server/app/relay.py` (verify)
The build environment couldn't reach twilio.com, so:
- **TwiML attribute names** come from the official `twilio` Python SDK 9.13, which generates
  them from Twilio's schema: `partialPrompts`, `interruptible`, `echoPromptFiltering`,
  `applicationReconnect`, `elevenlabsTextNormalization`, `ttsProvider`, `voice`.
- **WebSocket messages** in: `setup` (callSid), `prompt` (`voicePrompt`, `last`), `interrupt`
  (`utteranceUntilInterrupt`), `dtmf`, `error`. Out: `text` (`token`, `last`, `interruptible`,
  `preemptible`), `end` (`handoffData`). From memory plus Twilio search snippets.
- **Verify in M0:** each message shape above, and the exact URL Twilio signs on the
  WebSocket handshake. `relay_handshake_ok` accepts the `wss://` URL or its `https://` form.

## D-004 · Settings per the team's change list (Nov 13)
`partialPrompts="true"` (it defaults to false), `interruptible="any"` (set explicitly),
`echoPromptFiltering="true"`, `applicationReconnect="true"`. Our lines are sent
`preemptible: true`, which is safe because the controller only ever has one line playing.

## D-005 · Voice: Flash 2.5 by default, v4 is one env var away
`TTS_MODEL=flash_v2_5` is ConversationRelay's default ElevenLabs model. Set `TTS_MODEL=v4` for
the expressive model. The voice string then becomes `VOICE_ID-v4` with no speed or stability
settings, because v3/v4 don't support SSML or speed. With v3/v4, tone becomes a
natural-language audio tag at the start of the text token (`[warmly] Yeah! I'll be there
Sunday.`). The guards and the thread only ever see the untagged text.
**M0 task:** measure v4 against Flash 2.5 latency on a real call and record it here. Keep the
most human-sounding model that stays under about 1 s.

## D-006 · Voice IDs (verify)
The voice picker uses the design's names (Maya, Priya, Alex, Sam). Each maps to an ElevenLabs
voice ID in `app/src/data.ts`. These IDs were not verified, and "Priya" needs a real Indian
English voice. Pick the IDs in the ElevenLabs voice library, and put a sample at
`app/public/voices/<id>.mp3` for each one (the play button looks for it there).

## D-007 · Gemini: one fast model, and it never sits in the Send path
`gemini-3.5-flash-lite` with `thinking_level="minimal"` handles the turn analyzer, note parser
and reply writer. `GEMINI_REPLY_MODEL=gemini-3.8-flash` switches only the reply writer, and only
if reply-quality tests fail. The server checks both models exist at startup (`/api/health`).
Latency is logged per job (`gemini_<job>_ms`).
- Typed text, tapped chips, note facts, repeats, fillers and presence lines never call
  Gemini. They go straight through the guards (and approval, if needed) to speech.
- The signed draft is written as the signs arrive (`POST /signs`), so Send only checks a hash.
- Safety-relevant turn types (emergency, card number, hold, repeat, presence, robot) are
  decided by code, never by the model. Money and commitment flags are OR-ed with the code
  checks, so the model can't clear them.
- Every job has a deterministic fallback (`RulesBrain`), used on timeout or error. That keeps
  the call moving even when the model is slow, and it's what the offline test bench runs.

## D-008 · Approvals are bound to a hash
Every draft carries `hash = sha256(exact text + current terms)`. The terms are the amounts,
numbers, days and times in the draft and in the caller's latest line. Send (for a signed draft)
and "Yes, send it" (on the confirm sheet) must present that hash. If the signer edited the
text, or the caller has since named new terms ("actually it's $26.10"), the hash no longer
matches. The approval is then refused, and the sheet reopens showing the new terms.

## D-009 · Guards
Fact, negation, commitment and duplicate guards, plus a **hedge guard** ("might / maybe /
probably" in the sentence requires MAYBE in the signs, and vice versa). They live in
`server/app/guards.py` and run on every outgoing line. AI-written chips are filtered through
the fact guard before they're shown. Typed text skips the fact guard, because the signer wrote
it, but still goes through the commitment and duplicate guards.

## D-010 · Tone: from talk style for the MVP
Casual contacts get a warm delivery, polite ones neutral, or whatever the signer picks.
Automatic face-to-tone is off (`FACE_TONE=false`): a furrowed brow is also ASL grammar for
wh-questions, not only concern. `POST /signs` ignores `tone_source: "face"` unless the flag is on.

## D-011 · Fillers and playback timing
ConversationRelay doesn't report when playback ends, so the controller estimates it
(0.35 s + 2.8 words/s). Fillers come at 2 s and 8 s after the caller stops: at most 2 per turn,
never the same twice in a row, never while the caller is talking or on hold, and never after
a goodbye.

## D-012 · Stop button (verify)
Stop sends a near-silent `"..."` line. Our lines are `preemptible`, so it should cut off the
current line. **Verify on the M0 call.** If audio keeps playing, hide the Stop button and leave
interruption to the caller.

## D-013 · Interruptions keep the unsaid part
On `interrupt`, the line is marked "cut off". The part the caller heard
(`utteranceUntilInterrupt`) is shown solid and the rest faded. The unsaid rest becomes the
draft, so the signer can "Say the rest" or "Drop the rest".

## D-014 · Intro wording
Strangers and businesses get one honest line. With an order in the note: "Hey! Quick heads-up,
I'm deaf, so an app's voicing what I sign. I'd like to place a pickup order." Otherwise it ends
"Bear with me a sec." Contacts marked "Knows I sign" get no intro. On incoming calls from
those contacts, the app says "Hey!" when the signer answers, since the caller would otherwise
hear silence.

## D-015 · Scope of promises
Incoming calls only ring while the app is open. No lock-screen or closed-app ringing, and no
push. The demo phone sits on a stand. **Test the framing first:** the front camera must see
both hands, the face and the upper body.

## D-016 · Voice picker on first launch vs. "zero setup screens"
The design has a first-launch voice picker; the brief says zero setup screens before the first
call. Resolution: the picker opens on first launch with Maya preselected (one tap), and an
incoming call always takes over the screen. Set up the demo phone before judging.

## D-017 · Sign recognition plan replaced (see `model/PLAN.md`; results in D-020..D-026)
No more "80 signs" target. Test real checkpoints on the demo phone in hour one. Segment by
short pauses (one sign per segment). Start with the 15-25 signs that demonstrably work, and
report both single-sign accuracy and full-phrase success on a held-out signer.

## D-018 · Hold screen copy
The design's "Hold music is playing." line is left out: we can't detect music. "Leave a message
instead" opens the keyboard.

## D-019 · In-person name
The top half says "{name} is saying" using the name from the signer's first errand note
("name Shruti"). Until a name is known, it says "They're saying". No pronouns are guessed.

## D-020 · Sign model: SignBart-ASL-2730, ISLR 1st place as a second opinion
Searched HF for landmark-based ASL models (video models were out: raw video never leaves the
phone). SignBart-ASL-2730 (ASL Citizen, 2,730 signs) covers 62 of our 69 planned signs,
including COME, SUNDAY and most numbers. The ISLR 1st-place model (250 signs, MIT) covers 20,
and it needs 468 face points per frame, so it's only used for checking.
I reimplemented SignBart from the paper and a read of the authors' code (running their code
was blocked as external code). Weights load with strict key and shape checks; the ONNX export
matches PyTorch to 5e-6.

## D-021 · Hand order: SignBart's training data swaps MediaPipe's hands
On real ASL Citizen clips, feeding hands in MediaPipe Holistic's order gave 29% top-1;
swapped, 64%; mirroring x instead, 19%. The ISLR model got 84% with MediaPipe's own order, which
confirms the landmark conversion. `signbart_input` swaps. Left-handed signers need the opposite,
so there's a dominant-hand setting (Signs lab). Matched to the signer: 85% top-1 of all 2,730 signs.

## D-022 · Active vocabulary from measurements
`model/vocab.json`: the 59 signs with at least 80% hand-matched top-1 (within our signs) on 2+ real
clips. Recognition is restricted to these. Caller-named options get a 1.6x boost when re-ranking.
Unsure (top < 0.45 or margin < 0.15): the app offers the top two and says nothing until the
signer picks. Tune both on the held-out teammate.

## D-023 · Segmenter keeps lead-in
Trimming clips to the moving part dropped accuracy from 64% to 47%: the model was trained on
clips with lead-in. Segments keep about 0.33 s before the motion starts and the still frames
that end them. Pause between signs: 220 ms of stillness. The 280 ms first setting missed real
pauses because of the speed smoothing. Hands down for 0.5 s ends the phrase.

## D-024 · Tracking in a Web Worker
With Holistic on the main thread, the call UI stalled (~300 ms per frame on a CPU without a GPU),
and the test showed quick replies not appearing. Tracking now runs in a classic Web Worker
(MediaPipe uses importScripts). Busy frames are dropped, which is fine: accuracy is 95% at 10 fps.

## D-025 · Phrase ordering bug found by real-signer test
A new phrase reset the sign list before the previous phrase's results arrived, giving
"YES YES SUNDAY YES SUNDAY COME". The reset now runs in the same promise queue as the results.

## D-026 · Meet extension design (stretch)
Signer-only Chrome extension. The signing panel is the app's `/#meet`, opened as a small
window (normal camera permission flow). It posts to `window.opener` with origin checks both
ways. The content script types into Meet chat (best-effort selectors) and fetches `/api/tts`
(direct ElevenLabs, `ELEVENLABS_API_KEY`). `inject.js` wraps `getUserMedia` so Meet's mic track
is your mic mixed with the voice. Tested on a stand-in Meet page in Chromium with the
extension loaded; not tried on real Meet.

## D-027 · Model licenses
ISLR 1st place: MIT (model card). SignBart-ASL-2730: no license declared on the model card or the
GitHub repo. Fine for a hackathon demo; ask the authors before any redistribution or product use.
MediaPipe models: Apache 2.0. ASL Citizen poses were used only to check the pipeline locally and
are not committed.

## D-028 · ConversationRelay checked against Twilio's docs (Nov 14)
With twilio.com reachable, compared `relay.py` to websocket-messages, twiml/connect/conversationrelay,
voice-configuration and onboarding. Message shapes, attribute names, the `VOICE-v4` format and audio
tags all matched. Changes: added `ignoreBackchannel` (a caller's "uh-huh" no longer cuts a sentence
off); reconnect decision uses `SessionStatus == "failed"`; expressive models now include `v4_turbo`
and `v3_conversational`. Still unverified: behaviour on a real call, and which URL form the handshake signs.

## D-029 · Meeting voice on the Gemini key
The team has no separate TTS credits, and meetings can't use Twilio's voice. `/api/tts` uses Gemini
speech generation (`gemini-3.8-flash-lite-tts`, Interactions API, from Google's current docs) and
returns WAV; ElevenLabs is used instead if its key is set. Never called live.

## D-030 · Desktop bridge instead of a browser trick for Zoom and Teams
A web page can't create a system microphone. `bridge/sign2speak_bridge.py` waits on `/ws/bridge` for
approved sentences and plays them into VB-CABLE or BlackHole. It never captures audio, so it can't echo.
Sentences are de-duplicated by ID and by text (10 s). Audio output is untested here.

## D-031 · Gesture Synth design
Separate Playground tab, unreachable during a call. Notes snap to a pentatonic scale so nothing sounds
wrong. Pinch = note, held open palm = chord, height = brightness. One Euro smoothing plus hysteresis on
pinch and on lane edges stop stray notes. Every note is also a colour burst and a vibration pulse, and
there is a sound-off mode: it is meant to be seen and felt, not only heard. Touch works without a camera.

## D-032 · A repeated caller question is always answered
The bench found that "what was the name again?" within 10 s got silence, because the duplicate guard
blocked the same sentence. Note-fact answers to a new caller question now bypass that guard.

## D-033 · Dial limits
`DIAL_MAX_PER_MIN` (10) and `MAX_LIVE_CALLS` (3) protect the Twilio account from runaway or abusive dialing.

## D-034 · Calls in another language: translate at the edges, guard every line
Picked as the M6 feature (MISSION §6) because it reuses the whole engine. Each contact can have a
language (Spanish, French, Portuguese). The signer still works only in English, so the turn analyzer,
guards, confirm sheet and approval hashes are unchanged. Twilio gets the language on
`<ConversationRelay language=...>` for both recognition and voice; ElevenLabs Flash v2.5 is
multilingual, so the voice ID stays the same. Caller lines are translated to English for the
captions, with their own words shown underneath. Approved lines are translated just before they are
spoken and must pass `translation_guard`: every number (as digits), day, month and "no" must survive,
and no number may be added. If not, nothing is said and the draft comes back. Fixed lines (heads-up,
fillers, "still here") are written once per language in `translate.py` and never go through a model.
Needs Gemini; without it the app disables the picker and the server refuses non-English dials.
Translation happens after approval, so the signer sees the translation as it is spoken, not before.
Unverified live: Twilio's handling of `es-US` / `fr-FR` / `pt-BR` and Gemini translation quality.

## D-035 · Show it: video becomes evidence-linked facts with overlays
The hardest calls for someone who doesn't speak are the ones where you must *describe* something:
a leak, a warning light, a damaged parcel. Show it lets them film it instead. One Gemini call
(`server/app/show.py`, patterned on the team's Process-Annotation engine) returns facts, each with
the time it's visible and a box in the frame (0-1000, `[ymin, xmin, ymax, xmax]`). The app plays
the clip with those boxes as tooltips, so every fact is checked against the moment the camera saw
it. We use Gemini because it takes the whole clip natively, with timestamps and boxes, in one call.
Safety is the same as the errand note: facts are suggestions, nothing is said without approval, the
opening summary must pass the fact guard against the facts, and video facts become allowed sources
for the guards (anything not in them is still blocked). The same annotated clip can be shared as a
link (off by default) or shown in person. Privacy: the clip goes to Google for analysis, is kept on
our server for `SHOW_TTL_HOURS` (24) to replay or share, then deleted; "Delete this video now" does
it immediately. No fake engine in the product: without Gemini the feature says it needs the key.
Unverified until the key arrives: Gemini's fact quality, box accuracy, latency on 10-60 s clips,
and the model name `gemini-3.8-flash` (`GEMINI_VIDEO_MODEL`).

Deepened the same day to match the Process-Annotation engine: analysis is a background job with
progress; pass 1 gives sections that tile the clip plus facts; pass 2 transcribes each section in
parallel (actions, on-screen text, speech, sounds); pass 3 is a precision pass around each fact
(kept only inside its window). Added "ask the video" (answered only from the clip, or refused) and
a printable problem report whose key frames are grabbed in the browser, so no new server
dependencies. One failed section or fact keeps its coarse result; only a failed overview fails.


