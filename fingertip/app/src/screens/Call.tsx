import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NetworkError, newRequestId, post } from '../api'
import { CallVideoCard, ShowFlow } from './Show'
import { DEFAULT_QUICK, INTRO, mmss, VOICES } from '../data'
import { Alert, ArrowUp, Grid, HangUp, Hand, Phone, Keyboard, Mic, Music, Video as VideoIcon } from '../icons'
import type { CallView, Draft, Line } from '../types'
import { pretty, useSigning } from '../sign/useSigning'
import { Avatar } from './Setup'

const REPEAT = 'Could you say that again?'

type CommunicationMode = 'ai_assist' | 'sign_language' | 'exact_words' | 'captions_only'

const COMMUNICATION_MODES: { id: CommunicationMode; label: string; hint: string }[] = [
  { id: 'ai_assist', label: 'AI Assist', hint: 'Turn short ideas into a natural reply' },
  { id: 'sign_language', label: 'Sign Language', hint: 'Recognize supported signs on this device' },
  { id: 'exact_words', label: 'Exact Words', hint: 'Speak exactly what you enter' },
  { id: 'captions_only', label: 'Captions Only', hint: 'Show text without generating voice' },
]

function SwipeToAnswer({ onAnswer }: { onAnswer: () => void }) {
  const [value, setValue] = useState(0)
  const finish = () => {
    if (value >= 82) onAnswer()
    else setValue(0)
  }
  return (
    <div className="answer-slider" style={{ ['--swipe' as any]: `${value}%` }}>
      <span aria-hidden>slide to answer</span>
      <input
        aria-label="Slide to answer"
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={finish}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') finish() }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- incoming */

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')
}

function initials(name: string) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export function Incoming({ call, onAnswer, onDecline }: { call: CallView; onAnswer: () => void; onDecline: () => void }) {
  useEffect(() => {
    try { navigator.vibrate?.([400, 200, 400, 200, 400]) } catch { /* not supported */ }
  }, [])
  const [answering, setAnswering] = useState(false)
  const clock = useClock()
  const c = call.contact
  const ini = initials(c.name)
  const answer = () => { if (!answering) { setAnswering(true); onAnswer() } }
  return (
    <div className={`screen dark incoming-call ${answering ? 'answering' : ''}`} role="dialog" aria-label={`Incoming call from ${c.name}`}>
      <div className="phone-status" aria-hidden><span>{clock}</span><span className="status-island" /><span className="status-icons">●●●●</span></div>
      <div className="incoming-copy">
        <div className="kicker">{answering ? 'Connecting…' : 'Incoming Call'}</div>
        <h1>{c.name || 'Unknown caller'}</h1>
        <div className="sub">{c.number && c.name !== c.number ? 'mobile' : 'Phone call'}</div>
        <div className="avatar-rings" aria-hidden={!ini}>
          <div className="incoming-avatar">
            {ini ? <span>{ini}</span> : <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="8" r="4.2" /><path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z" /></svg>}
          </div>
        </div>
        <div className="incoming-capability"><Hand size={18} /> Answer with signs, typing, or AI Assist</div>
      </div>
      <div className="incoming-actions">
        <SwipeToAnswer onAnswer={answer} />
        <div className="incoming-buttons">
          <div><button className="decline-call" onClick={onDecline} aria-label="Decline call"><HangUp size={30} /></button><span>Decline</span></div>
          <div><button className="accept-call" onClick={answer} aria-label="Accept call"><Phone size={30} /></button><span>Accept</span></div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- calling (outgoing, before pickup) */

export function Calling({ call, voiceId, firstWords, onCancel }: { call: CallView; voiceId: string; firstWords: string | null; onCancel: () => void }) {
  const voice = VOICES.find((v) => v.id === voiceId)?.name ?? 'your voice'
  const c = call.contact
  // Only what Twilio has actually reported. "Connected" comes later, when the voice link is up.
  const progress = call.carrier === 'ringing' ? 'Ringing...'
    : call.carrier === 'in-progress' || call.carrier === 'answered' ? 'They picked up. Connecting...'
    : call.carrier === 'queued' || call.carrier === 'initiated' ? 'Dialing...'
    : 'Starting the call...'
  return (
    <div className="screen dark">
      <div className="dark-center">
        <div className="kicker" role="status" aria-live="polite">{progress}</div>
        <Avatar c={c} size="xl" />
        <h1>{c.name}</h1>
        {firstWords && (
          <div className="darkcard" style={{ flexDirection: 'column', gap: 6 }}>
            <small>When they pick up, they'll hear</small>
            <q>{firstWords}</q>
            <small>Voice: {voice}</small>
          </div>
        )}
      </div>
      <div className="round-row">
        <button className="round" onClick={onCancel}><span className="b red"><HangUp size={30} /></span>Cancel</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- self view (camera never leaves the device) */

export function SelfView({ signing, label, caption, camera = true, className = 'selfview', onVideo }: {
  signing: boolean; label?: string; caption?: string; camera?: boolean; className?: string; onVideo?: (v: HTMLVideoElement | null) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!camera) return
    let stream: MediaStream | null = null
    let dead = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
      .then((s) => {
        if (dead) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        if (ref.current) { ref.current.srcObject = s; setOn(true); onVideo?.(ref.current) }
      })
      .catch(() => setOn(false))
    return () => { dead = true; onVideo?.(null); stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])
  return (
    <div className={`${className} ${signing ? 'signing' : ''}`} aria-label="Your camera">
      <video ref={ref} autoPlay playsInline muted style={{ display: on ? 'block' : 'none' }} />
      {!on && <div className="ph"><div className="hd" /><div className="bd" /></div>}
      {label !== '' && <div className="tag2">{label ?? (signing ? 'Signing' : 'You')}</div>}
      {caption && <div className="camera-caption" aria-live="polite">{caption}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- in call */

function Wave({ on }: { on: boolean }) {
  return <span className={`wave ${on ? 'on' : ''}`} aria-hidden><i /><i /><i /><i /><i /></span>
}

export function useTimer(start: number | null): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return start ? mmss((now - start) / 1000) : '00:00'
}

function CallerText({ l }: { l: Line }) {
  const orig = l.original && l.original !== l.text ? <span className="orig">{l.original}</span> : null
  if (!l.unclear) return <>{l.text}{orig}</>
  return <>{l.text} <span className="unclear-word">[unclear]</span>{orig}</>
}

function Amount({ text }: { text: string }) {
  const parts = text.split(/(\$\d+(?:\.\d{2})?)/)
  return <>{parts.map((p, i) => (/^\$\d/.test(p) ? <span key={i} className="amt">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>
}

type Props = {
  call: CallView
  online: boolean
  dispatch: (m: any) => void
  /** Signs recognized so far in the current phrase (from the on-device recognizer, M3). */
  signing?: string[] | null
  /** The recognizer wasn't sure about one sign: the signer picks. Nothing is said until then. */
  unsure?: { options: string[] } | null
  onPickUnsure?: (option: string) => void
  onSignAgain?: () => void
  /** Design gallery: no camera, no network. */
  preview?: boolean
  startTyping?: string
  /** The signer's own always-available replies (Settings). */
  quick?: string[]
  /** Caption size from Settings. */
  capScale?: number
}

export function InCall({ call, online, dispatch, signing: signingProp = null, unsure: unsureProp = null, onPickUnsure, onSignAgain, preview = false, startTyping,
  quick = DEFAULT_QUICK, capScale = 1 }: Props) {
  const [communicationMode, setCommunicationMode] = useState<CommunicationMode>(() => {
    try { return (localStorage.getItem('sign2speak-mode') as CommunicationMode) || 'ai_assist' } catch { return 'ai_assist' }
  })
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(true)
  const [cameraOn, setCameraOn] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const [preparedDraft, setPreparedDraft] = useState<Draft | null>(null)
  const [dialed, setDialed] = useState('')
  // Live sign recognition. Each new sign re-drafts on the server, so the reply is ready (and sealed with
  // its approval hash) before the signer taps Send. Send never waits on a model.
  const lastPosted = useRef('')
  const draftFrom = (s: string[]) => {
    const key = s.join(' ')
    if (preview || !s.length || key === lastPosted.current) return
    lastPosted.current = key
    post(`/api/calls/${call.sid}/signs`, { signs: s }).catch(() => {})
  }
  const live = useSigning({ sid: call.sid, enabled: !preview && call.state !== 'ENDED' && communicationMode === 'sign_language', onSigns: draftFrom, onPhrase: draftFrom })
  const signing = signingProp ?? live.signs
  const unsure = unsureProp ?? (live.unsure ? { options: live.unsure.map(pretty) } : null)
  const pickUnsure = (o: string) => (onPickUnsure ? onPickUnsure(o) : live.pick(o.toUpperCase().replace(/ /g, '-')))
  const signAgain = () => {
    if (onSignAgain) return onSignAgain()
    live.again()
    lastPosted.current = ''
    post(`/api/calls/${call.sid}/draft/clear`).catch(() => {})
  }
  const name = call.contact.name
  const timer = useTimer(call.startedAt)
  const [mode, setMode] = useState<'idle' | 'type' | 'edit'>(startTyping !== undefined ? 'type' : 'idle')
  const [text, setText] = useState(startTyping ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const prevState = useRef(call.state)
  const api = (p: string, body?: unknown) => (preview ? Promise.resolve({ ok: true }) : post(`/api/calls/${call.sid}/${p}`, body))
  const holdStart = useRef<number | null>(call.state === 'ON_HOLD' ? Date.now() : null)
  if (call.state === 'ON_HOLD' && holdStart.current === null) holdStart.current = Date.now()
  if (call.state !== 'ON_HOLD') holdStart.current = null
  const holdTimer = useTimer(holdStart.current)
  const [showing, setShowing] = useState(false)       // Show it: film something instead of describing it

  useEffect(() => {
    try { localStorage.setItem('sign2speak-mode', communicationMode) } catch { /* private mode */ }
    if (!preview) post(`/api/calls/${call.sid}/mode`, { mode: communicationMode }).catch(() => {})
    if (communicationMode !== 'sign_language') {
      live.again()
      lastPosted.current = ''
    }
  // live.again is intentionally excluded: the hook object changes as recognition updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communicationMode, call.sid, preview])

  // A person came back from hold: flash and buzz.
  useEffect(() => {
    if (prevState.current === 'ON_HOLD' && call.state !== 'ON_HOLD') {
      setFlash(true)
      try { navigator.vibrate?.([300, 120, 300, 120, 300]) } catch { /* ignore */ }
      setTimeout(() => setFlash(false), 2200)
    }
    prevState.current = call.state
  }, [call.state])

  // Server asked to edit after "Change it".
  useEffect(() => {
    if (call.editDraft && call.draft) {
      setText(call.draft.text)
      setMode('edit')
      dispatch({ type: 'local_edit_done', sid: call.sid })
    }
  }, [call.editDraft, call.draft, call.sid, dispatch])

  useLayoutEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [call.lines, call.caption, call.draft, mode])

  async function send(t: string, source: 'typed' | 'chip' | 'draft', draftId?: string, approvedDraft?: Draft) {
    if (!t.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      // One request id per tap: if the network drops mid-request we retry once, and the server
      // answers the retry from memory instead of speaking the line twice.
      const sealed = approvedDraft ?? call.draft
      const editedAiCopy = communicationMode === 'ai_assist' && !!preparedDraft && t !== preparedDraft.text
      const body = {
        text: t, source: editedAiCopy ? 'typed' : source, draft_id: draftId,
        hash: source === 'draft' && !editedAiCopy ? sealed?.hash : undefined,
        signs: source === 'draft' ? sealed?.signs ?? [] : [], request_id: newRequestId(),
        mode: editedAiCopy ? 'exact_words' : communicationMode,
        requested_mode: editedAiCopy ? communicationMode : undefined,
        approved: source === 'draft' || editedAiCopy,
      }
      const r: any = await api('send', body).catch((e) => (e instanceof NetworkError ? api('send', body) : Promise.reject(e)))
      if (!r.ok) setErr(r.reason ?? "Couldn't send that.")
      else { setMode('idle'); setText(''); setPreparedDraft(null) }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitTyped() {
    if (!text.trim() || busy) return
    if (communicationMode !== 'ai_assist' || mode === 'edit') {
      return send(text, preparedDraft && text === preparedDraft.text ? 'draft' : 'typed', preparedDraft?.id, preparedDraft ?? undefined)
    }
    setBusy(true)
    setErr('')
    try {
      const response: any = await api('compose', { text, mode: communicationMode })
      const composed: Draft | undefined = typeof response?.draft === 'object' ? response.draft : undefined
      const sentence = composed?.text || (typeof response?.draft === 'string' ? response.draft : '')
      if (!sentence) throw new Error("AI Assist couldn't prepare a reply. You can switch to Exact Words.")
      setPreparedDraft(composed ?? {
        id: `local-${newRequestId()}`, text: sentence, source: 'ai_assist', signs: [], level: 'auto',
        confirm_summary: '', problems: [], blocked: false, tone: '', hash: '',
      })
      setText(sentence)
      setMode('edit')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function act(p: string, body?: unknown) {
    try { await api(p, body) } catch (e: any) { setErr(e.message) }
  }

  const lastCallerId = useMemo(() => [...call.lines].reverse().find((l) => l.who === 'caller')?.id, [call.lines])
  const draft = call.draft
  const st = call.state
  const reconnecting = !online || call.notice?.kind === 'reconnecting'
  const myTurn = ['YOUR_TURN', 'DRAFT_READY', 'CONFIRMING'].includes(st) || (!!draft && st !== 'SPEAKING')
  const unclear = !!call.analysis?.unclear && myTurn && !draft
  const chips = useMemo(() => {
    const c = call.analysis?.chips ?? []
    return draft?.source === 'rest' ? ['Say the rest', ...c.slice(0, 2)] : c
  }, [call.analysis, draft])
  const selectedMode = COMMUNICATION_MODES.find((option) => option.id === communicationMode) ?? COMMUNICATION_MODES[0]
  const cameraActive = cameraOn || communicationMode === 'sign_language'
  const cameraCaption = signing?.length ? signing.map(pretty).join(' ') : call.draft?.source === 'signs' ? call.draft.text : ''

  function tapChip(c: string) {
    if (c === 'Say the rest' && draft) return send(draft.text, 'draft', draft.id)
    return send(c, 'chip')
  }

  // ------------------------------------------------ thread
  const items: React.ReactNode[] = []
  let prevWho = ''
  call.lines.forEach((l) => {
    if (l.who === 'caller') {
      if (prevWho !== 'caller') items.push(<div key={l.id + 'l'} className="who-label caller">{name}</div>)
      items.push(
        <div key={l.id} className="row-c">
          <Avatar c={call.contact} size="xs" />
          <div className={`bub caller ${l.id === lastCallerId ? 'latest' : ''}`}><CallerText l={l} /></div>
        </div>)
      if (l.unclear) items.push(<div key={l.id + 'u'} className="pill">Part of that was hard to hear. We won't guess.</div>)
    } else if (l.kind === 'filler' || l.kind === 'presence') {
      items.push(<div key={l.id} className="pill">{name} heard "{l.spoken || l.text}"</div>)
    } else {
      const label = l.status === 'speaking' ? `${name} is hearing this...`
        : l.status === 'interrupted' ? 'You · cut off'
        : l.kind === 'fact' ? 'Said for you · from your note'
        : l.kind === 'intro' ? 'Said for you · heads-up'
        : l.kind === 'repeat' ? 'Said again for you'
        : l.kind === 'greeting' ? 'Said for you' : 'You · spoken'
      items.push(<div key={l.id + 'l'} className="who-label me" style={l.status === 'speaking' ? { color: 'var(--blue)', fontWeight: 700 } : undefined}>{label}</div>)
      items.push(
        <div key={l.id} className={`bub me ${l.status === 'speaking' ? 'speaking' : ''}`}>
          {l.status === 'interrupted' && l.heard && !l.spoken ? <>{l.heard} <span className="rest">{l.text.slice(l.heard.length).trim()}</span></> : l.text}
          {l.spoken && <span className="orig">{name} heard: {l.spoken}</span>}
        </div>)
      if (l.status === 'interrupted') items.push(<div key={l.id + 'i'} className="pill">{name} started talking, so we stopped and listened</div>)
    }
    prevWho = l.who === 'caller' ? 'caller' : 'me'
  })
  if (call.caption) {
    items.push(<div key="live-l" className="who-label live">{name} is talking</div>)
    items.push(
      <div key="live" className="row-c">
        <Avatar c={call.contact} size="xs" />
        <div className="bub caller live">{call.caption.text}<span className="cursor" /></div>
      </div>)
  }
  if (reconnecting) items.push(<div key="rc" className="pill">Anything {name} says now will show up once we reconnect</div>)
  if (signing) {
    items.push(
      <div key="signing" className="draft-wrap">
        <span className="lab">Reading your signs...</span>
        <div className="draftbub signing-box" aria-live="polite">
          <div className="signtags" style={{ marginTop: 0 }}>{signing.map((s2, i) => <span key={i}>{s2}</span>)}<span>...</span></div>
        </div>
      </div>)
  }
  if (unsure) {
    items.push(
      <div key="unsure" className="unsure">
        <b>Not sure about one sign. Which did you mean?</b>
        <div className="opts">
          {unsure.options.map((o, i) => <button key={o} className={i === unsure.options.length - 1 ? 'on' : ''} onClick={() => pickUnsure(o)}>{o}</button>)}
        </div>
        <small>Nothing is said until you pick.</small>
      </div>)
  }
  if (call.video && call.video.facts.length > 0) {
    const lastCaller = [...call.lines].reverse().find((l) => l.who === 'caller')?.text ?? ''
    items.push(<CallVideoCard key="video" callSid={call.sid} video={call.video} lastCallerText={lastCaller}
                              preview={preview} onSay={(f) => send(f.say, 'chip')} />)
  }
  if (draft && mode !== 'edit' && !signing && !unsure) {
    const under = draft.blocked ? (draft.problems[0] ? `This ${draft.problems[0]} · tap to change` : 'Check this · tap to change')
      : draft.source === 'signs' ? 'From your signing · tap to change'
      : draft.source === 'video' ? 'From your video · check it against the clip · tap to change'
      : draft.source === 'rest' ? "The part they didn't hear · tap to change" : 'Tap to change'
    items.push(
      <div key="draft" className="draft-wrap">
        <span className={`lab ${draft.blocked ? 'amber' : ''}`}>{draft.blocked ? 'Check before sending' : 'Ready to send'}</span>
        <button className={`draftbub ${draft.blocked ? 'blocked' : ''}`} onClick={() => { setText(draft.text); setMode('edit') }}>
          {draft.text}
          {draft.signs.length > 0 && <div className="signtags">{draft.signs.map((s, i) => <span key={i}>{s}</span>)}</div>}
        </button>
        <span className="under" style={draft.blocked ? { color: 'var(--amber)' } : undefined}>{under}</span>
      </div>)
  }

  // ------------------------------------------------ dock
  let dock: React.ReactNode
  const chipRow = chips.length > 0 && (
    <div className="chips" role="group" aria-label="Quick replies">
      {(unclear ? [REPEAT, ...chips.filter((c) => c !== REPEAT)] : chips).map((c, i) => (
        <button key={c + i} className={i === 0 && (unclear || c === 'Say the rest') ? 'first' : ''} onClick={() => tapChip(c)} disabled={busy}>{c}</button>
      ))}
    </div>
  )
  // The signer's own replies: always one tap away (not AI-suggested). Shown when no AI chips crowd the dock.
  const mine = quick.filter((q) => !chips.includes(q))
  const mineRow = mine.length > 0 && (
    <div className="chips mine" role="group" aria-label="Your quick replies">
      {mine.map((q) => <button key={q} onClick={() => send(q, 'chip')} disabled={busy}>{q}</button>)}
    </div>
  )
  if (reconnecting) {
    dock = <div className="dockrow"><div className="status"><span className="dots"><i /><i /><i /></span>Getting back in...</div></div>
  } else if (unsure && mode === 'idle') {
    dock = <div className="dockrow">
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button>
      <button className="btn btn-ghost grow" onClick={signAgain}>Sign again</button></div>
  } else if (signing && mode === 'idle') {
    dock = <div className="dockrow">
      <div className="status"><span className="dots"><i /><i /><i /></span><span>Keep signing. Lower your hands when done.</span></div>
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button></div>
  } else if (mode === 'edit') {
    dock = <>
      <div className="lab" style={{ color: 'var(--blue)', fontWeight: 700, fontSize: 13, textAlign: 'right' }}>Editing your reply</div>
      <textarea className="editbox" value={text} autoFocus={!preview} onChange={(e) => setText(e.target.value)} aria-label="Edit your reply" />
      <div className="dockrow">
        <button className="btn btn-ghost" onClick={() => { setMode('idle'); setText(''); setPreparedDraft(null) }}>Cancel</button>
        <button className="btn btn-blue grow" disabled={busy || !text.trim()}
                onClick={submitTyped}>{communicationMode === 'captions_only' ? 'Show caption' : `Send to ${name}`}</button>
      </div>
    </>
  } else if (mode === 'type') {
    dock = <>
      {chipRow}
      {mineRow}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submitTyped() }}>
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus={!preview}
               onBlur={(e) => { if (!e.target.value.trim() && !busy) setTimeout(() => setMode((m) => (m === 'type' ? 'idle' : m)), 150) }}
               placeholder={communicationMode === 'ai_assist' ? 'Try “yes home 6”' : communicationMode === 'captions_only' ? 'Type a caption' : 'Type your exact words'}
               aria-label="Type a reply" enterKeyHint="send" />
        <button className="sendround" type="submit" disabled={busy || !text.trim()} aria-label={communicationMode === 'ai_assist' ? 'Preview AI reply' : 'Send'}><ArrowUp size={22} /></button>
      </form>
    </>
  } else if (st === 'ON_HOLD') {
    dock = <button className="btn btn-ghost" onClick={() => setMode('type')}>Leave a message instead</button>
  } else if (st === 'SPEAKING') {
    dock = <div className="dockrow"><div className="status"><Wave on />Speaking for you...</div>
      <button className="btn btn-ghost" style={{ fontWeight: 700, fontFamily: 'var(--head)' }} onClick={() => act('stop')}>Stop</button></div>
  } else if (draft && draft.source === 'rest') {
    dock = <>{chipRow}<div className="dockrow">
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button>
      <button className="btn btn-ghost grow" onClick={() => act('draft/clear')}>Drop the rest</button></div></>
  } else if (draft) {
    dock = <>{chipRow}<div className="dockrow">
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button>
      <button className="btn btn-blue grow" disabled={busy || draft.blocked} onClick={() => send(draft.text, 'draft', draft.id)}>
        Send to {name} <ArrowUp size={20} /></button></div></>
  } else if (unclear) {
    dock = <>{chipRow}<div className="dockrow">
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button>
      <button className="btn btn-blue grow" disabled={busy} onClick={() => send(REPEAT, 'chip')}>Ask them to repeat</button></div></>
  } else if (myTurn) {
    dock = <>{chipRow}{!chipRow && mineRow}<div className="dockrow">
      <div className="status"><Wave on={false} />Your turn: sign, tap, or type</div>
      <button className="sq" onClick={() => setShowing(true)} aria-label="Show it: film something instead of describing it"><VideoIcon /></button>
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button></div></>
  } else {
    const waiting = st === 'CONNECTED' || st === 'RINGING'
    dock = <>{!waiting && mineRow}<div className="dockrow">
      <div className="status"><Wave on={st === 'CALLER_TALKING'} />{waiting ? 'Connecting...' : `Listening to ${name}...`}</div>
      {!waiting && <button className="sq" onClick={() => setShowing(true)} aria-label="Show it: film something instead of describing it"><VideoIcon /></button>}
      <button className="sq" onClick={() => setMode('type')} aria-label="Type instead"><Keyboard /></button></div></>
  }

  if (showing && !preview) return <ShowFlow callSid={call.sid} onClose={() => setShowing(false)} />

  return (
    <div className={`screen wide active-call ${flash ? 'flash' : ''}`} style={{ ['--cap' as any]: capScale }}>
      <div className="calltop">
        <span className={`connection-dot ${online ? 'online' : ''}`} aria-hidden />
        <Avatar c={call.contact} size="sm" />
        <div className="who"><b>{name}</b><small>{timer} · {preview ? 'Demo preview' : online ? 'Connected' : 'Reconnecting'}</small></div>
        <button className="hang" onClick={() => act('hangup')} aria-label="End call"><HangUp size={24} /></button>
      </div>
      <div className="mode-strip" role="radiogroup" aria-label="Communication mode">
        {COMMUNICATION_MODES.map((option) => (
          <button key={option.id} role="radio" aria-checked={communicationMode === option.id}
            className={communicationMode === option.id ? 'on' : ''}
            onClick={() => { setCommunicationMode(option.id); setPreparedDraft(null); setText(''); setMode('idle') }}>
            {option.id === 'sign_language' ? <Hand size={15} /> : option.id === 'exact_words' ? <Keyboard size={15} /> : option.id === 'captions_only' ? <span aria-hidden>CC</span> : <span aria-hidden>✦</span>}
            {option.label}
          </button>
        ))}
      </div>
      <div className="mode-hint"><b>{selectedMode.label}</b><span>{selectedMode.hint}</span></div>
      <div className="call-controls" aria-label="Call controls">
        <button className={muted ? 'on' : ''} onClick={() => setMuted(!muted)} aria-pressed={muted}><Mic size={20} /><span>{muted ? 'Muted' : 'Mute'}</span></button>
        <button className={speaker ? 'on' : ''} onClick={() => setSpeaker(!speaker)} aria-pressed={speaker}><span className="speaker-glyph" aria-hidden>◖))</span><span>Speaker</span></button>
        <button className={keypadOpen ? 'on' : ''} onClick={() => setKeypadOpen(!keypadOpen)} aria-pressed={keypadOpen}><Grid size={20} /><span>Keypad</span></button>
        <button className={cameraOn ? 'on' : ''} onClick={() => setCameraOn(!cameraOn)} aria-pressed={cameraOn}><VideoIcon size={20} /><span>Camera</span></button>
      </div>
      {reconnecting && <div className="banner" role="status"><i /><b>Reconnecting...</b> The call is still going.</div>}
      {call.notice && call.notice.kind !== 'reconnecting' && (
        <div className="banner" role="alert"><Alert size={18} /><span style={{ flex: 1 }}>{call.notice.text}</span>
          <button className="link" style={{ minHeight: 32 }} onClick={() => dispatch({ type: 'local_clear_notice', sid: call.sid })}>OK</button></div>
      )}
      {st === 'ON_HOLD' ? (
        <div className="hold">
          <div className="ring"><Music size={40} /></div>
          <h2>You're on hold</h2>
          {lastCallerId && <p>They said: "{call.lines.find((l) => l.id === lastCallerId)?.text}"</p>}
          <div className="cardbox" style={{ padding: '14px 18px', fontSize: 16 }}>Your phone will flash and buzz the moment a person starts talking.</div>
          <p className="fine" style={{ fontSize: 15 }}>Waiting {holdTimer.replace(/^0/, '')}</p>
        </div>
      ) : (
        <div className={`threadwrap ${cameraActive ? 'camera-on' : ''}`}>
          {cameraActive && mode === 'idle' && st !== 'CONFIRMING' && !reconnecting && <SelfView camera={!preview} onVideo={communicationMode === 'sign_language' ? live.onVideo : undefined} signing={!!signing || !!unsure || (!!draft && draft.source === 'signs')}
                    label={unsure ? 'Got it' : communicationMode === 'sign_language' ? 'Sign recognition' : 'Camera preview'} caption={cameraCaption} />}
          {keypadOpen && <div className="keypad-popover" role="dialog" aria-label="Keypad">
            <div className="dialed" aria-live="polite">{dialed || 'Keypad'}</div>
            <div className="keypad">{'123456789*0#'.split('').map((key) => <button key={key} onClick={() => setDialed((current) => (current + key).slice(-24))}>{key}</button>)}</div>
            <button className="keypad-close" onClick={() => { setKeypadOpen(false); setDialed('') }}>Done</button>
          </div>}
          <div className="thread" ref={threadRef} aria-live="polite">
            <div className="spacer" />
            {items}
          </div>
        </div>
      )}
      <div className="dock">
        {err && <div className="err" role="alert">{err}</div>}
        {dock}
      </div>
      {call.confirm && draft && (
        <div className="scrim">
          <div className="sheet" role="dialog" aria-label="Check before it's said">
            <div className="grab" />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="warnico"><Alert size={20} /></span>
              <h2>Check before it's said</h2>
            </div>
            <p style={{ margin: 0, fontSize: 18 }}><Amount text={call.confirm.summary + '.'} /></p>
            <div className="quote"><small>{name} will hear</small><b>"{call.confirm.sentence}"</b></div>
            <button className="btn btn-amber" onClick={() => act('confirm', { decision: 'yes', hash: call.confirm?.hash })}>Yes, send it</button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost grow" onClick={() => act('confirm', { decision: 'change' })}>Change it</button>
              <button className="btn btn-ghost grow" onClick={() => act('confirm', { decision: 'later' })}>Not yet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- after the call */

export function AfterCall({ call, onDone, onCallBack, onSave }: {
  call: CallView; onDone: () => void; onCallBack: () => void; onSave: () => void
}) {
  const [all, setAll] = useState(false)
  const [saved, setSaved] = useState(false)
  const name = call.contact.name
  const lines = call.lines.filter((l) => l.kind !== 'filler' && l.kind !== 'presence' && l.kind !== 'intro')
  const shown = all ? lines : lines.slice(0, 4)
  const mins = call.startedAt ? Math.max(1, Math.round((Date.now() - call.startedAt) / 60000)) : 0
  const missed = ['missed', 'declined', 'no-answer', 'busy', 'failed', 'canceled'].includes(call.endedReason)
  return (
    <div className="screen">
      <div className="after-head">
        <Avatar c={call.contact} size="md" />
        <h1>{missed ? (call.endedReason === 'busy' ? `${name} is busy` : call.endedReason === 'no-answer' ? `${name} didn't pick up` : `Call with ${name} didn't connect`) : `Call with ${name} ended`}</h1>
        {!missed && <small>{mins} min</small>}
      </div>
      <div className="scroll pad16">
        {call.recap.length > 0 && !missed && (
          <div className="cardbox boxpad">
            <div className="label cap-blue">Worth remembering</div>
            {call.recap.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        )}
        {lines.length > 0 && (
          <div className="cardbox boxpad">
            <div className="label">Conversation</div>
            {shown.map((l) => (
              <p key={l.id} className="tline"><b className={l.who === 'me' ? 'me' : ''}>{l.who === 'me' ? 'You' : name}:</b> {l.text}</p>
            ))}
            {lines.length > 4 && <button className="link" style={{ alignSelf: 'flex-start', textDecoration: 'underline' }} onClick={() => setAll(!all)}>{all ? 'Show less' : 'See all'}</button>}
          </div>
        )}
        <p className="fine" style={{ textAlign: 'center' }}>
          {saved ? 'Saved on this phone only.' : 'Only on this phone. Nothing was recorded.'}{' '}
          {!saved && lines.length > 0 && <button className="link" style={{ minHeight: 0, fontSize: 14 }} onClick={() => { onSave(); setSaved(true) }}>Save transcript</button>}
        </p>
      </div>
      <div className="foot">
        <button className="btn btn-ghost grow" onClick={onDone}>{saved ? 'Done' : 'Delete'}</button>
        <button className="btn btn-blue grow" onClick={onCallBack}>Call {name} back</button>
      </div>
    </div>
  )
}

export { INTRO }


