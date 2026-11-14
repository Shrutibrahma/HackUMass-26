import { useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { Keyboard, Mic } from '../icons'
import { useSigning } from '../sign/useSigning'
import { SelfView } from './Call'

// Browser speech recognition (Chrome on Android and desktop). Audio stays with the browser's engine; no server STT.
type SR = any
const SpeechRecognition: SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

const QUICK = ['Yes, thank you.', 'No, thanks.', 'Could you say that again?', 'One moment, please.']

type Props = { onDone: () => void; myName?: string; preview?: { shown: string; said: string; label?: string } }

export function InPerson({ onDone, myName = '', preview }: Props) {
  const [shown, setShown] = useState(preview?.shown ?? "Hi! I sign. I'll show my answers here.")
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const rec = useRef<SR>(null)
  const want = useRef(true)
  const [signed, setSigned] = useState('')
  const sign = useSigning({
    enabled: !preview,
    onPhrase: (s) => {
      post<{ text: string }>('/api/signs/sentence', { signs: s, style: 'casual' })
        .then((r) => setSigned(r.text)).catch(() => {})
    },
  })

  useEffect(() => {
    if (!SpeechRecognition || preview) return
    const r = new SpeechRecognition()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onstart = () => setListening(true)
    r.onresult = (e: any) => {
      let fin = ''
      let mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) fin += t
        else mid += t
      }
      if (fin) setFinalText(fin.trim())
      setInterim(mid.trim())
    }
    r.onend = () => {
      setListening(false)
      if (want.current) setTimeout(() => { try { r.start() } catch { /* already started */ } }, 250)
    }
    r.onerror = (e: any) => { if (e.error === 'not-allowed') want.current = false }
    rec.current = r
    try { r.start() } catch { /* ignore */ }
    return () => { want.current = false; try { r.stop() } catch { /* ignore */ } }
  }, [preview])

  function show(t: string) {
    if (!t.trim()) return
    setShown(t.trim())
    setDraft('')
    setSigned('')
    setTyping(false)
  }
  const who = myName || 'They'
  const heard = preview ? preview.said : finalText

  return (
    <div className="screen">
      <div className="ip-top" aria-label="Shown to the other person">
        <small>{myName ? `${myName} is saying` : "They're saying"}</small>
        <div className="big" aria-live="polite">{shown}</div>
        <small>{who} sign{myName ? 's' : ''}, you read. Just talk normally.</small>
      </div>
      <div className="ip-mid">
        <Mic size={20} />
        <span style={{ fontSize: 15 }}>{preview || (SpeechRecognition && listening) ? 'Listening' : SpeechRecognition ? 'Paused' : 'No captions'}</span>
        <span className="grow">Top half faces them</span>
        <button className="ip-kbd" onClick={() => setTyping(!typing)} aria-label="Type instead"><Keyboard size={20} /></button>
        <button className="ip-done" onClick={onDone}>Done</button>
      </div>
      <div className="ip-bottom">
        <div className="said-label">{preview?.label ?? 'They said'}</div>
        <div className="said" aria-live="polite">
          {SpeechRecognition || preview
            ? (heard || interim ? <>{heard} <span className="interim">{interim}</span></> : <span className="interim">Waiting for them to talk...</span>)
            : <span className="interim">Live captions need Chrome on Android or a laptop. You can still show your answers.</span>}
        </div>
        {typing ? <>
          <div className="chips">{QUICK.map((q) => <button key={q} onClick={() => show(q)}>{q}</button>)}</div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); show(draft) }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your answer" aria-label="Your answer" autoFocus />
            <button className="btn btn-blue" type="submit" style={{ minHeight: 52 }}>Show</button>
          </form>
        </> : (
          <div className="ip-card">
            <SelfView signing camera={!preview} label="" className="ip-self" onVideo={sign.onVideo} />
            <div style={{ flex: 1 }} aria-live="polite">
              {signed ? <b style={{ fontSize: 18 }}>{signed}</b>
                : sign.signs && sign.signs.length ? <div className="signtags">{sign.signs.map((s, i) => <span key={i}>{s}</span>)}<span>...</span></div>
                : <>
                  <b className="cap-blue" style={{ fontFamily: 'var(--head)', fontSize: 17 }}>Sign your answer</b>
                  <div className="fine">It shows on the top half when you tap Show.</div>
                </>}
            </div>
            <button className="btn btn-blue" style={{ minHeight: 52 }} onClick={() => (signed ? show(signed) : draft ? show(draft) : setTyping(true))}>Show</button>
          </div>
        )}
      </div>
    </div>
  )
}


