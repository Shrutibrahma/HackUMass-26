// TalkBridge browser app: captions in, approved replies out. No secrets here; all keys stay on the server.
const $ = (id) => document.getElementById(id)
const QUICK = ['Yes.', 'No.', 'One moment, please.', 'Could you repeat that, please?', 'Thank you!', 'Thank you, goodbye!']
const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress'])
const LABEL = { idle: 'Ready', queued: 'Dialing…', initiated: 'Dialing…', ringing: 'Ringing…', 'in-progress': 'Connected',
  completed: 'Call ended', busy: 'Busy', 'no-answer': 'No answer', failed: 'Call failed', canceled: 'Canceled' }

const state = { status: 'idle', started: null, relay: false, turns: [] }
let pendingConfirm = null

// ------------------------------------------------------------- server link
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  ws.onmessage = (e) => onEvent(JSON.parse(e.data))
  ws.onclose = () => { setTimeout(connect, 1000) }   // reconnects; the server sends a full snapshot
}

function onEvent(m) {
  switch (m.type) {
    case 'snapshot':
      Object.assign(state, { status: m.status, started: m.started, relay: m.relay, turns: m.turns })
      if (m.to) $('to').value = m.to
      $('partial').textContent = m.partial || ''
      renderTurns(); renderStatus(); break
    case 'status':
      state.status = m.status
      if (m.started) state.started = m.started
      if (m.error) $('dialMsg').textContent = m.error
      renderStatus(); break
    case 'relay':
      state.relay = m.connected; renderStatus(); break
    case 'partial':
      $('partial').textContent = m.text; break
    case 'turn':
      state.turns.push(m.turn)
      if (m.turn.who === 'them') { $('partial').textContent = ''; refreshSuggestions() }
      renderTurns(); break
    case 'interrupted': {
      const t = state.turns.findLast((x) => x.who === 'me' && x.text === m.turn.text)
      if (t) Object.assign(t, m.turn)
      renderTurns(); break
    }
    case 'error':
      $('dialMsg').textContent = m.message; break
  }
}

// ------------------------------------------------------------- rendering
function renderStatus() {
  const s = state.status
  const label = LABEL[s] || s
  $('status').textContent = s === 'in-progress' && !state.relay ? 'Connected (voice link starting…)' : label
  $('status').dataset.live = LIVE.has(s) ? '1' : '0'
  $('callBtn').disabled = LIVE.has(s)
  $('hangBtn').disabled = !LIVE.has(s)
}

function renderTurns() {
  const ol = $('turns')
  ol.innerHTML = ''
  if (!state.turns.length) {
    const li = document.createElement('li'); li.className = 'empty'
    li.textContent = 'Call someone. Their words appear here as they talk; your replies are spoken to them.'
    ol.append(li)
  }
  for (const t of state.turns) {
    const li = document.createElement('li')
    li.className = `turn ${t.who}${t.state === 'cut off' ? ' cut' : ''}`
    const who = document.createElement('span'); who.className = 'who'; who.textContent = t.who === 'them' ? 'They said' : 'You said'
    const txt = document.createElement('span'); txt.textContent = t.text
    li.append(who, txt)
    if (t.who === 'me') {
      const st = document.createElement('span'); st.className = 'state'
      st.textContent = t.state === 'cut off' ? 'Cut off: they talked over it' : 'Sent to their phone'
      li.append(st)
      if (t.state === 'cut off') {
        const again = document.createElement('button'); again.textContent = 'Say it again'
        again.onclick = () => sayIt(t.text); li.append(again)
      }
    }
    ol.append(li)
  }
  ol.scrollTop = ol.scrollHeight
}

function chips(el, items, onPick) {
  el.innerHTML = ''
  for (const text of items) {
    const b = document.createElement('button'); b.textContent = text
    b.onclick = () => onPick(text); el.append(b)
  }
}

// ------------------------------------------------------------- actions
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || `Error ${r.status}`)
  return data
}

async function dial() {
  $('dialMsg').textContent = ''
  try { await api('/api/call', { to: $('to').value }) } catch (e) { $('dialMsg').textContent = e.message }
}

async function sayIt(text, confirmed = false, requestId = crypto.randomUUID()) {
  text = text.trim()
  if (!text) return
  try {
    const r = await api('/api/say', { text, request_id: requestId, confirmed })
    if (r.needs_confirm) {
      pendingConfirm = { text, requestId }
      $('confirmText').textContent = text
      $('confirm').showModal()
      return
    }
    if ($('draft').value.trim() === text) $('draft').value = ''
  } catch (e) { $('dialMsg').textContent = e.message }
}

async function refreshSuggestions(hint = '') {
  $('aiSrc').textContent = '…'
  try {
    const r = await api('/api/suggest', { hint })
    $('aiSrc').textContent = `(${r.source}, ${r.ms} ms${r.dropped.length ? `, ${r.dropped.length} unsafe dropped` : ''})`
    chips($('sugs'), r.replies, hint ? (t) => { $('draft').value = t; $('draft').focus() } : (t) => sayIt(t))
    return r
  } catch (e) { $('aiSrc').textContent = e.message }
}

// ------------------------------------------------------------- wiring
chips($('quick'), QUICK, (t) => sayIt(t))
$('callBtn').onclick = dial
$('hangBtn').onclick = () => api('/api/hangup').catch(() => {})
$('sendBtn').onclick = () => sayIt($('draft').value)
$('expandBtn').onclick = () => refreshSuggestions($('draft').value)
$('draft').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sayIt($('draft').value) }
})
$('to').addEventListener('keydown', (e) => { if (e.key === 'Enter') dial() })
$('confirmYes').onclick = () => { $('confirm').close(); if (pendingConfirm) sayIt(pendingConfirm.text, true, pendingConfirm.requestId); pendingConfirm = null }
$('confirmNo').onclick = () => { $('confirm').close(); pendingConfirm = null }
$('size').onchange = (e) => {
  document.documentElement.style.setProperty('--cap', `${e.target.value}px`)
  try { localStorage.setItem('cap', e.target.value) } catch {}
}
try { const c = localStorage.getItem('cap'); if (c) { $('size').value = c; $('size').onchange({ target: $('size') }) } } catch {}

setInterval(() => {
  $('timer').textContent = state.status === 'in-progress' && state.started
    ? new Date((Date.now() / 1000 - state.started) * 1000).toISOString().slice(14, 19) : ''
}, 500)

fetch('/api/health').then((r) => r.json()).then((h) => {
  const bits = [h.twilio ? 'Twilio ✓' : 'Twilio ✗ (not set up)',
    h.public_url ? 'Public URL ✓' : 'Public URL ✗',
    h.gemini.configured ? (h.gemini.ok ? `Gemini ✓ (${h.gemini.model})` : `Gemini ✗ (${h.gemini.model})`) : 'Gemini off (rules only)']
  $('health').textContent = bits.join(' · ')
}).catch(() => {})

connect()
renderStatus()


