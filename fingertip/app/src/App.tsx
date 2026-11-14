import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Live, post } from './api'
import { DEFAULT_CONTACTS, DEFAULT_QUICK, sameNumber, VOICES } from './data'
import { AfterCall, Calling, InCall, Incoming } from './screens/Call'
import { InPerson } from './screens/InPerson'
import { MeetingsPage } from './screens/Meet'
import { Playground } from './screens/Playground'
import { ShowFlow } from './screens/Show'
import { ContactPage, ErrandNote, Home, Settings, Tabs, VoicePicker, type Prefs, type Tab } from './screens/Setup'
import { initial, reduce } from './store'
import { load, save } from './storage'
import type { CallView, Contact, Recent, SavedTranscript } from './types'

type Route =
  | { name: 'home' }
  | { name: 'contact'; id: string }
  | { name: 'note'; contact: Contact }
  | { name: 'voice'; back: Route }
  | { name: 'inperson' }
  | { name: 'settings' }
  | { name: 'show' }

export default function App() {
  const [s, dispatch] = useReducer(reduce, initial)
  const [contacts, setContacts] = useState<Contact[]>(() => load('contacts', DEFAULT_CONTACTS))
  const [recents, setRecents] = useState<Recent[]>(() => load('recents', []))
  const [voiceId, setVoiceId] = useState<string | null>(() => load<string | null>('voice', null))
  const [route, setRoute] = useState<Route>(() => (load<string | null>('voice', null) ? { name: 'home' } : { name: 'voice', back: { name: 'home' } }))
  const [online, setOnline] = useState(false)
  const [firstWords, setFirstWords] = useState<Record<string, string | null>>({})
  const [dialError, setDialError] = useState('')
  const [dialing, setDialing] = useState(false)
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#meetings' ? 'meetings' : location.hash === '#play' ? 'play' : 'call'))
  const tabs = <Tabs tab={tab} onTab={setTab} />
  const [myName, setMyName] = useState<string>(() => load('myName', ''))
  const [prefs, setPrefs] = useState<Prefs>(() => ({ quick: DEFAULT_QUICK, capScale: 1, introStyle: 'deaf', ...load<Partial<Prefs>>('prefs', {}) }))
  const live = useRef<Live | null>(null)
  const helloRef = useRef(() => ({}))
  helloRef.current = () => ({ type: 'hello', contacts, voice_id: voiceId, intro_style: prefs.introStyle })

  useEffect(() => save('prefs', prefs), [prefs])
  useEffect(() => save('contacts', contacts), [contacts])
  useEffect(() => save('recents', recents), [recents])

  useEffect(() => {
    const l = new Live(() => helloRef.current())
    l.onMessage = (m) => dispatch(m)
    l.onStatus = setOnline
    l.connect()
    live.current = l
    return () => l.close()
  }, [])
  useEffect(() => { live.current?.send(helloRef.current()) }, [contacts, voiceId, prefs.introStyle])

  // Log finished calls to Recent (on this device only).
  const logged = useRef(new Set<string>())
  useEffect(() => {
    for (const c of Object.values(s.calls)) {
      if (c.state !== 'ENDED' || logged.current.has(c.sid)) continue
      logged.current.add(c.sid)
      const known = contacts.find((k) => k.id === c.contact.id || sameNumber(k.number, c.contact.number))
      const missed = c.direction === 'incoming' && !c.startedAt
      setRecents((r) => [{
        id: c.sid, name: c.contact.name, number: c.contact.number, contactId: known?.id,
        direction: (missed ? 'missed' : c.direction) as Recent['direction'], at: Date.now(),
        seconds: c.startedAt ? (Date.now() - c.startedAt) / 1000 : 0,
      }, ...r].slice(0, 50))
    }
  }, [s.calls, contacts])

  const startCall = useCallback(async (c: Contact, note = '') => {
    setDialError('')
    setDialing(true)
    try {
      const r = await post<{ sid: string; first_words: string | null }>('/api/calls', {
        number: c.number, name: c.name, contact_id: c.id, knows_sign: c.knows_sign, kind: c.kind, style: c.style ?? '', note,
        language: c.language ?? '',
      })
      setFirstWords((f) => ({ ...f, [r.sid]: r.first_words }))
      setRoute({ name: 'home' })
    } catch (e: any) {
      setDialError(e.message)
      if (route.name !== 'note') setRoute({ name: 'contact', id: c.id })
    } finally {
      setDialing(false)
    }
  }, [route.name])

  const updateContact = (c: Contact) => setContacts((cs) => cs.map((x) => (x.id === c.id ? c : x)))

  function openCallFlow(c: Contact) {
    if (!c.number) { setRoute({ name: 'contact', id: c.id }); return }
    if (c.kind === 'business') setRoute({ name: 'note', contact: c })
    else startCall(c)
  }

  const voiceName = VOICES.find((v) => v.id === voiceId)?.name ?? VOICES[0].name
  const active: CallView | null = s.activeSid ? s.calls[s.activeSid] ?? null : null
  const ringing = s.ringing ? s.calls[s.ringing.sid] : null
  const ended = s.endedSid ? s.calls[s.endedSid] : null

  const screen = useMemo(() => {
    if (ringing && !active) {
      return <Incoming call={ringing}
        onAnswer={() => post(`/api/calls/${ringing.sid}/answer`).catch((e) => alert(e.message))}
        onDecline={() => post(`/api/calls/${ringing.sid}/decline`).catch(() => {})} />
    }
    if (active) {
      if (active.state === 'RINGING' && active.direction === 'outgoing') {
        return <Calling call={active} voiceId={voiceId ?? VOICES[0].id} firstWords={firstWords[active.sid] ?? null}
          onCancel={() => post(`/api/calls/${active.sid}/hangup`).catch(() => {})} />
      }
      return <InCall call={active} online={online} dispatch={dispatch} quick={prefs.quick} capScale={prefs.capScale} />
    }
    if (ended) {
      const back = contacts.find((k) => k.id === ended.contact.id || sameNumber(k.number, ended.contact.number))
        ?? { ...ended.contact, id: ended.contact.id || 'tmp', knows_sign: ended.contact.knows_sign }
      return <AfterCall call={ended}
        onDone={() => dispatch({ type: 'local_dismiss_ended' })}
        onSave={() => {
          const t: SavedTranscript = { id: ended.sid, name: ended.contact.name, at: Date.now(), recap: ended.recap,
            lines: ended.lines.filter((l) => l.kind !== 'filler').map((l) => ({ who: l.who === 'me' ? 'You' : ended.contact.name, text: l.text })) }
          save('saved', [t, ...load<SavedTranscript[]>('saved', [])].slice(0, 30))
        }}
        onCallBack={() => { dispatch({ type: 'local_dismiss_ended' }); openCallFlow(back as Contact) }} />
    }
    switch (route.name) {
      case 'voice':
        return <VoicePicker current={voiceId} onDone={(id) => { setVoiceId(id); save('voice', id); setRoute(route.back) }} />
      case 'inperson':
        return <InPerson myName={myName} onDone={() => setRoute({ name: 'home' })} />
      case 'show':
        return <ShowFlow onClose={() => setRoute({ name: 'home' })} />
      case 'settings':
        return <Settings prefs={prefs} voiceName={voiceName} onChange={setPrefs}
          onVoice={() => setRoute({ name: 'voice', back: { name: 'settings' } })} onBack={() => setRoute({ name: 'home' })} />
      case 'contact': {
        const c = contacts.find((x) => x.id === route.id)
        if (!c) return null
        return <>
          <ContactPage contact={c} voiceName={voiceName} onChange={updateContact} onBack={() => { setDialError(''); setRoute({ name: 'home' }) }}
            onCall={(cc) => { updateContact(cc); openCallFlow(cc) }} onVoice={() => setRoute({ name: 'voice', back: route })} />
          {dialError && <div className="err" role="alert" style={{ position: 'fixed', left: 16, right: 16, bottom: 96, maxWidth: 408, margin: '0 auto' }}>{dialError}</div>}
        </>
      }
      case 'note':
        return <ErrandNote contact={route.contact} busy={dialing} error={dialError}
          onParsed={(p) => {
            const nm = p.auto_facts.find((f) => f.key === 'name')?.value
            if (nm && !myName) { setMyName(nm); save('myName', nm) }
          }}
          onBack={() => { setDialError(''); setRoute({ name: 'contact', id: route.contact.id }) }}
          onCall={(note) => { updateContact({ ...route.contact, note }); startCall(route.contact, note) }} />
      default:
        // Playground and Meetings never run during a call: calls take over the screen above.
        if (tab === 'play') return <Playground onBack={() => setTab('call')} />
        if (tab === 'meetings') return <MeetingsPage tabs={tabs} />
        return <Home contacts={contacts} recents={recents} online={online} tabs={tabs}
          onOpen={(c) => setRoute({ name: 'contact', id: c.id })}
          onDial={(n) => {
            const known = contacts.find((k) => sameNumber(k.number, n))
            startCall(known ?? { id: '', name: '', number: n, knows_sign: false, kind: 'person' })
          }}
          onInPerson={() => setRoute({ name: 'inperson' })}
          onShow={() => setRoute({ name: 'show' })}
          onVideo={async () => {
            // Open the tab synchronously so pop-up blockers allow it, then point it at the new room.
            const w = window.open('about:blank', '_blank')
            try {
              const r = await post<{ room: string; host_url: string }>('/api/rooms', {})
              if (w) w.location.href = r.host_url; else location.href = r.host_url
            } catch (e: any) { w?.close(); alert(e.message) }
          }}
          onSettings={() => setRoute({ name: 'settings' })} />
    }
  }, [ringing, active, ended, route, contacts, recents, online, voiceId, voiceName, firstWords, dialError, dialing, startCall, myName, tab, prefs])

  return screen
}


