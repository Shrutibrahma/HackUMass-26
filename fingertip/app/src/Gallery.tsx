/**
 * Design gallery (open /#gallery): all 22 frames from the screen-design canvas,
 * rendered by the real app components with fixture data. No camera, no network.
 * Use it to check the UI against the designs and for the demo slide.
 */
import { useState, type ReactNode } from 'react'
import { APP_NAME } from './brand'
import { DEFAULT_QUICK, INTRO } from './data'
import { AfterCall, Calling, InCall, Incoming } from './screens/Call'
import { InPerson } from './screens/InPerson'
import { MeetPanel } from './screens/Meet'
import { ContactPage, ErrandNote, Home, Settings, VoicePicker, type Prefs } from './screens/Setup'
import { ShowPlayer } from './screens/Show'
import type { Analysis, CallView, Contact, Draft, Line, VideoFact, VideoSection } from './types'

const MOM: Contact = { id: 'mom', name: 'Mom', number: '4135550177', knows_sign: true, kind: 'person', style: 'casual', fav: true }
const TONY: Contact = { id: 'tonys', name: "Tony's Pizza", number: '4135550142', knows_sign: false, kind: 'business', style: 'polite',
  note: 'Garlic bread and Honey BBQ wings. Name is Shruti. Tell me the total before ordering.' }
const DRLEE: Contact = { id: 'drlee', name: "Dr. Lee's office", number: '4135550190', knows_sign: false, kind: 'business', style: 'polite' }
const TAQUERIA: Contact = { id: 'taq', name: 'Taquería Lupita', number: '4135550106', knows_sign: false, kind: 'business', style: 'polite', language: 'es-US' }
const CONTACTS: Contact[] = [MOM,
  { id: 'jordan', name: 'Jordan', number: '4135550111', knows_sign: true, kind: 'person', fav: true },
  { id: 'grandpa', name: 'Grandpa', number: '4135550122', knows_sign: false, kind: 'person', fav: true },
  { id: 'drlee', name: 'Dr. Lee', number: '4135550190', knows_sign: false, kind: 'business', fav: true }, TONY]

let n = 0
const L = (who: 'caller' | 'me', text: string, o: Partial<Line> = {}): Line =>
  ({ id: `g${n++}`, who, text, status: who === 'me' ? 'spoken' : 'final', level: '', kind: who === 'me' ? 'reply' : '', unclear: false, heard: '', ts: 0, ...o })
const D = (text: string, o: Partial<Draft> = {}): Draft =>
  ({ id: `d${n++}`, text, source: 'signs', signs: [], level: 'quick', confirm_summary: '', problems: [], blocked: false, tone: 'warm', hash: 'h', ...o })
const A = (chips: string[], o: Partial<Analysis> = {}): Analysis =>
  ({ question_type: 'yes_no', options: [], chips, note_fact_key: null, involves_money: false, involves_commitment: false, unclear: false, ...o })
const ago = (mmss: string) => { const [m, s] = mmss.split(':').map(Number); return Date.now() - (m * 60 + s) * 1000 }

function call(contact: Contact, at: string, o: Partial<CallView> = {}): CallView {
  return { sid: `s${n++}`, state: 'LISTENING', direction: 'incoming', contact, startedAt: ago(at), lines: [], caption: null, draft: null,
    analysis: null, confirm: null, recap: [], endedReason: '', notice: null, editDraft: false, ...o }
}

const DINNER = "That's great. Are you still coming for dinner on Sunday? Grandpa will be there."
const noop = () => {}

