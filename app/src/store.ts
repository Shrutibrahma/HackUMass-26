import type { CallView, Contact, Line } from './types'

export type State = {
  calls: Record<string, CallView>
  ringing: { sid: string; contact: Contact } | null
  activeSid: string | null
  endedSid: string | null
}

export const initial: State = { calls: {}, ringing: null, activeSid: null, endedSid: null }

function blank(sid: string, contact: Contact, direction: CallView['direction']): CallView {
  return {
    sid, contact, direction, state: 'RINGING', startedAt: null, lines: [], caption: null, draft: null,
    analysis: null, confirm: null, recap: [], endedReason: '', notice: null, editDraft: false,
  }
}

function upsertLine(lines: Line[], l: Line): Line[] {
  const i = lines.findIndex((x) => x.id === l.id)
  if (i === -1) return [...lines, l]
  const next = lines.slice()
  next[i] = l
  return next
}

export function reduce(s: State, m: any): State {
  if (m.type === 'local_dismiss_ended') return { ...s, endedSid: null }
  if (m.type === 'local_clear_notice') {
    const c = s.calls[m.sid]
    return c ? { ...s, calls: { ...s.calls, [m.sid]: { ...c, notice: null } } } : s
  }
  if (m.type === 'local_edit_done') {
    const c = s.calls[m.sid]
    return c ? { ...s, calls: { ...s.calls, [m.sid]: { ...c, editDraft: false } } } : s
  }

  const sid: string | undefined = m.sid
  if (!sid) return s

  if (m.type === 'ringing') {
    if (s.calls[sid]?.state === 'ENDED') return s
    return { ...s, ringing: { sid, contact: m.contact }, calls: { ...s.calls, [sid]: blank(sid, m.contact, 'incoming') } }
  }

  if (m.type === 'snapshot') {
    const c: CallView = {
      ...(s.calls[sid] ?? blank(sid, m.contact, m.direction)),
      state: m.state, direction: m.direction, contact: m.contact,
      startedAt: m.started_at ? m.started_at * 1000 : s.calls[sid]?.startedAt ?? null,
      lines: m.lines, caption: m.caption, draft: m.draft, analysis: m.analysis, recap: m.recap ?? [],
      endedReason: m.ended_reason ?? '',
    }
    const live = m.state !== 'ENDED'
    return {
      ...s,
      calls: { ...s.calls, [sid]: c },
      ringing: s.ringing?.sid === sid && m.state !== 'RINGING' ? null : s.ringing,
      activeSid: live && (m.state !== 'RINGING' || m.direction === 'outgoing') ? sid : s.activeSid,
    }
  }

  const c = s.calls[sid]
  if (!c) return s
  let n: CallView = c
  let extra: Partial<State> = {}

  switch (m.type) {
    case 'state':
      n = { ...c, state: m.state, startedAt: c.startedAt ?? (m.state === 'CONNECTED' ? Date.now() : null) }
      if (m.state !== 'CONFIRMING') n.confirm = null
      if (m.state !== 'RINGING' && s.ringing?.sid === sid) extra = { ringing: null, activeSid: sid }
      break
    case 'caption':
      n = { ...c, caption: m.line }
      break
    case 'line':
      n = { ...c, lines: upsertLine(c.lines, m.line), caption: m.line.who === 'caller' && c.caption?.id === m.line.id ? null : c.caption }
      break
    case 'turn':
      n = { ...c, analysis: m.analysis }
      break
    case 'draft':
      n = { ...c, draft: m.draft, editDraft: !!m.edit }
      break
    case 'confirm':
      n = { ...c, draft: m.draft, confirm: { summary: m.summary, sentence: m.sentence, hash: m.hash } }
      break
    case 'confirm_closed':
      n = { ...c, confirm: null }
      break
    case 'notice':
      n = { ...c, notice: { kind: m.kind, text: m.text } }
      break
    case 'call_status':
      n = { ...c, carrier: m.status }
      break
    case 'video_facts':
      n = { ...c, video: { show_id: m.show_id, facts: m.facts, summary: m.summary || c.video?.summary || '', answer: m.answer ?? null } }
      break
    case 'error':
      n = { ...c, notice: { kind: 'error', text: m.message } }
      break
    case 'ended':
      n = { ...c, state: 'ENDED', recap: m.recap ?? [], endedReason: m.reason, confirm: null, caption: null, lines: m.lines ?? c.lines }
      extra = {
        activeSid: s.activeSid === sid ? null : s.activeSid,
        ringing: s.ringing?.sid === sid ? null : s.ringing,
        endedSid: c.state !== 'RINGING' || c.direction === 'outgoing' ? sid : s.endedSid,
      }
      break
    default:
      return s
  }
  return { ...s, ...extra, calls: { ...s.calls, [sid]: n } }
}


