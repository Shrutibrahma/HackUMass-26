/**
 * Signs lab (/#signs-lab): a team tool, not part of the call UI.
 * - Framing check for the phone on its stand (face, shoulders and both hands in view).
 * - Dominant-hand setting (the model needs to know which hand leads).
 * - Record single signs or whole phrases from a teammate (landmarks only, never video) for the
 *   held-out evaluation: python eval/sign_eval.py --signer "<name>".
 * - Shows what the model recognized, so the team can see which signs work on this phone.
 */
import { useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { watch } from '../sign/camera'
import { wireFrames, type Hand } from '../sign/pipeline'
import { handsUp, Segmenter, type Frame } from '../sign/segmenter'
import { getHand } from '../sign/useSigning'
import { load, save } from '../storage'
import { SelfView } from './Call'

const PHRASES = ['YES SUNDAY COME', 'WANT SIX', 'NO TOMORROW', 'THANK-YOU', 'NEED MORE', 'YES SEVEN']

function framing(f: Frame | null): string {
  if (!f || !f.pose) return 'Step into view: we need to see your face and shoulders.'
  const ls = f.pose[11]
  const rs = f.pose[12]
  const nose = f.pose[0]
  if (nose[1] < 0.05) return 'Tilt the phone down a little: the top of your head is cut off.'
  if (Math.abs(ls[0] - rs[0]) > 0.6) return 'Move back a little: we need room for your hands.'
  if (Math.abs(ls[0] - rs[0]) < 0.15) return 'Move closer: you are too far away.'
  if (ls[1] > 0.75 || rs[1] > 0.75) return 'Raise the phone: your shoulders are near the bottom.'
  if (handsUp(f) && !(f.lh && f.rh)) return 'Good. Raise both hands to check they both stay in view.'
  return 'Framing looks good.'
}

export function SignsLab({ onDone }: { onDone: () => void }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [signer, setSigner] = useState(() => load('labSigner', ''))
  const [hand, setHand] = useState<Hand>(getHand())
  const [kind, setKind] = useState<'sign' | 'phrase'>('phrase')
  const [label, setLabel] = useState(PHRASES[0])
  const [vocab, setVocab] = useState<string[]>([])
  const [ready, setReady] = useState<boolean | null>(null)
  const [armed, setArmed] = useState(false)
  const [status, setStatus] = useState('')
  const [heard, setHeard] = useState<string[]>([])
  const [frameHint, setFrameHint] = useState('Starting the camera...')
  const [fps, setFps] = useState(0)
  const [ms, setMs] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const segs = useRef<Frame[][]>([])
  const armedRef = useRef(false)
  armedRef.current = armed
  const cfg = useRef({ hand, signer, kind, label })
  cfg.current = { hand, signer, kind, label }

  useEffect(() => {
    fetch('/api/signs/config').then((r) => r.json()).then((c) => { setVocab(c.vocab ?? []); setReady(!!c.ready) }).catch(() => setReady(false))
    refreshCounts()
  }, [])

  function refreshCounts() {
    fetch('/api/signs/recordings').then((r) => r.json()).then((r) => setCounts(r.signers?.[load('labSigner', '')] ?? {})).catch(() => {})
  }

  useEffect(() => {
    if (!video) return
    let last: Frame | null = null
    const seg = new Segmenter({
      onStart: () => { segs.current = []; setHeard([]) },
      onSegment: async (frames) => {
        segs.current.push(frames)
        const r = await post<{ ok: boolean; sign?: string; unsure?: boolean; options?: string[] }>(
          '/api/signs/classify', { frames: wireFrames(frames), hand: cfg.current.hand })
        if (r.ok && r.sign) setHeard((h) => [...h, r.unsure ? `${r.options?.join(' or ')}?` : r.sign!])
      },
      onPhraseEnd: async () => {
        if (!armedRef.current || !segs.current.length) return
        const { signer: who, kind: k, label: lab } = cfg.current
        const segments = segs.current.map((s) => wireFrames(s))
        try {
          await post('/api/signs/record', { signer: who, label: lab, kind: k, segments })
          setStatus(`Saved "${lab}" (${segments.length} sign${segments.length === 1 ? '' : 's'} seen).`)
          refreshCounts()
        } catch (e: any) {
          setStatus(e.message)
        }
        setArmed(false)
      },
    })
    const tick = setInterval(() => setFrameHint(framing(last)), 600)
    const stop = watch(video, (f) => { last = f; seg.push(f) }, (a, b) => { setFps(a); setMs(b) })
    return () => { stop(); clearInterval(tick) }
  }, [video])

  const pill = (on: boolean) => ({ className: on ? 'on' : '' })

  return (
    <div className="screen">
      <div className="head-white" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="title-row"><h1 style={{ fontSize: 26 }}>Signs lab</h1><button className="link" onClick={onDone}>Done</button></div>
        <p className="fine" style={{ margin: 0 }}>Team tool. Records landmarks only, never video.</p>
      </div>
      <div className="scroll pad16">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <SelfView signing={armed} camera onVideo={setVideo} label={armed ? 'Recording' : 'You'} className="lab-self" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b>{frameHint}</b>
            <span className="fine">{ready === false ? 'Sign model not loaded on the server.' : fps ? `Camera: ${fps.toFixed(1)} frames a second, ${ms.toFixed(0)} ms per frame${fps < 15 ? ' (low: recognition may suffer)' : ''}` : ''}</span>
          </div>
        </div>
        <div className="cardbox boxpad">
          <div className="label">You sign with your</div>
          <div className="filters">
            {(['right', 'left', 'auto'] as Hand[]).map((h) => (
              <button key={h} {...pill(hand === h)} onClick={() => { setHand(h); save('hand', h) }}>
                {h === 'auto' ? 'Not sure' : `${h[0].toUpperCase()}${h.slice(1)} hand`}</button>))}
          </div>
        </div>
        <div className="cardbox boxpad">
          <div className="label">Record for the held-out test</div>
          <input className="num-input" placeholder="Signer's name" value={signer} aria-label="Signer's name"
                 onChange={(e) => { setSigner(e.target.value); save('labSigner', e.target.value) }} />
          <div className="filters">
            <button {...pill(kind === 'phrase')} onClick={() => { setKind('phrase'); setLabel(PHRASES[0]) }}>Phrase</button>
            <button {...pill(kind === 'sign')} onClick={() => { setKind('sign'); setLabel(vocab[0] ?? 'YES') }}>Single sign</button>
          </div>
          {kind === 'phrase' ? (
            <input className="num-input" value={label} onChange={(e) => setLabel(e.target.value.toUpperCase())} list="phrases" aria-label="Phrase" />
          ) : (
            <select className="num-input" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Sign">
              {vocab.map((v) => <option key={v}>{v}</option>)}
            </select>
          )}
          <datalist id="phrases">{PHRASES.map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn btn-blue" disabled={!signer.trim() || armed} onClick={() => { setStatus(''); setArmed(true) }}>
            {armed ? 'Sign now, then lower your hands' : `Record "${label}"`}</button>
          {status && <div className="fine">{status}</div>}
          {Object.keys(counts).length > 0 && (
            <div className="fine">Recorded for {signer || 'this signer'}: {Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(', ')}</div>)}
        </div>
        <div className="cardbox boxpad">
          <div className="label">What the model saw (last phrase)</div>
          <div className="signtags">{heard.length ? heard.map((h, i) => <span key={i}>{h}</span>) : <span>Sign anything to try it.</span>}</div>
        </div>
      </div>
    </div>
  )
}