// Fixture facts in the shape Gemini returns (server/app/show.py). Not real output.
const FACTS: VideoFact[] = [
  { id: 'v1', say: 'Water drips from the front-left corner of the door.', label: 'Drip starts here', kind: 'problem', t: 6.2, t_end: 9, box: [620, 80, 820, 260], sure: true },
  { id: 'v2', say: 'The panel shows error code E24.', label: 'Error E24', kind: 'reading', t: 11, t_end: 14, box: [120, 420, 220, 600], sure: true },
  { id: 'v3', say: 'There is a puddle under the front of the machine.', label: 'Puddle', kind: 'problem', t: 11.2, t_end: 13, box: [840, 150, 980, 700], sure: false },
  { id: 'v4', say: 'The label says model DW80R5061.', label: 'Model label', kind: 'label', t: 15.5, t_end: 18, box: [300, 700, 380, 900], sure: true },
]
const SECTIONS: VideoSection[] = [
  { id: 's1', start: 0, end: 6, title: 'Whole machine', summary: 'The dishwasher with its door closed.', lines: [
    { t: 0.4, kind: 'action', text: 'Camera shows the dishwasher from the front' }, { t: 3.1, kind: 'speech', text: "It's been doing this since yesterday" }] },
  { id: 's2', start: 6, end: 10, title: 'The leak', summary: 'Water drips from the front-left corner of the door.', lines: [
    { t: 6.2, kind: 'action', text: 'Water drips from the front-left corner of the door' }, { t: 7.0, kind: 'sound', text: 'Steady dripping' }] },
  { id: 's3', start: 10, end: 20, title: 'Panel and label', summary: 'The error code, then the model label inside the door.', lines: [
    { t: 11.0, kind: 'text', text: 'E24' }, { t: 11.4, kind: 'action', text: 'The error light blinks red' },
    { t: 15.5, kind: 'text', text: 'MODEL DW80R5061' }, { t: 16.8, kind: 'action', text: 'Camera moves down to a puddle on the floor' }] },
]
const live = (c: CallView, extra: Record<string, unknown> = {}) => <InCall call={c} online dispatch={noop} preview {...extra} />

