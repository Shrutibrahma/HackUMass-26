/**
 * Living Aurora: the Gesture Synth's visual world. Pure drawing, no audio, no React.
 *
 * Music you can see: every note is light, shape and motion, so it works with the sound off.
 * - Pitch -> colour AND shape: low notes are violet/blue, round and slow; middle notes cyan/teal;
 *   high notes coral/pink/gold, smaller and sharper. Colour is never the only signal.
 * - Note onset -> an expanding pulse plus a burst of particles. Chord -> a layered bloom.
 * - A held note -> the hand's trail thickens into a flowing ribbon.
 * - Loudness (measured from the real audio, before the mute) -> how bright and alive the sky is.
 * - Silence -> the aurora slows to a calm breathing state.
 */
import { LANES } from './mapping'

// Colour stops low -> high (hue, saturation, lightness).
const STOPS: [number, number, number][] = [
  [268, 70, 58], [235, 80, 62], [200, 85, 58], [178, 75, 52], [165, 70, 55],
  [350, 85, 66], [330, 80, 68], [18, 90, 64], [42, 95, 60],
]

/** Lane (0 = lowest) -> [h, s, l], interpolated along the stops. */
export function laneColor(lane: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, lane / (LANES - 1))) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(t))
  const k = t - i
  const [h1, s1, l1] = STOPS[i]
  const [h2, s2, l2] = STOPS[i + 1]
  let dh = h2 - h1
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return [(h1 + dh * k + 360) % 360, s1 + (s2 - s1) * k, l1 + (l2 - l1) * k]
}
const hsla = ([h, s, l]: [number, number, number], a: number, dl = 0) => `hsla(${h.toFixed(0)},${s.toFixed(0)}%,${Math.min(95, l + dl).toFixed(0)}%,${Math.max(0, Math.min(1, a)).toFixed(3)})`

type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; lane: number; size: number; sides: number; spin: number }
type Pulse = { x: number; y: number; born: number; lane: number; big: boolean; lanes: number[] }
type Trail = { pts: { x: number; y: number; t: number }[]; lane: number; held: boolean; seen: number }

export class Aurora {
  private particles: Particle[] = []
  private pulses: Pulse[] = []
  private trails: Trail[] = [0, 1, 2].map(() => ({ pts: [], lane: 5, held: false, seen: 0 }))
  private recent: number[] = [3, 6, 9]      // lanes of recent notes: they tint the sky
  private lastNote = -1e9
  private energy = 0

  noteOn(x: number, y: number, lane: number, now: number) {
    this.pulses.push({ x, y, born: now, lane, big: false, lanes: [lane] })
    this.burst(x, y, lane, now, 14)
    this.tint(lane, now)
  }

  chordOn(x: number, y: number, lane: number, lanes: number[], now: number) {
    this.pulses.push({ x, y, born: now, lane, big: true, lanes })
    for (const l of lanes) this.burst(x, y, l, now, 10)
    this.tint(lane, now)
  }

  hand(i: number, x: number, y: number, lane: number, held: boolean, now: number) {
    const tr = this.trails[i]
    tr.pts.push({ x, y, t: now })
    if (tr.pts.length > 48) tr.pts.shift()
    tr.lane = lane
    tr.held = held
    tr.seen = now
  }

  private tint(lane: number, now: number) {
    this.recent = [...this.recent.slice(-2), lane]
    this.lastNote = now
  }

