import { describe, expect, it } from 'vitest'
import { Segmenter, type Frame, type P } from './segmenter'

// Synthetic signer at 30 fps: shoulders at y=0.45, width 0.25 (rest line ~0.75).
const POSE: P[] = Array.from({ length: 33 }, () => [0.5, 0.5] as P)
POSE[11] = [0.62, 0.45]
POSE[12] = [0.38, 0.45]
const hand = (x: number, y: number, spread = 0): P[] =>
  Array.from({ length: 21 }, (_, i) => [x + (i % 5) * 0.01 * (1 + spread), y - Math.floor(i / 5) * 0.01] as P)

function run(script: [ms: number, fn: (k: number) => P[] | null][]) {
  const segs: Frame[][] = []
  let ends = 0
  let starts = 0
  const s = new Segmenter({ onStart: () => starts++, onSegment: (f) => segs.push(f), onPhraseEnd: () => ends++ })
  let t = 0
  for (const [ms, fn] of script) {
    const n = Math.round(ms / 33.3)
    for (let k = 0; k < n; k++) {
      t += 33.3
      s.push({ t, pose: POSE, rh: fn(k / n), lh: null })
    }
  }
  return { segs, ends, starts }
}

const still = (x: number, y: number) => () => hand(x, y)
const moving = (x0: number, y0: number, dx: number, dy: number) => (u: number) => hand(x0 + dx * u, y0 + dy * u)
const wiggle = (x: number, y: number) => (u: number) => hand(x + 0.06 * Math.sin(u * 12), y + 0.04 * Math.cos(u * 9))

describe('Segmenter', () => {
  it('splits a phrase into one segment per pause and ends it when hands drop', () => {
    const r = run([
      [500, () => null],                         // hands down
      [400, moving(0.5, 0.9, 0, -0.4)],          // raise into signing space
      [500, wiggle(0.5, 0.5)],                   // sign 1 (YES)
      [400, still(0.5, 0.5)],                    // pause
      [500, moving(0.5, 0.5, 0.15, 0.05)],       // sign 2 (SUNDAY)
      [400, still(0.65, 0.55)],                  // pause
      [500, wiggle(0.6, 0.5)],                   // sign 3 (COME)
      [400, still(0.6, 0.5)],
      [700, () => null],                         // hands drop
    ])
    expect(r.starts).toBe(1)
    expect(r.segs.length).toBe(3)
    expect(r.ends).toBe(1)
  })

  it('keeps ~0.33 s of lead-in before a sign', () => {
    const r = run([
      [500, still(0.5, 0.5)],
      [600, wiggle(0.5, 0.5)],
      [400, still(0.5, 0.5)],
      [700, () => null],
    ])
    const first = r.segs[0]
    expect(first.length).toBeGreaterThan(0)
    // the first segment starts while the hand was still raised and not yet moving
    expect(first[first.length - 1].t - first[0].t).toBeGreaterThan(300)
  })

  it('accepts a held sign with little wrist motion (a number)', () => {
    const r = run([
      [400, () => null],
      [250, moving(0.5, 0.9, 0, -0.4)],
      [900, still(0.5, 0.5)],
      [700, () => null],
    ])
    expect(r.segs.length).toBe(1)
    expect(r.ends).toBe(1)
  })

  it('ignores hands that stay down (resting in the lap)', () => {
    const r = run([[2000, still(0.5, 0.95)]])
    expect(r.segs.length).toBe(0)
    expect(r.ends).toBe(0)
  })

  it('ends the phrase after a long still hold even with hands up', () => {
    const r = run([
      [300, wiggle(0.5, 0.5)],
      [400, still(0.5, 0.5)],
      [2000, still(0.5, 0.5)],
    ])
    expect(r.segs.length).toBe(1)
    expect(r.ends).toBe(1)
  })
})


