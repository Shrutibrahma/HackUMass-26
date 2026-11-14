import { describe, expect, it } from 'vitest'
import { chordAt, cutoffFor, HandVoice, isOpenPalm, laneOf, LANES, OneEuro, pinchAmount, SCALE, type P } from './mapping'

/** A synthetic right hand at (cx, cy). `pinch` 0..1 = thumb-index gap; `open` = fingers extended. */
function hand(cx: number, cy: number, pinch: number, open = true): P[] {
  const h: P[] = Array.from({ length: 21 }, () => [cx, cy] as P)
  const s = 0.1                       // wrist -> middle knuckle
  h[0] = [cx, cy + s]                 // wrist
  h[9] = [cx, cy]                     // middle knuckle
  const fingers = [[5, 6, 7, 8, -0.03], [9, 10, 11, 12, 0], [13, 14, 15, 16, 0.03], [17, 18, 19, 20, 0.06]] as const
  for (const [mcp, pip, dip, tip, dx] of fingers) {
    h[mcp] = [cx + dx, cy]
    h[pip] = [cx + dx, cy - 0.04]
    h[dip] = [cx + dx, open ? cy - 0.07 : cy - 0.02]
    h[tip] = [cx + dx, open ? cy - 0.1 : cy + 0.01]
  }
  if (pinch >= 0.75) {
    h[4] = [h[8][0] - pinch * s, h[8][1]]          // open hand: thumb well away from the index tip
  } else {
    // pinching: thumb tip and index tip separated by `pinch` hand-sizes, centered on (cx, cy - 0.05)
    h[4] = [cx - (pinch * s) / 2, cy - 0.05]
    h[8] = [cx + (pinch * s) / 2, cy - 0.05]
  }
  return h
}

describe('gesture mapping', () => {
  it('measures pinch and open palm independent of position', () => {
    expect(pinchAmount(hand(0.3, 0.4, 0.1))).toBeCloseTo(0.1, 1)
    expect(pinchAmount(hand(0.8, 0.7, 1.0))).toBeCloseTo(1.0, 1)
    expect(isOpenPalm(hand(0.5, 0.5, 1.0, true))).toBe(true)
    expect(isOpenPalm(hand(0.5, 0.5, 1.0, false))).toBe(false)   // fist
    expect(isOpenPalm(hand(0.5, 0.5, 0.1, true))).toBe(false)    // pinching
  })

  it('snaps position to scale lanes with hysteresis', () => {
    expect(laneOf(0, null)).toBe(0)
    expect(laneOf(0.999, null)).toBe(LANES - 1)
    const edge = 3 / LANES
    expect(laneOf(edge + 0.002, 2)).toBe(2)     // barely over the edge: stay
    expect(laneOf(edge + 0.03, 2)).toBe(3)      // clearly over: move
    expect(chordAt(0)).toEqual([SCALE[0], SCALE[2], SCALE[4]])
    expect(chordAt(LANES - 1).every((n) => SCALE.includes(n))).toBe(true)
  })

  it('plays one note per pinch and none from jitter around the threshold', () => {
    const v = new HandVoice(false)
    const ev: string[] = []
    let t = 0
    const feed = (h: P[] | null) => { t += 33; for (const e of v.update(h, t)) if (e.type !== 'move') ev.push(e.type) }
    for (let i = 0; i < 5; i++) feed(hand(0.5, 0.5, 1.0, false))         // fist-ish, apart: nothing
    for (let i = 0; i < 5; i++) feed(hand(0.5, 0.5, 0.2, false))         // pinch
    for (const p of [0.45, 0.5, 0.42, 0.55, 0.4]) feed(hand(0.5, 0.5, p, false))   // jitter inside the hysteresis band
    feed(hand(0.5, 0.5, 0.9, false))                                     // release
    expect(ev).toEqual(['noteOn', 'noteOff'])
  })

  it('slides to a new note when a pinched hand moves across lanes, and stops when the hand leaves', () => {
    const v = new HandVoice(false)
    const notes: string[] = []
    let t = 0
    let off = 0
    const feed = (h: P[] | null) => { t += 33; for (const e of v.update(h, t)) { if (e.type === 'noteOn') notes.push(e.note); if (e.type === 'noteOff') off++ } }
    for (let i = 0; i < 40; i++) feed(hand(0.1 + i * 0.02, 0.5, 0.2, false))
    feed(null)
    expect(notes.length).toBeGreaterThan(3)
    expect(new Set(notes).size).toBe(notes.length)          // each lane once, in order
    expect(notes).toEqual([...notes].sort((a, b) => SCALE.indexOf(a) - SCALE.indexOf(b)))
    expect(off).toBe(1)
  })

  it('needs an open palm held briefly for a chord (a passing hand does not trigger it)', () => {
    const v = new HandVoice(false)
    let t = 0
    const run = (frames: number) => { let on = 0; for (let i = 0; i < frames; i++) { t += 33; for (const e of v.update(hand(0.5, 0.5, 1.0, true), t)) if (e.type === 'chordOn') on++ } return on }
    expect(run(3)).toBe(0)       // ~100 ms: too short
    v.update(null, (t += 33))
    expect(run(12)).toBe(1)      // ~400 ms: one chord, not one per frame
  })

  it('One Euro filter calms jitter but still follows real movement', () => {
    const f = new OneEuro()
    let t = 0
    let out = 0
    const noisy = Array.from({ length: 60 }, (_, i) => 0.5 + (i % 2 ? 0.01 : -0.01))
    const outs = noisy.map((v) => (out = f.filter(v, (t += 16))))
    const spread = Math.max(...outs.slice(20)) - Math.min(...outs.slice(20))
    expect(spread).toBeLessThan(0.012)
    for (let i = 0; i < 30; i++) out = f.filter(0.9, (t += 16))
    expect(out).toBeGreaterThan(0.85)
  })

  it('maps height to brightness', () => {
    expect(cutoffFor(0)).toBeGreaterThan(cutoffFor(1) * 10)
  })
})