  private burst(x: number, y: number, lane: number, now: number, n: number) {
    const hi = lane / (LANES - 1)                 // 0 low .. 1 high
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
      const sp = (0.06 + Math.random() * 0.12) * (0.6 + hi * 0.9)   // high notes fly faster
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, life: 1400 - hi * 500 + Math.random() * 300, lane,
        size: 9 - hi * 5 + Math.random() * 2, sides: hi < 0.34 ? 0 : hi < 0.67 ? 6 : 4, spin: (Math.random() - 0.5) * 0.01,
      })
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600)
  }

  /** level: 0..1 measured loudness of the real audio (before the mute). */
  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number, level: number) {
    this.energy += (Math.max(level, this.pulses.some((p) => now - p.born < 300) ? 0.6 : 0) - this.energy) * 0.08
    const idle = now - this.lastNote > 3500
    const e = this.energy

    // night sky
    const bg = g.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#05060f')
    bg.addColorStop(1, '#0b0a1f')
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)

    // aurora bands, tinted by the last notes; slower and dimmer when idle
    g.globalCompositeOperation = 'lighter'
    const speed = idle ? 0.00006 : 0.00018 + e * 0.0003
    for (let b = 0; b < 3; b++) {
      const col = laneColor(this.recent[b % this.recent.length])
      const base = h * (0.28 + b * 0.17)
      const amp = h * (0.05 + 0.06 * e)
      const breathe = idle ? 0.5 + 0.5 * Math.sin(now * 0.0012 + b) : 1
      const grad = g.createLinearGradient(0, base - amp * 3, 0, base + h * 0.25)
      grad.addColorStop(0, hsla(col, 0))
      grad.addColorStop(0.35, hsla(col, (0.10 + 0.22 * e) * breathe))
      grad.addColorStop(1, hsla(col, 0))
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += 12) {
        const y = base + Math.sin(x * 0.006 + now * speed * (b + 1) * 6 + b * 2) * amp
          + Math.sin(x * 0.017 - now * speed * 9 + b) * amp * 0.35
        g.lineTo(x, y)
      }
      g.lineTo(w, h)
      g.closePath()
      g.fill()
    }

    // a soft rainbow floor: where the notes are, low (left) to high (right). No labels, no numbers.
    for (let i = 0; i < LANES; i++) {
      const col = laneColor(i)
      const fl = g.createLinearGradient(0, h, 0, h - 70)
      fl.addColorStop(0, hsla(col, 0.22 + e * 0.2))
      fl.addColorStop(1, hsla(col, 0))
      g.fillStyle = fl
      g.fillRect((i * w) / LANES, h - 70, w / LANES + 1, 70)
    }

    // hand ribbons: a held note becomes a thick flowing ribbon
    for (const tr of this.trails) {
      if (now - tr.seen > 500 || tr.pts.length < 2) { if (now - tr.seen > 500) tr.pts.length = 0; continue }
      const col = laneColor(tr.lane)
      for (let i = 1; i < tr.pts.length; i++) {
        const a = tr.pts[i - 1]
        const p = tr.pts[i]
        const k = i / tr.pts.length
        g.strokeStyle = hsla(col, k * (tr.held ? 0.85 : 0.35), 10)
        g.lineWidth = (tr.held ? 18 : 5) * k + 1 + e * 10 * k
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(a.x * w, a.y * h)
        g.lineTo(p.x * w, p.y * h)
        g.stroke()
      }
      const head = tr.pts[tr.pts.length - 1]
      const r = tr.held ? 22 : 14
      const glow = g.createRadialGradient(head.x * w, head.y * h, 0, head.x * w, head.y * h, r * 3)
      glow.addColorStop(0, hsla(col, 0.9, 20))
      glow.addColorStop(1, hsla(col, 0))
      g.fillStyle = glow
      g.beginPath()
      g.arc(head.x * w, head.y * h, r * 3, 0, Math.PI * 2)
      g.fill()
    }

    // pulses (note) and blooms (chord)
    this.pulses = this.pulses.filter((p) => now - p.born < (p.big ? 2200 : 1500))
    for (const p of this.pulses) {
      const life = p.big ? 2200 : 1500
      const k = (now - p.born) / life
      const ease = 1 - Math.pow(1 - k, 3)
      const layers = p.big ? p.lanes : [p.lane]
      layers.forEach((l, j) => {
        const col = laneColor(l)
        const r = (p.big ? 70 + j * 40 : 30) + ease * (p.big ? 260 : 170) * (1 - (l / LANES) * 0.35)
        g.strokeStyle = hsla(col, (1 - k) * 0.9, 12)
        g.lineWidth = (p.big ? 14 : 8) * (1 - k) + 1
        g.beginPath()
        if (p.big) {      // bloom: a soft flower, one petal ring per chord note
          const petals = 5 + j
          for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
            const rr = r * (0.82 + 0.18 * Math.cos(a * petals + j))
            const x = p.x * w + Math.cos(a) * rr
            const y = p.y * h + Math.sin(a) * rr
            if (a === 0) g.moveTo(x, y); else g.lineTo(x, y)
          }
        } else {
          g.arc(p.x * w, p.y * h, r, 0, Math.PI * 2)
        }
        g.stroke()
      })
      const col = laneColor(p.lane)
      const core = g.createRadialGradient(p.x * w, p.y * h, 0, p.x * w, p.y * h, (p.big ? 90 : 45) * (1 - k) + 1)
      core.addColorStop(0, hsla(col, 0.95 * (1 - k), 25))
      core.addColorStop(1, hsla(col, 0))
      g.fillStyle = core
      g.beginPath()
      g.arc(p.x * w, p.y * h, (p.big ? 90 : 45) * (1 - k) + 1, 0, Math.PI * 2)
      g.fill()
    }

    // particles: round (low), hexagons (middle), sharp diamonds (high)
    this.particles = this.particles.filter((q) => now - q.born < q.life)
    for (const q of this.particles) {
      const age = now - q.born
      const k = age / q.life
      const x = (q.x + q.vx * age / 1000 * 2.2) * w
      const y = (q.y + q.vy * age / 1000 * 2.2 - 0.02 * (age / 1000) ** 2) * h
      const s = q.size * (1 - k * 0.6)
      g.fillStyle = hsla(laneColor(q.lane), (1 - k) * 0.9, 15)
      g.beginPath()
      if (q.sides === 0) g.arc(x, y, s, 0, Math.PI * 2)
      else {
        const rot = q.spin * age
        for (let i = 0; i < q.sides; i++) {
          const a = rot + (i / q.sides) * Math.PI * 2
          const rr = q.sides === 4 && i % 2 ? s * 0.45 : s
          if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
          else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
        }
        g.closePath()
      }
      g.fill()
    }
    g.globalCompositeOperation = 'source-over'
  }
}


