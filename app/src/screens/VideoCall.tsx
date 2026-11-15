import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { post } from '../api'
import { load, save } from '../storage'
import { pretty, useSigning } from '../sign/useSigning'
import {
  SFArrowUp, SFCaptions, SFCheck, SFEllipsis, SFExclamation, SFHand, SFLink, SFMic, SFMicSlash, SFPerson, SFPhoneDown,
  SFShare, SFSparkles, SFSpeaker, SFVideo, SFVideoSlash, SFWifiSlash, SFXmark,
} from '../sf'
import './video.css'

/**
 * Host side of a browser video call (WebRTC, signaling over /ws/room/{room}), laid out like a FaceTime call.
 * The guest joins /v/{room} in any browser (server/app/static/video.html: same protocol, same look).
 * My signs are recognized on this device (landmarks only leave it), sent as live captions that show over
 * my video on BOTH screens, and can optionally be voiced into the call audio.
 *
 * Room protocol (relayed verbatim by server/app/rooms.py):
 *   {type:'offer'|'answer', description} {type:'ice', candidate}   perfect negotiation
 *   {type:'caption', text, final, src:'sign'|'typed'|'ai'}         live captions (host -> guest)
 *   {type:'state', role, name, cam, mic, away}                      names, camera-off / muted / away badges
 *   {type:'bye', role}                                              hung up (a host bye ends the guest's call)
 */
type MediaState = 'pending' | 'ok' | 'audio' | 'none' | 'denied' | 'error'
type Conn = 'idle' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'left' | 'full' | 'ended'
type Src = 'sign' | 'typed' | 'ai'
type Corner = 'tl' | 'tr' | 'bl' | 'br'
type Caption = { text: string; final: boolean; src: Src; fading: boolean }
type Suggest = { input: string; text: string; state: 'wait' | 'ready' | 'error' }

