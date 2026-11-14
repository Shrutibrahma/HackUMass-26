/**
 * One sign per segment. The signer makes a short pause between signs; dropping the hands ends the phrase.
 *
 * The model (SignBart, trained on ASL Citizen clips) expects a little lead-in and follow-through
 * around each sign: trimming clips to the motion alone cut accuracy from 64% to 47% on real signers.
 * So every segment keeps ~0.33 s before the motion starts and the still frames that end it.
 *
 * Motion = mean movement of all visible hand points (fingers included, so a held number sign whose
 * handshape changes still counts), in shoulder widths per second.
 */
export type P = [number, number]
export type Frame = { t: number; pose: P[] | null; lh: P[] | null; rh: P[] | null }

export type SegParams = {
  vMove: number      // speed that counts as signing
  vStill: number     // below this, the hands are still
  stillMs: number    // pause between signs
  minSignMs: number
  staticSignMs: number // a held sign (no big motion) counts after this long
  maxSignMs: number
  preMs: number      // lead-in kept before a sign
  restMs: number     // hands down this long = phrase done
  longStillMs: number // hands up but still this long = phrase done
}

export const DEFAULTS: SegParams = {
  vMove: 0.8, vStill: 0.35, stillMs: 220, minSignMs: 250, staticSignMs: 650, maxSignMs: 3000,
  preMs: 330, restMs: 500, longStillMs: 1600,
}

type Events = {
  onStart?: () => void
  onSegment: (frames: Frame[]) => void
  onPhraseEnd: () => void
}

function shoulderWidth(f: Frame): number {
  const p = f.pose
  if (p && p[11] && p[12]) {
    const d = Math.hypot(p[11][0] - p[12][0], p[11][1] - p[12][1])
    if (d > 0.02) return d
  }
  return 0.25
}

function restLine(f: Frame): number {
  const p = f.pose
  if (p && p[11] && p[12]) return (p[11][1] + p[12][1]) / 2 + 1.2 * shoulderWidth(f)
  return 0.92
}

export function handsUp(f: Frame): boolean {
  const line = restLine(f)
  return [f.lh, f.rh].some((h) => !!h && h[0][1] < line)
}

function motion(a: Frame, b: Frame): number {
  const dt = (b.t - a.t) / 1000
  if (dt <= 0) return 0
  let sum = 0
  let n = 0
  for (const k of ['lh', 'rh'] as const) {
    const ha = a[k]
    const hb = b[k]
    if (!ha || !hb) continue
    for (let i = 0; i < hb.length; i++) {
      sum += Math.hypot(hb[i][0] - ha[i][0], hb[i][1] - ha[i][1])
      n++
    }
  }
  if (!n) return 0
  return sum / n / dt / shoulderWidth(b)
}

type Mode = 'idle' | 'sign' | 'hold'

export class Segmenter {
  private p: SegParams
  private ev: Events
  private buf: Frame[] = []      // recent frames for lead-in
  private seg: Frame[] = []
  private mode: Mode = 'idle'
  private speed = 0
  private peak = 0
  private stillSince = -1
  private downSince = -1
  private segStart = 0
  private signsInPhrase = 0

  constructor(ev: Events, p: Partial<SegParams> = {}) {
    this.ev = ev
    this.p = { ...DEFAULTS, ...p }
  }

  get signing(): boolean {
    return this.mode !== 'idle'
  }

  reset(): void {
    this.buf = []
    this.seg = []
    this.mode = 'idle'
    this.signsInPhrase = 0
    this.stillSince = this.downSince = -1
  }

  push(f: Frame): void {
    const prev = this.buf[this.buf.length - 1]
    const v = prev ? motion(prev, f) : 0
    this.speed = prev ? 0.5 * this.speed + 0.5 * v : 0
    this.buf.push(f)
    while (this.buf.length && f.t - this.buf[0].t > this.p.preMs + 50) this.buf.shift()

    const up = handsUp(f)
    if (!up) {
      if (this.downSince < 0) this.downSince = f.t
    } else {
      this.downSince = -1
    }
    const down = this.downSince >= 0 && f.t - this.downSince >= this.p.restMs

    if (this.speed < this.p.vStill) {
      if (this.stillSince < 0) this.stillSince = f.t
    } else {
      this.stillSince = -1
    }
    const stillFor = this.stillSince >= 0 ? f.t - this.stillSince : 0

    switch (this.mode) {
      case 'idle':
        if (up) this.begin(f)
        break
      case 'sign': {
        this.seg.push(f)
        this.peak = Math.max(this.peak, this.speed)
        const dur = f.t - this.segStart
        const moved = this.peak >= this.p.vMove
        const paused = stillFor >= this.p.stillMs && dur >= this.p.minSignMs && (moved || dur >= this.p.staticSignMs)
        if (paused || dur >= this.p.maxSignMs) {
          this.emit()
          this.mode = 'hold'
        } else if (down) {
          if (dur >= this.p.minSignMs && (moved || dur >= this.p.staticSignMs)) this.emit()
          this.endPhrase()
        }
        break
      }
      case 'hold':
        if (down || stillFor >= this.p.longStillMs) this.endPhrase()
        else if (up && this.speed >= this.p.vMove) this.begin(f)
        break
    }
  }

  private begin(f: Frame): void {
    if (this.mode === 'idle') this.ev.onStart?.()
    this.mode = 'sign'
    this.seg = this.buf.slice(0, -1).concat(f)       // lead-in + this frame
    this.segStart = this.seg[0].t
    this.peak = this.speed
  }

  private emit(): void {
    this.signsInPhrase++
    this.ev.onSegment(this.seg)
    this.seg = []
  }

  private endPhrase(): void {
    const had = this.signsInPhrase > 0
    this.reset()
    if (had) this.ev.onPhraseEnd()
  }
}


