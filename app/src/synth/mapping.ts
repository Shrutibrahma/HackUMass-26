/**
 * Gesture Synth: hand landmarks -> musical control. Pure logic, no audio, so it can be tested.
 *
 * - Where your hand is, left to right, picks the note. Notes snap to a pentatonic scale, so
 *   every note sounds good with every other one.
 * - Height sets brightness (filter).
 * - Pinch (thumb to index finger) plays a note. Hold and move to slide through the scale.
 * - Open palm, held still for a moment, plays a soft chord.
 * Smoothing (One Euro filter) and hysteresis stop jitter from firing stray notes.
 */
export type P = [number, number]

// Two octaves of C major pentatonic, low to high.
export const SCALE = ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5']
export const LANES = SCALE.length

/** One Euro filter (Casiez et al. 2012): steady when still, quick when moving. */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0
  private minCutoff: number
  private beta: number
  private dCutoff: number
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }
  filter(v: number, tMs: number): number {
    if (this.x === null) { this.x = v; this.t = tMs; return v }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000)
    this.t = tMs
    const dx = (v - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x)
    return this.x
  }
  reset() { this.x = null; this.dx = 0 }
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Hand size: wrist to middle-finger knuckle. Makes every measure distance-independent. */
export const handSize = (h: P[]) => Math.max(1e-4, dist(h[0], h[9]))

/** 0 = fingertips touching, ~1 = wide apart. */
export const pinchAmount = (h: P[]) => dist(h[4], h[8]) / handSize(h)

/** All four fingers extended (tip farther from the wrist than its middle joint) and not pinching. */
export function isOpenPalm(h: P[]): boolean {
  const ext = [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, pip]) => dist(h[tip], h[0]) > dist(h[pip], h[0]) * 1.15)
  return ext && pinchAmount(h) > 0.75
}

/** Lane with hysteresis: you must move 15% past a lane edge to leave it, so notes don't flutter. */
export function laneOf(x: number, prev: number | null): number {
  const pos = Math.min(0.9999, Math.max(0, x)) * LANES
  const raw = Math.floor(pos)
  if (prev === null || raw === prev) return raw
  const edge = raw > prev ? prev + 1 : prev
  return Math.abs(pos - edge) > 0.15 ? raw : prev
}

/** Major-pentatonic triad built on a lane (root, +2 lanes, +4 lanes). */
export const chordAt = (lane: number) => [0, 2, 4].map((k) => SCALE[Math.min(LANES - 1, Math.min(lane, LANES - 5) + k)])

export type HandEvent =
  | { type: 'noteOn'; note: string; lane: number; x: number; y: number }
  | { type: 'noteOff' }
  | { type: 'chordOn'; notes: string[]; lane: number; x: number; y: number }
  | { type: 'chordOff' }
  | { type: 'move'; x: number; y: number; pinched: boolean; palm: boolean }

const PINCH_ON = 0.38
const PINCH_OFF = 0.6
const PALM_HOLD_MS = 220

/** One hand's state machine. Feed it landmarks (or null when the hand is gone); it returns events. */
export class HandVoice {
  private fx = new OneEuro()
  private fy = new OneEuro()
  private pinched = false
  private lane: number | null = null
  private palmSince = -1
  private chord = false
  private mirror: boolean

  constructor(mirror = true) {
    this.mirror = mirror
  }

  update(h: P[] | null, tMs: number): HandEvent[] {
    const out: HandEvent[] = []
    if (!h) {
      if (this.pinched) out.push({ type: 'noteOff' })
      if (this.chord) out.push({ type: 'chordOff' })
      this.pinched = this.chord = false
      this.lane = null
      this.palmSince = -1
      this.fx.reset()
      this.fy.reset()
      return out
    }
    // Control point: between thumb tip and index tip.
    const rawX = (h[4][0] + h[8][0]) / 2
    const x = this.fx.filter(this.mirror ? 1 - rawX : rawX, tMs)
    const y = this.fy.filter((h[4][1] + h[8][1]) / 2, tMs)
    const amt = pinchAmount(h)
    const was = this.pinched
    if (!this.pinched && amt < PINCH_ON) this.pinched = true
    else if (this.pinched && amt > PINCH_OFF) this.pinched = false

    if (this.pinched) {
      const lane = laneOf(x, was ? this.lane : null)
      if (!was || lane !== this.lane) {
        this.lane = lane
        out.push({ type: 'noteOn', note: SCALE[lane], lane, x, y })
      }
    } else if (was) {
      out.push({ type: 'noteOff' })
      this.lane = null
    }

    const palm = !this.pinched && isOpenPalm(h)
    if (palm) {
      if (this.palmSince < 0) this.palmSince = tMs
      if (!this.chord && tMs - this.palmSince >= PALM_HOLD_MS) {
        this.chord = true
        const lane = laneOf(x, null)
        out.push({ type: 'chordOn', notes: chordAt(lane), lane, x, y })
      }
    } else {
      this.palmSince = -1
      if (this.chord) { this.chord = false; out.push({ type: 'chordOff' }) }
    }
    out.push({ type: 'move', x, y, pinched: this.pinched, palm: this.chord })
    return out
  }
}

/** Height (0 top .. 1 bottom) -> filter cutoff in Hz: higher hand = brighter. */
export const cutoffFor = (y: number) => 300 * Math.pow(2, (1 - Math.min(1, Math.max(0, y))) * 4.2)


