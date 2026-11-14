/**
 * Landmarks from the self-view camera, computed in a Web Worker (tracker.worker.ts) so the call
 * UI never waits on MediaPipe. WASM and models are served by our own app (no CDN).
 *
 * Two trackers produce the same Frame (x, y only):
 * - "holistic" (default): Holistic Landmarker, the layout the sign models were trained on.
 * - "lite" (?tracker=lite): Pose Landmarker lite + Hand Landmarker, no face mesh; each hand is
 *   assigned to the nearer pose wrist, which is how Holistic decides left vs right.
 * Headless test (4-core CPU, no GPU, no person in view): holistic 339 ms, lite 537 ms per frame.
 * Measure on the phone in the Signs lab. If the worker is busy, new frames are dropped, not queued:
 * the sign model holds up well at low frame rates (95% at 10 fps on real signers).
 */
import type { Frame } from './segmenter'

export const trackerName = (): 'lite' | 'holistic' =>
  new URLSearchParams(location.search).get('tracker') === 'lite' ? 'lite' : 'holistic'

type TrackerName = 'lite' | 'holistic' | 'hands'
const workers: Partial<Record<TrackerName, Promise<Worker>>> = {}
const listeners = new Set<(m: any) => void>()

function getWorker(tracker: TrackerName): Promise<Worker> {
  if (!workers[tracker]) {
    const ready: Promise<Worker> = new Promise((resolve, reject) => {
      const w = new Worker(new URL('./tracker.worker.ts', import.meta.url))   // classic: MediaPipe uses importScripts
      w.onmessage = (e) => {
        if (e.data.type === 'ready') resolve(w)
        else if (e.data.type === 'error') reject(new Error(e.data.message))
        else listeners.forEach((l) => l(e.data))
      }
      w.onerror = (e) => reject(e)
      w.postMessage({ type: 'init', tracker, base: location.origin })
    })
    workers[tracker] = ready
    ready.catch(() => { delete workers[tracker] })
  }
  return workers[tracker]!
}

/** Tracks every frame the worker has time for. Returns a stop function. */
export function watch(video: HTMLVideoElement, onFrame: (f: Frame) => void, onFps?: (fps: number, msPerFrame: number) => void,
  tracker: TrackerName = trackerName()): () => void {
  let stop = false
  let busy = false
  let n = 0
  let ms = 0
  let t0 = performance.now()
  const onMsg = (m: any) => {
    if (m.type !== 'frame') return
    busy = false
    if (stop) return
    if (m.frame) onFrame(m.frame)
    n++
    ms += m.ms
    const now = performance.now()
    if (now - t0 > 2000) { onFps?.((n * 1000) / (now - t0), ms / n); n = 0; ms = 0; t0 = now }
  }
  getWorker(tracker).then((w) => {
    listeners.add(onMsg)
    const tick = async () => {
      if (stop) return
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true
        try {
          const bitmap = await createImageBitmap(video)
          w.postMessage({ type: 'frame', bitmap, t: performance.now() }, [bitmap])
        } catch {
          busy = false
        }
      }
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick)
      else requestAnimationFrame(tick)
    }
    tick()
  }).catch((e) => console.warn('[Sign2Speak] sign tracking unavailable; typing still works:', e?.message ?? e))
  return () => { stop = true; listeners.delete(onMsg) }
}