const FRAMES: [string, ReactNode, boolean?][] = [
  ['1 · First launch: pick your voice', <VoicePicker current={null} onDone={noop} />],
  ['2 · Home: favorites, recents, talk in person', <Home contacts={CONTACTS} online onOpen={noop} onDial={noop} onInPerson={noop} onSettings={noop}
    recents={[
      { id: 'r1', name: 'Mom', number: '', direction: 'incoming', at: Date.now() - 864e5, seconds: 360 },
      { id: 'r2', name: "Tony's Pizza", number: '', direction: 'outgoing', at: Date.now() - 3 * 864e5, seconds: 240 },
      { id: 'r3', name: "Dr. Lee's office", number: '', direction: 'outgoing', at: Date.now() - 4 * 864e5, seconds: 180 },
    ]} />],
  ['3 · Contact: "Knows I sign" skips the intro', <ContactPage contact={MOM} voiceName="Maya" onChange={noop} onBack={noop} onCall={noop} onVoice={noop} />],
  ['4 · Errand call: optional note', <ErrandNote contact={TONY} busy={false} error="" onBack={noop} onCall={noop}
    preview={{ auto_facts: [{ key: 'order', value: 'garlic bread and Honey BBQ wings' }, { key: 'name', value: 'Shruti' }], needs_confirmation: ['tell me the total before ordering'] }} />],
  ['5 · Calling: real progress from the carrier, and what they will hear first', <Calling call={call(TONY, '0:00', { state: 'RINGING', direction: 'outgoing', carrier: 'ringing' })} voiceId="XrExE9yKIg1WjnnlVkGX"
    firstWords={INTRO.replace('Bear with me a sec.', "I'd like to place a pickup order.")} onCancel={noop} />],
  ['6 · Incoming call: answer like normal', <Incoming call={call(MOM, '0:00', { state: 'RINGING' })} onAnswer={noop} onDecline={noop} />],
  ['7 · Caller talking: live captions', live(call(MOM, '02:14', {
    state: 'CALLER_TALKING',
    lines: [L('me', "Hey Mom! How's it going?"), L('caller', 'Oh hi, sweetheart! How was your week?'), L('me', 'Good! Busy with work, but good.')],
    caption: L('caller', "That's great. Are you still coming for dinner on Sun", { status: 'partial' }),
  }))],
  ['8 · You are signing (filler covers the pause)', live(call(MOM, '02:18', {
    state: 'YOUR_TURN',
    lines: [L('me', 'Good! Busy with work, but good.'), L('caller', DINNER), L('me', 'Mm, one sec...', { kind: 'filler' })],
  }), { signing: ['YES', 'SUNDAY'] })],
  ['9 · Reply ready: tap Send', live(call(MOM, '02:21', {
    state: 'DRAFT_READY', lines: [L('me', 'Good! Busy with work, but good.'), L('caller', DINNER)],
    draft: D("Yes, I'll be there on Sunday!"), analysis: A(['Yes', 'No', 'What time?', 'Hold on']),
  }))],
  ['10 · Unsure sign: you pick', live(call(TONY, '01:05', {
    state: 'YOUR_TURN', lines: [L('caller', 'Sure. Six wings or twelve?')],
  }), { unsure: { options: ['Ten', 'Twelve'] } })],
  ['11 · Edit the reply', live(call(MOM, '02:24', {
    state: 'DRAFT_READY', lines: [L('caller', DINNER)],
    draft: D("Yeah! I'll be there Sunday. Want me to bring anything?"), editDraft: true,
  }))],
  ['12 · Type instead', <TypeFrame />],
  ['13 · Speaking for you', live(call(MOM, '02:26', {
    state: 'SPEAKING', lines: [L('caller', DINNER), L('me', "Yeah! I'll be there Sunday.", { status: 'speaking' })],
  }))],
  ['14 · They talked over you: we stop', live(call(MOM, '02:27', {
    state: 'CALLER_TALKING',
    lines: [L('caller', DINNER), L('me', "Yeah! I'll be there Sunday. What should I bring?", { status: 'interrupted', heard: "Yeah! I'll be there" })],
    caption: L('caller', 'Oh wait, sorry. Is it Saturday or Sunday for you?', { status: 'partial' }),
    draft: D('Sunday. What should I bring?', { source: 'rest' }), analysis: A(['Sunday', 'Saturday'], { question_type: 'options' }),
  }))],
  ['15 · Answered from your note', live(call(TONY, '01:40', {
    direction: 'outgoing', state: 'CALLER_TALKING',
    lines: [L('me', "Let's do twelve Honey BBQ wings and the garlic bread. For pickup."), L('caller', 'Got it. And what name is that under?'),
      L('me', "It's under Shruti.", { kind: 'fact', level: 'auto' })],
    caption: L('caller', 'Perfect. Give me one sec to ring it up.', { status: 'partial' }),
  }))],
  ['16 · Money: you confirm first', live(call(TONY, '02:58', {
    direction: 'outgoing', state: 'CONFIRMING',
    lines: [L('me', "Let's do twelve Honey BBQ wings and the garlic bread. Pickup, under Shruti."),
      L('caller', 'Okay, that comes to $23.40 with tax. Should I place it?'), L('me', 'Mm, one sec...', { kind: 'filler' })],
    draft: D('Yes, please go ahead and place the order.', { level: 'confirm', confirm_summary: 'This agrees to pay $23.40 and places the order' }),
    confirm: { summary: 'This agrees to pay $23.40 and places the order', sentence: 'Yes, please go ahead and place the order.', hash: 'h' },
  }))],
  ['17 · Unclear audio: we don\'t guess', live(call(TONY, '02:40', {
    direction: 'outgoing', state: 'YOUR_TURN',
    lines: [L('caller', 'Okay, so your total comes to twenty with tax.', { unclear: true })],
    analysis: A(['Could you say that again?', 'One sec'], { unclear: true, question_type: 'statement' }),
  }))],
  ['18 · On hold: flash + buzz when a person returns', live(call(DRLEE, '04:12', {
    direction: 'outgoing', state: 'ON_HOLD', lines: [L('caller', "Please hold, I'll be right with you.")],
  }))],
  ['19 · Connection blip: call keeps going', <InCall preview dispatch={noop} online={false} call={call(MOM, '03:02', {
    state: 'LISTENING', lines: [L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', 'Yeah, of course!')],
  })} />],
  ['20 · After the call', <AfterCall onDone={noop} onCallBack={noop} onSave={noop} call={call(MOM, '06:00', {
    state: 'ENDED', recap: ["Dinner Sunday at 6. You said you'll be there.", 'Bring dessert. Grandpa is coming.'],
    lines: [L('caller', 'Are you still coming for dinner on Sunday?'), L('me', "Yes, I'll be there on Sunday!"),
      L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', "Sure, I'll bring the chocolate cake."), L('caller', 'Love you!'), L('me', 'Love you too!')],
  })} />],
  ['21 · In person: flip the phone', <InPerson onDone={noop} myName="Shruti" preview={{
    shown: "Yes, I'm picking up a prescription. The name is Shruti.", label: 'Pharmacist said',
    said: "Got it. It'll be ready in about ten minutes. Any questions for the pharmacist?" }} />],
  ['22 · Google Meet (stretch): signer-only extension', <MeetPanel />, true],
  ['23 · Call in Spanish: you read English, they hear Spanish', live(call(TAQUERIA, '01:12', {
    direction: 'outgoing', state: 'DRAFT_READY',
    lines: [
      L('me', INTRO, { kind: 'intro', level: 'auto',
        spoken: '¡Hola! Un aviso rápido: soy una persona sorda, y una app dice en voz alta lo que escribo o expreso en señas. Dame un momento, por favor.' }),
      L('caller', 'Hi, what can I get you?', { original: 'Hola, ¿qué le puedo servir?' }),
      L('me', 'Two tacos al pastor, please.', { spoken: '2 tacos al pastor, por favor.' }),
      L('caller', 'What time do you want them for?', { original: '¿Para qué hora los quiere?' }),
    ],
    draft: D('For 7:30, please.', { source: 'typed' }), analysis: A(['Let me check.', 'Could you say that again?'], { question_type: 'time' }),
  }))],
  ['24 · Settings: caption size, how the heads-up describes you, your quick replies', <SettingsFrame />],
  ['25 · Your quick replies, one tap away (no AI involved)', live(call(DRLEE, '00:41', {
    direction: 'outgoing', state: 'LISTENING',
    lines: [L('caller', "Dr. Lee's office, this is Dana. How can I help?"), L('me', "Hi, I'd like to move my appointment.")],
  }))],
  ['26 · Show it: every fact pinned to when and where the camera saw it (fixture data, no video)',
    <div style={{ padding: 12, background: 'var(--card)' }}><ShowPlayer src={null} facts={FACTS} sections={SECTIONS} duration={20} previewTime={11.5} /></div>],
  ['27 · In a call: check a point against the clip, then say it', live(call({ ...DRLEE, id: 'landlord', name: 'Landlord' }, '00:52', {
    direction: 'outgoing', state: 'DRAFT_READY',
    lines: [L('caller', "Hi, it's Mark. What's going on?")],
    video: { show_id: 'fixture', facts: FACTS, summary: '' },
    draft: D('My dishwasher leaks from the front-left corner of the door, and it shows error E24.', { source: 'video' }),
  }))],
]

function SettingsFrame() {
  const [p, setP] = useState<Prefs>({ quick: DEFAULT_QUICK, capScale: 1.2, introStyle: 'nonspeaking' })
  return <Settings prefs={p} voiceName="Maya" onChange={setP} onVoice={noop} onBack={noop} />
}

function TypeFrame() {
  // Frame 12 opens with the keyboard up; InCall shows it after one tap, so render it in that state.
  const c = call(MOM, '03:40', {
    state: 'YOUR_TURN', lines: [L('caller', 'Wonderful. Around 6. Could you bring dessert?'), L('me', 'Yeah, of course!')],
    analysis: A(['Sure', 'What kind?', 'Hold on']),
  })
  return <InCall call={c} online dispatch={noop} preview key="type" startTyping="I'll bring the chocolate cake you like." />
}

export default function Gallery() {
  return (
    <div className="gallery">
      <h1>{APP_NAME} · all screens</h1>
      {FRAMES.map(([label, node, wide]) => (
        <div key={label} className={`gframe ${wide ? 'wide' : ''}`} data-frame={label.split(' ')[0]}>
          <div className="glabel">{label}</div>
          <div className="phone">{node}</div>
        </div>
      ))}
    </div>
  )
}


