export type Contact = {
  id: string
  name: string
  number: string
  knows_sign: boolean
  kind: 'person' | 'business'
  style?: 'casual' | 'polite'
  fav?: boolean
  note?: string
  /** BCP-47 the other person speaks; '' or undefined = English. Needs Gemini on the server. */
  language?: string
}

export type Line = {
  id: string
  who: 'caller' | 'me'
  text: string
  status: string // caller: partial|final ; me: speaking|spoken|interrupted
  level: string
  kind: string
  unclear: boolean
  heard: string
  /** Other-language calls: the caller's own words (text is the English). */
  original?: string
  /** Other-language calls: what the caller actually heard. */
  spoken?: string
  ts: number
}

/** Show it: one fact from the signer's video, tied to a time and (optionally) a place in the frame. */
export type VideoFact = {
  id: string
  say: string
  label: string
  kind: 'problem' | 'reading' | 'label' | 'object' | 'action' | 'answer' | 'other'
  t: number
  t_end: number
  /** [ymin, xmin, ymax, xmax], 0-1000 of the video frame; null = not one place. */
  box: [number, number, number, number] | null
  sure: boolean
  /** Precision pass tightened this time/box. */
  refined?: boolean
  /** For answers from "ask the video". */
  question?: string
}

export type TranscriptLine = { t: number; kind: 'action' | 'speech' | 'text' | 'sound'; text: string }
export type VideoSection = { id: string; start: number; end: number; title: string; summary: string; lines: TranscriptLine[] }

export type ShowRecord = {
  id: string
  share_token?: string
  share?: boolean
  title?: string
  created?: number
  duration: number
  status?: 'processing' | 'done' | 'failed'
  progress?: string
  error?: string
  summary_say: string
  facts: VideoFact[]
  sections?: VideoSection[]
  notes?: string
  refined?: number
  seconds?: number
}

export type Draft = {
  id: string
  text: string
  source: string
  signs: string[]
  level: 'auto' | 'quick' | 'confirm'
  confirm_summary: string
  problems: string[]
  blocked: boolean
  tone: string
  hash: string
}

export type Analysis = {
  question_type: string
  options: string[]
  chips: string[]
  note_fact_key: string | null
  involves_money: boolean
  involves_commitment: boolean
  unclear: boolean
}

export type CallView = {
  sid: string
  state: string
  direction: 'incoming' | 'outgoing'
  contact: Contact
  startedAt: number | null
  lines: Line[]
  caption: Line | null
  draft: Draft | null
  analysis: Analysis | null
  confirm: { summary: string; sentence: string; hash: string } | null
  recap: string[]
  endedReason: string
  notice: { kind: string; text: string } | null
  editDraft: boolean
  /** Last Twilio call status for an outgoing call (queued, initiated, ringing, in-progress...). Real events only. */
  carrier?: string
  /** Show it: facts from a clip attached to this call. */
  video?: { show_id: string; facts: VideoFact[]; summary: string; answer?: VideoFact | null } | null
}

export type Recent = {
  id: string
  name: string
  number: string
  direction: 'incoming' | 'outgoing' | 'missed'
  at: number
  seconds: number
  contactId?: string
}

export type SavedTranscript = {
  id: string
  name: string
  at: number
  recap: string[]
  lines: { who: string; text: string }[]
}


