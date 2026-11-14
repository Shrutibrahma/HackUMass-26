import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NetworkError, newRequestId, post } from '../api'
import { CallVideoCard, ShowFlow } from './Show'
import { DEFAULT_QUICK, INTRO, mmss, VOICES } from '../data'
import {
  SFArrowUp, SFCaptions, SFExclamation, SFHand, SFKeyboard, SFKeypad, SFMic, SFMicSlash, SFPhone, SFPhoneDown,
  SFSparkles, SFSpeaker, SFStop, SFVideo, SFWaveform, SFWifiSlash, SFXmark,
} from '../sf'
import type { CallView, Draft, Line } from '../types'
import { pretty, useSigning } from '../sign/useSigning'
import { IOSAvatar, KeyGrid, StatusBar } from './Phone'

const REPEAT = 'Could you say that again?'

type CommunicationMode = 'ai_assist' | 'sign_language' | 'exact_words' | 'captions_only'

const COMMUNICATION_MODES: { id: CommunicationMode; label: string; short: string; hint: string }[] = [
  { id: 'ai_assist', label: 'AI Assist', short: 'AI Assist', hint: 'A few words become a natural sentence. You approve it first.' },
  { id: 'sign_language', label: 'Sign Language', short: 'Sign', hint: 'Your camera reads supported signs on this device.' },
  { id: 'exact_words', label: 'Exact Words', short: 'Exact', hint: 'Spoken exactly as you type it.' },
  { id: 'captions_only', label: 'Captions Only', short: 'Captions', hint: 'Shown as text. Nothing is spoken.' },
]

/* ---------------------------------------------------------------- incoming (iOS 17 style) */

function SwipeToAnswer({ onAnswer }: { onAnswer: () => void }) {
  const [value, setValue] = useState(0)
  const finish = () => { if (value >= 82) onAnswer(); else setValue(0) }
  return (
    <div className="answer-slider" style={{ ['--swipe' as string]: `${value}%` }}>
      <span aria-hidden>slide to answer</span>
      <i className="knob" aria-hidden><SFPhone size={26} /></i>
      <input aria-label="Slide to answer" type="range" min="0" max="100" value={value}
        onChange={(e) => setValue(Number(e.target.value))} onPointerUp={finish}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') finish() }} />
    </div>
  )
}

