# Architecture

```
 Hearing person's phone                Twilio                          Vultr (Docker + Caddy, HTTPS/WSS)              Signer's phone (PWA)
 ─────────────────────               ──────────                       ─────────────────────────────────              ─────────────────────
                                                                         FastAPI (one service)
   normal phone call  ───────────▶  Twilio number ── POST /twilio/voice ─▶ create session ── "ringing" ──WSS /ws/app──▶ Incoming call
                                     (signature checked)                                                               │ tap Answer
                                    calls.update(TwiML) ◀── POST /api/calls/{sid}/answer ◀─────────────────────────────┘
                                    <Connect><ConversationRelay>
                                      STT + turn detection ── prompt (partial/final) ─▶ Controller (state machine)
                                      ElevenLabs TTS      ◀── text token ──────────────   │  guards (fact, negation,
                                      interruptions       ── interrupt ───────────────▶   │  hedge, commitment, duplicate)
                                     WSS /ws/relay/{sid}                                  │  approval hash
                                     (handshake signature checked)                        │  fillers, hold, repeats
                                                                                          ▼
                                                                                   Gemini (structured JSON)
                                                                                   note parser · turn analyzer
                                                                                   reply writer · recap
                                                                                   (+ deterministic fallback)
                                                                                          │
                                                       captions, chips, drafts, confirm ──┴──WSS /ws/app──▶ thread, chips, draft, confirm sheet
                                                       send / signs / confirm / stop ◀────── REST ──────── signer taps, types, signs
                                                                                                           MediaPipe in browser (M3):
                                                                                                           landmarks only, never video
```

## Outgoing calls
App `POST /api/calls` → note parsed → `calls.create` with ConversationRelay TwiML → the callee
answers and says hello → the intro is spoken → note facts answer their questions
automatically → anything about money or bookings opens the confirm sheet.

## States
`RINGING → CONNECTED → LISTENING ⇄ CALLER_TALKING → YOUR_TURN → DRAFT_READY → SPEAKING →
LISTENING`, plus `CONFIRMING`, `ON_HOLD`, `ENDED`. Only one outgoing line plays at a time. A
new reply replaces a queued one.

## Send levels
- **Auto:** intro, note facts, repeats, presence checks, fillers.
- **Quick:** chips, typed text and signed drafts with no commitment. Sent on Send.
- **Confirm:** money, payment, bookings, final confirmations, or info not in the note. Sent
  only after "Yes, send it" with the matching hash.

## Recovery
- **App socket drops:** the call keeps going and the app shows "Reconnecting...". On
  reconnect the server sends a full snapshot.
- **Relay socket drops:** `applicationReconnect="true"` lets Twilio redial it. If the
  ConversationRelay session ends anyway, the `<Connect action>` handler reconnects it up to
  twice.

## Privacy
Raw video never leaves the device. No recordings. Transcripts stay in memory and are saved
only on the signer's own phone if they tap "Save transcript".


