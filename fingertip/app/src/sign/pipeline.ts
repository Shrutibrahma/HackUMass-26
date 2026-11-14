/**
 * Frames -> one-sign segments -> server classifier -> phrase of signs.
 * Camera-independent, so real recorded landmarks can be pushed through exactly this code.
 * Only landmarks (x, y) leave the device; never video.
 */
import { Segmenter, type Frame, type SegParams } from './segmenter'

export type Hand = 'right' | 'left' | 'auto'
export type Classified = { ok: boolean; sign?: string; unsure?: boolean; options?: string[]; reason?: string }
export type Classify = (frames: Frame[]) => Promise<Classified>

export type PipelineEvents = {
  /** Signs so far in this phrase (sure ones; an unsure one waits for a pick). */
  onSigns: (signs: string[]) => void
  /** One sign was unsure: offer these two. Nothing is said until the signer picks. */
  onUnsure: (options: string[]) => void
  /** Hands dropped: the phrase is done. */
  onPhraseEnd: (signs: string[]) => void
  onSigningStart?: () => void
}

const round = (pts: [number, number][] | null) => (pts ? pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) : null)

export function wireFrames(frames: Frame[]) {
  return frames.map((f) => ({ pose: round(f.pose), lh: round(f.lh), rh: round(f.rh) }))
}

export class SignPipeline {
  private seg: Segmenter
  private signs: string[] = []
  private pending: Promise<void> = Promise.resolve()
  private unsureAt = -1
  private ended = false
  private ev: PipelineEvents
  private classify: Classify

  constructor(classify: Classify, ev: PipelineEvents, params: Partial<SegParams> = {}) {
    this.classify = classify
    this.ev = ev
    this.seg = new Segmenter({
      // A new phrase resets in the same queue as the classifications, so a slow answer from the
      // previous phrase can never land in this one.
      onStart: () => {
        ev.onSigningStart?.()
        this.pending = this.pending.then(() => { this.signs = []; this.unsureAt = -1; this.ended = false })
      },
      onSegment: (frames) => this.queue(frames),
      onPhraseEnd: () => { this.pending = this.pending.then(() => this.finish()) },
    }, params)
  }

  push(f: Frame): void {
    this.seg.push(f)
  }

  /** Signer picked one of the unsure options. */
  pick(option: string): void {
    if (this.unsureAt < 0) return
    this.signs.splice(this.unsureAt, 0, option)
    this.unsureAt = -1
    this.ev.onSigns([...this.signs])
    if (this.ended) this.ev.onPhraseEnd([...this.signs])
  }

  /** "Sign again": drop this phrase. */
  clear(): void {
    this.signs = []
    this.unsureAt = -1
    this.seg.reset()
    this.ev.onSigns([])
  }

  /** Wait for in-flight classifications (tests). */
  drain(): Promise<void> {
    return this.pending
  }

  private queue(frames: Frame[]): void {
    // Keep phrase order even when the network is uneven.
    this.pending = this.pending.then(async () => {
      let r: Classified
      try {
        r = await this.classify(frames)
      } catch {
        return
      }
      if (!r.ok || !r.sign) return
      if (r.unsure && r.options && r.options.length > 1 && this.unsureAt < 0) {
        this.unsureAt = this.signs.length
        this.ev.onUnsure(r.options)
        return
      }
      if (this.signs[this.signs.length - 1] === r.sign && this.unsureAt < 0) return   // one sign split in two
      this.signs.push(r.sign)
      this.ev.onSigns([...this.signs])
    })
  }

  private finish(): void {
    this.ended = true
    if (this.unsureAt >= 0) return          // waits for the pick
    if (this.signs.length) this.ev.onPhraseEnd([...this.signs])
  }
}


