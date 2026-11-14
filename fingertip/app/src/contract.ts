/**
 * The frontend/backend contract: every event the server pushes on /ws/app and every command the
 * app sends. The frontend depends only on this file, never on model or telephony internals.
 * docs/CONTRACT.md maps these names to the build spec's (call.status, caption.partial, ...).
 *
 * Events: { type, sid, eid, ts, ...payload }. `eid` increases by one per event; `ts` is server time
 * in seconds. On (re)connect the server sends a `snapshot` per live call, so a missed event never
 * leaves the screen wrong for long.
 * Commands: HTTP POST, answered with { ok, reason? }. Never show a command as done before `ok`.
 */
import type { Analysis, Contact, Draft, Line } from './types'

/** Call controller states (server/app/controller.py). Connected only once Twilio's voice link is up. */
export type CallState =
  | 'RINGING' | 'CONNECTED' | 'LISTENING' | 'CALLER_TALKING' | 'YOUR_TURN' | 'DRAFT_READY'
  | 'SPEAKING' | 'CONFIRMING' | 'ON_HOLD' | 'ENDED'

/** Twilio's own call status, passed through unchanged from its status callback. */
export type CarrierStatus = 'queued' | 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled'

type Base = { sid: string; eid: number; ts: number }

export type ServerEvent = Base & (
  | { type: 'snapshot'; state: CallState; direction: 'incoming' | 'outgoing'; contact: Contact; started_at: number | null
      lines: Line[]; caption: Line | null; draft: Draft | null; analysis: Analysis | null; recap: string[]; ended_reason: string }
  | { type: 'ringing'; contact: Contact }                       // incoming call waiting for Answer
  | { type: 'call_status'; status: CarrierStatus }              // real carrier progress (outgoing)
  | { type: 'state'; state: CallState }
  | { type: 'caption'; line: Line }                            // partial caption: replaced as words arrive
  | { type: 'line'; line: Line }                               // final caption, or a spoken line (status speaking|spoken|interrupted)
  | { type: 'turn'; analysis: Analysis }                       // what kind of turn it is + suggested replies
  | { type: 'draft'; draft: Draft | null; edit?: boolean }     // the reply waiting for approval (null = none)
  | { type: 'confirm'; draft: Draft; hash: string; summary: string; sentence: string }  // money/booking: ask first
  | { type: 'confirm_closed' }
  | { type: 'notice'; kind: 'reconnecting' | 'emergency' | 'translate' | string; text: string }
  | { type: 'error'; message: string }
  | { type: 'ended'; reason: string; recap: string[]; lines?: Line[] }
)

/** Commands. Each resolves to an acknowledgement; `ok: false` always comes with a plain-language reason. */
export type Ack = { ok: boolean; reason?: string; stale?: boolean; confirm?: boolean; request_id?: string; duplicate?: boolean }

export type Commands = {
  'POST /api/calls': { body: { number: string; name?: string; contact_id?: string; knows_sign?: boolean; kind?: 'person' | 'business'
    style?: string; note?: string; language?: string }; reply: { sid: string; note_facts: unknown[]; note_confirm: string[]; first_words: string | null } }
  'POST /api/calls/{sid}/answer': { body: undefined; reply: Ack }
  'POST /api/calls/{sid}/decline': { body: undefined; reply: Ack }
  'POST /api/calls/{sid}/hangup': { body: undefined; reply: Ack }
  /** Approve and say. `request_id` makes a retry safe; `hash` must match the draft shown (source=draft). */
  'POST /api/calls/{sid}/send': { body: { text: string; source: 'typed' | 'chip' | 'draft'; draft_id?: string; hash?: string
    signs?: string[]; request_id?: string }; reply: Ack }
  'POST /api/calls/{sid}/signs': { body: { signs: string[]; tone?: string }; reply: Ack }
  'POST /api/calls/{sid}/confirm': { body: { decision: 'yes' | 'change' | 'later'; hash?: string }; reply: Ack }
  'POST /api/calls/{sid}/draft/clear': { body: undefined; reply: Ack }
  'POST /api/calls/{sid}/stop': { body: undefined; reply: Ack }
  'POST /api/meet/say': { body: { text: string }; reply: Ack & { bridges: number } }
}

/** Sent once per socket (and again when they change). */
export type Hello = { type: 'hello'; contacts: Contact[]; voice_id: string | null; intro_style: 'deaf' | 'hoh' | 'nonspeaking' | 'none' }


