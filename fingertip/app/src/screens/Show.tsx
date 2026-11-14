/**
 * Show it: film something instead of describing it.
 *
 * Gemini watches the clip in passes (server/app/show.py): sections that tile it, a transcript of
 * everything in each section (actions, on-screen text, speech, sounds), key facts pinned to WHEN
 * and WHERE, then a precision pass. This screen is the studio for that record:
 *  - the clip with AR boxes + tooltips at the right moment and spot,
 *  - a section rail you can drag through, with numbered fact pins,
 *  - a live transcript that follows the playhead (tap a line to jump),
 *  - key moments to say in a call, "ask the video", and a printable problem report.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { post, postForm, withKey } from '../api'
import { Video as VideoIcon } from '../icons'
import type { ShowRecord, TranscriptLine, VideoFact, VideoSection } from '../types'

export const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const KIND: Record<VideoFact['kind'], string> = {
  problem: 'Problem', reading: 'Reading', label: 'Label', object: 'Object', action: 'Action', answer: 'Answer', other: 'Seen',
}
const LINE: Record<TranscriptLine['kind'], string> = { action: 'Happens', text: 'On screen', speech: 'Said', sound: 'Sound' }
const HUES = [212, 168, 38, 330, 262, 12, 190, 96]

/* ---------------------------------------------------------------- the studio player */

