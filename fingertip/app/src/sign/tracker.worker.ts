/// <reference lib="webworker" />
/**
 * Landmark tracking off the main thread, so captions and buttons never wait on MediaPipe.
 * Receives ImageBitmaps, returns Frames (x, y only). See camera.ts for the two trackers.
 */
import { FilesetResolver, HandLandmarker, HolisticLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'

type LM = { x: number; y: number }
type P = [number, number]
const pts = (l?: LM[]): P[] | null => (l && l.length ? l.map((p) => [p.x, p.y] as P) : null)
const d2 = (a: LM, b: LM) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

let detect: ((img: ImageBitmap, ts: number) => { pose: P[] | null; lh: P[] | null; rh: P[] | null }) | null = null

async function init(tracker: 'holistic' | 'lite' | 'hands', base: string) {
  const files = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`)
  const model = (f: string) => `${base}/models/${f}`
  const withFallback = async <T,>(make: (d: 'GPU' | 'CPU') => Promise<T>) => {
    try { return await make('GPU') } catch { return make('CPU') }
  }
  if (tracker === 'hands') {
    // Playground only: hands alone, the fastest tracker. Left/right = side of the picture.
    const hands = await withFallback((delegate) => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: model('hand_landmarker.task'), delegate }, runningMode: 'VIDEO', numHands: 2,
    }))
    detect = (img, ts) => {
      const hs = [...hands.detectForVideo(img, ts).landmarks].sort((a, b) => a[0].x - b[0].x)
      return { pose: null, lh: pts(hs.length > 1 ? hs[1] : undefined), rh: pts(hs[0]) }
    }
    return
  }
  if (tracker === 'holistic') {
    const h = await withFallback((delegate) => HolisticLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: model('holistic_landmarker.task'), delegate },
      runningMode: 'VIDEO', outputFaceBlendshapes: false, outputPoseSegmentationMasks: false,
    } as any))
    detect = (img, ts) => {
      const r = (h as any).detectForVideo(img, ts)
      return { pose: pts(r.poseLandmarks[0]), lh: pts(r.leftHandLandmarks[0]), rh: pts(r.rightHandLandmarks[0]) }
    }
    return
  }
  const pose = await withFallback((delegate) => PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: model('pose_landmarker_lite.task'), delegate }, runningMode: 'VIDEO', numPoses: 1,
  }))
  const hands = await withFallback((delegate) => HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: model('hand_landmarker.task'), delegate }, runningMode: 'VIDEO', numHands: 2,
  }))
  detect = (img, ts) => {
    const p = pose.detectForVideo(img, ts).landmarks[0]
    const hs = hands.detectForVideo(img, ts + 0.5).landmarks
    let lh: LM[] | undefined
    let rh: LM[] | undefined
    if (p && hs.length) {   // nearest pose wrist (15 = person's left, 16 = right), as Holistic does
      const s = hs.map((h) => ({ h, toL: d2(h[0], p[15]), toR: d2(h[0], p[16]) }))
      if (s.length === 1) { if (s[0].toL < s[0].toR) lh = s[0].h; else rh = s[0].h }
      else if (s[0].toL + s[1].toR <= s[0].toR + s[1].toL) { lh = s[0].h; rh = s[1].h } else { lh = s[1].h; rh = s[0].h }
    }
    return { pose: pts(p), lh: pts(lh), rh: pts(rh) }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try {
      await init(m.tracker, m.base)
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) })
    }
    return
  }
  if (m.type === 'frame' && detect) {
    const t0 = performance.now()
    try {
      const f = detect(m.bitmap, m.t)
      self.postMessage({ type: 'frame', frame: { ...f, t: m.t }, ms: performance.now() - t0 })
    } catch {
      self.postMessage({ type: 'frame', frame: null, ms: performance.now() - t0 })
    } finally {
      m.bitmap.close()
    }
  }
}


