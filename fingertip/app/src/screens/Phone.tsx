import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME } from '../brand'
import { ago, CAPTION_SIZES, DEFAULT_QUICK, INTRO_STYLES, introFor, prettyNumber, VOICES } from '../data'
import {
  SFCaptions, SFChevronLeft, SFChevronRight, SFClock, SFDelete, SFGear, SFHand, SFInfo, SFKeypad, SFPerson, SFPhone,
  SFCheck, SFPlus, SFSparkles, SFStar, SFVideo, SFWifiSlash, SFXmark,
} from '../sf'
import type { Contact, Recent } from '../types'
import type { Prefs } from './Setup'

/* ---------------------------------------------------------------- shared bits */

export function StatusBar() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')
  return (
    <div className="ios-status" aria-hidden>
      <span>{time}</span><span className="island" />
      <span className="icons">
        <span className="bars"><i style={{ height: 4 }} /><i style={{ height: 6 }} /><i style={{ height: 8 }} /><i style={{ height: 11 }} /></span>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10 10 0 0 0 8 .6 10 10 0 0 0 .9 3.4L2 4.6a8.4 8.4 0 0 1 6-2.4zm0 3.3c1.4 0 2.7.5 3.7 1.4l1.1-1.2A7.1 7.1 0 0 0 8 3.9a7.1 7.1 0 0 0-4.8 1.8l1.1 1.2c1-.9 2.3-1.4 3.7-1.4zm0 3.3c.6 0 1.1.2 1.5.5L8 10.9 6.5 9.3c.4-.3.9-.5 1.5-.5z" /></svg>
        <span className="battery"><i /></span>
      </span>
    </div>
  )
}

const TONES = ['#ff9f0a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#5e5ce6']
export function monogram(name: string) {
  const w = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return w.slice(0, 2).map((x) => x[0]).join('').toUpperCase()
}
/** iOS Contacts-style monogram; businesses get a tinted tile colour, people the classic grey gradient. */
export function IOSAvatar({ name, size = 'sm', business = false }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl'; business?: boolean }) {
  const ini = monogram(name)
  const tone = business ? TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length] : undefined
  return (
    <span className={`ios-avatar ${size}`} aria-hidden style={tone ? { background: `linear-gradient(180deg, ${tone}, ${tone}cc)` } : undefined}>
      {ini || <SFPerson size={size === 'sm' ? 22 : size === 'md' ? 34 : 56} filled />}
    </span>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="ios-switch"><input type="checkbox" role="switch" aria-label={label} checked={on} onChange={(e) => onChange(e.target.checked)} /><span /></label>
}

/* ---------------------------------------------------------------- Phone home (tab bar app) */

export type PhoneTab = 'favorites' | 'recents' | 'contacts' | 'keypad'

type HomeProps = {
  contacts: Contact[]
  recents: Recent[]
  online: boolean
  onOpen: (c: Contact) => void
  onCall: (c: Contact) => void
  onDial: (number: string) => void
  onSettings: () => void
  onVideo: () => void
  onDemo: () => void
  onAddContact: (c: Contact) => void
  onClearRecents: () => void
}

