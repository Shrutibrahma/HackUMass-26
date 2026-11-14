import { useEffect, useState } from 'react'
import { post } from '../api'
import { APP_NAME } from '../brand'
import { useSigning } from '../sign/useSigning'
import { SelfView } from './Call'

/**
 * Google Meet (stretch, M6): the signer-only Chrome extension panel.
 * Display-only view for now; the extension itself is built only after M0-M5 are solid.
 */
export function MeetPanel({ preview = true }: { preview?: boolean }) {
  const people = [
    { n: 'Priya', c: 'var(--amber)' }, { n: 'Marcus', c: '#4d5765' },
    { n: 'Lena', c: '#4d5765' }, { n: 'You (Shruti)', c: 'var(--blue)' },
  ]
  return (
    <div className="meet">
      <div className="tiles">
        {people.map((p) => (
          <div key={p.n} className="tile">
            <div className="av lg" style={{ background: p.c, color: '#fff' }}>{p.n[0]}</div>
            <span>{p.n}</span>
          </div>
        ))}
        <div className="cc"><b>Marcus:</b> So can we commit to shipping Friday, or do we need more time?</div>
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#aeb6c2', fontSize: 14 }}>Team sync · Video call</div>
      </div>
      <div className="panel">
        <h3>{APP_NAME}</h3>
        <div className="fine">In this meeting</div>
        <SelfView signing camera={!preview} />
        <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
          <span className="lab" style={{ alignSelf: 'flex-start' }}>Ready to send</span>
          <div className="draftbub">I think Friday works. I'll finish testing by Thursday.</div>
        </div>
        <div className="fine">Everyone hears it in your voice and sees it in chat.</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost">Edit</button>
          <button className="btn btn-blue grow" style={{ fontSize: 16 }}>Send to meeting</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The live panel the Meet extension opens in a small window (/#meet).
 * Signs (or typing) -> one sentence -> "Send to meeting": the extension posts it to Meet chat and,
 * if voice is set up on the server, plays it into the Meet mic.
 */
export function MeetLive({ embedded = false }: { embedded?: boolean }) {
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState<string[]>([])
  const [err, setErr] = useState('')
  const opener = typeof window !== 'undefined' ? window.opener : null
  const sign = useSigning({
    onPhrase: (s) => {
      post<{ text: string }>('/api/signs/sentence', { signs: s, style: 'polite' })
        .then((r) => { setDraft(r.text); setEditing(false) }).catch(() => {})
    },
  })

  function send() {
    const text = draft.trim()
    if (!text) return
    setErr('')
    const done = () => { setSent((s) => [...s, text]); setDraft(''); setEditing(false) }
    if (opener && !embedded) {
      opener.postMessage({ source: 'sign2speak', type: 'send', text }, 'https://meet.google.com')
      done()
      return
    }
    // No Meet window: speak through the desktop bridge (virtual microphone for Zoom, Teams, Meet app).
    post<{ ok: boolean; bridges: number; reason?: string }>('/api/meet/say', { text }).then((r) => {
      if (!r.ok) { setErr(r.reason ?? "Couldn't send that."); return }
      if (r.bridges === 0) { setErr('Nothing was said: the desktop bridge is not connected. See the steps above.'); return }
      setNote(`Sent to ${r.bridges === 1 ? 'your virtual microphone' : `${r.bridges} bridges`}.`)
      done()
    }).catch((e) => setErr(e.message))
  }

  return (
    <div className={embedded ? 'meet-embedded' : 'screen'}>
      <div className="pad16" style={embedded ? { padding: 0 } : { flex: 1, overflow: 'auto' }}>
        {!embedded && <><h3 style={{ fontSize: 20 }}>{APP_NAME}</h3><div className="fine">In this meeting</div></>}
        <div style={{ position: 'relative', height: 200 }}>
          <SelfView signing={!!sign.signs} onVideo={sign.onVideo} className="selfview meet-self" />
        </div>
        {sent.map((t, i) => <div key={i} className="bub me" style={{ fontSize: 16 }}>{t}</div>)}
        {sign.signs && !draft && (
          <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
            <span className="lab">Reading your signs...</span>
            <div className="draftbub signing-box"><div className="signtags" style={{ marginTop: 0 }}>{sign.signs.map((s, i) => <span key={i}>{s}</span>)}<span>...</span></div></div>
          </div>
        )}
        {(draft || editing) && (
          <div className="draft-wrap" style={{ alignSelf: 'stretch', maxWidth: 'none' }}>
            <span className="lab" style={{ alignSelf: 'flex-start' }}>{editing ? 'Editing' : 'Ready to send'}</span>
            {editing
              ? <textarea className="editbox" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label="Your message" />
              : <button className="draftbub" onClick={() => setEditing(true)}>{draft}</button>}
          </div>
        )}
        <div className="fine">{embedded ? 'Sign, or tap Type. Nothing is said until you tap Say it.' : 'Everyone hears it in your voice and sees it in chat.'}</div>
        {note && !err && <div className="fine" role="status" style={{ color: 'var(--blue)' }}>{note}</div>}
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      <div className="foot" style={embedded ? { border: 0, padding: '12px 0 0', background: 'none' } : undefined}>
        <button className="btn btn-ghost" onClick={() => setEditing(true)}>{draft ? 'Edit' : 'Type'}</button>
        <button className="btn btn-blue grow" style={{ fontSize: 16 }} disabled={!draft.trim()} onClick={send}>{embedded ? 'Say it in the meeting' : 'Send to meeting'}</button>
      </div>
    </div>
  )
}


/**
 * Meetings tab: the same sign-to-voice engine, spoken into a meeting you already use.
 * Every status line here is read from the server; nothing is assumed.
 */
type Health = { bridges: number; meet_voice: string | null }

export function MeetingsPage({ tabs }: { tabs: React.ReactNode }) {
  const [h, setH] = useState<Health | null>(null)
  useEffect(() => {
    let stop = false
    const poll = () => fetch('/api/health').then((r) => r.json()).then((j) => { if (!stop) setH(j) }).catch(() => { if (!stop) setH(null) })
    poll()
    const t = setInterval(poll, 3000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  const server = `${location.origin}`
  const Step = ({ ok, title, children }: { ok: boolean | null; title: string; children: React.ReactNode }) => (
    <div className="mstep">
      <span className={`mdot ${ok === true ? 'ok' : ok === false ? 'no' : ''}`} aria-hidden />
      <div><b>{title}</b><div className="fine">{children}</div></div>
    </div>
  )
  return (
    <div className="screen">
      <div className="head-white">{tabs}<h1 style={{ fontSize: 28, marginTop: 12 }}>Meetings</h1>
        <p className="fine" style={{ margin: '4px 0 0', fontSize: 15 }}>Sign in Zoom, Teams or Meet. The others install nothing.</p></div>
      <div className="scroll pad16">
        <div className="cardbox boxpad">
          <div className="label">Set up once</div>
          <Step ok={h ? !!h.meet_voice : null} title={h?.meet_voice ? `Voice is ready (${h.meet_voice === 'gemini' ? 'Gemini speech' : 'ElevenLabs'})` : 'Voice on the server'}>
            {h?.meet_voice ? 'Your sentences can be spoken in meetings.' : h ? 'Not set up: the server needs a Gemini or ElevenLabs key.' : 'Checking...'}
          </Step>
          <Step ok={h ? h.bridges > 0 : null} title={h && h.bridges > 0 ? 'Desktop bridge connected' : 'Desktop bridge (Zoom, Teams, any app)'}>
            {h && h.bridges > 0 ? 'Your virtual microphone is listening for sentences.' : <>
              Install a virtual audio cable (VB-CABLE on Windows, BlackHole on macOS), then run on this laptop:
              <code className="mcode">python bridge/sign2speak_bridge.py {server}</code>
              In the meeting app, pick the cable as your microphone ("CABLE Output" or "BlackHole 2ch").</>}
          </Step>
          <Step ok={null} title="Google Meet in Chrome">
            Load the <code>extension/</code> folder in Chrome (Extensions, Developer mode, Load unpacked), then tap
            the {APP_NAME} button inside Meet. It speaks into your Meet microphone and posts to chat. We can't detect it from here.
          </Step>
        </div>
        <div className="cardbox boxpad">
          <div className="label">Say something in your meeting</div>
          <MeetLive embedded />
        </div>
        <p className="fine">While the bridge is your microphone, the meeting hears only the generated voice. For what others say, turn on the meeting's own captions.</p>
      </div>
    </div>
  )
}


