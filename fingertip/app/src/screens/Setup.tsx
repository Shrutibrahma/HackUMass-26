import { useEffect, useRef, useState } from 'react'
import { post } from '../api'
import { APP_NAME, TAGLINE } from '../brand'
import { ago, avatarTone, CAPTION_SIZES, DEFAULT_QUICK, initials, INTRO_STYLES, introFor, prettyNumber, VOICES, type IntroStyle } from '../data'
import { Back, Gear, People, Play, Video as VideoIcon } from '../icons'
import type { Contact, Recent } from '../types'

export function Avatar({ c, size = '' }: { c: Pick<Contact, 'name' | 'kind' | 'knows_sign' | 'id'>; size?: string }) {
  return <div className={`av ${avatarTone(c)} ${size}`} aria-hidden>{initials(c.name)}</div>
}

/* ---------------------------------------------------------------- voice picker */

export function VoicePicker({ current, onDone }: { current: string | null; onDone: (id: string) => void }) {
  const [sel, setSel] = useState(current ?? VOICES[0].id)
  const [filter, setFilter] = useState<'any' | 'f' | 'm' | 'accent'>('any')
  const [playing, setPlaying] = useState<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const list = VOICES.filter((v) => filter === 'any' || (filter === 'accent' ? v.foreign : v.gender === filter))
  const chosen = VOICES.find((v) => v.id === sel) ?? VOICES[0]

  function play(id: string) {
    setSel(id)
    audio.current?.pause()
    const a = new Audio(`/voices/${id}.mp3`)
    audio.current = a
    setPlaying(id)
    setMissing(null)
    a.onended = () => setPlaying(null)
    a.play().catch(() => { setPlaying(null); setMissing(id) })
  }
  useEffect(() => () => audio.current?.pause(), [])

  return (
    <div className="screen">
      <div className="head-white" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: 30 }}>Pick your voice</h1>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>This is how you'll sound on every call. Change it anytime.</p>
        <div className="filters" role="group" aria-label="Filter voices">
          {([['any', 'Any'], ['f', 'Feminine'], ['m', 'Masculine'], ['accent', 'Accent']] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>
          ))}
        </div>
      </div>
      <div className="scroll pad16">
        {list.map((v) => (
          <div key={v.id} className={`voice ${sel === v.id ? 'on' : ''}`} role="button" tabIndex={0}
               onClick={() => setSel(v.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(v.id)} aria-pressed={sel === v.id}>
            <button className="playb" onClick={(e) => { e.stopPropagation(); play(v.id) }} aria-label={`Play ${v.name}`}>
              <Play size={18} />
            </button>
            <div className="meta">
              <b>{v.name}</b>
              <small>{v.feel} · {v.age} · {v.accent}</small>
            </div>
            {sel === v.id && <span className="sel">{playing === v.id ? 'Playing' : 'Selected'}</span>}
          </div>
        ))}
        <div className="sample">
          <small>Sample</small>
          "Hey! Yeah, I'll be there Sunday. Can't wait."
        </div>
        {missing && <p className="fine">That sample isn't on this device yet. You'll hear the voice on your first call.</p>}
      </div>
      <div className="foot">
        <button className="btn btn-blue grow" onClick={() => onDone(sel)}>Use {chosen.name}'s voice</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- home */

type HomeProps = {
  contacts: Contact[]
  recents: Recent[]
  online: boolean
  onOpen: (c: Contact) => void
  onDial: (number: string) => void
  onInPerson: () => void
  onSettings: () => void
  onShow?: () => void
  onVideo?: () => void
  onDemo?: () => void
  tabs?: React.ReactNode
}

export type Tab = 'call' | 'meetings' | 'play'

/** The three top-level experiences. */
export function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label={APP_NAME}>
      {([['call', 'Call'], ['meetings', 'Meetings'], ['play', 'Playground']] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{l}</button>
      ))}
    </div>
  )
}

