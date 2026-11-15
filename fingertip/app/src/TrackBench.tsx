/** /#trackbench: tracker speed on this machine (canvas stream of a still photo stands in for the camera). */
import { useEffect, useState } from 'react'
import { watch } from './sign/camera'

export function TrackBench() {
  const [out, setOut] = useState<string[]>([])
  useEffect(() => {
    const img = new Image()
    img.src = '/bench-person.jpg'
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 480
      const g = c.getContext('2d')!
      let k = 0
      const draw = () => { g.fillStyle = '#888'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 160 + (k++ % 4), 0, 320, 480); requestAnimationFrame(draw) }
      draw()
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = c.captureStream(30); await v.play()
      for (const t of ['fast', 'holistic', 'lite'] as const) {
        const r = await new Promise<string>((res) => {
          let last = ''; let face = 0; let n = 0
          const stop = watch(v, (f) => { n++; if (f.fx || f.pose) face++ }, (fps, ms) => { last = `${t}: ${fps.toFixed(1)} fps, ${ms.toFixed(0)} ms/frame` }, t)
          setTimeout(() => { stop(); res(`${last || t + ': no frames'} (detections ${face}/${n})`) }, 15000)
        })
        setOut((o) => [...o, r])
      }
      setOut((o) => [...o, 'done'])
    }
  }, [])
  return <pre id="bench" style={{ color: '#fff', padding: 20, fontSize: 16 }}>{out.join('\n') || 'running…'}</pre>
}
