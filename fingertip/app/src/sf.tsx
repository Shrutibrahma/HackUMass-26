/**
 * Line icons drawn in the style of Apple's SF Symbols (1.7 stroke, round caps, 24-pt grid).
 * Original artwork; no Apple assets. Use these everywhere in the call and video UI (no emoji, no text glyphs).
 */
type P = { size?: number; filled?: boolean; className?: string }
const base = (size = 24, filled = false, className?: string) => ({
  width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const,
  fill: filled ? 'currentColor' : 'none', stroke: filled ? 'none' : 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
})

const HANDSET = 'M6.6 3.2c.5-.2 1.1 0 1.4.4l1.9 2.8c.3.5.3 1.1-.1 1.5L8.4 9.3a.9.9 0 0 0-.1 1 11.6 11.6 0 0 0 5.4 5.4.9.9 0 0 0 1-.1l1.4-1.4c.4-.4 1-.4 1.5-.1l2.8 1.9c.5.3.6.9.4 1.4l-.8 1.9c-.4.9-1.3 1.4-2.3 1.3C10.4 19.9 4.1 13.6 3.4 6.4c-.1-1 .4-1.9 1.3-2.3z'

export const SFPhone = ({ size, filled = true, className }: P) => <svg {...base(size, filled, className)}><path d={HANDSET} /></svg>
export const SFPhoneDown = ({ size, className }: P) => (
  <svg {...base(size, true, className)}><path d="M12 8.6c-3.4 0-6.6 1-8.9 2.8-.6.5-.8 1.3-.6 2l.6 1.8c.2.6.9 1 1.5.8l3.1-.9c.5-.1.9-.6.9-1.1v-1.6c0-.3.2-.5.5-.6a11.8 11.8 0 0 1 5.8 0c.3.1.5.3.5.6V14c0 .5.4 1 .9 1.1l3.1.9c.6.2 1.3-.2 1.5-.8l.6-1.8c.2-.7 0-1.5-.6-2-2.3-1.8-5.5-2.8-8.9-2.8z" /></svg>
)
export const SFMic = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></svg>
)
export const SFMicSlash = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M15 9.5V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.4 12.6c.1-.5.1-1 .1-1.6M12 17.5V21M9 21h6M3.5 3.5l17 17" /></svg>
)
export const SFSpeaker = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" /><path d="M15 9a4 4 0 0 1 0 6M17.7 6.5a7.5 7.5 0 0 1 0 11" /></svg>
)
export const SFKeypad = ({ size, className }: P) => (
  <svg {...base(size, true, className)}>{[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.9" />))}</svg>
)
export const SFVideo = ({ size, filled = false, className }: P) => (
  <svg {...base(size, filled, className)}><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="m15.5 10.5 5-3v9l-5-3z" /></svg>
)
export const SFVideoSlash = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M9 6h3.5a3 3 0 0 1 3 3v3M15.5 15a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V9a3 3 0 0 1 1.6-2.7M15.5 10.5l5-3v9l-3.4-2M3 3l18 18" /></svg>
)
export const SFHand = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.8 15.9a1.5 1.5 0 0 1 2.3-1.9L8 15.5V12" /></svg>
)
export const SFSparkles = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M10 3.5 11.6 8a2 2 0 0 0 1.2 1.2L17.3 11l-4.5 1.6a2 2 0 0 0-1.2 1.2L10 18.3l-1.6-4.5a2 2 0 0 0-1.2-1.2L2.7 11l4.5-1.6A2 2 0 0 0 8.4 8.2zM18.5 3v4M16.5 5h4M18 16v3M16.5 17.5h3" /></svg>
)
export const SFQuote = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 17H10l-4.5 3.5V17H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 5zM7 9.5h10M7 12.5h6" /></svg>
)
export const SFCaptions = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M10.5 10a2.2 2.2 0 1 0 0 4M17 10a2.2 2.2 0 1 0 0 4" /></svg>
)
export const SFText = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" /></svg>
)
export const SFKeyboard = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6.5 12.5h.01M17.5 12.5h.01M8.5 15h7M9.5 12.5h5" /></svg>
)
export const SFArrowUp = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.4}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
)
export const SFXmark = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.2}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const SFChevronLeft = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.4}><path d="M15 5 8 12l7 7" /></svg>
)
export const SFChevronRight = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.2}><path d="m9 5 7 7-7 7" /></svg>
)
export const SFInfo = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></svg>
)
export const SFStar = ({ size, filled = true, className }: P) => (
  <svg {...base(size, filled, className)}><path d="m12 3.2 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" /></svg>
)
export const SFClock = ({ size, filled = false, className }: P) => (
  <svg {...base(size, false, className)}><circle cx="12" cy="12" r="9" fill={filled ? 'currentColor' : 'none'} /><path d="M12 7v5l3.2 2" stroke={filled ? '#000' : 'currentColor'} /></svg>
)
export const SFPerson = ({ size, filled = false, className }: P) => (
  <svg {...base(size, filled, className)}><circle cx="12" cy="8" r="4" /><path d="M4 20.5c.6-4 3.9-6.5 8-6.5s7.4 2.5 8 6.5z" /></svg>
)
export const SFPersonCircle = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="10" r="3" /><path d="M6.2 18.4c1.3-2 3.4-3.1 5.8-3.1s4.5 1.1 5.8 3.1" /></svg>
)
export const SFGear = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.4-.9-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4z" /></svg>
)
export const SFLink = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3A4.5 4.5 0 0 0 11 19.4l1.2-1.2" /></svg>
)
export const SFShare = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M12 15V3.5M8 7.5l4-4 4 4M7.5 10.5H6A1.5 1.5 0 0 0 4.5 12v7.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-1.5" /></svg>
)
export const SFEllipsis = ({ size, className }: P) => (
  <svg {...base(size, true, className)}><circle cx="5.5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="18.5" cy="12" r="1.9" /></svg>
)
export const SFWaveform = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" /></svg>
)
export const SFPause = ({ size, className }: P) => (
  <svg {...base(size, true, className)}><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" /><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" /></svg>
)
export const SFStop = ({ size, className }: P) => (
  <svg {...base(size, true, className)}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
)
export const SFCheck = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.4}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
)
export const SFExclamation = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4.5M12 17.2v.1" /></svg>
)
export const SFWifiSlash = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M2.5 8.5a14 14 0 0 1 5-2.9M11 5a14 14 0 0 1 10.5 3.5M5.5 11.8a9.5 9.5 0 0 1 4-2M14.8 10a9.5 9.5 0 0 1 3.7 1.8M8.6 15a5 5 0 0 1 6.8 0M12 19h.01M3 3l18 18" /></svg>
)
export const SFPlus = ({ size, className }: P) => (
  <svg {...base(size, false, className)} strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>
)
export const SFDelete = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7zM11.5 9.5l5 5M16.5 9.5l-5 5" /></svg>
)
export const SFRecord = ({ size, className }: P) => (
  <svg {...base(size, false, className)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></svg>
)
