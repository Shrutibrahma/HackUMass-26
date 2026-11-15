# Frontend / backend contract

The typed source of truth is [`app/src/contract.ts`](../app/src/contract.ts). This page maps the
build spec's event names (§10) to the ones the code actually uses, and says which spec events don't
exist yet. We kept the existing names: they are already in the server, app, tests and bench, and
renaming them would change nothing a user can see.

## Events (server → app, WebSocket `/ws/app`)

Every event has `type`, `sid` (call session), `eid` (increasing event id) and `ts` (server time,
seconds). On every (re)connect the server sends a `snapshot` of each live call, so reconnects
recover state rather than replaying events.

| Spec name | Actual event | Notes |
|---|---|---|
| `call.incoming` | `ringing` | Real Twilio webhook |
| `call.status` | `call_status` | Twilio's own `CallStatus` (queued, initiated, ringing, in-progress…), passed through |
| `call.connected` | `state` → `CONNECTED` | Only when ConversationRelay's socket is set up, never on API acceptance |
| `call.ended`, `call.failed` | `ended` (`reason`: hangup, busy, no-answer, failed, canceled, declined, missed) | |
| `caption.partial` | `caption` | Replaced as words arrive |
| `caption.final` | `line` with `who: "caller"`, `status: "final"` | `original` holds the caller's own words on other-language calls |
| `speech.queued` / `speech.speaking` | `line` with `who: "me"`, `status: "speaking"`; `state` → `SPEAKING` | One line at a time; duplicates suppressed |
| `speech.completed` | `line` `status: "spoken"` | Estimated from length: ConversationRelay doesn't report playback end |
| `speech.interrupted` | `line` `status: "interrupted"` + `draft` with the unsaid rest | |
| `speech.failed` | `error`, or `notice` `kind: "translate"` | |
| `recognition.partial` / `.final` | Not a server event: signs are recognized in the browser (`app/src/sign/`); the server gets `POST /signs` and answers with a `draft` | |
| `recognition.uncertain` | Local in the app (`useSigning().unsure`) | Two choices; nothing is said until the signer picks |
| `tracking.status`, `audio.route_status` | `/api/health` (`signs`, `bridges`, `meet_voice`), polled | |
| `sound.detected` | Not built | Sound alerts were cut |
| `synth.note_on` / `note_off` | Local only (`app/src/synth/`), never sent to the server | Gesture Synth never touches telephony |
| (extra) `turn` | Turn analysis + suggested replies | |
| (extra) `confirm`, `confirm_closed` | Money or booking: the confirm sheet | Approval bound to a hash of the words and current terms |
| (extra) `notice` | Reconnecting, emergency, translation problems | |

## Commands (app → server, HTTP POST)

Every command answers `{ ok, reason? }`. The app never shows an action as done before `ok: true`.
`send` takes a `request_id`: a retry with the same id gets the first answer back
(`duplicate: true`) instead of speaking the line again. The app retries once, with the same id,
only when the request got no answer at all.

| Spec action | Endpoint |
|---|---|
| Start call | `POST /api/calls` |
| Answer / reject / end | `POST /api/calls/{sid}/answer` · `/decline` · `/hangup` |
| Approve and send | `POST /api/calls/{sid}/send` (typed, chip, or draft + its hash) |
| Edit | Send the edited text (`source: typed`); it is checked again |
| Cancel outgoing | `POST /api/calls/{sid}/draft/clear`; Stop while speaking: `/stop` |
| Confirm money/booking | `POST /api/calls/{sid}/confirm` (`yes` + hash, `change`, `later`) |
| Signs for the current reply | `POST /api/calls/{sid}/signs` |
| Select voice, heads-up style | WebSocket `hello` (`voice_id`, `intro_style`) |
| Speak into a meeting | `POST /api/meet/say` (desktop bridge) or the Meet extension |
| Show it: analyze a clip | `POST /api/show` (multipart: `file`, `duration`, `context`, `title`) → `{status: processing}`; poll `GET /api/show/{id}` for `progress`, then `sections` (with transcript `lines`), `facts` (`t`, `t_end`, `box`, `refined`) |
| Show it: ask the video | `POST /api/show/{id}/ask` `{question}` → `{found, fact}`; in a call `POST /api/calls/{sid}/ask-video` `{question?}` (default: the caller's last line) → event `video_facts` with `answer` |
| Show it: use in a call | `POST /api/calls/{sid}/show/{show_id}` → event `video_facts` + a `draft` (`source: video`) |
| Show it: share / delete | `POST /api/show/{id}/share` `{share}` · `DELETE /api/show/{id}` · read-only `GET /api/shared/{token}` |

## Simulation vs real

Without Twilio keys the server uses `FakeTelephony` and logs "Twilio not configured: using
FakeTelephony (no real calls)". `/api/health` reports `"twilio": false`. Nothing in the app
presents a fake call as real: no phone rings, no carrier events arrive, and the Calling screen
stays at "Starting the call...".