export function ShowPlayer({ src, facts, sections = [], duration = 0, onSay, compact = false, previewTime, focusId }: {
  src: string | null; facts: VideoFact[]; sections?: VideoSection[]; duration?: number
  onSay?: (f: VideoFact) => void; compact?: boolean
  /** Gallery / no video: freeze at this time. */
  previewTime?: number
  /** Jump to this fact when it changes (e.g. a new answer). */
  focusId?: string | null
}) {
  const video = useRef<HTMLVideoElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const tx = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(previewTime ?? 0)
  const [dur, setDur] = useState(duration)
  const [focus, setFocus] = useState<string | null>(null)
  const [tab, setTab] = useState<'timeline' | 'moments'>(sections.some((s) => s.lines?.length) && !compact ? 'timeline' : 'moments')

  useEffect(() => {
    const v = video.current
    if (!v) return
    let raf = 0
    const tick = () => { setNow(v.currentTime); if (!v.paused) raf = requestAnimationFrame(tick) }
    const play = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) }
    const meta = () => { if (Number.isFinite(v.duration)) setDur(v.duration) }
    v.addEventListener('play', play); v.addEventListener('seeked', tick); v.addEventListener('timeupdate', tick)
    v.addEventListener('loadedmetadata', meta)
    return () => { cancelAnimationFrame(raf); v.removeEventListener('play', play); v.removeEventListener('seeked', tick)
      v.removeEventListener('timeupdate', tick); v.removeEventListener('loadedmetadata', meta) }
  }, [src])

  const t = previewTime ?? now
  const total = Math.max(dur || duration, ...facts.map((f) => f.t_end), ...sections.map((s) => s.end), 1)
  const num = useMemo(() => Object.fromEntries(facts.map((f, i) => [f.id, i + 1])), [facts])
  const visible = facts.filter((f) => t >= f.t - 0.05 && t <= f.t_end + 0.3)
  const curSec = sections.find((s) => t >= s.start && t < s.end) ?? sections[sections.length - 1]
  const lines = curSec?.lines ?? []
  const activeLine = lines.reduce((acc, l, i) => (l.t <= t + 0.05 ? i : acc), -1)

  function seek(to: number, pause = true) {
    const v = video.current
    if (v) { v.currentTime = Math.max(0, Math.min(to, total)); if (pause) v.pause() } else setNow(to)
  }
  function jump(f: VideoFact) { setFocus(f.id); seek(f.t) }
  useEffect(() => {
    const f = facts.find((x) => x.id === focusId)
    if (f) jump(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])
  useEffect(() => {            // keep the active transcript line in view
    const el = tx.current?.querySelector('.tl.on') as HTMLElement | null
    if (el && tx.current) tx.current.scrollTop = el.offsetTop - tx.current.clientHeight / 2
  }, [activeLine, curSec?.id])

  // drag on the rail to scrub
  const scrub = (e: React.PointerEvent) => {
    const r = rail.current!.getBoundingClientRect()
    seek(((e.clientX - r.left) / r.width) * total, true)
  }

  return (
    <div className={`sp ${compact ? 'compact' : ''}`}>
      <div className="sp-stagewrap">
        <div className="sp-stage">
          {src ? <video ref={video} src={src} controls playsInline preload="metadata" />
            : <div className="sp-ph" aria-hidden />}
          <div className="sp-ov" aria-hidden>
            {visible.filter((f) => f.box).map((f) => {
              const [y0, x0, y1, x1] = f.box!
              return (
                <div key={f.id} className={`sp-box ${f.sure ? '' : 'unsure'} ${f.kind === 'answer' ? 'answer' : ''} ${focus === f.id ? 'focus' : ''}`}
                     style={{ left: `${x0 / 10}%`, top: `${y0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}>
                  <span className={`sp-tip ${y0 < 140 ? 'below' : ''}`}><b>{num[f.id]}</b>{f.label}{f.sure ? '' : ' ?'}</span>
                </div>
              )
            })}
            {visible.filter((f) => !f.box).map((f, i) => (
              <span key={f.id} className="sp-float" style={{ top: `${12 + i * 34}px` }}><b>{num[f.id]}</b>{f.label}</span>
            ))}
            {curSec && sections.length > 1 && <span className="sp-chapter">{curSec.title}</span>}
          </div>
        </div>
      </div>

      {/* section rail: drag to scrub, pins for facts */}
      <div className="sp-railwrap">
        <div className="sp-pins" aria-hidden>
          {facts.map((f) => (
            <span key={f.id} className={`sp-pin ${focus === f.id ? 'on' : ''} ${f.kind === 'answer' ? 'answer' : ''}`}
                  style={{ left: `${Math.min(100, (f.t / total) * 100)}%` }}>{num[f.id]}</span>
          ))}
        </div>
        <div ref={rail} className="sp-rail" role="slider" aria-label="Scrub through the video" aria-valuemin={0}
             aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)} tabIndex={0}
             onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable */ } scrub(e) }}
             onPointerMove={(e) => { if (e.buttons) scrub(e) }}
             onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(t + 1); if (e.key === 'ArrowLeft') seek(t - 1) }}>
          {(sections.length ? sections : [{ id: 'all', start: 0, end: total, title: '', summary: '', lines: [] }]).map((s, i) => (
            <div key={s.id} className={`sp-seg ${curSec?.id === s.id ? 'on' : ''}`}
                 style={{ left: `${(s.start / total) * 100}%`, width: `${((s.end - s.start) / total) * 100}%`, ['--h' as any]: HUES[i % HUES.length] }}>
              <span>{s.title}</span>
            </div>
          ))}
          <div className="sp-head" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} />
        </div>
        <div className="sp-times"><span>{mmss(t)}</span><span>{mmss(total)}</span></div>
      </div>

      {!compact && sections.length > 0 && (
        <div className="filters" role="tablist" aria-label="View">
          <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>Timeline</button>
          <button role="tab" aria-selected={tab === 'moments'} className={tab === 'moments' ? 'on' : ''} onClick={() => setTab('moments')}>Key moments ({facts.length})</button>
        </div>
      )}

      {tab === 'timeline' && !compact && sections.length > 0 ? (
        <div className="sp-tx">
          <div className="sp-secnav">
            {sections.map((s, i) => (
              <button key={s.id} className={curSec?.id === s.id ? 'on' : ''} style={{ ['--h' as any]: HUES[i % HUES.length] }}
                      onClick={() => seek(s.start)}>
                <b>{i + 1}. {s.title}</b><small>{mmss(s.start)}–{mmss(s.end)}</small>
              </button>
            ))}
          </div>
          {curSec && (
            <div className="sp-secbody">
              <div className="sp-sechead"><b>{curSec.title}</b>{curSec.summary && <span>{curSec.summary}</span>}</div>
              <div ref={tx} className="sp-lines" aria-live="off">
                {lines.length === 0 && <p className="fine">No transcript for this part.</p>}
                {lines.map((l, i) => (
                  <button key={i} className={`tl ${l.kind} ${i === activeLine ? 'on' : ''}`} onClick={() => seek(l.t)}>
                    <span className="tt">{mmss(l.t)}</span>
                    <span className="tk">{LINE[l.kind]}</span>
                    <span className="tx">{l.kind === 'speech' ? `“${l.text}”` : l.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <ol className="sp-facts">
          {facts.map((f) => {
            const live = t >= f.t - 0.05 && t <= f.t_end + 0.3
            return (
              <li key={f.id} className={`${live ? 'live' : ''} ${focus === f.id ? 'on' : ''} ${f.kind === 'answer' ? 'answer' : ''}`}>
                <button className="sp-fact" onClick={() => jump(f)} aria-label={`Show ${mmss(f.t)} in the video`}>
                  <span className="sp-n">{num[f.id]}</span>
                  <span className="sp-body">
                    <span className="sp-meta">{mmss(f.t)} · {KIND[f.kind] ?? 'Seen'}{f.refined ? ' · pinpointed' : ''}
                      {!f.sure && <em> · not sure, check it</em>}{!f.box && ' · no single spot'}</span>
                    {f.question && <span className="sp-q">Asked: {f.question}</span>}
                    <span className="sp-say">{f.say}</span>
                  </span>
                </button>
                {onSay && <button className="btn btn-ghost sp-saybtn" onClick={() => onSay(f)}>Say this</button>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- ask the video */

function AskBox({ onAsk, placeholder = "What's the model number?" }: { onAsk: (q: string) => Promise<string | null>; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <form className="askbox" onSubmit={async (e) => {
      e.preventDefault()
      if (!q.trim() || busy) return
      setBusy(true); setMsg('')
      try { setMsg((await onAsk(q.trim())) ?? '') } finally { setBusy(false) }
    }}>
      <input className="num-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Ask the video" maxLength={300} />
      <button className="btn btn-ghost" type="submit" disabled={busy || !q.trim()}>{busy ? 'Checking...' : 'Ask the video'}</button>
      {msg && <div className="fine" role="status" style={{ flexBasis: '100%' }}>{msg}</div>}
    </form>
  )
}

/* ---------------------------------------------------------------- capture -> analyze -> use */

export function ShowFlow({ callSid, onClose }: { callSid?: string; onClose: () => void }) {
  const [avail, setAvail] = useState<{ available: boolean } | null>(null)
  const [context, setContext] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState('')
  const [rec, setRec] = useState<ShowRecord | null>(null)
  const [shared, setShared] = useState(false)
  const [copied, setCopied] = useState(false)
  const [report, setReport] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setAvail(h.show ?? { available: false })).catch(() => setAvail({ available: false }))
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const working = busy || rec?.status === 'processing'
  useEffect(() => {
    if (!working) return
    const t0 = Date.now()
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(i)
  }, [working])
  // poll the background job
  useEffect(() => {
    if (rec?.status !== 'processing') return
    const i = setInterval(() => {
      fetch(withKey(`/api/show/${rec.id}`)).then((r) => r.json()).then((r: ShowRecord) => {
        setRec(r)
        if (r.status === 'failed') setErr(r.error ?? "Couldn't read that video.")
      }).catch(() => {})
    }, 1000)
    return () => clearInterval(i)
  }, [rec?.id, rec?.status])

  function choose(f: File | null) {
    setErr('')
    if (!f) return
    if (!f.type.startsWith('video/')) { setErr("That isn't a video. Film one, or pick a video file."); return }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function analyze() {
    if (!file) return
    setBusy(true); setErr('')
    try {
      const duration = await new Promise<number>((res) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? v.duration : 0)
        v.onerror = () => res(0)
        v.src = preview!
      })
      const form = new FormData()
      form.append('file', file); form.append('duration', String(duration))
      form.append('context', context); form.append('title', context.slice(0, 80))
      setRec(await postForm<ShowRecord>('/api/show', form))
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  async function ask(q: string) {
    if (!rec) return null
    try {
      const r = await post<{ found: boolean; fact: VideoFact | null }>(`/api/show/${rec.id}/ask`, { question: q })
      if (!r.found || !r.fact) return "The video doesn't clearly show that."
      setRec({ ...rec, facts: [...rec.facts, r.fact] })
      setFocusId(r.fact.id)
      return null
    } catch (e: any) { return e.message }
  }

  async function useInCall() {
    if (!rec || !callSid) return
    try { await post(`/api/calls/${callSid}/show/${rec.id}`); onClose() } catch (e: any) { setErr(e.message) }
  }
  async function toggleShare() {
    if (!rec) return
    try {
      const r = await post<{ share: boolean; share_token: string | null }>(`/api/show/${rec.id}/share`, { share: !shared })
      setShared(r.share)
      if (r.share_token) setRec({ ...rec, share_token: r.share_token })
    } catch (e: any) { setErr(e.message) }
  }
  async function remove() {
    if (rec) await fetch(withKey(`/api/show/${rec.id}`), { method: 'DELETE' }).catch(() => {})
    onClose()
  }

  const done = rec?.status === 'done'
  const link = rec?.share_token ? `${location.origin}/#s/${rec.share_token}` : ''
  if (report && rec && done) return <ShowReport rec={rec} src={withKey(`/api/show/${rec.id}/video`)} onClose={() => setReport(false)} />

  return (
    <div className="screen show">
      <div className="head-white">
        <div className="title-row">
          <div><h1 style={{ fontSize: 26 }}>Show it</h1>
            <p className="fine" style={{ margin: 0 }}>Film it instead of describing it.</p></div>
          <button className="link" onClick={onClose}>{done ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
      <div className="scroll pad16" style={{ gap: 14 }}>
        {avail && !avail.available && <div className="cardbox boxpad" role="status">Show it needs the Gemini key on the server. Everything else still works.</div>}

        {!rec && (
          <>
            <div className="cardbox boxpad" style={{ gap: 10 }}>
              <div className="label">1 · Film it (10 to 60 seconds)</div>
              <input ref={pick} type="file" accept="video/*" capture="environment" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} aria-label="Film or choose a video" />
              {preview ? <video src={preview} controls playsInline className="show-preview" />
                : <button className="show-drop" onClick={() => pick.current?.click()}><VideoIcon size={36} /><b>Film it now</b><small>or pick a video you already have</small></button>}
              {preview && <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => pick.current?.click()}>Use a different video</button>}
              <small className="fine">Get close, hold steady, and show any labels or screens for a couple of seconds. Talk or point if you like: it's transcribed too.</small>
            </div>
            <div className="cardbox boxpad" style={{ gap: 8 }}>
              <div className="label">2 · What's it about? (optional)</div>
              <input className="num-input" value={context} onChange={(e) => setContext(e.target.value)} maxLength={300}
                     placeholder="Dishwasher leaking, calling the landlord" aria-label="What the video is about" />
            </div>
            <p className="fine">Your video is sent to Google Gemini to be analyzed. It's kept on this server for 24 hours so you can replay or share it, then deleted.</p>
          </>
        )}

        {working && (
          <div className="cardbox boxpad show-busy" role="status" aria-live="polite">
            <span className="dots"><i /><i /><i /></span>
            <span><b>{rec?.progress || 'Sending the video'}</b><br /><small className="fine">Gemini is watching · {elapsed}s</small></span>
          </div>
        )}
        {err && <div className="err" role="alert">{err}</div>}

        {rec && done && (
          <>
            <div className="cardbox boxpad">
              <div className="label">What the video shows{rec.seconds ? ` · read in ${Math.round(rec.seconds)} s` : ''}{rec.refined ? ` · ${rec.refined} moment${rec.refined === 1 ? '' : 's'} pinpointed` : ''}</div>
              {rec.facts.length === 0 && <p>Nothing clear enough to describe. Try filming closer and steadier.</p>}
              <ShowPlayer src={withKey(`/api/show/${rec.id}/video`)} facts={rec.facts} sections={rec.sections} duration={rec.duration} focusId={focusId} />
              {rec.notes && <p className="fine" style={{ marginTop: 8 }}>Couldn't see clearly: {rec.notes}</p>}
              <AskBox onAsk={ask} />
            </div>
            {rec.summary_say && (
              <div className="cardbox boxpad">
                <div className="label">Ready to say</div>
                <p style={{ fontSize: 19, margin: 0 }}>"{rec.summary_say}"</p>
                <small className="fine">Nothing is said until you send it in a call. Check each point against the video first.</small>
              </div>
            )}
            <button className="btn btn-ghost" onClick={() => setReport(true)}>Problem report (print or save as PDF)</button>
            <div className="cardbox setting">
              <div className="txt"><b>Share a link</b>
                <small>{shared ? 'Anyone with the link can watch this clip, its timeline and notes.' : 'Off. Turn on to send the annotated clip to the other person.'}</small></div>
              <button className={`toggle ${shared ? 'on' : ''}`} role="switch" aria-checked={shared} aria-label="Share a link" onClick={toggleShare} />
            </div>
            {shared && link && (
              <div className="cardbox boxpad" style={{ gap: 8 }}>
                <code className="mcode" style={{ wordBreak: 'break-all' }}>{link}</code>
                <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}) }}>{copied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}
            <button className="link" style={{ alignSelf: 'flex-start', color: 'var(--red)' }} onClick={remove}>Delete this video now</button>
          </>
        )}
      </div>
      <div className="foot">
        {!rec || rec.status === 'failed' ? (
          <button className="btn btn-blue grow" disabled={!file || working || (avail !== null && !avail.available)}
                  onClick={() => { setRec(null); analyze() }}>{working ? 'Watching...' : rec ? 'Try again' : 'Show Gemini'}</button>
        ) : !done ? (
          <button className="btn btn-blue grow" disabled>Watching... {elapsed}s</button>
        ) : callSid ? (
          <button className="btn btn-blue grow" onClick={useInCall} disabled={rec.facts.length === 0}>Use in this call</button>
        ) : (
          <button className="btn btn-blue grow" onClick={onClose}>Done</button>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- in a call */

export function CallVideoCard({ callSid, video, lastCallerText, onSay, preview = false }: {
  callSid: string; video: { show_id: string; facts: VideoFact[]; answer?: VideoFact | null }
  lastCallerText: string; onSay: (f: VideoFact) => void; preview?: boolean
}) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function check() {
    setBusy(true); setMsg('')
    try {
      const r = await post<{ found: boolean; question: string }>(`/api/calls/${callSid}/ask-video`, { question: '' })
      if (!r.found) setMsg(`The video doesn't clearly show that ("${r.question}").`)
    } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="vidcard">
      <span className="lab">From your video · check a point, then say it</span>
      <ShowPlayer compact src={preview ? null : withKey(`/api/show/${video.show_id}/video`)} facts={video.facts}
                  previewTime={preview ? video.facts[0]?.t : undefined} focusId={video.answer?.id ?? null} onSay={onSay} />
      {lastCallerText && (
        <button className="btn btn-ghost" disabled={busy || preview} onClick={check}>
          {busy ? 'Checking the video...' : `Check the video for: “${lastCallerText.length > 48 ? lastCallerText.slice(0, 48) + '…' : lastCallerText}”`}
        </button>
      )}
      {msg && <div className="fine" role="status">{msg}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- problem report */

/** A one-page report: key frames with their boxes, timestamps, the summary and the full timeline.
 *  Frames are captured in the browser from the clip itself; print or save as PDF. */
export function ShowReport({ rec, src, onClose }: { rec: ShowRecord; src: string; onClose: () => void }) {
  const [frames, setFrames] = useState<Record<string, string>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'noframes'>('loading')
  useEffect(() => {
    let dead = false
    const v = document.createElement('video')
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = src
    const grab = async () => {
      const out: Record<string, string> = {}
      for (const f of rec.facts) {
        await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(f.t + 0.05, (v.duration || f.t) - 0.05) })
        const c = document.createElement('canvas')
        const w = 480
        c.width = w; c.height = Math.round((v.videoHeight / v.videoWidth) * w) || 270
        const g = c.getContext('2d')!
        g.drawImage(v, 0, 0, c.width, c.height)
        if (f.box) {
          const [y0, x0, y1, x1] = f.box
          g.lineWidth = 4; g.strokeStyle = '#ffd23f'
          g.strokeRect((x0 / 1000) * c.width, (y0 / 1000) * c.height, ((x1 - x0) / 1000) * c.width, ((y1 - y0) / 1000) * c.height)
        }
        out[f.id] = c.toDataURL('image/jpeg', 0.85)
      }
      return out
    }
    v.onloadeddata = () => { grab().then((o) => { if (!dead) { setFrames(o); setState('ready') } }).catch(() => !dead && setState('noframes')) }
    v.onerror = () => !dead && setState('noframes')
    return () => { dead = true; v.removeAttribute('src') }
  }, [rec, src])

  const created = rec.created ? new Date(rec.created * 1000) : new Date()
  return (
    <div className="screen report">
      <div className="head-white noprint">
        <div className="title-row"><h1 style={{ fontSize: 24 }}>Problem report</h1>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-blue" onClick={() => window.print()} disabled={state === 'loading'}>Print / save PDF</button>
            <button className="link" onClick={onClose}>Back</button></span></div>
      </div>
      <div className="scroll pad16 rp">
        <header className="rp-head">
          <h1>{rec.title || 'What the video shows'}</h1>
          <div className="fine">{created.toLocaleString()} · {mmss(rec.duration || 0)} video · {rec.facts.length} key points · made with Fingertip (Google Gemini read the video)</div>
          {rec.summary_say && <p className="rp-sum">{rec.summary_say}</p>}
        </header>
        {state === 'loading' && <p className="fine">Taking the key frames...</p>}
        <section className="rp-grid">
          {rec.facts.map((f, i) => (
            <figure key={f.id} className="rp-fig">
              {frames[f.id] ? <img src={frames[f.id]} alt={`Frame at ${mmss(f.t)}: ${f.label}`} /> : <div className="rp-noimg" />}
              <figcaption><b>{i + 1}. {f.label}</b> · {mmss(f.t)}{f.sure ? '' : ' · not sure'}<br />{f.say}</figcaption>
            </figure>
          ))}
        </section>
        {(rec.sections ?? []).length > 0 && (
          <section>
            <h2>Timeline</h2>
            {(rec.sections ?? []).map((s, i) => (
              <div key={s.id} className="rp-sec">
                <h3>{i + 1}. {s.title} <span className="fine">{mmss(s.start)}–{mmss(s.end)}</span></h3>
                {s.summary && <p>{s.summary}</p>}
                <table><tbody>
                  {s.lines.map((l, j) => <tr key={j}><td>{mmss(l.t)}</td><td>{LINE[l.kind]}</td><td>{l.kind === 'speech' ? `“${l.text}”` : l.text}</td></tr>)}
                </tbody></table>
              </div>
            ))}
          </section>
        )}
        {rec.notes && <p className="fine">Couldn't see clearly: {rec.notes}</p>}
        <p className="fine">The points, boxes and timeline were found by AI (Google Gemini) from the video. AI can misread things; the video itself is the record.</p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- what the other person opens */

export function SharedShow({ token }: { token: string }) {
  const [rec, setRec] = useState<ShowRecord | null>(null)
  const [err, setErr] = useState('')
  const [report, setReport] = useState(false)
  const src = `/api/shared/${encodeURIComponent(token)}/video`
  useEffect(() => {
    fetch(`/api/shared/${encodeURIComponent(token)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail ?? 'This link has expired.')
      setRec(j)
    }).catch((e) => setErr(e.message))
  }, [token])
  if (report && rec) return <ShowReport rec={rec} src={src} onClose={() => setReport(false)} />
  return (
    <div className="screen show">
      <div className="head-white">
        <h1 style={{ fontSize: 24 }}>{rec?.title || 'A video for you'}</h1>
        <p className="fine" style={{ margin: 0 }}>Shared with Fingertip. Drag through the timeline, or tap a point to see that moment.</p>
      </div>
      <div className="scroll pad16" style={{ gap: 14 }}>
        {err && <div className="err" role="alert">{err}</div>}
        {rec && <>
          {rec.summary_say && <div className="cardbox boxpad"><p style={{ fontSize: 19, margin: 0 }}>{rec.summary_say}</p></div>}
          <div className="cardbox boxpad"><ShowPlayer src={src} facts={rec.facts} sections={rec.sections} duration={rec.duration} /></div>
          <button className="btn btn-ghost" onClick={() => setReport(true)}>Problem report (print or save as PDF)</button>
          <p className="fine">The points, boxes and timeline were found by AI (Google Gemini), and the sender chose to share them. AI can misread things, so check against the video. The link expires within 24 hours.</p>
        </>}
      </div>
    </div>
  )
}