export function Incoming({ call, onAnswer, onDecline }: { call: CallView; onAnswer: () => void; onDecline: () => void }) {
  useEffect(() => { try { navigator.vibrate?.([400, 200, 400, 200, 400]) } catch { /* not supported */ } }, [])
  const [answering, setAnswering] = useState(false)
  const c = call.contact
  const answer = () => { if (!answering) { setAnswering(true); onAnswer() } }
  return (
    <div className={`screen ios call-full incoming ${answering ? 'answering' : ''}`} role="dialog" aria-label={`Incoming call from ${c.name}`}>
      <div className="call-backdrop" aria-hidden><IOSAvatar name={c.name} size="xl" business={c.kind === 'business'} /></div>
      <StatusBar />
      <div className="call-top">
        <div className="call-kicker">{answering ? 'Connecting…' : 'mobile'}</div>
        <h1 className="call-name">{c.name || 'Unknown caller'}</h1>
        <div className="call-cap"><SFCaptions size={15} /> Live captions on · reply by signing or typing</div>
      </div>
      <div className="call-avatar-wrap"><div className="pulse" aria-hidden /><IOSAvatar name={c.name} size="xl" business={c.kind === 'business'} /></div>
      <div className="incoming-bottom">
        <div className="incoming-buttons">
          <div className="ios-callbtn"><button className="red" onClick={onDecline} aria-label="Decline call"><SFPhoneDown size={34} /></button>Decline</div>
          <div className="ios-callbtn"><button className="green" onClick={answer} aria-label="Accept call"><SFPhone size={32} /></button>Accept</div>
        </div>
        <SwipeToAnswer onAnswer={answer} />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- calling (outgoing, before pickup) */

export function Calling({ call, voiceId, firstWords, onCancel }: { call: CallView; voiceId: string; firstWords: string | null; onCancel: () => void }) {
  const voice = VOICES.find((v) => v.id === voiceId)?.name ?? 'your voice'
  const c = call.contact
  // Only what Twilio has actually reported. "Connected" comes later, when the voice link is up.
  const progress = call.carrier === 'ringing' ? 'ringing…'
    : call.carrier === 'in-progress' || call.carrier === 'answered' ? 'connecting…'
    : 'calling…'
  return (
    <div className="screen ios call-full calling">
      <div className="call-backdrop" aria-hidden><IOSAvatar name={c.name} size="xl" business={c.kind === 'business'} /></div>
      <StatusBar />
      <div className="call-top">
        <div className="call-kicker" role="status" aria-live="polite">{progress}</div>
        <h1 className="call-name">{c.name}</h1>
      </div>
      {firstWords && (
        <div className="first-words ios-material">
          <span className="fw-k"><SFWaveform size={14} /> When they answer, {voice} says</span>
          <span className="fw-t">“{firstWords}”</span>
        </div>
      )}
      <div className="call-grid">
        {[['mute', <SFMic key="m" size={30} />], ['keypad', <SFKeypad key="k" size={28} />], ['speaker', <SFSpeaker key="s" size={30} />],
          ['captions', <SFCaptions key="c" size={30} />], ['sign', <SFHand key="h" size={30} />], ['AI', <SFSparkles key="a" size={30} />]].map(([l, icon]) => (
          <div key={l as string} className="ios-callbtn"><button disabled aria-label={`${l} (after they answer)`}>{icon}</button>{l}</div>
        ))}
      </div>
      <div className="call-end-row"><div className="ios-callbtn"><button className="red" onClick={onCancel} aria-label="Cancel call"><SFPhoneDown size={34} /></button>End</div></div>
    </div>
  )
}

/* ---------------------------------------------------------------- self view (camera never leaves the device) */

export function SelfView({ signing, label, caption, camera = true, className = 'selfview', onVideo }: {
  signing: boolean; label?: string; caption?: string; camera?: boolean; className?: string; onVideo?: (v: HTMLVideoElement | null) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  const [denied, setDenied] = useState(false)
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
      .catch(() => { setOn(false); setDenied(true) })
    return () => { dead = true; onVideo?.(null); stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])
  return (
    <div className={`${className} ${signing ? 'signing' : ''}`} aria-label="Your camera">
      <video ref={ref} autoPlay playsInline muted style={{ display: on ? 'block' : 'none' }} />
      {!on && <div className="ph">{denied ? <span className="ph-msg">Camera blocked. Allow it in the address bar, then try again.</span> : <><div className="hd" /><div className="bd" /></>}</div>}
      {label !== '' && <div className="tag2">{label ?? (signing ? 'Signing' : 'You')}</div>}
      {caption && <div className="camera-caption" aria-live="polite">{caption}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- in call */

function Wave({ on }: { on: boolean }) {
  return <span className={`ic-wave ${on ? 'on' : ''}`} aria-hidden><i /><i /><i /><i /><i /></span>
}

export function useTimer(start: number | null): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return start ? mmss((now - start) / 1000) : '00:00'
}

function CallerText({ l }: { l: Line }) {
  const orig = l.original && l.original !== l.text ? <span className="orig">{l.original}</span> : null
  if (!l.unclear) return <>{l.text}{orig}</>
  return <>{l.text} <span className="unclear-word">unclear</span>{orig}</>
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
  /** Rehearsal call (simulated): show it plainly. */
  demo?: boolean
}

export function InCall({ call, online, dispatch, signing: signingProp = null, unsure: unsureProp = null, onPickUnsure, onSignAgain, preview = false, startTyping,
  quick = DEFAULT_QUICK, capScale = 1, demo = false }: Props) {
  const [communicationMode, setCommunicationMode] = useState<CommunicationMode>(() => {
    try { return (localStorage.getItem('sign2speak-mode') as CommunicationMode) || 'ai_assist' } catch { return 'ai_assist' }
  })
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(true)
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
  }, [call.lines, call.caption, call.draft, mode, signing, unsure])

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

  const switchMode = (m: CommunicationMode) => { setCommunicationMode(m); setPreparedDraft(null); setText(''); setMode('idle'); setErr('') }
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
  const cameraActive = communicationMode === 'sign_language'
  const cameraCaption = signing?.length ? signing.map(pretty).join(' ') : call.draft?.source === 'signs' ? call.draft.text : ''
  const modeInfo = COMMUNICATION_MODES.find((m) => m.id === communicationMode) ?? COMMUNICATION_MODES[0]
  const status = preview ? (demo ? 'Rehearsal' : 'Preview') : reconnecting ? 'Reconnecting…' : st === 'CONNECTED' || st === 'RINGING' ? 'Connecting…' : timer

  function tapChip(c: string) {
    if (c === 'Say the rest' && draft) return send(draft.text, 'draft', draft.id)
    return send(c, 'chip')
  }

  // ------------------------------------------------ thread (Messages-style)
  const items: React.ReactNode[] = []
  let prevWho = ''
  call.lines.forEach((l) => {
    if (l.who === 'caller') {
      if (prevWho !== 'caller') items.push(<div key={l.id + 'l'} className="ic-sender">{name}</div>)
      items.push(<div key={l.id} className={`ic-msg them ${l.id === lastCallerId ? 'latest' : ''}`}><CallerText l={l} /></div>)
      if (l.unclear) items.push(<div key={l.id + 'u'} className="ic-note">Part of that was hard to hear. Nothing was guessed.</div>)
    } else if (l.kind === 'filler' || l.kind === 'presence') {
      items.push(<div key={l.id} className="ic-note">{name} heard “{l.spoken || l.text}”</div>)
    } else {
      const label = l.status === 'speaking' ? 'Speaking…'
        : l.status === 'interrupted' ? 'Cut off'
        : l.kind === 'caption' ? 'Shown as caption · not spoken'
        : l.kind === 'fact' ? 'Said for you · from your note'
        : l.kind === 'intro' ? 'Said for you · heads-up'
        : l.kind === 'repeat' ? 'Said again'
        : l.kind === 'greeting' ? 'Said for you' : `Heard by ${name}`
      items.push(
        <div key={l.id} className={`ic-msg me ${l.status === 'speaking' ? 'speaking' : ''} ${l.kind === 'caption' ? 'caption' : ''} ${l.status === 'interrupted' ? 'cut' : ''}`}>
          {l.status === 'interrupted' && l.heard && !l.spoken ? <>{l.heard} <span className="rest">{l.text.slice(l.heard.length).trim()}</span></> : l.text}
          {l.spoken && <span className="orig">{name} heard: {l.spoken}</span>}
        </div>)
      items.push(<div key={l.id + 's'} className={`ic-receipt ${l.status === 'speaking' ? 'live' : ''}`}>{label}</div>)
      if (l.status === 'interrupted') items.push(<div key={l.id + 'i'} className="ic-note">{name} started talking, so the voice stopped to listen</div>)
    }
    prevWho = l.who === 'caller' ? 'caller' : 'me'
  })
  if (call.caption) {
    if (prevWho !== 'caller') items.push(<div key="live-l" className="ic-sender">{name}</div>)
    items.push(<div key="live" className="ic-msg them live">{call.caption.text}<span className="ic-typing"><i /><i /><i /></span></div>)
  }
  if (reconnecting) items.push(<div key="rc" className="ic-note">Anything {name} says now appears when we reconnect</div>)
  if (signing) {
    items.push(
      <div key="signing" className="ic-card signing" aria-live="polite">
        <div className="ic-card-k"><SFHand size={14} /> Reading your signs</div>
        <div className="ic-tags">{signing.map((s2, i) => <span key={i}>{pretty(s2)}</span>)}<span className="dots"><i /><i /><i /></span></div>
      </div>)
  }
  if (unsure) {
    items.push(
      <div key="unsure" className="ic-card">
        <div className="ic-card-k">Which sign did you mean?</div>
        <div className="ic-choice">{unsure.options.map((o) => <button key={o} onClick={() => pickUnsure(o)}>{o}</button>)}</div>
        <div className="ic-card-f">Nothing is said until you pick.</div>
      </div>)
  }
  if (call.video && call.video.facts.length > 0) {
    const lastCaller = [...call.lines].reverse().find((l) => l.who === 'caller')?.text ?? ''
    items.push(<CallVideoCard key="video" callSid={call.sid} video={call.video} lastCallerText={lastCaller}
                              preview={preview} onSay={(f) => send(f.say, 'chip')} />)
  }
  if (draft && mode !== 'edit' && !signing && !unsure) {
    const k = draft.blocked ? 'Check before sending' : draft.source === 'signs' ? 'From your signs' : draft.source === 'video' ? 'From your video'
      : draft.source === 'rest' ? 'The part they didn’t hear' : 'Ready to send'
    items.push(
      <button key="draft" className={`ic-draft ${draft.blocked ? 'blocked' : ''}`} onClick={() => { setText(draft.text); setMode('edit') }} aria-label="Edit this reply">
        <span className="ic-card-k">{draft.blocked ? <SFExclamation size={14} /> : <SFSparkles size={14} />} {k}</span>
        <span className="t">{draft.text}</span>
        {draft.signs.length > 0 && <span className="ic-tags">{draft.signs.map((s, i) => <span key={i}>{pretty(s)}</span>)}</span>}
        <span className="ic-card-f">{draft.blocked && draft.problems[0] ? `This ${draft.problems[0]}. ` : ''}Tap to edit</span>
      </button>)
  }

  // ------------------------------------------------ dock
  const chipList = unclear ? [REPEAT, ...chips.filter((c) => c !== REPEAT)] : chips
  const mine = quick.filter((q) => !chips.includes(q))
  const chipRow = (list: string[], label: string) => list.length > 0 && (
    <div className="ic-chips" role="group" aria-label={label}>
      {list.map((c, i) => <button key={c + i} className={i === 0 && (unclear || c === 'Say the rest') ? 'first' : ''} onClick={() => tapChip(c)} disabled={busy}>{c}</button>)}
    </div>
  )
  const composerPlaceholder = communicationMode === 'ai_assist' ? 'A few words, e.g. “yes home 6”'
    : communicationMode === 'captions_only' ? 'Caption (not spoken)' : communicationMode === 'sign_language' ? 'Or type instead' : 'Exactly what to say'
  const composer = (
    <form className="ic-composer" onSubmit={(e) => { e.preventDefault(); submitTyped() }}>
      <input value={text} onChange={(e) => setText(e.target.value)} autoFocus={!preview && mode === 'type'}
             onFocus={() => mode === 'idle' && setMode('type')}
             placeholder={composerPlaceholder} aria-label="Type a reply" enterKeyHint="send" />
      <button className="ic-send" type="submit" disabled={busy || !text.trim()}
              aria-label={communicationMode === 'ai_assist' ? 'Write it with AI' : communicationMode === 'captions_only' ? 'Show caption' : 'Send'}>
        {busy ? <span className="spin" /> : communicationMode === 'ai_assist' ? <SFSparkles size={18} /> : <SFArrowUp size={18} />}
      </button>
    </form>
  )
  let dock: React.ReactNode
  if (reconnecting) {
    dock = <div className="ic-status"><SFWifiSlash size={18} /><span>Getting back in… The call is still going.</span></div>
  } else if (unsure && mode === 'idle') {
    dock = <div className="ic-row"><button className="ios-btn gray grow" onClick={signAgain}>Sign again</button>
      <button className="ic-round" onClick={() => setMode('type')} aria-label="Type instead"><SFKeyboard size={20} /></button></div>
  } else if (signing && mode === 'idle') {
    dock = <div className="ic-status"><SFHand size={18} /><span>Keep signing. Lower your hands when you're done.</span>
      <button className="ic-round" onClick={() => setMode('type')} aria-label="Type instead"><SFKeyboard size={20} /></button></div>
  } else if (mode === 'edit') {
    dock = <>
      <div className="ic-edit-k">{preparedDraft ? <><SFSparkles size={13} /> AI suggestion: edit or send</> : 'Edit your reply'}</div>
      <textarea className="ic-editbox" value={text} autoFocus={!preview} onChange={(e) => setText(e.target.value)} aria-label="Edit your reply" rows={2} />
      <div className="ic-row">
        <button className="ios-btn gray" onClick={() => { setMode('idle'); setText(''); setPreparedDraft(null) }}>Cancel</button>
        <button className="ios-btn filled grow" disabled={busy || !text.trim()} onClick={submitTyped}>
          {communicationMode === 'captions_only' ? 'Show caption' : `Say it to ${name}`}</button>
      </div>
    </>
  } else if (st === 'ON_HOLD') {
    dock = <>{composer}</>
  } else if (st === 'SPEAKING') {
    dock = <div className="ic-status"><Wave on /><span>Speaking for you…</span>
      <button className="ic-pill-btn" onClick={() => act('stop')}><SFStop size={13} /> Stop</button></div>
  } else if (draft && draft.source === 'rest') {
    dock = <>{chipRow(chipList, 'Quick replies')}<div className="ic-row">
      <button className="ios-btn gray grow" onClick={() => act('draft/clear')}>Drop the rest</button>
      <button className="ic-round" onClick={() => setMode('type')} aria-label="Type instead"><SFKeyboard size={20} /></button></div></>
  } else if (draft) {
    dock = <>{chipRow(chipList, 'Quick replies')}<div className="ic-row">
      <button className="ic-round" onClick={() => setMode('type')} aria-label="Type instead"><SFKeyboard size={20} /></button>
      <button className="ios-btn filled grow" disabled={busy || draft.blocked} onClick={() => send(draft.text, 'draft', draft.id)}>
        Say it to {name} <SFArrowUp size={17} /></button></div></>
  } else {
    const waiting = st === 'CONNECTED' || st === 'RINGING'
    dock = <>
      {myTurn ? chipRow(chipList.length ? chipList : mine, chipList.length ? 'Suggested replies' : 'Your quick replies') : !waiting && chipRow(mine, 'Your quick replies')}
      <div className="ic-listen">
        <Wave on={st === 'CALLER_TALKING'} />
        <span>{waiting ? 'Connecting the call…' : myTurn ? (unclear ? 'Didn’t catch that. Ask them to repeat?' : 'Your turn: sign, tap or type') : `Listening to ${name}…`}</span>
        {!waiting && !preview && <button className="ic-pill-btn" onClick={() => setShowing(true)} aria-label="Show it: film something instead of describing it"><SFVideo size={14} /> Show it</button>}
      </div>
      {composer}
    </>
  }

  if (showing && !preview) return <ShowFlow callSid={call.sid} onClose={() => setShowing(false)} />

  return (
    <div className={`screen ios incall ${flash ? 'flash' : ''}`} style={{ ['--cap' as string]: capScale }}>
      <StatusBar />
      <header className="ic-head">
        <IOSAvatar name={name} size="sm" business={call.contact.kind === 'business'} />
        <div className="ic-who"><b>{name}</b><span className={reconnecting ? 'warn' : ''}>{status}{demo ? ' · simulated' : ''}</span></div>
        <button className="ic-end" onClick={() => act('hangup')} aria-label="End call"><SFPhoneDown size={24} /></button>
      </header>
      <div className="ic-modes">
        <div className="ios-seg" role="radiogroup" aria-label="How you reply">
          {COMMUNICATION_MODES.map((o) => (
            <button key={o.id} role="radio" aria-checked={communicationMode === o.id} aria-label={o.label}
              className={communicationMode === o.id ? 'on' : ''} onClick={() => switchMode(o.id)}>{o.short}</button>
          ))}
        </div>
        <div className="ic-mode-hint">{modeInfo.hint}</div>
      </div>
      <div className="ic-controls" aria-label="Call controls">
        <button className={muted ? 'on' : ''} onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <SFMicSlash size={21} /> : <SFMic size={21} />}<span>{muted ? 'muted' : 'mute'}</span></button>
        <button className={speaker ? 'on' : ''} onClick={() => setSpeaker(!speaker)} aria-pressed={speaker} aria-label="Speaker"><SFSpeaker size={21} /><span>speaker</span></button>
        <button className={keypadOpen ? 'on' : ''} onClick={() => setKeypadOpen(!keypadOpen)} aria-pressed={keypadOpen} aria-label="Keypad"><SFKeypad size={19} /><span>keypad</span></button>
      </div>
      {call.notice && call.notice.kind !== 'reconnecting' && (
        <div className="ios-banner warn" role="alert"><SFExclamation size={18} /><span style={{ flex: 1 }}>{call.notice.text}</span>
          <button className="ios-link" style={{ fontSize: 15, fontWeight: 600 }} onClick={() => dispatch({ type: 'local_clear_notice', sid: call.sid })}>OK</button></div>
      )}
      {st === 'ON_HOLD' ? (
        <div className="ic-hold">
          <div className="ic-hold-ring"><SFWaveform size={38} /></div>
          <h2>You're on hold</h2>
          {lastCallerId && <p>They said: “{call.lines.find((l) => l.id === lastCallerId)?.text}”</p>}
          <p className="ic-hold-note">Your phone will flash and buzz the moment a person starts talking.</p>
          <span className="ic-hold-t">Waiting {holdTimer.replace(/^0/, '')}</span>
        </div>
      ) : (
        <div className={`ic-threadwrap ${cameraActive ? 'camera-on' : ''}`}>
          {cameraActive && mode !== 'edit' && st !== 'CONFIRMING' && !reconnecting && (
            <SelfView className="ic-self" camera={!preview} onVideo={live.onVideo}
              signing={!!signing || !!unsure || (!!draft && draft.source === 'signs')}
              label={unsure ? 'Pick one' : signing ? 'Reading signs' : 'Sign to reply'} caption={cameraCaption} />
          )}
          <div className="ic-thread" ref={threadRef} aria-live="polite" style={{ fontSize: `${17 * capScale}px` }}>
            <div className="spacer" />
            {items.length === 0 && <div className="ic-empty"><SFCaptions size={30} /><span>{name}'s words appear here as they talk.</span></div>}
            {items}
          </div>
        </div>
      )}
      <div className="ic-dock ios-material-thick">
        {err && <div className="ic-err" role="alert"><SFExclamation size={15} /><span>{err}</span><button aria-label="Dismiss" onClick={() => setErr('')}><SFXmark size={12} /></button></div>}
        {dock}
      </div>
      {keypadOpen && (
        <div className="ios-scrim" onClick={() => setKeypadOpen(false)}>
          <div className="ios-sheet ic-keypad" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keypad">
            <div className="grabber" />
            <div className="dial-number" aria-live="polite">{dialed || ' '}</div>
            <KeyGrid small onKey={(k) => setDialed((d) => (d + k).slice(-24))} />
            <button className="ios-btn gray" style={{ width: '100%', marginTop: 16 }} onClick={() => { setKeypadOpen(false); setDialed('') }}>Hide</button>
          </div>
        </div>
      )}
      {call.confirm && draft && (
        <div className="ios-scrim">
          <div className="ios-sheet ic-confirm" role="dialog" aria-label="Check before it's said">
            <div className="grabber" />
            <div className="ic-confirm-h"><span className="tile"><SFExclamation size={20} /></span><h2>Check before it's said</h2></div>
            <p><Amount text={call.confirm.summary + '.'} /></p>
            <div className="ic-quote"><small>{name} will hear</small><b>“{call.confirm.sentence}”</b></div>
            <button className="ios-btn filled" style={{ width: '100%', background: 'var(--sys-orange)' }} onClick={() => act('confirm', { decision: 'yes', hash: call.confirm?.hash })}>Yes, say it</button>
            <div className="ic-row" style={{ marginTop: 10 }}>
              <button className="ios-btn gray grow" onClick={() => act('confirm', { decision: 'change' })}>Change it</button>
              <button className="ios-btn gray grow" onClick={() => act('confirm', { decision: 'later' })}>Not yet</button>
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
  const shown = all ? lines : lines.slice(-6)
  const secs = call.startedAt ? Math.max(1, Math.round((Date.now() - call.startedAt) / 1000)) : 0
  const missed = ['missed', 'declined', 'no-answer', 'busy', 'failed', 'canceled'].includes(call.endedReason)
  const title = !missed ? 'Call Ended' : call.endedReason === 'busy' ? 'Busy' : call.endedReason === 'no-answer' ? 'No Answer'
    : call.endedReason === 'declined' ? 'Declined' : call.endedReason === 'missed' ? 'Missed Call' : 'Call Failed'
  return (
    <div className="screen ios phone after">
      <StatusBar />
      <div className="scroll">
        <div className="card-head" style={{ paddingTop: 28 }}>
          <IOSAvatar name={name} size="lg" business={call.contact.kind === 'business'} />
          <h1>{name}</h1>
          <span className={`after-state ${missed ? 'bad' : ''}`}>{title}{!missed && secs ? ` · ${mmss(secs)}` : ''}</span>
        </div>
        {call.recap.length > 0 && !missed && (<>
          <div className="ios-section-h">Worth remembering</div>
          <div className="ios-group">{call.recap.map((p, i) => <div key={i} className="ios-row"><SFSparkles size={16} className="check" /><span className="grow" style={{ fontSize: 15 }}>{p}</span></div>)}</div>
        </>)}
        {lines.length > 0 && (<>
          <div className="ios-section-h">Conversation</div>
          <div className="ios-group after-lines">
            {shown.map((l) => <div key={l.id} className="ios-row"><span className="grow" style={{ fontSize: 15 }}><b className={l.who === 'me' ? 'me' : ''}>{l.who === 'me' ? 'You' : name}</b> {l.text}</span></div>)}
            {lines.length > 6 && <button className="ios-row link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${lines.length}`}</button>}
          </div>
        </>)}
        <p className="ios-section-f" style={{ textAlign: 'center', padding: '14px 32px' }}>
          {saved ? 'Transcript saved on this device.' : 'Kept only on this device. Nothing was recorded.'}</p>
        {!saved && lines.length > 0 && <div className="ios-group"><button className="ios-row link" onClick={() => { onSave(); setSaved(true) }}>Save Transcript</button></div>}
        <div style={{ height: 20 }} />
      </div>
      <div className="after-foot">
        <button className="ios-btn gray" onClick={onDone}>Done</button>
        <button className="ios-btn filled" onClick={onCallBack}><SFPhone size={18} /> Call Back</button>
      </div>
    </div>
  )
}

export { INTRO }
