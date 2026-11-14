/**
 * Gesture Synth (Playground). A separate mode: it never runs during a call and can't send speech.
 *
 * Music you can see and feel as well as hear (Living Aurora, synth/aurora.ts): every note is light,
 * shape and a pulse of vibration, so it's playable with the sound off. Pinch to play, move sideways
 * through the notes, raise your hand for a brighter sound, hold an open palm for a chord.
 * No camera? Touch or click the stage: same instrument.
 */
import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { watch } from '../sign/camera'
import type { Frame } from '../sign/segmenter'
import { Aurora } from '../synth/aurora'
import { cutoffFor, HandVoice, laneOf, SCALE, type HandEvent } from '../synth/mapping'

function makeEngine() {
  // Everything goes through `master`; the meter reads it BEFORE the mute, so the light still
  // follows the music when the sound is off.
  const master = new Tone.Gain(1).toDestination()
  const meter = new Tone.Meter({ smoothing: 0.85 })
  master.connect(meter)
  const reverb = new Tone.Reverb({ decay: 2.8, wet: 0.28 }).connect(master)
  const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.25, wet: 0.18 }).connect(reverb)
  const voice = () => {
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 1800, Q: 1 }).connect(delay)
    const synth = new Tone.Synth({
      oscillator: { type: 'fattriangle', count: 3, spread: 18 } as any,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.55, release: 0.5 },
    }).connect(filter)
    synth.volume.value = -8
    return { synth, filter }
  }
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' }, envelope: { attack: 0.25, decay: 0.3, sustain: 0.7, release: 1.4 },
  }).connect(reverb)
  pad.volume.value = -14
  return {
    voices: [voice(), voice(), voice()], pad, meter,
    /** 0..1 loudness of what is actually playing. */
    level: () => { const db = meter.getValue() as number; return Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 48) / 40)) : 0 },
    dispose: () => { reverb.dispose(); delay.dispose(); pad.dispose(); meter.dispose(); master.dispose() },
  }
}

export function Playground({ onBack }: { onBack: () => void }) {
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(false)
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied'>('off')
  const [fps, setFps] = useState(0)
  const [count, setCount] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const engine = useRef<ReturnType<typeof makeEngine> | null>(null)
  const sky = useRef(new Aurora())
  const lanes = useRef<number[]>([5, 5, 5])
  const chords = useRef<Record<number, string[]>>({})

  // ---- one place where gestures become sound, light and vibration
  const handle = (i: number, events: HandEvent[]) => {
    const e = engine.current
    if (!e) return
    const v = e.voices[i]
    const now = performance.now()
    for (const ev of events) {
      if (ev.type === 'noteOn') {
        v.synth.triggerAttack(ev.note)
        lanes.current[i] = ev.lane
        sky.current.noteOn(ev.x, ev.y, ev.lane, now)
        try { navigator.vibrate?.(22) } catch { /* not supported */ }
        setCount((c) => c + 1)
      } else if (ev.type === 'noteOff') {
        v.synth.triggerRelease()
      } else if (ev.type === 'chordOn') {
        chords.current[i] = ev.notes
        e.pad.triggerAttack(ev.notes)
        sky.current.chordOn(ev.x, ev.y, ev.lane, ev.notes.map((n) => SCALE.indexOf(n)), now)
        try { navigator.vibrate?.([40, 30, 40]) } catch { /* not supported */ }
        setCount((c) => c + 1)
      } else if (ev.type === 'chordOff') {
        if (chords.current[i]) e.pad.triggerRelease(chords.current[i])
        delete chords.current[i]
      } else {
        v.filter.frequency.rampTo(cutoffFor(ev.y), 0.05)
        const lane = ev.pinched ? lanes.current[i] : laneOf(ev.x, null)
        sky.current.hand(i, ev.x, ev.y, lane, ev.pinched || ev.palm, now)
      }
    }
  }

  async function start(withCamera: boolean) {
    await Tone.start()
    engine.current = makeEngine()
    setStarted(true)
    if (!withCamera) return
    setCamera('starting')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
      setCamera('on')
    } catch {
      setCamera('denied')
    }
  }

  // ---- camera hands
  useEffect(() => {
    if (camera !== 'on' || !video.current) return
    const hands = [new HandVoice(true), new HandVoice(true)]
    const stop = watch(video.current, (f: Frame) => {
      handle(0, hands[0].update(f.rh, f.t))
      handle(1, hands[1].update(f.lh, f.t))
    }, (a) => setFps(a), 'hands')
    const v = video.current
    return () => {
      stop()
      ;(v.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])

  // ---- touch / mouse: the same instrument without a camera
  const pointer = useRef<{ lane: number | null }>({ lane: null })
  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const pointerPlay = (e: React.PointerEvent, down: boolean) => {
    if (!started) return
    const { x, y } = at(e)
    const lane = laneOf(x, down ? null : pointer.current.lane)
    const evs: HandEvent[] = []
    if (down || lane !== pointer.current.lane) evs.push({ type: 'noteOn', note: SCALE[lane], lane, x, y })
    evs.push({ type: 'move', x, y, pinched: true, palm: false })
    pointer.current.lane = lane
    handle(2, evs)
  }

  // ---- drawing
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')!
    let raf = 0
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      try {
        sky.current.draw(g, w, h, performance.now(), engine.current?.level() ?? 0)
      } catch (err) {
        console.warn('aurora frame failed', err)      // a visual glitch must never stop the music
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => { Tone.getDestination().mute = muted }, [muted])
  useEffect(() => () => { engine.current?.voices.forEach((v) => { v.synth.dispose(); v.filter.dispose() }); engine.current?.dispose() }, [])

  const hint = camera === 'on'
    ? (fps ? 'Pinch to play. Move sideways for notes, up for brightness. Hold an open palm for a chord.' : 'Finding your hands...')
    : camera === 'denied' ? 'No camera, no problem: touch or click anywhere to play.'
    : 'Touch or click anywhere to play. Drag to slide through the scale.'

  return (
    <div className="pg" data-notes={count} data-fps={fps.toFixed(1)}>
      <video ref={video} className="pg-video" playsInline muted style={{ opacity: camera === 'on' ? 0.28 : 0 }} />
      <canvas ref={canvas} className="pg-canvas" aria-label="Gesture Synth stage: touch or use your hands to play"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pointerPlay(e, true) }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') pointerPlay(e, false) }}
        onPointerUp={() => { pointer.current.lane = null; handle(2, [{ type: 'noteOff' }]) }}
        onPointerCancel={() => { pointer.current.lane = null; handle(2, [{ type: 'noteOff' }]) }} />
      <div className="pg-top">
        <button className="pg-btn" onClick={onBack}>Back</button>
        <b className="pg-title">Gesture Synth</b>
        <button className="pg-btn" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'Sound off' : 'Sound on'}</button>
      </div>
      {started && <div className="pg-hint" aria-live="polite">{muted ? 'Sound is off. You can still see and feel every note. ' : ''}{hint}</div>}
      {!started && (
        <div className="pg-start">
          <h1>Play music with your hands</h1>
          <p>Every note is a colour you can see and a pulse you can feel. It can't sound wrong.</p>
          <button className="btn btn-blue" onClick={() => start(true)}>Start with camera</button>
          <button className="btn pg-ghost" onClick={() => start(false)}>Play by touch</button>
        </div>
      )}
    </div>
  )
}


