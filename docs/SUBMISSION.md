# Submission draft and demo script

Draft for the Devpost page and the judging table. Everything in **[brackets]** must be filled in from
a real, observed result (`eval/live_calls.md`, `eval/sign_eval.py`) or deleted. Never submit a
bracket as if it were true. Remove any scene below that wasn't stable on the day.

---

## Fingertip · Every conversation, at your fingertips.

### The problem
Phone calls still assume everyone can hear and speak. Deaf signers today can use relay services
(which need an interpreter on the line), captioned-call apps (where you type every reply), or
avoid the call. Booking a doctor, ordering takeout, or answering Mom about Sunday dinner shouldn't
need a third person or a keyboard.

### What it does
The user signs, types, or taps one of their own quick replies on their phone or laptop. Not
everyone who uses it is Deaf, and not everyone signs: a nonspeaking hearing user types or taps, and
the heads-up describes them the way they choose. The person they're calling hears a
natural voice on an ordinary phone call and installs nothing. Their reply comes back as live
captions. The same engine also speaks into Google Meet, and into Zoom or Teams through a virtual
microphone.

An assistant handles the awkward parts of a live call, but never decides anything for the signer:
- It shows the recognized signs as a draft. Nothing is said until the signer taps Send.
- Anything involving money, bookings or commitments opens a confirm sheet first. If the price
  changes, the approval no longer counts.
- Code-level guards block any sentence that adds a number, day or name the signer didn't give, drops
  a "no", or sounds more certain than the signer was.
- Short "one sec..." fillers keep the caller from hanging up while the signer signs. If the caller
  talks over the voice, it stops, and the unsaid part is kept.
- Businesses and strangers always hear an honest heads-up that an app is voicing for a Deaf person.
- Calls in Spanish, French or Portuguese: the caller hears their language, and the signer reads
  English with the caller's own words underneath. Numbers, days and "no" are checked after
  translation.
- **Show it.** Some things are hard to describe without speaking: a leak, a warning light, a broken
  part. So you film it. Gemini watches the clip and lists what it shows, and each point is pinned
  to the moment and the spot in the video. The clip plays back with those boxes as on-screen
  tooltips, so you check every point against what the camera saw before anything is said. Then the
  landlord hears a clear description, follow-up answers ("what's the model number?") come from the
  video, and you can send them the annotated clip as a link.
- Captions in four sizes; customizable quick replies, always one tap away.
- Gesture Synth (Playground): a "Living Aurora". Play music with your hands, and each note becomes
  light, shape and motion: low notes violet and round, high notes gold and sharp. A vibration pulse
  comes with every note, and it is fully playable with the sound off.

### How we built it
- **Signer app:** React + TypeScript PWA. MediaPipe Holistic runs in a Web Worker on the device.
  **Raw video never leaves the device**; only hand and body landmarks are sent.
- **Sign recognition:** SignBart (ASL Citizen, 2,730 signs) exported to ONNX, running on the server
  CPU. A pause segmenter cuts one sign per pause; 59 everyday signs are active for calls.
- **Calls:** Twilio ConversationRelay (speech-to-text, ElevenLabs voice, barge-in) talking to a
  FastAPI server over WebSocket. Every outgoing line goes through one function with duplicate
  suppression and cancellation.
- **AI:** Gemini [model] writes sentences from glosses, suggests quick replies, translates, and
  recaps. Every job has a rules fallback, so a call never stalls on the model.
- **Meetings:** a Chrome extension for Meet; a small Python bridge playing into VB-CABLE for Zoom
  and Teams.
- **Hosting:** Docker + Caddy on **Vultr**.

### What we measured (only real results)
| Check | Result |
|---|---|
| Real phone calls completed (5+ turns, interruption, hang-up) | [n calls, carrier, `eval/live_calls.md`] |
| Typed line → caller hears it | [median ms] |
| Held-out teammate signing, our 59 signs | [top-1 %, phrases exact x/y] |
| Public ASL Citizen signers (may be in training data) | 96% top-1 within our signs, 85% across all 2,730 |
| Safety bench (scripted calls, rules brain) | 40/40 cases, 36/36 guard units |
| Safety bench with live Gemini | [x/40] |
| Real Google Meet, second participant heard the voice | [yes/no, date] |

### Limits (say these out loud)
- Not a replacement for interpreters, VRS or emergency services. It can't call 911.
- 59 signs in calls, recognized one sign per pause, not fluent continuous ASL. Typing covers the rest.
- No facial grammar yet: questions and negation come from signs and the signer's tone choice.
- Single-user demo server. Incoming calls only ring while the app is open.
- SignBart has no declared license: demo use only.
- While the desktop bridge is the meeting mic, the meeting hears only the generated voice.

### Sponsor tech actually used
Vultr (hosting) · Gemini (sentence writing, replies, translation, recap, meeting voice) ·
Twilio ConversationRelay · ElevenLabs voices through Twilio · MediaPipe.

---

## Demo script (90–120 s), with consent, only with what works that day

**Before:** server `/api/health` shows `twilio: true`, `gemini.model_ok: true`, `signs.ready: true`.
The judge has agreed to be called. The backup video is ready but **never presented as live**.

1. **The real phone (40 s).** "Can I call your phone?" Dial the judge. They answer and hear the
   heads-up. The signer signs YES SUNDAY COME. Point at the chips: those are the recognized signs.
   Tap Send. The judge hears "Yeah! I'll be there Sunday." The judge replies, and the captions appear.
2. **It won't guess (20 s).** The judge asks "six or twelve?" If the sign is unclear, two choices
   appear and nothing is said until the signer taps one. The judge names a price, and the confirm
   sheet appears.
3. **Show it (25 s), only if verified with the real key.** Still on the judge's call, film
   something for 10–15 s, such as a blinking router or a cracked screen. Show the clip with its
   boxes and tooltips. Tap Send: the judge hears the description. The judge asks a follow-up, and
   the answer comes from the video ("Say this"). Turn on sharing and text them the link.
4. **Another language (15 s), only if verified on a real call.** Switch a contact to Español. The
   judge (or a teammate) hears Spanish, and the signer reads English.
5. **Same engine in Meet (15 s), only if stable today.** The other participant hears the voice and
   sees the chat line.
5. **Gesture Synth (15 s).** Hand the judge the camera. Pinch, and music starts.

Close: "The other person installed nothing. The signer approved every word."


