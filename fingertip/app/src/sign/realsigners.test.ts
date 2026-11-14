/**
 * Real signers (ASL Citizen poses, exported by the bench) through the app's own segmenter and
 * pipeline, classified by the running server. Skipped unless PHRASES and SERVER are available.
 *   PHRASES=/path/phrases.json SERVER=http://localhost:8000 npx vitest run src/sign/realsigners.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SignPipeline, wireFrames } from './pipeline'
import type { Frame } from './segmenter'

const PHRASES = process.env.PHRASES ?? '/tmp/claude-0/phrases.json'
const SERVER = process.env.SERVER ?? 'http://localhost:8000'
const STEP = Number(process.env.STEP ?? '1')   // 2 = 15 fps, 3 = 10 fps: a slower phone
type Clip = { gloss: string; fps: number; frames: Omit<Frame, 't'>[] }

describe.skipIf(!existsSync(PHRASES))('real signers through the pipeline', () => {
  it('recognizes demo phrases', async () => {
    const phrases: Clip[][] = JSON.parse(readFileSync(PHRASES, 'utf8'))
    const rows: string[] = []
    let clipsOk = 0
    let clips = 0
    let phrasesOk = 0
    let segments = 0
    for (const ph of phrases) {
      const got: string[] = []
      const pipe = new SignPipeline(async (frames) => {
        segments++
        const r = await fetch(`${SERVER}/api/signs/classify`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames: wireFrames(frames), hand: 'auto' }),
        })
        return r.json()
      }, {
        onSigns: () => {},
        // In this offline test nobody taps: an unsure sign counts as its first option.
        onUnsure: (opts) => { pipe.pick(opts[0]) },
        onPhraseEnd: (s) => { got.push(...s) },
      })
      let t = 0
      for (const c of ph) c.frames.forEach((f, i) => { t += 1000 / c.fps; if (i % STEP === 0) pipe.push({ ...f, t }) })
      for (let k = 0; k < 30; k++) { t += 33.3; pipe.push({ pose: null, lh: null, rh: null, t }) }   // hands down at the end
      await pipe.drain()
      const want = ph.map((c) => c.gloss)
      const ok = got.join(' ') === want.join(' ')
      phrasesOk += ok ? 1 : 0
      want.forEach((w, i) => { clips++; if (got[i] === w) clipsOk++ })
      rows.push(`| ${want.join(' ')} | ${got.join(' ') || '(nothing)'} | ${ok ? 'yes' : 'no'} |`)
    }
    const md = [
      '# Real signers through the app pipeline', '',
      `ASL Citizen clips (MediaPipe Holistic) streamed at ${Math.round(30 / STEP)} fps through \`SignPipeline\` ->`,
      '`Segmenter` -> `POST /api/signs/classify` (hand: auto). Unsure signs count as their first option (no tap).',
      'These signers may be in the model\'s training data: this checks segmentation and the pipeline, not held-out accuracy.', '',
      `- Signs in the right place: **${clipsOk}/${clips}**`,
      `- Whole phrases exactly right: **${phrasesOk}/${phrases.length}**`,
      `- Segments sent to the server: ${segments} for ${clips} signs`, '',
      '| Signed | Recognized | Exact |', '|---|---|---|', ...rows, ''].join('\n')
    if (STEP === 1) writeFileSync(new URL('../../../eval/pipeline_check.md', import.meta.url), md)
    console.log(md)
    expect(clipsOk / clips).toBeGreaterThan(0.6)
  }, 120000)
})