export function Home({ contacts, recents, online, onOpen, onDial, onInPerson, onSettings, onShow, onVideo, onDemo, tabs }: HomeProps) {
  const [sheet, setSheet] = useState<'pad' | 'new' | null>(null)
  const favs = contacts.filter((c) => c.fav)
  const find = (r: Recent) => contacts.find((c) => c.id === r.contactId)

  return (
    <div className="screen">
      <div className="head-white">
        {tabs}
        <div className="title-row" style={tabs ? { marginTop: 12 } : undefined}>
          <div>
            <h1>Calls</h1>
            <div className="fine">{TAGLINE}</div>
            {!online && <div className="fine" style={{ color: 'var(--amber)' }}>Connecting to the server...</div>}
          </div>
          <button className="gear" onClick={onSettings} aria-label="Settings"><Gear size={22} /></button>
        </div>
      </div>
      <div className="scroll pad16" style={{ gap: 16 }}>
        <div className="label">Favorites</div>
        <div className="favs">
          {favs.map((c) => (
            <button key={c.id} className="fav" onClick={() => onOpen(c)}>
              <Avatar c={c} size="md" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
        <button className="cardbox tip" onClick={onInPerson}>
          <span className="ico"><People size={22} /></span>
          <span><b>Talk in person</b><small>Flip your phone so they can read</small></span>
        </button>
        {onVideo && (
          <button className="cardbox tip" onClick={onVideo}>
            <span className="ico"><VideoIcon size={22} /></span>
            <span><b>Video call with captions</b><small>Send a link. They join in any browser, no app.</small></span>
          </button>
        )}
        {onShow && (
          <button className="cardbox tip" onClick={onShow}>
            <span className="ico"><VideoIcon size={22} /></span>
            <span><b>Show it</b><small>Film a problem instead of describing it</small></span>
          </button>
        )}
        {onDemo && (
          <button className="link" style={{ alignSelf: 'flex-start', fontSize: 13, opacity: .7 }} onClick={onDemo}>
            Rehearse: simulated call from Mom (no real phone)
          </button>
        )}
        <div className="label" style={{ marginTop: 6 }}>Recent</div>
        <div>
          {recents.length === 0 && <div className="empty">Your calls will show up here.</div>}
          {recents.slice(0, 12).map((r) => (
            <button key={r.id} className={`recent ${r.direction === 'missed' ? 'missed' : ''}`}
                    onClick={() => { const c = find(r); if (c) onOpen(c); else onDial(r.number) }}>
              <span>
                <b>{r.name}</b>
                <small>{r.direction === 'missed' ? 'Missed' : r.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                  {r.seconds > 0 && ` · ${Math.max(1, Math.round(r.seconds / 60))} min`}</small>
              </span>
              <span className="when">{ago(r.at)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="foot">
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSheet('pad')}>Keypad</button>
        <button className="btn btn-blue" style={{ flex: 1.1 }} onClick={() => setSheet('new')}>New call</button>
      </div>
      {sheet === 'pad' && <Keypad onClose={() => setSheet(null)} onCall={(n) => { setSheet(null); onDial(n) }} />}
      {sheet === 'new' && (
        <div className="scrim" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New call">
            <div className="grab" />
            <h2>Who do you want to call?</h2>
            {contacts.map((c) => (
              <button key={c.id} className="recent" onClick={() => { setSheet(null); onOpen(c) }}>
                <Avatar c={c} size="sm" />
                <span><b>{c.name}</b><small>{c.number ? prettyNumber(c.number) : 'Add a number'}</small></span>
              </button>
            ))}
            <button className="btn btn-ghost" onClick={() => setSheet('pad')}>Enter a number</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Keypad({ onClose, onCall }: { onClose: () => void; onCall: (n: string) => void }) {
  const [n, setN] = useState('')
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
  const digits = n.replace(/\D/g, '')
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keypad">
        <div className="grab" />
        <div className="dialed" aria-live="polite">{prettyNumber(n) || ' '}</div>
        <div className="keypad">
          {keys.map((k) => <button key={k} onClick={() => setN((x) => (x + k).slice(0, 15))}>{k}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setN((x) => x.slice(0, -1))} aria-label="Delete digit">Delete</button>
          <button className="btn btn-blue grow" disabled={digits.length < 10} onClick={() => onCall(n)}>Call</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- settings */

export type Prefs = { quick: string[]; capScale: number; introStyle: IntroStyle }

export function Settings({ prefs, voiceName, onChange, onVoice, onBack }: {
  prefs: Prefs; voiceName: string; onChange: (p: Prefs) => void; onVoice: () => void; onBack: () => void
}) {
  const [adding, setAdding] = useState('')
  const addQuick = () => {
    const t = adding.trim()
    if (!t || prefs.quick.includes(t)) return
    onChange({ ...prefs, quick: [...prefs.quick, t].slice(0, 12) })
    setAdding('')
  }
  const move = (i: number, d: -1 | 1) => {
    const q = prefs.quick.slice()
    const j = i + d
    if (j < 0 || j >= q.length) return
    ;[q[i], q[j]] = [q[j], q[i]]
    onChange({ ...prefs, quick: q })
  }
  return (
    <div className="screen">
      <div className="head-white">
        <div className="title-row"><h1>Settings</h1><button className="link" onClick={onBack}>Done</button></div>
      </div>
      <div className="scroll pad16" style={{ gap: 14 }}>
        <div className="cardbox setting">
          <div className="txt"><b>Your voice</b><small>{voiceName}</small></div>
          <button className="link" onClick={onVoice}>Change</button>
        </div>

        <div className="cardbox boxpad">
          <div className="label">Caption size</div>
          <div className="filters" role="radiogroup" aria-label="Caption size">
            {CAPTION_SIZES.map((s) => (
              <button key={s.k} role="radio" aria-checked={prefs.capScale === s.k} className={prefs.capScale === s.k ? 'on' : ''}
                      onClick={() => onChange({ ...prefs, capScale: s.k })}>{s.label}</button>
            ))}
          </div>
          <div className="bub caller cap-sample" style={{ ['--cap' as any]: prefs.capScale }}>Hi! Are you still coming on Sunday?</div>
        </div>

        <div className="cardbox boxpad">
          <div className="label">At the start of calls with someone new, they hear</div>
          <div className="introopts" role="radiogroup" aria-label="How the heads-up describes you">
            {INTRO_STYLES.map((s) => (
              <button key={s.key} role="radio" aria-checked={prefs.introStyle === s.key} className={`introopt ${prefs.introStyle === s.key ? 'on' : ''}`}
                      onClick={() => onChange({ ...prefs, introStyle: s.key })}>
                <b>{s.label}</b><small>"{introFor(s.key)}"</small>
              </button>
            ))}
          </div>
        </div>

        <div className="cardbox boxpad">
          <div className="label">Quick replies</div>
          <div className="fine">Always one tap away in a call. Nothing is said until you tap. Money or bookings still ask you first.</div>
          <ul className="quicklist">
            {prefs.quick.map((q, i) => (
              <li key={q}>
                <span>{q}</span>
                <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move "${q}" up`}>↑</button>
                <button className="mini" onClick={() => move(i, 1)} disabled={i === prefs.quick.length - 1} aria-label={`Move "${q}" down`}>↓</button>
                <button className="mini" onClick={() => onChange({ ...prefs, quick: prefs.quick.filter((x) => x !== q) })} aria-label={`Remove "${q}"`}>✕</button>
              </li>
            ))}
          </ul>
          <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); addQuick() }}>
            <input className="num-input" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a reply" aria-label="New quick reply" maxLength={80} />
            <button className="btn btn-ghost" type="submit" style={{ minHeight: 48 }} disabled={!adding.trim()}>Add</button>
          </form>
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...prefs, quick: DEFAULT_QUICK })}>Reset to defaults</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- contact page */

export function ContactPage({ contact, voiceName, onChange, onBack, onCall, onVoice }: {
  contact: Contact; voiceName: string; onChange: (c: Contact) => void; onBack: () => void
  onCall: (c: Contact) => void; onVoice: () => void
}) {
  const [editing, setEditing] = useState(!contact.number)
  const [num, setNum] = useState(contact.number)
  const [err, setErr] = useState('')
  const style = contact.style ?? (contact.kind === 'business' ? 'polite' : 'casual')
  // Other-language calls need translation on the server (Gemini). Ask, don't assume.
  const [langs, setLangs] = useState<{ available: boolean; list: { code: string; name: string }[] } | null>(null)
  useEffect(() => {
    let stop = false
    fetch('/api/health').then((r) => r.json()).then((h) => { if (!stop) setLangs(h.languages ?? null) }).catch(() => {})
    return () => { stop = true }
  }, [])
  const langCode = contact.language || 'en-US'
  const langName = langs?.list.find((l) => l.code === langCode)?.name ?? 'English'

  function saveNumber(): boolean {
    const d = num.replace(/\D/g, '')
    if (d.length !== 10 && !(d.length === 11 && d.startsWith('1'))) {
      setErr('Add a 10-digit phone number first.')
      return false
    }
    onChange({ ...contact, number: num })
    setEditing(false)
    setErr('')
    return true
  }

  return (
    <div className="screen">
      <div className="contact-head">
        <button className="back" onClick={onBack} aria-label="Back"><Back /></button>
        <Avatar c={contact} size="lg" />
        <h1>{contact.name}</h1>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 300 }}>
            <input className="num-input" inputMode="tel" placeholder="(413) 555-0177" value={num} autoFocus
                   aria-label="Phone number" onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNumber()} />
            <button className="btn btn-ghost" style={{ minHeight: 48 }} onClick={saveNumber}>Save</button>
          </div>
        ) : (
          <p>mobile · <button className="link" style={{ minHeight: 0, fontWeight: 400, color: 'var(--ink-2)' }} onClick={() => setEditing(true)}>{prettyNumber(contact.number)}</button></p>
        )}
        {err && <div className="err">{err}</div>}
      </div>
      <div className="scroll pad16">
        <div className="cardbox setting">
          <div className="txt"><b>Knows I sign</b><small>Skip the heads-up at the start of calls</small></div>
          <button className={`toggle ${contact.knows_sign ? 'on' : ''}`} role="switch" aria-checked={contact.knows_sign}
                  aria-label="Knows I sign" onClick={() => onChange({ ...contact, knows_sign: !contact.knows_sign })} />
        </div>
        <div className="cardbox setting">
          <div className="txt"><b>Talk style</b><small>{style === 'casual' ? 'Casual' : 'Polite'}</small></div>
          <button className="link" onClick={() => onChange({ ...contact, style: style === 'casual' ? 'polite' : 'casual' })}>Change</button>
        </div>
        <div className="cardbox setting">
          <div className="txt">
            <b>They speak</b>
            <small>{langCode === 'en-US' ? 'English' : `${langName} · you read and write English`}
              {langs && !langs.available ? (langCode === 'en-US' ? ' · other languages need the Gemini key' : ' · needs the Gemini key on the server') : ''}</small>
          </div>
          <select className="lang-select" aria-label="Language they speak" value={langCode}
                  disabled={!langs || (!langs.available && langCode === 'en-US')}
                  onChange={(e) => onChange({ ...contact, language: e.target.value === 'en-US' ? '' : e.target.value })}>
            {(langs?.list ?? [{ code: 'en-US', name: 'English' }]).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div className="cardbox setting">
          <div className="txt"><b>Voice</b><small>{voiceName} (your default)</small></div>
          <button className="link" onClick={onVoice}>Change</button>
        </div>
      </div>
      <div className="foot">
        <button className="btn btn-blue grow" onClick={() => { if (!editing || saveNumber()) onCall({ ...contact, number: editing ? num : contact.number }) }}>
          Call {contact.name}
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- errand note */

export type Parsed = { auto_facts: { key: string; value: string }[]; needs_confirmation: string[] }

function factLabel(f: { key: string; value: string }): string[] {
  if (f.key === 'name') return [`Name: ${f.value}`]
  if (f.key === 'order') return f.value.split(/\s*(?:,| and )\s*/i).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1))
  return [f.value]
}

function confirmLabel(s: string): string {
  const t = s.toLowerCase()
  if (/total|price|cost|how much/.test(t)) return 'The total'
  if (/book|appointment/.test(t)) return 'The booking'
  return s[0].toUpperCase() + s.slice(1)
}

export function ErrandNote({ contact, onBack, onCall, busy, error, onParsed, preview }: {
  contact: Contact; onBack: () => void; onCall: (note: string) => void; busy: boolean; error: string
  onParsed?: (p: Parsed) => void; preview?: Parsed
}) {
  const [note, setNote] = useState(contact.note ?? '')
  const [parsed, setParsed] = useState<Parsed | null>(preview ?? null)

  useEffect(() => {
    if (preview) return
    if (!note.trim()) { setParsed(null); return }
    const t = setTimeout(() => {
      post<Parsed>('/api/note/parse', { note }).then((p) => { setParsed(p); onParsed?.(p) }).catch(() => setParsed(null))
    }, 450)
    return () => clearTimeout(t)
  }, [note, preview, onParsed])

  const says = parsed?.auto_facts.flatMap(factLabel) ?? []
  const checks = [...new Set((parsed?.needs_confirmation ?? []).map(confirmLabel))]
  if (says.length && !checks.includes('Placing the order') && parsed?.auto_facts.some((f) => f.key === 'order')) checks.push('Placing the order')

  return (
    <div className="screen">
      <div className="head-white" style={{ position: 'relative', paddingLeft: 64 }}>
        <button className="back" onClick={onBack} aria-label="Back" style={{ top: 'calc(28px + env(safe-area-inset-top))' }}><Back /></button>
        <div className="fine" style={{ fontSize: 15 }}>Calling</div>
        <h1 style={{ fontSize: 28 }}>{contact.name}</h1>
        <div className="fine" style={{ fontSize: 15 }}>{prettyNumber(contact.number)}</div>
      </div>
      <div className="scroll pad16">
        <label htmlFor="note" style={{ fontSize: 18 }}><b>Add a note</b> <span style={{ color: 'var(--ink-2)' }}>(optional)</span></label>
        <textarea id="note" className="note-area" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="What's the call for? e.g. order garlic bread, name Shruti, tell me the total first" />
        {(says.length > 0 || checks.length > 0) && (
          <div className="cardbox boxpad">
            {says.length > 0 && <>
              <div className="label cap-blue">I can say for you</div>
              <div className="chipset">{says.map((s) => <span key={s} className="tag blue">{s}</span>)}</div>
            </>}
            {checks.length > 0 && <>
              <div className="label cap-amber" style={{ marginTop: 6 }}>I'll check with you first</div>
              <div className="chipset">{checks.map((s) => <span key={s} className="tag amber">{s}</span>)}</div>
            </>}
          </div>
        )}
        <p className="fine">Anything about money or bookings always waits for your tap.</p>
        {error && <div className="err" role="alert">{error}</div>}
      </div>
      <div className="foot">
        <button className="btn btn-ghost" onClick={() => onCall('')} disabled={busy}>Skip</button>
        <button className="btn btn-blue grow" onClick={() => onCall(note)} disabled={busy}>{busy ? 'Calling...' : 'Call'}</button>
      </div>
    </div>
  )
}


