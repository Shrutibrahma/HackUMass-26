import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { HangUp, Mic, Video as VideoIcon } from '../icons'
import { pretty, useSigning } from '../sign/useSigning'

/**
 * Host side of a browser video call (WebRTC, signaling over /ws/room/{room}).
 * The guest joins /v/{room} in any browser: no app, no extension.
 * My signs are recognized on this device (landmarks only leave it), shown as live captions over my video
 * on BOTH screens, and can optionally be voiced into the call audio.
 */
type Status = 'starting' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'blocked'

const STATUS_TEXT: Record<Status, string> = {
  starting: 'Starting camera…', waiting: 'Waiting for them to join', connecting: 'Connecting…',
  connected: 'Connected', reconnecting: 'Reconnecting…', ended: 'Call ended', blocked: 'Camera blocked',
}

export function VideoCall({ room, onClose }: { room: string; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState('')
  const [caption, setCaption] = useState<{ text: string; final: boolean } | null>(null)
  const [text, setText] = useState('')
  const [aiSentence, setAiSentence] = useState(true)
  const [speak, setSpeak] = useState(false)
  const [signOn, setSignOn] = useState(true)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [copied, setCopied] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')

  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const ws = useRef<WebSocket | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const media = useRef<MediaStream | null>(null)
  const out = useRef<MediaStream | null>(null)
  const audio = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode; mic?: MediaStreamAudioSourceNode } | null>(null)
  const ice = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const neg = useRef({ polite: false, makingOffer: false, ignoreOffer: false })
  const ended = useRef(false)
  const fade = useRef<number | undefined>(undefined)
  const inviteUrl = `${location.origin}/v/${encodeURIComponent(room)}`

  const send = (o: object) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(o)) }

  const showCaption = useCallback((t: string, final: boolean) => {
    window.clearTimeout(fade.current)
    setCaption(t ? { text: t, final } : null)
    if (final && t) fade.current = window.setTimeout(() => setCaption(null), 6500)
  }, [])

  const pushCaption = useCallback((t: string, final: boolean) => {
    showCaption(t, final)
    send({ type: 'caption', text: t, final })
  }, [showCaption])

  /** Voice a line into the call audio (Mom hears it). Uses the server's meeting voice (/api/tts). */
  const voice = useCallback(async (line: string) => {
    const a = audio.current
    if (!a || !line) return
    try {
      const t0 = performance.now()
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `voice failed (${r.status})`)
      const buf = await a.ctx.decodeAudioData(await r.arrayBuffer())
      const src = a.ctx.createBufferSource()
      src.buffer = buf
      src.connect(a.dest)
      src.start()
      setVoiceNote(`Voiced in ${Math.round(performance.now() - t0)} ms`)
    } catch (e: any) {
      setVoiceNote(`Voice unavailable: ${e.message}. Caption still sent.`)
    }
  }, [])

  const finish = useCallback(async (line: string) => {
    const t = line.trim()
    if (!t) return
    pushCaption(t, true)
    if (speak) voice(t)
  }, [pushCaption, speak, voice])

  const onPhrase = useCallback(async (signs: string[]) => {
    if (!signs.length) return
    const glosses = signs.map(pretty).join(' ')
    if (!aiSentence) { finish(glosses); return }
    pushCaption(glosses + ' …', false)
    try {
      const r = await post<{ text: string }>('/api/signs/sentence', { signs, style: 'casual' })
      finish(r.text || glosses)
    } catch {
      finish(glosses)
    }
  }, [aiSentence, finish, pushCaption])

  const sign = useSigning({ enabled: signOn && status !== 'blocked' && status !== 'ended', onPhrase,
    onSigns: (s) => pushCaption(s.map(pretty).join(' '), false) })

  // ---- WebRTC (perfect negotiation, same protocol as /v/{room})
  const newPC = useCallback(() => {
    pc.current?.close()
    neg.current.makingOffer = false
    neg.current.ignoreOffer = false
    const p = new RTCPeerConnection({ iceServers: ice.current })
    pc.current = p
    out.current?.getTracks().forEach((t) => p.addTrack(t, out.current!))
    p.ontrack = (e) => { if (remoteRef.current) { remoteRef.current.srcObject = e.streams[0]; remoteRef.current.play().catch(() => {}) } }
    p.onicecandidate = (e) => { if (e.candidate) send({ type: 'ice', candidate: e.candidate }) }
    p.onnegotiationneeded = async () => {
      try { neg.current.makingOffer = true; await p.setLocalDescription(); send({ type: 'offer', description: p.localDescription }) }
      catch (e) { console.error(e) } finally { neg.current.makingOffer = false }
    }
    p.onconnectionstatechange = () => {
      if (ended.current) return
      const s = p.connectionState
      if (s === 'connected') setStatus('connected')
      else if (s === 'connecting') setStatus('connecting')
      else if (s === 'disconnected') setStatus('reconnecting')
      else if (s === 'failed') { setStatus('reconnecting'); try { p.restartIce() } catch { /* ignore */ } }
    }
  }, [])

  const onSignal = useCallback(async (m: any) => {
    const p = pc.current
    if (!p) return
    if (m.type === 'offer' || m.type === 'answer') {
      const d = m.description
      const collision = d.type === 'offer' && (neg.current.makingOffer || p.signalingState !== 'stable')
      neg.current.ignoreOffer = !neg.current.polite && collision
      if (neg.current.ignoreOffer) return
      await p.setRemoteDescription(d)
      if (d.type === 'offer') { await p.setLocalDescription(); send({ type: 'answer', description: p.localDescription }) }
    } else if (m.type === 'ice') {
      try { await p.addIceCandidate(m.candidate) } catch (e) { if (!neg.current.ignoreOffer) console.error(e) }
    }
  }, [])

  useEffect(() => {
    let retry = 0
    let timer: number | undefined
    const connect = () => {
      if (ended.current) return
      const w = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/room/${encodeURIComponent(room)}`)
      ws.current = w
      w.onopen = () => { retry = 0 }
      w.onmessage = async (ev) => {
        let m: any
        try { m = JSON.parse(ev.data) } catch { return }
        switch (m.type) {
          case 'joined': neg.current.polite = !!m.polite; newPC(); setStatus(m.peers < 2 ? 'waiting' : 'connecting'); break
          case 'peer-joined': setStatus('connecting'); newPC(); break
          case 'peer-left': setStatus('waiting'); if (remoteRef.current) remoteRef.current.srcObject = null; newPC(); break
          case 'full': ended.current = true; setStatus('ended'); setError('This call already has two people.'); break
          case 'bye': setStatus('waiting'); if (remoteRef.current) remoteRef.current.srcObject = null; break
          case 'caption': break   // our own captions echo back from REST pushes; already shown
          default: try { await onSignal(m) } catch (e) { console.error(e) }
        }
      }
      w.onclose = () => {
        if (ended.current) return
        setStatus('reconnecting')
        timer = window.setTimeout(connect, Math.min(1000 * 1.6 ** retry++, 8000))
      }
    }
    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: { echoCancellation: true, noiseSuppression: true } })
        media.current = s
        if (localRef.current) { localRef.current.srcObject = s; localRef.current.play().catch(() => {}) }
        // Outgoing audio = my mic + the voiced captions, mixed (no extra app on Mom's side).
        const ctx = new AudioContext()
        const dest = ctx.createMediaStreamDestination()
        const mic = s.getAudioTracks().length ? ctx.createMediaStreamSource(s) : undefined
        mic?.connect(dest)
        audio.current = { ctx, dest, mic }
        out.current = new MediaStream([...s.getVideoTracks(), ...dest.stream.getAudioTracks()])
        sign.onVideo(localRef.current)
      } catch (e: any) {
        setStatus('blocked')
        setError(e?.name === 'NotAllowedError'
          ? 'Camera and microphone are blocked. Click the camera icon in the address bar, choose Allow, then reload.'
          : `Couldn't start the camera (${e?.name ?? 'error'}). Close other apps using it and reload.`)
        return
      }
      try { const r = await fetch('/api/rooms/ice'); if (r.ok) ice.current = await r.json() } catch { /* default STUN */ }
      connect()
    }
    start()
    return () => {
      ended.current = true
      window.clearTimeout(timer)
      send({ type: 'bye' })
      ws.current?.close()
      pc.current?.close()
      media.current?.getTracks().forEach((t) => t.stop())
      audio.current?.ctx.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  useEffect(() => { media.current?.getAudioTracks().forEach((t) => { t.enabled = !muted }) }, [muted])
  useEffect(() => { media.current?.getVideoTracks().forEach((t) => { t.enabled = !camOff }) }, [camOff])

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { window.prompt('Copy this link', inviteUrl) }
  }

  const end = () => { ended.current = true; send({ type: 'bye' }); onClose() }

  return (
    <div className="screen dark vcall">
      <div className="vc-top">
        <span className={`vc-dot ${status}`} aria-hidden />
        <span className="vc-status" role="status">{STATUS_TEXT[status]}</span>
        <button className="vc-copy" onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button>
      </div>
      <div className="vc-stage">
        <video ref={remoteRef} className="vc-remote" playsInline autoPlay />
        {status !== 'connected' && !error && (
          <div className="vc-wait">
            <b>{status === 'waiting' ? 'Send Mom this link' : STATUS_TEXT[status]}</b>
            {status === 'waiting' && <code>{inviteUrl}</code>}
            {status === 'waiting' && <small>She opens it in any browser. No app, no sign-up.</small>}
          </div>
        )}
        {error && <div className="vc-wait err" role="alert">{error}</div>}
        <div className="vc-self">
          <video ref={localRef} playsInline autoPlay muted />
          {sign.signs && <span className="vc-signing">Signing…</span>}
          {caption && <div className={`vc-cap ${caption.final ? '' : 'partial'}`} aria-live="polite">{caption.text}</div>}
        </div>
      </div>
      {sign.unsure && (
        <div className="vc-unsure" role="group" aria-label="Which sign did you mean?">
          <span>Did you sign</span>
          {sign.unsure.map((o) => <button key={o} onClick={() => sign.pick(o)}>{pretty(o)}</button>)}
          <button className="ghost" onClick={sign.again}>Neither</button>
        </div>
      )}
      <div className="vc-options">
        <button className={signOn ? 'on' : ''} aria-pressed={signOn} onClick={() => setSignOn(!signOn)}>✋ Sign captions</button>
        <button className={aiSentence ? 'on' : ''} aria-pressed={aiSentence} onClick={() => setAiSentence(!aiSentence)}>✦ AI sentence</button>
        <button className={speak ? 'on' : ''} aria-pressed={speak} onClick={() => setSpeak(!speak)}>🔊 Voice it</button>
      </div>
      {voiceNote && speak && <div className="vc-note">{voiceNote}</div>}
      <form className="vc-compose" onSubmit={(e) => { e.preventDefault(); finish(text); setText('') }}>
        <input value={text} placeholder="Type a caption (sent exactly)" aria-label="Type a caption"
          onChange={(e) => { setText(e.target.value); pushCaption(e.target.value, false) }} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
      <div className="vc-controls">
        <button className={muted ? 'off' : ''} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}><Mic size={22} /></button>
        <button className={camOff ? 'off' : ''} onClick={() => setCamOff(!camOff)} aria-label={camOff ? 'Camera on' : 'Camera off'}><VideoIcon size={22} /></button>
        <button className="end" onClick={end} aria-label="End video call"><HangUp size={26} /></button>
      </div>
      <div className="vc-foot">Browser video call · not FaceTime · signs recognized on this device (limited vocabulary)</div>
    </div>
  )
}
