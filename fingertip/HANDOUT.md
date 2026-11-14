# Fingertip: team handout

**Every conversation, at your fingertips.**

You're taking over Fingertip. This page has everything you need: what the product does, every
feature and how far along it is, how to run it, the rules, and who does what next.

Get the code: `git pull` on `main` (repo `github.com/Shrutibrahma/HackUMass-26`).

---

## 1. The idea

A Deaf, hard-of-hearing or nonspeaking person makes real phone calls and joins real meetings their
own way: signing, typing, tapping a reply, or **showing** a video. The other person just uses their
normal phone or meeting app and installs nothing.

The user stays in control. AI suggests and phrases, code checks it, and **nothing is said without
the user's OK.**

**Status words used below**
- **Works**: we ran it and watched it work (offline, on a fake phone line, or in the browser).
- **Built, not tested live**: done and tested offline, but needs a real service, device or person.
- **Needs keys**: waiting on accounts (see `WHAT_I_NEED.md`).

> Nothing has run on a real Twilio call, real Gemini, a real Meet, or with a new signer yet.

---

## 2. Every feature

### Phone calls (the core)

| Feature | What it does | Status |
|---|---|---|
| Real phone calls | Call or answer any normal number through Twilio. Twilio turns their speech into text and our text into a voice | Needs keys |
| Live captions | Their words appear while they talk | Built, not tested live |
| Type to talk | Type a reply; it's checked, then spoken | Works |
| Quick replies | Your own one-tap phrases ("Yes", "Please repeat that"), editable in Settings | Works |
| Smart reply chips | Reads the caller's question (yes/no, a time, a price) and offers 2–4 answers. Chips that make up facts are dropped | Works with built-in rules; Gemini version needs keys |
| **Safety guards** ★ | Every outgoing line is checked: no made-up numbers, names or days; your "no" stays "no"; "maybe" stays "maybe"; money or booking needs a confirm; no repeats within 10 s | Works: 40/40 scripted calls, 36/36 guard tests |
| **Approval tied to the exact words** ★ | If the caller changes the price after you approve, your approval is cancelled | Works (offline) |
| Confirm sheet | "This agrees to pay $23.40 and places the order. Yes / Change / Not yet" | Works |
| **Fillers while you compose** ★ | "Mm, one sec..." so the caller doesn't hang up while you sign or type (max 2 per turn) | Works (offline) |
| **Interrupted? Keep the rest** ★ | If the caller talks over the voice, it stops, and the unsaid part waits for you: "Say the rest" or "Drop it" | Built, not tested live |
| Call mechanics handled | "Are you there?" → "Yep, still here"; "say that again" → repeats; hold-music detection buzzes you when a person returns | Works (offline) |
| **Errand note** ★ | Before calling a shop: "garlic bread and wings, name Shruti, tell me the total first". Safe facts are said automatically; money waits for you | Works (offline) |
| Honest heads-up | Strangers hear an app is voicing for you. You choose how you're described (Deaf / hard of hearing / don't speak / neutral) | Works |
| Talk style and voice | Casual for family, polite for businesses; 4 voices | Works; voices not checked live |
| **Calls in Spanish, French, Portuguese** ★ | They hear their language; you read English with their own words underneath. Numbers, days and "no" are re-checked after translation | Built, not tested live |
| Real call progress | "Ringing" / "They picked up" only from Twilio's real events, never faked | Works |
| Send never doubles | Tapping Send twice on bad wifi still speaks once | Works |
| Reconnects | If the connection blips, the call screen recovers | Works (offline) |
| After the call | Recap of what was agreed. The transcript is saved only on your phone, only if you tap Save | Works |
| Phone basics | Contacts, recents, keypad, 4 caption sizes | Works |
| Abuse protection | Twilio signature checks, dial limits, max live calls, optional access key, "text 911" notice | Works (offline) |

### Signing

| Feature | What it does | Status |
|---|---|---|
| On-device hand tracking | The camera is read in the browser; **video never leaves the phone** | Built, not tested on the demo device |
| Sign recognition | 59 everyday ASL signs (from a 2,730-sign model) | 96% on public signers; **not yet tested on a new signer** |
| Signs → sentence | Recognized signs show as chips; a sentence is drafted for you to edit | Works |
| Unsure sign → you pick | If a sign is unclear, you get two choices. Nothing is said until you pick | Works |
| Signs lab | Record a teammate, measure accuracy, tune the threshold (`/#signs-lab`) | Built, not used on a person yet |

