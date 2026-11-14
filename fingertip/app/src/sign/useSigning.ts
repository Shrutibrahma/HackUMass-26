import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { load } from '../storage'
import { watch } from './camera'
import { SignPipeline, wireFrames, type Hand } from './pipeline'

export const getHand = (): Hand => load<Hand>('hand', 'right')

type Opts = {
  /** Live call: the caller's named options boost those signs. */
  sid?: string
  /** Signs so far (draft can be written before the signer taps Send). */
  onSigns?: (signs: string[]) => void
  /** Hands dropped: the phrase is done. */
  onPhrase?: (signs: string[]) => void
  enabled?: boolean
}

/**
 * Camera frames -> MediaPipe Holistic (in the browser) -> one sign per pause -> server classifier.
 * Only landmarks leave the phone. Returns what the UI needs; no numbers, no skeletons.
 */
export function useSigning({ sid, onSigns, onPhrase, enabled = true }: Opts) {
  const [signs, setSigns] = useState<string[] | null>(null)       // non-null while signing
  const [unsure, setUnsure] = useState<string[] | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const pipe = useRef<SignPipeline | null>(null)
  const cb = useRef({ onSigns, onPhrase })
  cb.current = { onSigns, onPhrase }

  useEffect(() => {
    if (!enabled || !video) return
    const hand = getHand()
    const p = new SignPipeline(
      (frames) => post('/api/signs/classify', { frames: wireFrames(frames), hand, sid }),
      {
        onSigningStart: () => setSigns([]),
        onSigns: (s) => { setSigns(s); if (s.length) cb.current.onSigns?.(s) },
        onUnsure: (opts) => setUnsure(opts),
        onPhraseEnd: (s) => { setSigns(null); setUnsure(null); cb.current.onPhrase?.(s) },
      },
    )
    pipe.current = p
    const stop = watch(video, (f) => p.push(f))
    return () => { stop(); pipe.current = null }
  }, [enabled, video, sid])

  const pick = useCallback((o: string) => { setUnsure(null); pipe.current?.pick(o) }, [])
  const again = useCallback(() => { setUnsure(null); setSigns(null); pipe.current?.clear() }, [])
  return { signs, unsure, pick, again, onVideo: setVideo }
}

/** "TWELVE" -> "Twelve", "THANK-YOU" -> "Thank you" (for the unsure-sign buttons). */
export const pretty = (g: string) => (g.charAt(0) + g.slice(1).toLowerCase()).replace(/-/g, ' ')