const SRC_LABEL: Record<Src, string> = { sign: 'Signed', typed: 'Typed', ai: 'AI' }
const CAP_SCALES = [0.85, 1, 1.2, 1.45, 1.75]
const HIDE_AFTER_MS = 4000
const LINGER_MS = 5000
const MAX_CAPTION = 280

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
/** Long captions: keep the newest words (the card shows the last two lines). */
const tail = (t: string) => (t.length > MAX_CAPTION ? '…' + t.slice(-MAX_CAPTION).replace(/^\S*\s/, '') : t)
const initial = (n: string) => (n.trim()[0] ?? '').toUpperCase()
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const newCid = () => { try { return crypto.randomUUID() } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}` } }

/** Keep a caption to the newest words that fit its box (2 lines): drop leading words, prefix an ellipsis. */
function fitNewest(span: HTMLElement | null, pad = 0) {
  const box = span?.parentElement
  const node = span?.firstChild
  if (!span || !box || !node || node.nodeType !== 3) return
  let t = (node.nodeValue ?? '').replace(/^…/, '')
  for (let i = 0; i < 80 && span.offsetHeight > box.clientHeight - pad + 1; i++) {
    const sp = t.indexOf(' ', 1)
    if (sp < 0) break
    t = t.slice(sp + 1)
    node.nodeValue = '…' + t
  }
}

function Avatar({ name }: { name: string }) {
  return <span className="ft-avatar" aria-hidden>{initial(name) || <SFPerson filled />}</span>
}

export function VideoCall({ room, onClose, peer, publicBase }: { room: string; onClose: () => void; peer?: string; publicBase?: string }) {
  const myName = load<string>('myName', '')
  const [peerName, setPeerName] = useState(peer ?? '')
  const who = peerName || 'them'
  const Who = peerName || 'They'

  // ---- call state
  const [session, setSession] = useState(0)                 // bump = start over (Try Again / Call again)
  const [allowNoMedia, setAllowNoMedia] = useState(false)
  const [media, setMedia] = useState<MediaState>('pending')
  const [mediaErr, setMediaErr] = useState('')
  const [conn, setConn] = useState<Conn>('idle')
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedFor, setEndedFor] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [remote, setRemote] = useState({ video: false, cam: true, mic: true, away: false })
  const [needUnmute, setNeedUnmute] = useState(false)

  // ---- local controls
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [capsOn, setCapsOn] = useState(true)
  const [signOn, setSignOn] = useState(true)
  const [aiTyped, setAiTyped] = useState(() => load<boolean>('vc.aiTyped', false))
  const [aiSigns, setAiSigns] = useState(() => load<boolean>('vc.aiSigns', true))
  const [speak, setSpeak] = useState(() => load<boolean>('vc.speak', false))
  const [capScale, setCapScale] = useState(() => load<number>('vc.capScale', 1))
  const [voiceNote, setVoiceNote] = useState('')

  // ---- UI
  const [caption, setCaption] = useState<Caption | null>(null)
  const [text, setText] = useState('')
  const [exact, setExact] = useState(false)                  // text came from "Edit" on an AI suggestion: send as-is
  const [suggest, setSuggest] = useState<Suggest | null>(null)
  const [typing, setTyping] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok?: boolean } | null>(null)
  const [chromeOn, setChromeOn] = useState(true)
  const [poke, setPoke] = useState(0)
  const [swapped, setSwapped] = useState(false)
  const [corner, setCorner] = useState<Corner>('tr')
  const [chromeH, setChromeH] = useState(120)
  const [aspect, setAspect] = useState({ self: 3 / 4, remote: 3 / 4 })

  // ---- refs
  const stageRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selfTile = useRef<HTMLDivElement>(null)
  const remoteTile = useRef<HTMLDivElement>(null)
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const backdropRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const capSpan = useRef<HTMLSpanElement>(null)
  const miniSpan = useRef<HTMLSpanElement>(null)
  const ws = useRef<WebSocket | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const out = useRef<MediaStream | null>(null)
  const audio = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null)
  const ice = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const neg = useRef({ polite: false, makingOffer: false, ignoreOffer: false })
  const cid = useRef(newCid())
  const stopped = useRef(false)
  const reconnectNow = useRef<() => void>(() => {})
  const fadeT = useRef<number[]>([])
  const toastT = useRef<number | undefined>(undefined)
  const lastPartial = useRef(0)
  const live = useRef({ muted, camOff, startedAt, Who, media })
  live.current = { muted, camOff, startedAt, Who, media }

  // The invite must be the server's PUBLIC address (tunnel/domain), never localhost: Mom opens it on her phone.
  const inviteUrl = `${publicBase || location.origin}/v/${encodeURIComponent(room)}${myName ? `?from=${encodeURIComponent(myName)}` : ''}`
  const hasPeer = conn === 'connecting' || conn === 'connected' || conn === 'reconnecting'
  const videoOk = media === 'ok'

  const send = useCallback((o: object) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(o)) }, [])
  const sendState = useCallback(() => {
    const m = live.current
    send({ type: 'state', role: 'host', name: myName, cam: m.media === 'ok' && !m.camOff, mic: !m.muted && m.media !== 'none', away: document.hidden })
  }, [send, myName])

  const flash = useCallback((t: string, ok = false) => {
    window.clearTimeout(toastT.current)
    setToast({ text: t, ok })
    toastT.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  // ---------------------------------------------------------------- captions
  const showCaption = useCallback((t: string, final: boolean, src: Src) => {
    fadeT.current.forEach((x) => window.clearTimeout(x))
    fadeT.current = []
    if (!t) { setCaption(null); return }
    setCaption({ text: tail(t), final, src, fading: false })
    if (final) {
      fadeT.current.push(window.setTimeout(() => setCaption((c) => (c ? { ...c, fading: true } : c)), LINGER_MS))
      fadeT.current.push(window.setTimeout(() => setCaption(null), LINGER_MS + 650))
    }
  }, [])

  const pushCaption = useCallback((t: string, final: boolean, src: Src) => {
    showCaption(t, final, src)
    send({ type: 'caption', text: tail(t), final, src })
  }, [showCaption, send])

  /** Voice a line into the call audio (they hear it). Uses the server's meeting voice (/api/tts). */
  const voice = useCallback(async (line: string) => {
    const a = audio.current
    if (!a || !line) return
    try {
      const t0 = performance.now()
      if (a.ctx.state !== 'running') await a.ctx.resume()
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `voice failed (${r.status})`)
      const buf = await a.ctx.decodeAudioData(await r.arrayBuffer())
      const src = a.ctx.createBufferSource()
      src.buffer = buf
      src.connect(a.dest)
      src.start()
      setVoiceNote(`Last line voiced in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
    } catch (e: any) {
      setVoiceNote(`Voice unavailable (${e.message}). Captions still sent.`)
      flash('Voice unavailable. Caption sent.')
    }
  }, [flash])

  const finish = useCallback((line: string, src: Src) => {
    const t = line.trim()
    if (!t) return
    pushCaption(t, true, src)
    if (speak) voice(t)
  }, [pushCaption, speak, voice])

  const onPhrase = useCallback(async (signs: string[]) => {
    if (!signs.length) return
    const glosses = signs.map(pretty).join(' ')
    if (!aiSigns) { finish(glosses, 'sign'); return }
    pushCaption(glosses + ' …', false, 'sign')
    try {
      const r = await post<{ text: string }>('/api/signs/sentence', { signs, style: 'casual' })
      finish(r.text || glosses, r.text ? 'ai' : 'sign')
    } catch {
      finish(glosses, 'sign')
    }
  }, [aiSigns, finish, pushCaption])

  const sign = useSigning({
    enabled: signOn && videoOk && !camOff && conn !== 'ended',
    onPhrase,
    onSigns: (s) => pushCaption(s.map(pretty).join(' '), false, 'sign'),
  })
  const signVideo = useRef(sign.onVideo)
  signVideo.current = sign.onVideo

  // ---------------------------------------------------------------- WebRTC + signaling
  useEffect(() => {
    stopped.current = false
    let retry = 0
    let fullRetries = 0
    let joinedOnce = false
    let timer: number | undefined
    let iceTimer: number | undefined

    const clearRemote = () => {
      if (remoteRef.current) remoteRef.current.srcObject = null
      if (backdropRef.current) backdropRef.current.srcObject = null
      setRemote({ video: false, cam: true, mic: true, away: false })
      setNeedUnmute(false)
    }

    const newPC = () => {
      pc.current?.close()
      neg.current.makingOffer = false
      neg.current.ignoreOffer = false
      const p = new RTCPeerConnection({ iceServers: ice.current })
      pc.current = p
      const o = out.current
      o?.getTracks().forEach((t) => p.addTrack(t, o))
      if (!o?.getVideoTracks().length) p.addTransceiver('video', { direction: 'recvonly' })
      if (!o?.getAudioTracks().length) p.addTransceiver('audio', { direction: 'recvonly' })
      p.ontrack = (e) => {
        const s = e.streams[0] ?? new MediaStream([e.track])
        const v = remoteRef.current
        if (!v) return
        if (v.srcObject !== s) { v.srcObject = s; if (backdropRef.current) backdropRef.current.srcObject = s }
        v.play().catch((err) => {
          // autoplay with sound blocked: play muted and ask for one tap
          if (err?.name === 'NotAllowedError') { v.muted = true; v.play().catch(() => {}); setNeedUnmute(true) }
        })
        backdropRef.current?.play().catch(() => {})
      }
      p.onicecandidate = (e) => { if (e.candidate) send({ type: 'ice', candidate: e.candidate }) }
      p.onnegotiationneeded = async () => {
        try { neg.current.makingOffer = true; await p.setLocalDescription(); send({ type: 'offer', description: p.localDescription }) }
        catch (e) { console.error(e) } finally { neg.current.makingOffer = false }
      }
      p.onconnectionstatechange = () => {
        if (stopped.current || pc.current !== p) return
        const s = p.connectionState
        window.clearTimeout(iceTimer)
        if (s === 'connected') { setConn('connected'); setStartedAt((t) => t ?? Date.now()) }
        else if (s === 'connecting') setConn((c) => (c === 'connected' || c === 'reconnecting' ? 'reconnecting' : 'connecting'))
        else if (s === 'disconnected') {
          setConn('reconnecting')
          iceTimer = window.setTimeout(() => { if (p.connectionState !== 'connected') try { p.restartIce() } catch { /* closed */ } }, 3000)
        } else if (s === 'failed') { setConn('reconnecting'); try { p.restartIce() } catch { /* closed */ } }
      }
    }

    const onSignal = async (m: any) => {
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
    }

    // The guest left or hung up: stay in the room so they can come back on the same link.
    const peerGone = () => { clearRemote(); setSwapped(false); setConn('left'); newPC() }

    const connect = () => {
      if (stopped.current) return
      window.clearTimeout(timer)
      if (ws.current && ws.current.readyState <= 1) return
      const w = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/room/${encodeURIComponent(room)}?cid=${cid.current}`)
      ws.current = w
      w.onopen = () => { retry = 0 }
      w.onmessage = async (ev) => {
        let m: any
        try { m = JSON.parse(ev.data) } catch { return }
        switch (m.type) {
          case 'joined':
            joinedOnce = true; fullRetries = 0
            neg.current.polite = !!m.polite
            newPC()
            setConn((c) => (m.peers < 2 ? (c === 'left' || c === 'reconnecting' ? 'left' : 'waiting') : (c === 'connected' ? 'reconnecting' : 'connecting')))
            sendState()
            break
          case 'peer-joined':
            setConn((c) => { if (c === 'left') flash(`${live.current.Who} rejoined`, true); return c === 'connected' ? 'reconnecting' : 'connecting' })
            clearRemote(); newPC(); sendState()
            break
          case 'peer-left': case 'bye': peerGone(); break
          case 'full':
            // Right after a network drop the server may still hold our old socket: retry before giving up.
            if (joinedOnce && fullRetries++ < 8) { setConn('reconnecting'); break }
            stopped.current = true; setConn('full'); break
          case 'state':
            if (m.name && !peer) setPeerName(String(m.name).slice(0, 40))
            setRemote((r) => ({ ...r, cam: m.cam !== false, mic: m.mic !== false, away: !!m.away }))
            break
          case 'caption': break
          default: try { await onSignal(m) } catch (e) { console.error(e) }
        }
      }
      w.onclose = () => {
        if (stopped.current || ws.current !== w) return
        setConn((c) => (c === 'waiting' || c === 'left' ? c : 'reconnecting'))
        timer = window.setTimeout(connect, Math.min(800 * 1.6 ** retry++, 8000))
      }
    }
    reconnectNow.current = () => {
      if (stopped.current) return
      if (!ws.current || ws.current.readyState > 1) { retry = 0; connect() }
      const p = pc.current
      if (p && (p.connectionState === 'failed' || p.connectionState === 'disconnected')) try { p.restartIce() } catch { /* ignore */ }
    }

    /** Camera + mic, with fallbacks: audio only when there is no camera, receive-only when nothing works. */
    const getMedia = async (): Promise<MediaStream | null | 'fail'> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (allowNoMedia) { setMedia('none'); return null }
        setMediaErr('This browser cannot use the camera here. Open the app over https in Safari or Chrome.')
        setMedia('error'); return 'fail'
      }
      const audioC = { echoCancellation: true, noiseSuppression: true }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: audioC })
        setMedia('ok'); return s
      } catch (e: any) {
        const n = e?.name
        if (n === 'NotAllowedError' || n === 'SecurityError') {
          if (allowNoMedia) { setMedia('none'); return null }
          setMedia('denied'); return 'fail'
        }
        if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'NotReadableError') {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: audioC })
            setMedia('audio')
            flash(n === 'NotReadableError' ? 'Camera is busy in another app. Audio only.' : 'No camera found. You are on audio only.')
            return s
          } catch { /* no mic either */ }
          setMedia('none'); flash('No camera or microphone. You can still type captions.'); return null
        }
        if (allowNoMedia) { setMedia('none'); return null }
        setMediaErr(`Couldn't start the camera (${n ?? 'error'}). Close other apps that use it, then try again.`)
        setMedia('error'); return 'fail'
      }
    }

    const start = async () => {
      setMedia('pending'); setConn('idle'); setMediaErr(''); setStartedAt(null); setCaption(null); setSwapped(false)
      clearRemote()
      const s = await getMedia()
      if (s === 'fail') return
      if (stopped.current) { s?.getTracks().forEach((t) => t.stop()); return }
      stream.current = s
      if (s && localRef.current) { localRef.current.srcObject = s; localRef.current.play().catch(() => {}) }
      // Outgoing audio = my mic + the voiced captions, mixed (nothing to install on their side).
      try {
        const ctx = new AudioContext()
        const dest = ctx.createMediaStreamDestination()
        if (s?.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest)
        audio.current = { ctx, dest }
        out.current = new MediaStream([...(s?.getVideoTracks() ?? []), ...dest.stream.getAudioTracks()])
      } catch {
        out.current = s
      }
      s?.getAudioTracks().forEach((t) => { t.enabled = !live.current.muted })
      s?.getVideoTracks().forEach((t) => { t.enabled = !live.current.camOff })
      if (s?.getVideoTracks().length) signVideo.current(localRef.current)
      try { const r = await fetch('/api/rooms/ice'); if (r.ok) ice.current = await r.json() } catch { /* default STUN */ }
      if (stopped.current) return
      setConn('waiting')
      connect()
    }
    start()

    return () => {
      stopped.current = true
      window.clearTimeout(timer)
      window.clearTimeout(iceTimer)
      try { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ type: 'bye', role: 'host' })) } catch { /* ignore */ }
      ws.current?.close()
      ws.current = null
      pc.current?.close()
      pc.current = null
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
      audio.current?.ctx.close().catch(() => {})
      audio.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, session])

  useEffect(() => { stream.current?.getAudioTracks().forEach((t) => { t.enabled = !muted }); sendState() }, [muted, sendState])
  useEffect(() => { stream.current?.getVideoTracks().forEach((t) => { t.enabled = !camOff }); sendState() }, [camOff, media, sendState])
  useEffect(() => { save('vc.aiTyped', aiTyped) }, [aiTyped])
  useEffect(() => { save('vc.aiSigns', aiSigns) }, [aiSigns])
  useEffect(() => { save('vc.speak', speak) }, [speak])
  useEffect(() => { save('vc.capScale', capScale) }, [capScale])

  // network + tab visibility
  useEffect(() => {
    const on = () => { setOnline(true); reconnectNow.current() }
    const off = () => setOnline(false)
    const vis = () => {
      sendState()
      if (!document.hidden) {
        localRef.current?.play().catch(() => {})
        remoteRef.current?.play().catch(() => {})
        backdropRef.current?.play().catch(() => {})
        reconnectNow.current()
      }
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis) }
  }, [sendState])

  // call timer
  useEffect(() => {
    if (conn !== 'connected' && conn !== 'reconnecting') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [conn])

  // controls auto-hide after 4 s of no interaction while connected
  const busy = sheet || typing || !!text || !!suggest || !!sign.unsure || needUnmute
  useEffect(() => {
    if (conn !== 'connected' || busy) { setChromeOn(true); return }
    const t = window.setTimeout(() => setChromeOn(false), HIDE_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [conn, busy, poke])
  const wake = useCallback(() => {
    setChromeOn(true); setPoke((n) => n + 1)
    if (audio.current?.ctx.state === 'suspended') audio.current.ctx.resume().catch(() => {})
  }, [])

  // measure the bottom chrome so captions and the PiP float just above it
  useLayoutEffect(() => {
    const el = bottomRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setChromeH(el.offsetHeight))
    ro.observe(el)
    setChromeH(el.offsetHeight)
    return () => ro.disconnect()
  }, [media, conn])

  useLayoutEffect(() => { fitNewest(capSpan.current); fitNewest(miniSpan.current, 8) })

  // ---------------------------------------------------------------- picture-in-picture placement
  const pipIsRemote = hasPeer && swapped
  const pipEl = useCallback(() => (hasPeer ? (swapped ? remoteTile.current : selfTile.current) : null), [hasPeer, swapped])
  const pipBox = useCallback((c: Corner) => {
    const st = stageRef.current
    if (!st || !pipEl()) return null
    const W = st.clientWidth, H = st.clientHeight
    const a = Math.min(2, Math.max(0.5, pipIsRemote ? aspect.remote : aspect.self))
    let w = W < 600 ? Math.max(96, Math.min(W * 0.28, 150)) : Math.min(W * 0.2, 260)
    if (a > 1) w = Math.min(w * 1.3, W * 0.42)
    const h = Math.min(w / a, H * 0.3)
    w = h * a
    const m = 12
    const top = 12 + 52 + 12
    const bottom = chromeOn ? chromeH + 16 + 12 : 16
    const x = c[1] === 'l' ? m : W - w - m
    const y = c[0] === 't' ? top : Math.max(top, H - h - bottom)
    return { x, y, w, h, W, H }
  }, [pipEl, pipIsRemote, aspect, chromeOn, chromeH])

  const layoutPip = useCallback(() => {
    const el = pipEl()
    for (const t of [selfTile.current, remoteTile.current]) {
      if (t && t !== el) { t.style.transform = ''; t.style.width = ''; t.style.height = '' }
    }
    const b = pipBox(corner)
    if (!el || !b) return
    el.style.width = `${b.w}px`
    el.style.height = `${b.h}px`
    el.style.transform = `translate(${b.x}px, ${b.y}px)`
  }, [pipEl, pipBox, corner])

  useLayoutEffect(() => { layoutPip() }, [layoutPip])
  useEffect(() => {
    window.addEventListener('resize', layoutPip)
    return () => window.removeEventListener('resize', layoutPip)
  }, [layoutPip])

  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number; moved: boolean; t: number } | null>(null)
  const onTileDown = (e: RPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el !== pipEl()) return
    const b = pipBox(corner)
    if (!b) return
    e.stopPropagation()
    wake()
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: b.x, y: b.y, moved: false, t: performance.now() }
  }
  const onTileMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    d.moved = true
    e.currentTarget.classList.add('dragging')
    e.currentTarget.style.transform = `translate(${d.x + dx}px, ${d.y + dy}px)`
  }
  const onTileUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    e.currentTarget.classList.remove('dragging')
    if (!d.moved) { setSwapped((s) => !s); return }      // tap: swap big and small
    const b = pipBox(corner)
    if (!b) return
    // project along the flick so a quick throw lands in the corner it was aimed at
    const k = 1 + 120 / Math.max(16, performance.now() - d.t)
    const px = d.x + (e.clientX - d.sx) * k + b.w / 2
    const py = d.y + (e.clientY - d.sy) * k + b.h / 2
    const next = `${py < b.H / 2 ? 't' : 'b'}${px < b.W / 2 ? 'l' : 'r'}` as Corner
    if (next === corner) layoutPip()
    else setCorner(next)
  }

  // ---------------------------------------------------------------- actions
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); flash('Link copied', true); return } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = inviteUrl; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      flash(ok ? 'Link copied' : 'Press and hold the link to copy it', ok)
    } catch { flash('Press and hold the link to copy it') }
  }
  const canShare = typeof navigator.share === 'function' && isTouch()
  const shareLink = async () => {
    wake()
    if (canShare) {
      try { await navigator.share({ title: 'Video call', text: myName ? `${myName} is inviting you to a video call` : 'Join my video call', url: inviteUrl }); return }
      catch (e: any) { if (e?.name === 'AbortError') return }
    }
    copyLink()
  }

  const end = () => {
    const started = live.current.startedAt
    send({ type: 'bye', role: 'host' })
    stopped.current = true
    ws.current?.close(); pc.current?.close()
    stream.current?.getTracks().forEach((t) => t.stop())
    setEndedFor(started ? Date.now() - started : 0)
    setSheet(false); setSuggest(null); setText(''); setCaption(null)
    setConn('ended')
  }
  const again = () => { setConn('idle'); setSession((n) => n + 1) }
  const retryMedia = (noMedia: boolean) => { setAllowNoMedia(noMedia); setSession((n) => n + 1) }
  const unmuteRemote = () => {
    const v = remoteRef.current
    if (v) { v.muted = false; v.play().catch(() => {}) }
    setNeedUnmute(false)
  }

  // typed captions
  const aiMode = aiTyped && !exact
  const onType = (v: string) => {
    setText(v)
    if (aiMode) return       // AI rewrites on send; raw shorthand is not streamed
    const t = Date.now()
    if (!v.trim()) { pushCaption('', false, 'typed'); return }
    if (t - lastPartial.current > 120) { lastPartial.current = t; pushCaption(v, false, 'typed') }
  }
  const submit = async () => {
    const t = text.trim()
    if (!t) return
    if (!aiMode) { finish(t, exact ? 'ai' : 'typed'); setText(''); setExact(false); return }
    setSuggest({ input: t, text: '', state: 'wait' })
    setText('')
    try {
      const r = await post<{ text: string }>('/api/expand', { text: t, style: 'casual' })
      setSuggest((s) => (s && s.input === t ? { ...s, text: (r.text || t).trim(), state: 'ready' } : s))
    } catch {
      setSuggest((s) => (s && s.input === t ? { ...s, text: t, state: 'error' } : s))
    }
  }
  const sendSuggestion = () => {
    if (!suggest || suggest.state === 'wait') return
    finish(suggest.text, suggest.state === 'ready' ? 'ai' : 'typed')
    setSuggest(null)
  }
  const editSuggestion = () => {
    if (!suggest) return
    setText(suggest.state === 'wait' ? suggest.input : suggest.text)
    setExact(suggest.state === 'ready')
    setSuggest(null)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }
  const stepCaps = (d: number) => {
    const i = CAP_SCALES.findIndex((s) => s >= capScale - 0.001)
    setCapScale(CAP_SCALES[Math.min(CAP_SCALES.length - 1, Math.max(0, (i < 0 ? 1 : i) + d))])
  }

  // ---------------------------------------------------------------- render
  const panel = media === 'denied' || media === 'error' || conn === 'full' || conn === 'ended'
  const statusLine = media === 'pending' ? 'Starting camera…'
    : conn === 'connected' && startedAt ? fmt(now - startedAt)
    : conn === 'connecting' ? 'Connecting…'
    : conn === 'reconnecting' ? 'Reconnecting…'
    : conn === 'left' ? `${Who} left`
    : conn === 'waiting' ? `Waiting for ${who}…`
    : 'Starting…'
  const dot = conn === 'left' ? 'bad' : ''
  const selfOff = !videoOk || camOff
  const remoteOff = !remote.video || !remote.cam || remote.away
  const remoteOffText = !remote.video && conn !== 'connected' ? 'Connecting…' : remote.away ? 'Video paused' : 'Camera off'
  const showInvite = !panel && media !== 'pending' && (conn === 'waiting' || conn === 'left')
  const cap = caption && capsOn ? caption : null
  const rootStyle = { '--chrome-h': `${chromeH}px`, '--cap-scale': capScale } as CSSProperties
  const tileEvents = { onPointerDown: onTileDown, onPointerMove: onTileMove, onPointerUp: onTileUp, onPointerCancel: onTileUp }

  return (
    <div className={`screen ios ft${chromeOn ? '' : ' chrome-off'}${panel ? ' has-panel' : ''}`} style={rootStyle}
      onPointerMove={(e) => { if (e.pointerType === 'mouse') wake() }} onKeyDown={wake}
      onPointerDown={(e) => {
        // tapping the full-bleed video toggles the controls (FaceTime behaviour); anything else wakes them
        const big = (e.target as HTMLElement).closest('.ft-tile.big')
        if (big && conn === 'connected' && chromeOn && !busy && e.pointerType !== 'mouse') setChromeOn(false)
        else wake()
      }}>
      <div className="ft-stage" ref={stageRef}>
        <div ref={remoteTile} {...tileEvents}
          className={`ft-tile remote ${hasPeer ? (swapped ? 'pip' : 'big') : 'big gone'}${remoteOff ? ' camoff' : ''}${remote.mic ? '' : ' micoff'}`}
          role={pipIsRemote ? 'button' : undefined} aria-label={pipIsRemote ? `${Who}'s video. Tap to make it full screen` : undefined}>
          <video ref={backdropRef} className="ft-backdrop" playsInline autoPlay muted aria-hidden />
          <video ref={remoteRef} className="main" playsInline autoPlay
            onLoadedData={() => setRemote((r) => ({ ...r, video: true }))}
            onResize={(e) => { const v = e.currentTarget; if (v.videoWidth) setAspect((a) => ({ ...a, remote: v.videoWidth / v.videoHeight })) }} />
          <div className="ft-off"><Avatar name={peerName} /><small>{remoteOffText}</small></div>
          <span className="ft-badge" role="img" aria-label={`${Who} is muted`}><SFMicSlash size={16} /></span>
        </div>
        <div ref={selfTile} {...tileEvents}
          className={`ft-tile self ${hasPeer && !swapped ? 'pip' : 'big'}${selfOff ? ' camoff' : ''}`}
          role={hasPeer && !swapped ? 'button' : undefined} aria-label={hasPeer && !swapped ? 'Your video. Drag to move it, tap to make it full screen' : undefined}>
          <video ref={localRef} playsInline autoPlay muted
            onResize={(e) => { const v = e.currentTarget; if (v.videoWidth) setAspect((a) => ({ ...a, self: v.videoWidth / v.videoHeight })) }} />
          <div className="ft-off"><Avatar name={myName} />
            <small>{media === 'pending' ? 'Starting camera…' : media === 'audio' ? 'Audio only' : media === 'none' ? 'No camera' : 'Camera off'}</small></div>
          {cap && hasPeer && (
            <div className={`ft-mini${cap.final ? '' : ' partial'}${cap.fading ? ' fading' : ''}`} aria-hidden><span ref={miniSpan}>{cap.text}</span></div>
          )}
        </div>
      </div>

      {showInvite && <div className="ft-dim" />}
      {showInvite && (
        <div className="ft-center">
          <div className="ft-card" role="dialog" aria-labelledby="ft-invite-h">
            <Avatar name={peerName} />
            <h2 id="ft-invite-h">{conn === 'left' ? `${Who} left` : `Invite ${peerName || 'someone'}`}</h2>
            <p>{conn === 'left' ? 'Waiting for them to rejoin… You can stay on this screen.' : 'Send this link to start the call.'}</p>
            <div className="ft-linkfield">
              <span title={inviteUrl}>{inviteUrl.replace(/^https?:\/\//, '')}</span>
              <button onClick={copyLink} aria-label="Copy link"><SFLink size={20} /></button>
            </div>
            <button className="ft-bigbtn" onClick={shareLink}><SFShare size={20} />{canShare ? 'Share Link' : 'Copy Link'}</button>
            <p className="ft-sub">They open it in any browser. No app needed.</p>
          </div>
        </div>
      )}

      {needUnmute && (
        <button className="ft-unmute ft-material" onClick={unmuteRemote} aria-label="Tap to unmute the call audio">
          <SFSpeaker size={22} />Tap to unmute
        </button>
      )}

      {/* top: name + status, share, options */}
      {!panel && (
        <div className="ft-top">
          <div className="ft-pill ft-material" role="status" aria-live="polite">
            <Avatar name={peerName} />
            <div className="txt">
              <b>{peerName || 'Video Call'}</b>
              <span>{conn !== 'connected' && <i className={`ft-dot ${dot}`} />}{statusLine}</span>
            </div>
          </div>
          <span className="ft-spacer" />
          <button className="ft-round ft-material" onClick={shareLink} aria-label={canShare ? 'Share invite link' : 'Copy invite link'}><SFShare size={21} /></button>
          <button className="ft-round ft-material" onClick={() => setSheet(true)} aria-label="More options" aria-haspopup="dialog"><SFEllipsis size={22} /></button>
        </div>
      )}

      {!online && !panel && (
        <div className="ft-banner ft-material" role="alert"><SFWifiSlash size={18} />No internet. Reconnecting when it is back.</div>
      )}
      {toast && <div className="ft-toast ft-material" role="status">{toast.ok && <SFCheck size={16} />}{toast.text}</div>}

      {/* live captions: what the other person sees under my video */}
      {!panel && (cap || sign.signs) && (
        <div className="ft-caption" aria-live="polite">
          {sign.signs && <div className="ft-signing ft-material"><span className="ft-wave" aria-hidden><i /><i /><i /></span>Signing…</div>}
          {cap && (
            <div className={`ft-cap${cap.final ? '' : ' partial'}${cap.fading ? ' fading' : ''}`}>
              <div className="lbl"><SFCaptions />Live Captions · {SRC_LABEL[cap.src]}</div>
              <div className="ft-cap-text"><span ref={capSpan}>{cap.text}</span></div>
            </div>
          )}
        </div>
      )}

      {/* bottom: suggestion / composer / control capsule */}
      {!panel && (
        <div className="ft-bottom" ref={bottomRef}>
          {sign.unsure && (
            <div className="ft-unsure ft-material keep" role="group" aria-label="Which sign did you mean?">
              <span>Did you sign</span>
              {sign.unsure.map((o) => <button key={o} className="ft-chipbtn" onClick={() => sign.pick(o)}>{pretty(o)}</button>)}
              <button className="ft-chipbtn ghost" onClick={sign.again}>Neither</button>
            </div>
          )}
          {suggest && (
            <div className="ft-suggest ft-material keep" role="group" aria-label="AI suggestion">
              <div className="lbl"><SFSparkles size={15} /><span>{suggest.state === 'error' ? 'AI unavailable. Send as typed?' : 'AI suggestion'}</span>
                <span className="ft-spacer" />
                <button className="ft-x" onClick={() => setSuggest(null)} aria-label="Discard suggestion"><SFXmark size={14} /></button>
              </div>
              <button className={`body${suggest.state === 'wait' ? ' wait' : ''}`} onClick={sendSuggestion} disabled={suggest.state === 'wait'}
                aria-label={suggest.state === 'wait' ? 'Writing a suggestion' : `Send: ${suggest.text}`}>
                {suggest.state === 'wait' ? `Rewriting “${suggest.input}”…` : suggest.text}
              </button>
              <div className="row">
                <button className="ft-chipbtn" onClick={editSuggestion}>Edit</button>
                <button className="ft-chipbtn primary" onClick={sendSuggestion} disabled={suggest.state === 'wait'}><SFArrowUp size={16} />Send</button>
              </div>
            </div>
          )}
          {media !== 'pending' && (
            <form className={`ft-compose${typing || text ? ' keep' : ''}`} onSubmit={(e) => { e.preventDefault(); submit() }}>
              <button type="button" className={`ft-ai ft-material${aiTyped ? ' on' : ''}`} aria-pressed={aiTyped}
                aria-label={aiTyped ? 'AI rewrite is on' : 'AI rewrite is off'} title="AI rewrites your shorthand before you send it"
                onClick={() => { setAiTyped(!aiTyped); setExact(false); flash(aiTyped ? 'AI off: sent exactly as typed' : 'AI on: you approve each line', !aiTyped) }}>
                <SFSparkles size={21} />
              </button>
              <label className="ft-field ft-material">
                <span className="sr">Type a caption</span>
                <input ref={inputRef} value={text} placeholder={aiMode ? 'Type shorthand for AI' : 'Type a caption'} enterKeyHint="send" autoComplete="off"
                  onChange={(e) => onType(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
                <button type="submit" className="ft-send" disabled={!text.trim()} aria-label={aiMode ? 'Rewrite with AI' : 'Send caption'}>
                  {aiMode ? <SFSparkles size={18} /> : <SFArrowUp size={18} />}
                </button>
              </label>
            </form>
          )}
          <div className="ft-capsule ft-material" role="toolbar" aria-label="Call controls">
            <button className={`ft-cbtn${muted || media === 'none' ? ' off' : ''}`} onClick={() => setMuted(!muted)} disabled={media === 'none' || media === 'pending'}
              aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted || media === 'none' ? <SFMicSlash size={24} /> : <SFMic size={24} />}</button>
            <button className={`ft-cbtn${camOff || !videoOk ? ' off' : ''}`} onClick={() => setCamOff(!camOff)} disabled={!videoOk}
              aria-pressed={camOff} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}>{camOff || !videoOk ? <SFVideoSlash size={24} /> : <SFVideo size={24} />}</button>
            <button className={`ft-cbtn${capsOn ? '' : ' off'}`} onClick={() => setCapsOn(!capsOn)} aria-pressed={capsOn}
              aria-label={capsOn ? 'Hide captions on my screen' : 'Show captions on my screen'}><SFCaptions size={24} /></button>
            <button className={`ft-cbtn${signOn && videoOk && !camOff ? ' lit' : ''}`} onClick={() => { setSignOn(!signOn); flash(signOn ? 'Sign captions off' : 'Sign captions on', !signOn) }}
              disabled={!videoOk || camOff} aria-pressed={signOn} aria-label={signOn ? 'Stop sign recognition' : 'Start sign recognition'}><SFHand size={24} /></button>
            <button className="ft-cbtn end" onClick={end} aria-label="End call"><SFPhoneDown size={28} /></button>
          </div>
        </div>
      )}

      {/* options sheet */}
      {sheet && (
        <div className="ft-scrim" onClick={() => setSheet(false)}>
          <div className="ft-sheet" role="dialog" aria-label="Call options" onClick={(e) => e.stopPropagation()}>
            <div className="ft-group">
              <div className="head">Call Options</div>
              <label className="ft-row">
                <span className="ico"><SFSpeaker size={18} /></span>
                <span className="grow">Voice it<small>{speak && voiceNote ? voiceNote : 'Speaks your captions into the call audio. Voice takes ~2-4 s.'}</small></span>
                <span className="ft-switch"><input type="checkbox" role="switch" checked={speak} onChange={(e) => setSpeak(e.target.checked)} aria-label="Voice captions into the call" /><span /></span>
              </label>
              <label className="ft-row">
                <span className="ico indigo"><SFSparkles size={18} /></span>
                <span className="grow">AI sentences from signs<small>Turns a signed phrase into one natural sentence.</small></span>
                <span className="ft-switch"><input type="checkbox" role="switch" checked={aiSigns} onChange={(e) => setAiSigns(e.target.checked)} aria-label="AI sentences from signs" /><span /></span>
              </label>
              <div className="ft-row">
                <span className="ico gray"><SFCaptions size={18} /></span>
                <span className="grow">Caption size</span>
                <span className="ft-stepper">
                  <button onClick={() => stepCaps(-1)} disabled={capScale <= CAP_SCALES[0]} aria-label="Smaller captions">A−</button>
                  <button onClick={() => stepCaps(1)} disabled={capScale >= CAP_SCALES[CAP_SCALES.length - 1]} aria-label="Larger captions">A+</button>
                </span>
              </div>
              <button className="ft-row" onClick={() => { setSheet(false); copyLink() }}>
                <span className="ico teal"><SFLink size={18} /></span>
                <span className="grow">Copy invite link<small>{inviteUrl.replace(/^https?:\/\//, '')}</small></span>
              </button>
            </div>
            <div className="ft-group"><button className="ft-row cancel" onClick={() => setSheet(false)}>Done</button></div>
          </div>
        </div>
      )}

      {/* full-screen states */}
      {media === 'denied' && (
        <div className="ft-panel" role="alert">
          <span className="ft-glyph"><SFVideoSlash size={34} /></span>
          <h2>Camera and microphone are blocked</h2>
          <p>Your camera is needed to read your signs. You can still type captions without it.</p>
          <ol className="ft-steps">
            <li>{/iPhone|iPad/.test(navigator.userAgent) ? 'Tap aA in the address bar, then Website Settings.' : 'Click the camera or lock icon in the address bar.'}</li>
            <li>Set Camera and Microphone to <b>Allow</b>.</li>
            <li>Come back and tap Try Again.</li>
          </ol>
          <div className="ft-actions">
            <button className="ft-bigbtn" onClick={() => retryMedia(false)}>Try Again</button>
            <button className="ft-bigbtn plain" onClick={() => retryMedia(true)}>Continue without camera</button>
            <button className="ft-bigbtn plain" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
      {media === 'error' && (
        <div className="ft-panel" role="alert">
          <span className="ft-glyph orange"><SFExclamation size={34} /></span>
          <h2>Camera unavailable</h2>
          <p>{mediaErr}</p>
          <div className="ft-actions">
            <button className="ft-bigbtn" onClick={() => retryMedia(false)}>Try Again</button>
            <button className="ft-bigbtn plain" onClick={() => retryMedia(true)}>Continue without camera</button>
            <button className="ft-bigbtn plain" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
      {conn === 'full' && (
        <div className="ft-panel" role="alert">
          <span className="ft-glyph orange"><SFExclamation size={34} /></span>
          <h2>This call is full</h2>
          <p>Only two people can be in a call, and someone else already opened this link. Start a new call to get a fresh link.</p>
          <div className="ft-actions">
            <button className="ft-bigbtn" onClick={again}>Try Again</button>
            <button className="ft-bigbtn plain" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
      {conn === 'ended' && (
        <div className="ft-panel ft-ended" role="status">
          <Avatar name={peerName} />
          <h2>Call ended</h2>
          <span className="dur">{endedFor ? fmt(endedFor) : 'Not connected'}</span>
          <div className="ft-actions row">
            <button className="ft-bigbtn gray" onClick={onClose}>Close</button>
            <button className="ft-bigbtn green" onClick={again}><SFVideo size={20} filled />Call again</button>
          </div>
        </div>
      )}
    </div>
  )
}