### Show it (Gemini watches a video) ★ the demo's "wow"

| Feature | What it does | Status |
|---|---|---|
| Film instead of describe | Film 10–60 s of a problem (a leaking pipe, an error screen). Gemini reads it in several passes with live progress | Works with a test engine; **real Gemini needs keys** |
| Chapters + full transcript | The clip is split into chapters. Each has a timed transcript: what happens, text on screen copied exactly, speech word for word, sounds. Drag the timeline to any moment | Works (test engine) |
| On-screen boxes and tooltips | Each fact is boxed on the video at the right moment, with numbered pins on the timeline | Works (test engine) |
| Precision pass | A close second look around each fact to tighten its time and box | Works (test engine) |
| **Ask the video** | "What's the model number?" is answered only from the clip, with the moment boxed. Otherwise: "the video doesn't clearly show that". In a call, one tap checks the caller's last question | Works (test engine) |
| Use it in a call | The summary becomes a draft reply; each fact has "Say this". Nothing is spoken automatically | Works (fake line) |
| Problem report | One printable page with real frames from the clip, boxes drawn, timestamps and the full timeline. For a landlord, insurer or repair shop | Works |
| Share, delete, expiry | Share a link to the same studio and report; delete any time; auto-deleted after 24 h | Works |

### Meetings

| Feature | What it does | Status |
|---|---|---|
| Google Meet extension | A Fingertip button in Meet; approved sentences go to the chat and into your mic | Tested on a stand-in page only |
| Desktop bridge | Speaks into Zoom, Teams, anything, through a virtual mic (VB-CABLE / BlackHole) | Built, audio not tested |
| Meetings tab | Shows real setup status; say something into the meeting | Works |
| Meeting voice | Gemini speech (or ElevenLabs) | Needs keys |

### In person

| Feature | What it does | Status |
|---|---|---|
| Flip the phone | Your sentence shown big for the other person; their speech captioned (Chrome) | Not tested with a real mic |

### Gesture Synth (Playground)

