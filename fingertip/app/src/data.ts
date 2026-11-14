import type { Contact } from './types'

// Demo contacts. Numbers are blank on purpose: set them to the phones in the room.
export const DEFAULT_CONTACTS: Contact[] = [
  { id: 'mom', name: 'Mom', number: '', knows_sign: true, kind: 'person', style: 'casual', fav: true },
  { id: 'jordan', name: 'Jordan', number: '', knows_sign: true, kind: 'person', style: 'casual', fav: true },
  { id: 'grandpa', name: 'Grandpa', number: '', knows_sign: false, kind: 'person', style: 'casual', fav: true },
  { id: 'drlee', name: 'Dr. Lee', number: '', knows_sign: false, kind: 'business', style: 'polite', fav: true },
  { id: 'tonys', name: "Tony's Pizza", number: '', knows_sign: false, kind: 'business', style: 'polite', fav: false,
    note: 'Garlic bread and Honey BBQ wings. Name is Shruti. Tell me the total before ordering.' },
]

// Display names follow the screen designs. Each maps to an ElevenLabs voice ID;
// verify the IDs in the ElevenLabs voice library before the demo (DECISIONS.md D-006).
export type Voice = { id: string; name: string; feel: string; age: string; accent: string; gender: 'f' | 'm'; foreign: boolean }
export const VOICES: Voice[] = [
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Maya', feel: 'Warm and friendly', age: '20s', accent: 'American', gender: 'f', foreign: false },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Priya', feel: 'Bright and upbeat', age: '20s', accent: 'Indian English', gender: 'f', foreign: true },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Alex', feel: 'Calm and clear', age: '30s', accent: 'American', gender: 'm', foreign: false },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Sam', feel: 'Deep and relaxed', age: '40s', accent: 'British', gender: 'm', foreign: true },
]

// Mirrors server translate.intro(): how the heads-up describes you is a setting, not an assumption.
export type IntroStyle = 'deaf' | 'hoh' | 'nonspeaking' | 'none'
export const INTRO_STYLES: { key: IntroStyle; label: string; says: string }[] = [
  { key: 'deaf', label: "I'm Deaf", says: "I'm deaf, so an app is voicing what I sign or type." },
  { key: 'hoh', label: "I'm hard of hearing", says: "I'm hard of hearing, so an app is voicing what I sign or type." },
  { key: 'nonspeaking', label: "I don't speak", says: "I can't speak, so an app is voicing what I sign or type." },
  { key: 'none', label: 'Just say an app is voicing', says: 'an app is voicing what I sign or type.' },
]
export const introFor = (s: IntroStyle = 'deaf') => `Hey! Quick heads-up: ${INTRO_STYLES.find((x) => x.key === s)?.says ?? INTRO_STYLES[0].says} Bear with me a sec.`
export const INTRO = introFor('deaf')

/** Always-available replies. Editable in Settings; nothing here is ever sent without a tap. */
export const DEFAULT_QUICK = ['Yes.', 'No.', 'Please repeat that.', 'Give me a moment.', 'I have a question.', 'Thank you.']

export const CAPTION_SIZES = [{ k: 0.9, label: 'Small' }, { k: 1, label: 'Medium' }, { k: 1.2, label: 'Large' }, { k: 1.45, label: 'Extra large' }]

export function initials(name: string): string {
  const w = name.replace(/[^A-Za-z ]/g, '').trim()
  return (w[0] ?? '?').toUpperCase()
}

export function avatarTone(c: Pick<Contact, 'kind' | 'knows_sign' | 'id'>): string {
  if (c.kind === 'business') return c.id === 'drlee' || c.id.startsWith('doc') ? 'gray' : 'amber'
  if (c.knows_sign) return c.id === 'mom' ? 'blue' : 'soft'
  return 'gray'
}

export function prettyNumber(n: string): string {
  const d = n.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n
}

export function sameNumber(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '').slice(-10)
  return da.length === 10 && da === b.replace(/\D/g, '').slice(-10)
}

export function ago(t: number): string {
  const d = new Date(t)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (days <= 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}


