/**
 * Settings → Signing. Practise the 55 built-in signs and teach the app your own.
 * - Practise: sign anything; each sign appears as you finish it (pause between signs).
 * - Teach: pick a sign (or type any word, in any sign language), sign it 3 times.
 *   Your examples win over the built-in model when they match. Landmarks only, never video.
 */
import { useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { watch } from '../sign/camera'
import { wireFrames, type Hand } from '../sign/pipeline'
import { Segmenter, type Frame } from '../sign/segmenter'
import { getHand } from '../sign/useSigning'
import { save } from '../storage'
import { SelfView } from './Call'
import { StatusBar } from './Phone'
import { SFCheck, SFChevronLeft, SFHand, SFPlus, SFXmark } from '../sf'

const TIMES = 3
type Heard = { sign: string; personal: boolean; unsure: boolean; options?: string[] }
type Cfg = { ready: boolean; conversation: string[]; personal: Record<string, number> }

const pretty = (g: string) => g.replace(/-/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

function framing(f: Frame | null): string {
  if (!f || !f.pose) return 'Step into view so your face and shoulders show.'
  const ls = f.pose[11], rs = f.pose[12]
  if (f.pose[0][1] < 0.05) return 'Tilt the camera down a little.'
  if ((ls[1] + rs[1]) / 2 > 0.62) return 'Sit up or raise the camera: your shoulders should be near the middle of the picture so your hands stay in view.'
  if (Math.abs(ls[0] - rs[0]) > 0.6) return 'Move back a little so your hands fit.'
  if (Math.abs(ls[0] - rs[0]) < 0.15) return 'Move a little closer.'
  return ''
}

export function SignSetup({ onBack }: { onBack: () => void }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [hand, setHand] = useState<Hand>(() => (getHand() === 'left' ? 'left' : 'right'))
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [heard, setHeard] = useState<Heard[]>([])
  const [signing, setSigning] = useState(false)
  const [hint, setHint] = useState('Starting the camera…')
  const [slow, setSlow] = useState(0)
  const [teach, setTeach] = useState<string | null>(null)     // label being taught
  const [got, setGot] = useState(0)
  const [note, setNote] = useState('')
  const [custom, setCustom] = useState('')
  const [filter, setFilter] = useState('')
  const live = useRef({ hand, teach, got })
  live.current = { hand, teach, got }

  const refresh = () => fetch('/api/signs/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ ready: false, conversation: [], personal: {} }))
  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (!video) return
    let last: Frame | null = null
    const seg = new Segmenter({
      onStart: () => { setSigning(true); if (!live.current.teach) setHeard([]) },
      onSegment: async (frames) => {
        const { hand: h, teach: t } = live.current
        if (t) {
          try {
            const r = await post<{ ok: boolean; count?: number; reason?: string; consistency?: number }>('/api/signs/teach', { label: t, frames: wireFrames(frames), hand: h })
            if (!r.ok) { setNote(r.reason ?? 'Try that one again.'); return }
            const n = live.current.got + 1
            setGot(n)
            setNote(r.consistency !== undefined && r.consistency < 0.5 ? 'That one looked different from the last. Sign it the way you normally do.' : '')
            if (n >= TIMES) { setTeach(null); setNote(`Learned “${pretty(t)}”. Try it below.`); refresh() }
          } catch (e: any) { setNote(e.message) }
          return
        }
        try {
          const r = await post<{ ok: boolean; sign?: string; unsure?: boolean; options?: string[]; source?: string }>('/api/signs/classify', { frames: wireFrames(frames), hand: h })
          if (r.ok && r.sign) setHeard((x) => [...x, { sign: r.sign!, personal: r.source === 'personal', unsure: !!r.unsure, options: r.options }].slice(-8))
        } catch { /* keep going */ }
      },
      onPhraseEnd: () => setSigning(false),
    })
    const tick = setInterval(() => setHint(framing(last)), 700)
    const stop = watch(video, (f) => { last = f; seg.push(f) }, (fps) => setSlow(fps < 8 ? fps : 0))
    return () => { stop(); clearInterval(tick) }
  }, [video])

  const startTeach = (label: string) => { setTeach(label.trim().toUpperCase()); setGot(0); setNote(''); setHeard([]) }
  const forget = async (label: string) => {
    await fetch(`/api/signs/personal/${encodeURIComponent(label)}`, { method: 'DELETE' }); refresh()
  }
  const personal = cfg?.personal ?? {}
  const conv = (cfg?.conversation ?? []).filter((s) => !filter || pretty(s).toLowerCase().includes(filter.toLowerCase()))
  const own = Object.keys(personal).filter((k) => !(cfg?.conversation ?? []).includes(k))

  return (
    <div className="screen ios phone sign-setup">
      <StatusBar />
      <div className="ios-nav"><button onClick={onBack} className="ios-back"><SFChevronLeft size={20} />Settings</button><span /></div>
      <div className="scroll">
        <h1 className="ios-large-title">Signing</h1>

        <div className="ss-stage">
          <SelfView signing={signing || !!teach} camera onVideo={setVideo} label="" className="ss-cam" />
          {(hint || slow > 0) && <div className="ss-hint">{hint || `Tracking is slow on this computer (${slow.toFixed(0)} frames a second). Close other tabs or plug in for better results.`}</div>}
          {teach ? (
            <div className="ss-teach" aria-live="polite">
              <div className="ss-teach-word">{pretty(teach)}</div>
              <div className="ss-dots">{Array.from({ length: TIMES }, (_, i) => <span key={i} className={i < got ? 'on' : ''}>{i < got ? <SFCheck size={12} /> : null}</span>)}</div>
              <div className="ss-teach-sub">Sign it, then drop your hands. {TIMES - got} more.</div>
              <button className="ios-link" onClick={() => { setTeach(null); setNote('') }}>Cancel</button>
            </div>
          ) : (
            <div className="ss-heard" aria-live="polite">
              {heard.length ? heard.map((h, i) => (
                <span key={i} className={`ss-chip ${h.unsure ? 'unsure' : ''}`}>
                  {h.unsure && h.options?.length ? h.options.map(pretty).join(' or ') + '?' : pretty(h.sign)}
                  {h.personal && <em>yours</em>}
                </span>)) : <span className="ss-empty">One sign at a time: sign it, then drop your hands out of view.</span>}
            </div>
          )}
          {note && <div className="ss-note">{note}</div>}
        </div>
        {cfg && !cfg.ready && <p className="ios-section-f">The sign model isn't loaded on the server, so signing is off. Typing still works.</p>}

        <div className="ios-section-h">You sign with your</div>
        <div className="ios-group" style={{ padding: 12 }}>
          <div className="ios-seg">{(['right', 'left'] as Hand[]).map((h) => (
            <button key={h} className={hand === h ? 'on' : ''} onClick={() => { setHand(h); save('hand', h) }}>{h === 'right' ? 'Right hand' : 'Left hand'}</button>))}</div>
        </div>
        <p className="ios-section-f">The hand that moves most. Getting this right matters more than anything else.</p>

        <div className="ios-section-h">Your own signs</div>
        <div className="ios-group">
          {own.map((k) => (
            <div key={k} className="ios-row"><span className="ios-icon-tile" style={{ background: 'var(--sys-indigo)' }}><SFHand size={17} /></span>
              <span className="grow">{pretty(k)}<span className="sub">{personal[k]} example{personal[k] === 1 ? '' : 's'}</span></span>
              <button className="ios-link" onClick={() => startTeach(k)}>Add more</button>
              <button aria-label={`Forget ${k}`} className="row-del" onClick={() => forget(k)}><SFXmark size={14} /></button></div>))}
          <form className="ios-row" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { startTeach(custom); setCustom('') } }}>
            <span className="ios-icon-tile" style={{ background: 'var(--sys-green)' }}><SFPlus size={17} /></span>
            <input className="inline-field" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Any word or name, any sign language" aria-label="New sign" maxLength={40} />
            <button className="ios-link" type="submit" disabled={!custom.trim()}>Teach</button></form>
        </div>
        <p className="ios-section-f">Sign it {TIMES} times and the app learns your version. Only hand positions are saved, never video.</p>

        <div className="ios-section-h">The {cfg?.conversation.length ?? 25} signs it knows</div>
        <div className="ios-search"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" aria-label="Search signs" /></div>
        <div className="ios-group">
          {conv.map((s) => (
            <div key={s} className="ios-row">
              <span className="grow">{pretty(s)}{personal[s] ? <span className="sub">Tuned to you · {personal[s]} examples</span> : null}</span>
              {personal[s] ? <SFCheck size={16} className="check" /> : null}
              <button className="ios-link" onClick={async () => { if (personal[s]) await forget(s); startTeach(s) }}>{personal[s] ? 'Redo' : 'Tune to me'}</button>
            </div>))}
        </div>
        <p className="ios-section-f">ASL, recognised with Google’s MediaPipe sign model (Kaggle ISLR winner). If one keeps coming out wrong, tap “Tune to me” and sign it 3 times. Need a word that isn’t here, like “sorry” or “help”? Teach it above.</p>
        <p className="ios-section-f" style={{ textAlign: 'center' }}>Sign engine: Google ISLR · one sign per raise · build 25-drop</p>
        <div style={{ height: 28 }} />
      </div>
    </div>
  )
}