| Feature | What it does | Status |
|---|---|---|
| Play music with your hands | Pinch = note, move sideways = pitch (can't sound wrong), height = brightness, open palm = chord. Touch works too | Works by touch; camera play not tested |
| Living Aurora | Music you can **see**: a sky tinted by your notes, ribbons, pulses, chord blooms. Works with sound off and buzzes on each note, for Deaf players | Works |

### Platform

| Feature | Status |
|---|---|
| Docker + HTTPS deploy | Built and run locally; server (Vultr) not set up yet |
| `/api/health` page with live timings | Works |
| Screen gallery: every screen with sample data at `/#gallery` (27 screens) | Works |
| Install as a phone app (PWA) | Works |
| Tests: server 40, app 12, safety bench 40 calls | All pass (Nov 14) |

★ = what we think is new. **Not yet checked against existing products** (Rylo/Nagish, InnoCaption,
CapTel, Be My Eyes, Sign-Speak and others). Check before claiming it in the pitch.

---

## 3. Run it (about 10 minutes)

You need Python 3.11+ and Node 20+.

```bash
# server
cd server
python -m venv .venv
# Windows: .venv\Scripts\activate     Mac/Linux: . .venv/bin/activate
pip install -r requirements.txt

# app
cd ../app
npm ci
npm run build
```

Copy `.env.example` to `.env` in the repo root. Get the keys from Shruti privately: never in a group
chat, never committed to git.

```bash
cd server
uvicorn app.main:app --port 8000 --env-file ../.env
```

Open **http://localhost:8000**. Start with **http://localhost:8000/#gallery** to see every screen.

- **Working on the UI?** Also run `npm run dev` in `app/`. It reloads as you edit and talks to the
  server on port 8000.
- **No keys?** Everything still runs. It uses a fake phone line and built-in rules instead of Gemini,
  and says so on `/api/health`. Show it will say it needs Gemini.

## 4. Before every push

```bash
cd server && python -m pytest -q tests      # expect 40 passed, 1 skipped
python eval/bench.py                        # from the repo root: expect 40/40 and 36/36
cd app && npx vitest run && npm run build   # expect 12 passed, 1 skipped; build succeeds
```

The bench checks the call safety guards. If your change makes it fail, the change is wrong, not the
bench.

---

## 5. Where things are

| Area | Files |
|---|---|
| Call screen | `app/src/screens/Call.tsx` |
| Home, contacts, settings | `app/src/screens/Setup.tsx` |
| Show it studio | `app/src/screens/Show.tsx` |
| Meetings, in person, synth | `app/src/screens/Meet.tsx`, `InPerson.tsx`, `Playground.tsx`, `app/src/synth/` |
| Signing | `app/src/sign/` |
| App state and server link | `app/src/store.ts`, `api.ts`, `contract.ts`, `types.ts` |
| All styles | `app/src/index.css` |
| Server routes | `server/app/main.py` |
| Call logic and guards | `server/app/controller.py`, `guards.py`, `ai.py`, `translate.py` |
| Show it engine | `server/app/show.py` |
| Meet extension / desktop bridge | `extension/`, `bridge/` |

The list of messages between app and server is in `docs/CONTRACT.md`. If you rename one, change
`app/src/contract.ts`, the server and that doc together.

---

## 6. Rules that don't bend

These protect real people on real calls. Polish must never break them.

1. **Nothing is spoken without the user's OK.** Approving can be one tap, but it can't be skipped.
   Money or booking needs a second confirm. Changing this is a team decision (section 8).
2. **Never show fake as real.** No pretend "connected", no fake captions. If something isn't ready,
   the screen says so plainly.
3. **The camera stays on the phone.** Sign video never leaves the browser. Show it clips go to
   Gemini only when the user films one, and are deleted after 24 h.
4. **No keys in git or chat.** `.env` is ignored by git; keep it that way.
5. **Don't rewrite git history.** No force pushes; add new commits.

---

## 7. Who does what

One person per workstream, so nobody edits the same files at once. Write your name in.

### A. Look and feel: ________
- Go through every screen in `/#gallery`. Make spacing, text sizes and colours one consistent
  system (all in `app/src/index.css`).
- Show it is the demo's "wow": animate the boxes and tooltips in, preview a moment when hovering a
  pin, and polish the timeline.
- Check every screen at phone width, in dark mode, and with the biggest caption size.

### B. Interaction and flow: ________
- The call loop is the product: they talk → captions → you reply → approve → spoken. Count taps and
  seconds per step and cut them (Enter sends the top quick reply, keyboard shortcuts, a clear "your
  turn" moment, vibration on phones).
- Every button shows what happened: sending → sent, or why not, in plain words.
- Show it: show the clip right away and let facts appear as each pass finishes, instead of
  one long wait.

### C. Backend smoothness: ________
- Cut the connection mid-call and check the screen recovers with no missing or doubled lines.
- Check that 2–3 Show it videos processing at once never slow a live call. Calls always win.
- Add timeouts to the Gemini steps so a slow answer never freezes a call. The built-in rules should
  take over.

### D. Speed: ________
Measured on Nov 14 on a laptop:

| What | Now | Easy win |
|---|---|---|
| App download | **588 kB in one file** (171 kB compressed) | Split it: load the call screen first; load Show it, Synth, Gallery and Signs lab only when opened (`React.lazy`) |
| Camera / sign model | ~47 MB of model files | Load only when the camera turns on; start loading quietly on Home |
| Fonts | Two formats + extra character sets | Keep woff2 only, basic Latin only |
| Browser caching | App files aren't cached | Send `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` |
| Server response | ~2 ms | Already fine |
| AI replies and Show it | **Unknown** | Measure as soon as the Gemini key is in. Probably the real bottleneck |

Measure before and after each change and write the numbers in your commit message.

---

## 8. Decisions for the whole team

- **Can some lines skip the approval tap?** For example, "One moment please" in a single tap.
  Decide together, write it down in `DECISIONS.md`, and keep the safety guards on those lines too.
- **HackUMass rules on work done before the event.** Check the rules and disclose as needed.

## 9. Still to test in the real world

See `WHAT_I_NEED.md`. In short: a real Twilio call (`scripts/live_check.py`), real Gemini for calls
and Show it (3–4 real problem videos), a real Google Meet with a partner, the desktop bridge's
audio, and a signer the model has never seen.

## More detail

- `docs/FEATURES.md`: every feature with its code location and evidence
- `docs/STATUS.md`: what's verified
- `MISSION.md`: goals and rules
- `DECISIONS.md`: why things are the way they are
- `HANDOFF.md`: first hour on the real server and first real call