export function PhoneHome(p: HomeProps) {
  const [tab, setTab] = useState<PhoneTab>(() => (sessionStorage.getItem('phone-tab') as PhoneTab) || 'favorites')
  useEffect(() => { try { sessionStorage.setItem('phone-tab', tab) } catch { /* private */ } }, [tab])
  return (
    <div className="screen ios phone">
      <StatusBar />
      {!p.online && <div className="ios-banner warn" role="status"><SFWifiSlash size={18} /><span>Connecting to the {APP_NAME} server… Calls start as soon as it's back.</span></div>}
      <div className="phone-body">
        {tab === 'favorites' && <Favorites {...p} />}
        {tab === 'recents' && <Recents {...p} />}
        {tab === 'contacts' && <Contacts {...p} />}
        {tab === 'keypad' && <DialPad onDial={p.onDial} contacts={p.contacts} />}
      </div>
      <nav className="ios-tabbar ios-material-thick" aria-label="Phone">
        {([['favorites', 'Favorites', <SFStar key="s" size={25} filled={tab === 'favorites'} />],
          ['recents', 'Recents', <SFClock key="c" size={25} filled={tab === 'recents'} />],
          ['contacts', 'Contacts', <SFPerson key="p" size={25} filled={tab === 'contacts'} />],
          ['keypad', 'Keypad', <SFKeypad key="k" size={25} />]] as const).map(([k, label, icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>{icon}{label}</button>
        ))}
      </nav>
    </div>
  )
}

function Favorites({ contacts, onOpen, onCall, onSettings, onVideo, onDemo }: HomeProps) {
  const favs = contacts.filter((c) => c.fav)
  return (
    <div className="scroll">
      <div className="ios-nav"><span /><button onClick={onSettings} aria-label="Settings"><SFGear size={22} /></button></div>
      <h1 className="ios-large-title">Favorites</h1>
      <div className="quick-actions">
        <button onClick={onVideo}><span className="qa-ico" style={{ background: 'var(--sys-green)' }}><SFVideo size={22} filled /></span>
          <span><b>Video call with captions</b><small>Send a link. They join from any browser.</small></span></button>
      </div>
      <div className="ios-group ios-plain" style={{ marginTop: 14 }}>
        {favs.length === 0 && <div className="ios-row"><span className="grow sub">Star a contact to keep them here.</span></div>}
        {favs.map((c) => (
          <div key={c.id} className="ios-row" style={{ ['--inset' as string]: '68px' }}>
            <button className="fav-main" onClick={() => onCall(c)} aria-label={`Call ${c.name}`}>
              <IOSAvatar name={c.name} business={c.kind === 'business'} />
              <span className="grow"><span className="name">{c.name}</span>
                <span className="sub"><SFPhone size={12} /> {c.number ? 'mobile' : 'add number'}{c.knows_sign ? ' · knows I sign' : ''}</span></span>
            </button>
            <button className="info" onClick={() => onOpen(c)} aria-label={`${c.name} details`}><SFInfo size={22} /></button>
          </div>
        ))}
      </div>
      <p className="ios-section-f">Tap a name to call. Captions, AI replies and signing are ready in every call.</p>
      <div className="ios-group" style={{ marginTop: 22 }}>
        <button className="ios-row" onClick={onDemo}>
          <span className="ios-icon-tile" style={{ background: 'var(--sys-orange)' }}><SFPhone size={16} /></span>
          <span className="grow">Rehearse a call<span className="sub">Simulated call from Mom · no real phone</span></span>
          <SFChevronRight size={16} className="chev" />
        </button>
      </div>
      <div style={{ height: 24 }} />
    </div>
  )
}

function Recents({ recents, contacts, onOpen, onDial, onClearRecents }: HomeProps) {
  const [missedOnly, setMissedOnly] = useState(false)
  const list = recents.filter((r) => !missedOnly || r.direction === 'missed')
  const find = (r: Recent) => contacts.find((c) => c.id === r.contactId)
  return (
    <div className="scroll">
      <div className="ios-nav">
        <span />
        <div className="ios-seg" style={{ width: 180 }} role="radiogroup" aria-label="Show">
          <button className={!missedOnly ? 'on' : ''} role="radio" aria-checked={!missedOnly} onClick={() => setMissedOnly(false)}>All</button>
          <button className={missedOnly ? 'on' : ''} role="radio" aria-checked={missedOnly} onClick={() => setMissedOnly(true)}>Missed</button>
        </div>
        {recents.length ? <button onClick={onClearRecents}>Clear</button> : <span style={{ width: 40 }} />}
      </div>
      <h1 className="ios-large-title">Recents</h1>
      {list.length === 0
        ? <div className="empty-state"><SFClock size={40} /><b>{missedOnly ? 'No missed calls' : 'No recent calls'}</b><span>Calls you make and receive show up here.</span></div>
        : <div className="ios-plain">
          {list.slice(0, 40).map((r) => {
            const c = find(r)
            return (
              <div key={r.id} className="ios-row" style={{ ['--inset' as string]: '16px' }}>
                <button className="fav-main" onClick={() => (c ? onOpen(c) : onDial(r.number))}>
                  <span className="grow"><span className={`name ${r.direction === 'missed' ? 'missed' : ''}`}>{r.name}</span>
                    <span className="sub">{r.direction === 'missed' ? 'Missed' : r.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                      {r.seconds > 0 ? ` · ${Math.max(1, Math.round(r.seconds / 60))} min` : ''}</span></span>
                  <span className="detail">{ago(r.at)}</span>
                </button>
                {c && <button className="info" onClick={() => onOpen(c)} aria-label={`${r.name} details`}><SFInfo size={22} /></button>}
              </div>
            )
          })}
        </div>}
    </div>
  )
}

function Contacts({ contacts, onOpen, onAddContact }: HomeProps) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const list = useMemo(() => contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.number.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name)), [contacts, q])
  const groups = useMemo(() => {
    const m = new Map<string, Contact[]>()
    for (const c of list) { const k = (c.name[0] || '#').toUpperCase(); m.set(k, [...(m.get(k) ?? []), c]) }
    return [...m.entries()]
  }, [list])
  return (
    <div className="scroll">
      <div className="ios-nav"><span /><button onClick={() => setAdding(true)} aria-label="New contact"><SFPlus size={22} /></button></div>
      <h1 className="ios-large-title">Contacts</h1>
      <label className="ios-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search contacts" /></label>
      {groups.map(([letter, cs]) => (
        <div key={letter}>
          <div className="letter-h">{letter}</div>
          <div className="ios-plain">
            {cs.map((c) => (
              <button key={c.id} className="ios-row" style={{ ['--inset' as string]: '16px' }} onClick={() => onOpen(c)}>
                <span className="grow"><b style={{ fontWeight: 600 }}>{c.name}</b>{c.kind === 'business' && <span className="sub">Business</span>}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="empty-state"><SFPerson size={40} /><b>No results</b></div>}
      {adding && <NewContactSheet onCancel={() => setAdding(false)} onSave={(c) => { onAddContact(c); setAdding(false) }} />}
    </div>
  )
}

function NewContactSheet({ onCancel, onSave }: { onCancel: () => void; onSave: (c: Contact) => void }) {
  const [name, setName] = useState('')
  const [num, setNum] = useState('')
  const [biz, setBiz] = useState(false)
  const digits = num.replace(/\D/g, '')
  const ok = name.trim() && (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))
  return (
    <div className="ios-scrim" onClick={onCancel}>
      <div className="ios-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New contact">
        <div className="sheet-nav"><button onClick={onCancel}>Cancel</button><b>New Contact</b>
          <button disabled={!ok} style={{ fontWeight: 600 }} onClick={() => onSave({ id: `c${Date.now()}`, name: name.trim(), number: num, knows_sign: false, kind: biz ? 'business' : 'person', style: biz ? 'polite' : 'casual', fav: false })}>Done</button></div>
        <div className="ios-group" style={{ margin: '8px 0 0' }}>
          <input className="ios-field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Name" />
          <input className="ios-field" placeholder="Phone (10 digits)" inputMode="tel" value={num} onChange={(e) => setNum(e.target.value)} aria-label="Phone number" />
          <div className="ios-row"><span className="grow">Business</span><Switch on={biz} onChange={setBiz} label="Business" /></div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- dial pad (iOS Keypad) */

const KEYS: [string, string][] = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']]

export function KeyGrid({ onKey, small = false }: { onKey: (k: string) => void; small?: boolean }) {
  return (
    <div className={`keygrid ${small ? 'small' : ''}`}>
      {KEYS.map(([k, letters]) => (
        <button key={k} onClick={() => onKey(k)} aria-label={k}><span className="d">{k}</span>{letters && <span className="l">{letters}</span>}</button>
      ))}
    </div>
  )
}

function DialPad({ onDial, contacts }: { onDial: (n: string) => void; contacts: Contact[] }) {
  const [n, setN] = useState('')
  const digits = n.replace(/\D/g, '')
  const match = digits.length >= 4 ? contacts.find((c) => c.number.replace(/\D/g, '').endsWith(digits.slice(-10))) : undefined
  const holdTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9*#]$/.test(e.key)) setN((x) => (x + e.key).slice(0, 15))
      else if (e.key === 'Backspace') setN((x) => x.slice(0, -1))
      else if (e.key === 'Enter' && digits.length >= 10) onDial(n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, digits.length, onDial])
  return (
    <div className="dialpad">
      <div className="dial-number" aria-live="polite">{prettyNumber(n) || ' '}</div>
      <div className="dial-match">{match ? match.name : n && digits.length < 10 ? '' : ' '}</div>
      <KeyGrid onKey={(k) => setN((x) => (x + k).slice(0, 15))} />
      <div className="dial-actions">
        <span />
        <button className="dial-call" disabled={digits.length < 10} onClick={() => onDial(n)} aria-label="Call"><SFPhone size={34} /></button>
        {n ? <button className="dial-del" aria-label="Delete" onClick={() => setN((x) => x.slice(0, -1))}
          onPointerDown={() => { holdTimer.current = window.setTimeout(() => setN(''), 600) }}
          onPointerUp={() => window.clearTimeout(holdTimer.current)}><SFDelete size={26} /></button> : <span />}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- contact card */

export function ContactCard({ contact, voiceName, langs, onChange, onBack, onCall, onVoice, onDelete, onVideo, error }: {
  contact: Contact; voiceName: string; langs: { available: boolean; list: { code: string; name: string }[] } | null
  onChange: (c: Contact) => void; onBack: () => void; onCall: (c: Contact) => void; onVoice: () => void; onDelete: () => void; onVideo?: () => void; error?: string
}) {
  const [num, setNum] = useState(contact.number)
  const [editingNum, setEditingNum] = useState(!contact.number)
  const [err, setErr] = useState('')
  const style = contact.style ?? (contact.kind === 'business' ? 'polite' : 'casual')
  const langCode = contact.language || 'en-US'
  const saveNumber = (): boolean => {
    const d = num.replace(/\D/g, '')
    if (d.length !== 10 && !(d.length === 11 && d.startsWith('1'))) { setErr('Enter a 10-digit phone number.'); return false }
    onChange({ ...contact, number: num }); setEditingNum(false); setErr(''); return true
  }
  const call = () => { if (!editingNum || saveNumber()) onCall({ ...contact, number: editingNum ? num : contact.number }) }
  return (
    <div className="screen ios phone">
      <StatusBar />
      <div className="ios-nav"><button onClick={onBack}><SFChevronLeft size={22} />Contacts</button>
        <button onClick={() => onChange({ ...contact, fav: !contact.fav })} aria-label={contact.fav ? 'Remove from favorites' : 'Add to favorites'}>
          <SFStar size={22} filled={!!contact.fav} /></button></div>
      <div className="scroll">
        <div className="card-head">
          <IOSAvatar name={contact.name} size="lg" business={contact.kind === 'business'} />
          <h1>{contact.name}</h1>
          {contact.kind === 'business' && <span className="sub">Business · polite talk style</span>}
          <div className="card-actions">
            <button onClick={call} aria-label={`Call ${contact.name}`}><SFPhone size={22} /><span>call</span></button>
            <button onClick={onVideo} disabled={!onVideo} aria-label={`Video call ${contact.name}`}><SFVideo size={22} filled /><span>video</span></button>
            <button onClick={() => onChange({ ...contact, fav: !contact.fav })} aria-label={contact.fav ? 'Remove from favorites' : 'Add to favorites'}>
              <SFStar size={22} filled={!!contact.fav} /><span>{contact.fav ? 'favorite' : 'add favorite'}</span></button>
          </div>
        </div>
        {(err || error) && <div className="ios-banner bad" role="alert">{err || error}</div>}
        <div className="ios-group" style={{ marginTop: 16 }}>
          {editingNum ? (
            <div className="ios-row"><span className="grow"><span className="sub" style={{ marginTop: 0 }}>mobile</span>
              <input className="inline-field" inputMode="tel" placeholder="(413) 555-0177" value={num} autoFocus aria-label="Phone number"
                onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNumber()} /></span>
              <button className="ios-link" onClick={saveNumber}>Save</button></div>
          ) : (
            <button className="ios-row" onClick={() => setEditingNum(true)}><span className="grow"><span className="sub" style={{ marginTop: 0 }}>mobile</span>
              <span style={{ color: 'var(--sys-blue)' }}>{prettyNumber(contact.number)}</span></span><span className="detail">Edit</span></button>
          )}
        </div>
        <div className="ios-section-h">Accessibility on calls</div>
        <div className="ios-group">
          <div className="ios-row"><span className="grow">Knows I sign<span className="sub">Skip the heads-up at the start of calls</span></span>
            <Switch on={contact.knows_sign} onChange={(v) => onChange({ ...contact, knows_sign: v })} label="Knows I sign" /></div>
          <div className="ios-row"><span className="grow">Talk style</span>
            <div className="ios-seg" style={{ width: 150 }}>
              {(['casual', 'polite'] as const).map((s) => <button key={s} className={style === s ? 'on' : ''} onClick={() => onChange({ ...contact, style: s })}>{s === 'casual' ? 'Casual' : 'Polite'}</button>)}
            </div></div>
          <div className="ios-row"><span className="grow">They speak
            <span className="sub">{langs && !langs.available ? 'Other languages need the Gemini key on the server' : 'You still read and write English'}</span></span>
            <select className="ios-select" aria-label="Language they speak" value={langCode} disabled={!langs || (!langs.available && langCode === 'en-US')}
              onChange={(e) => onChange({ ...contact, language: e.target.value === 'en-US' ? '' : e.target.value })}>
              {(langs?.list ?? [{ code: 'en-US', name: 'English' }]).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select></div>
          <button className="ios-row" onClick={onVoice}><span className="grow">Voice</span><span className="detail">{voiceName}</span><SFChevronRight size={16} className="chev" /></button>
        </div>
        <div className="ios-group" style={{ marginTop: 22 }}>
          <button className="ios-row danger" onClick={onDelete}>Delete Contact</button>
        </div>
        <div style={{ height: 28 }} />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- settings */

export function SettingsIOS({ prefs, voiceName, onChange, onVoice, onBack, onMeetings, onPlayground }: {
  prefs: Prefs; voiceName: string; onChange: (p: Prefs) => void; onVoice: () => void; onBack: () => void
  onMeetings: () => void; onPlayground: () => void
}) {
  const [adding, setAdding] = useState('')
  const add = () => { const t = adding.trim(); if (t && !prefs.quick.includes(t)) onChange({ ...prefs, quick: [...prefs.quick, t].slice(0, 12) }); setAdding('') }
  return (
    <div className="screen ios phone">
      <StatusBar />
      <div className="ios-nav"><span /><button onClick={onBack} style={{ fontWeight: 600 }}>Done</button></div>
      <div className="scroll">
        <h1 className="ios-large-title">Settings</h1>
        <div className="ios-group">
          <button className="ios-row" onClick={onVoice}><span className="ios-icon-tile" style={{ background: 'var(--sys-indigo)' }}><SFSparkles size={17} /></span>
            <span className="grow">Your voice</span><span className="detail">{voiceName}</span><SFChevronRight size={16} className="chev" /></button>
        </div>
        <div className="ios-section-h">Caption size</div>
        <div className="ios-group" style={{ padding: 12 }}>
          <div className="ios-seg">{CAPTION_SIZES.map((s) => <button key={s.k} className={prefs.capScale === s.k ? 'on' : ''} onClick={() => onChange({ ...prefs, capScale: s.k })}>{s.label}</button>)}</div>
          <div className="cap-preview" style={{ fontSize: 17 * prefs.capScale }}>Hi! Are you still coming on Sunday?</div>
        </div>
        <div className="ios-section-h">Heads-up for new people</div>
        <div className="ios-group">
          {INTRO_STYLES.map((s) => (
            <button key={s.key} className="ios-row" onClick={() => onChange({ ...prefs, introStyle: s.key })} role="radio" aria-checked={prefs.introStyle === s.key}>
              <span className="grow">{s.label}<span className="sub">“{introFor(s.key)}”</span></span>
              {prefs.introStyle === s.key && <SFCheck size={18} className="check" />}
            </button>
          ))}
        </div>
        <div className="ios-section-h">Quick replies</div>
        <div className="ios-group">
          {prefs.quick.map((q) => (
            <div key={q} className="ios-row"><span className="grow">{q}</span>
              <button aria-label={`Remove ${q}`} onClick={() => onChange({ ...prefs, quick: prefs.quick.filter((x) => x !== q) })} className="row-del"><SFXmark size={14} /></button></div>
          ))}
          <form className="ios-row" onSubmit={(e) => { e.preventDefault(); add() }}>
            <input className="inline-field" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a reply" aria-label="New quick reply" maxLength={80} />
            <button className="ios-link" type="submit" disabled={!adding.trim()}>Add</button></form>
        </div>
        <p className="ios-section-f">Always one tap away in a call. Nothing is said until you tap. <button className="ios-link" style={{ fontSize: 13 }} onClick={() => onChange({ ...prefs, quick: DEFAULT_QUICK })}>Reset</button></p>
        <div className="ios-section-h">More from {APP_NAME}</div>
        <div className="ios-group">
          <button className="ios-row" onClick={onMeetings}><span className="ios-icon-tile" style={{ background: 'var(--sys-blue)' }}><SFCaptions size={17} /></span>
            <span className="grow">Meetings<span className="sub">Captions in Google Meet and Zoom web</span></span><SFChevronRight size={16} className="chev" /></button>
          <button className="ios-row" onClick={onPlayground}><span className="ios-icon-tile" style={{ background: 'var(--sys-teal)' }}><SFHand size={17} /></span>
            <span className="grow">Playground<span className="sub">Gesture synth</span></span><SFChevronRight size={16} className="chev" /></button>
        </div>
        <div style={{ height: 28 }} />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- voice picker */

export function VoicePickerIOS({ current, onDone, first = false }: { current: string | null; onDone: (id: string) => void; first?: boolean }) {
  const [sel, setSel] = useState(current ?? VOICES[0].id)
  const [playing, setPlaying] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const play = (id: string) => {
    setSel(id); audio.current?.pause()
    const a = new Audio(`/voices/${id}.mp3`); audio.current = a; setPlaying(id)
    a.onended = () => setPlaying(null); a.play().catch(() => setPlaying(null))
  }
  const chosen = VOICES.find((v) => v.id === sel) ?? VOICES[0]
  return (
    <div className="screen ios phone">
      <StatusBar />
      <div className="ios-nav">{first ? <span /> : <button onClick={() => onDone(current ?? sel)}><SFChevronLeft size={22} />Back</button>}<span /></div>
      <div className="scroll">
        <h1 className="ios-large-title">{first ? 'Choose your voice' : 'Voice'}</h1>
        <p className="ios-subtitle">This is how you'll sound when the app speaks for you on calls. You can change it anytime.</p>
        <div className="ios-group">
          {VOICES.map((v) => (
            <button key={v.id} className="ios-row" onClick={() => setSel(v.id)} role="radio" aria-checked={sel === v.id}>
              <span className="voice-play" role="button" tabIndex={0} aria-label={`Play ${v.name}`} onClick={(e) => { e.stopPropagation(); play(v.id) }}>
                {playing === v.id ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>}</span>
              <span className="grow">{v.name}<span className="sub">{v.feel} · {v.accent}</span></span>
              {sel === v.id && <SFCheck size={18} className="check" />}
            </button>
          ))}
        </div>
        <p className="ios-section-f">Powered by ElevenLabs through the phone line.</p>
      </div>
      <div className="sheet-foot"><button className="ios-btn filled" style={{ width: '100%' }} onClick={() => onDone(sel)}>Use {chosen.name}</button></div>
    </div>
  )
}
