// Fingertip in Google Meet / Zoom web: one slim bar at the bottom of the meeting.
// Type (or sign) -> optional AI rewrite you approve -> the sentence is drawn into YOUR camera video (inject.js),
// so everyone in the meeting can read it. Show & explain (Alt+E) labels what you hold up to the camera.
// All server calls go through the extension's service worker (bg.js). Zoom Desktop and FaceTime: not supported.
(() => {
  if (window.__fingertipBar) return
  window.__fingertipBar = true

  const isMeet = location.hostname === 'meet.google.com'
  const state = {
    mode: 'ai',            // ai | exact
    burn: true,            // captions drawn into my camera
    chat: false,           // also post to Meet chat
    voice: false,          // also speak into the meeting mic
    wrapped: null,         // {video, audio} once inject.js has wrapped the camera
    server: 'http://127.0.0.1:8000',
    serverOk: null,
    preview: null,         // { text, source } awaiting approval
    root: null,
    $: null,
  }
  const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 300)
  const api = (path, body, binary = false) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ ft: 'api', path, body, binary }, (r) => resolve(r || { ok: false, error: 'Extension was reloaded. Refresh this tab.' })) }
    catch { resolve({ ok: false, error: 'Extension was reloaded. Refresh this tab.' }) }
  })

  // ------------------------------------------------------------ camera captions (inject.js, main world)
  function burn(text, final = true) { window.postMessage({ fingertip: 'caption', text, final }, '*') }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.fingertip === 'wrapped') { state.wrapped = event.data; render() }
  })

  // ------------------------------------------------------------ UI
  const CSS = `
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);width:min(680px,calc(100vw - 24px));z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:stretch}
  .card{background:rgba(20,22,30,.96);color:#f4f5fb;border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.45);backdrop-filter:blur(14px)}
  .bar{display:flex;align-items:center;gap:6px;padding:6px}
  .seg{display:flex;background:rgba(255,255,255,.08);border-radius:12px;padding:3px;flex:none}
  .seg button{border:0;background:transparent;color:#aab0c4;font:700 12px inherit;padding:7px 10px;border-radius:9px;cursor:pointer}
  .seg button.on{background:#6a5cff;color:#fff}
  input{flex:1;min-width:0;height:40px;border:0;outline:0;border-radius:12px;padding:0 12px;background:rgba(255,255,255,.07);color:#fff;font-size:15px}
  input::placeholder{color:#8a90a6}
  .ib{flex:none;width:40px;height:40px;border:0;border-radius:12px;background:rgba(255,255,255,.08);color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center;position:relative}
  .ib:hover{background:rgba(255,255,255,.16)} .ib.on{background:#6a5cff}
  .ib[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:46px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#000;color:#fff;font:600 11px inherit;padding:4px 7px;border-radius:6px}
  .dot{width:8px;height:8px;border-radius:50%;background:#777;flex:none;margin:0 4px}
  .dot.ok{background:#3ddc97}.dot.bad{background:#ff5d6c}
  .preview{padding:10px 12px;display:flex;align-items:center;gap:10px}
  .preview .t{flex:1;font-size:16px;font-weight:650;line-height:1.3}
  .preview .k{font-size:11px;color:#9aa1b8;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .preview textarea{flex:1;min-height:44px;border:1px solid #6a5cff;border-radius:10px;background:#11131b;color:#fff;font-size:15px;padding:8px;resize:vertical}
  .btn{border:0;border-radius:10px;padding:9px 13px;font:700 13px inherit;cursor:pointer;background:rgba(255,255,255,.1);color:#fff;flex:none}
  .btn.go{background:#21b673}
  .toast{padding:8px 12px;font-size:13px;border-radius:12px;align-self:center;max-width:100%}
  .toast.good{background:#123d2c;color:#b9f6da}.toast.bad{background:#47202a;color:#ffd3dc}.toast.info{background:#1f2433;color:#d4d8e8}
  .menu{padding:12px;display:grid;gap:9px;font-size:13px}
  .menu label{display:flex;gap:8px;align-items:flex-start;color:#dfe2ee}
  .menu small{color:#9aa1b8}
  .menu .ask{height:34px;font-size:13px}
  .mini{position:fixed;right:18px;bottom:96px;z-index:2147483647;width:46px;height:46px;border-radius:16px;border:0;background:#6a5cff;color:#fff;font:800 18px system-ui;cursor:pointer;box-shadow:0 10px 26px rgba(30,20,90,.45)}
  .hide{display:none!important}`

  function build() {
    if (state.root) return
    const host = document.createElement('div')
    host.id = 'fingertip-meeting-assistant'
    const sh = host.attachShadow({ mode: 'open' })
    sh.innerHTML = `<style>${CSS}</style>
      <button class="mini hide" id="ft-open" aria-label="Open Fingertip">F</button>
      <div class="wrap" id="ft-wrap" role="region" aria-label="Fingertip captions">
        <div class="toast hide" id="ft-toast" role="status" aria-live="polite"></div>
        <div class="card preview hide" id="ft-preview">
          <div style="flex:1;min-width:0"><div class="k" id="ft-preview-k">AI suggestion</div><div class="t" id="ft-preview-text"></div>
            <textarea class="hide" id="ft-edit" aria-label="Edit the sentence"></textarea></div>
          <button class="btn" id="ft-editbtn">Edit</button><button class="btn" id="ft-cancel" aria-label="Discard">✕</button>
          <button class="btn go" id="ft-show">Show ↵</button>
        </div>
        <div class="card menu hide" id="ft-menu">
          <label><input type="checkbox" id="ft-burn" checked> <span><b>Captions in my camera</b><br><small>Everyone in the meeting sees them. <span id="ft-cam"></span></small></span></label>
          <label><input type="checkbox" id="ft-chat" ${isMeet ? '' : 'disabled'}> <span>Also post to Meet chat <small>(best effort)</small></span></label>
          <label><input type="checkbox" id="ft-voice"> <span>Also speak it into my mic <small>(experimental)</small></span></label>
          <label><input type="checkbox" id="ft-live"> <span>Explain live: keep labelling what I show</span></label>
          <input class="ask" id="ft-ask" placeholder="Explain focus (optional): e.g. which light is the problem?">
          <small>Server: <span id="ft-server"></span> · <a href="#" id="ft-options" style="color:#a99fff">change</a></small>
        </div>
        <div class="card bar">
          <span class="dot" id="ft-dot" title="Server status"></span>
          <div class="seg" role="radiogroup" aria-label="Mode">
            <button id="ft-mode-ai" class="on" role="radio" aria-checked="true" title="AI turns a few words into a natural sentence. You approve it first.">✦ AI</button>
            <button id="ft-mode-exact" role="radio" aria-checked="false" title="Shown exactly as typed">Exact</button>
          </div>
          <input id="ft-input" aria-label="Type what you want to say" autocomplete="off">
          <button class="ib" id="ft-sign" data-tip="Sign instead" aria-label="Open signing camera">✋</button>
          <button class="ib" id="ft-explain" data-tip="Explain what I'm showing (Alt+E)" aria-label="Explain what I'm showing">🔍</button>
          <button class="ib" id="ft-more" data-tip="Settings" aria-label="Settings">⋯</button>
          <button class="ib" id="ft-min" data-tip="Minimise" aria-label="Minimise">–</button>
        </div>
      </div>`
    document.documentElement.appendChild(host)
    state.root = sh
    state.$ = (id) => sh.getElementById(id)
    const $ = state.$
    const input = $('ft-input')
    // Keep the meeting's own keyboard shortcuts from firing while typing here.
    for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation())
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } if (e.key === 'Escape') clearPreview() })
    $('ft-mode-ai').addEventListener('click', () => setMode('ai'))
    $('ft-mode-exact').addEventListener('click', () => setMode('exact'))
    $('ft-show').addEventListener('click', approve)
    $('ft-cancel').addEventListener('click', clearPreview)
    $('ft-editbtn').addEventListener('click', () => {
      const ed = $('ft-edit'); ed.value = state.preview?.text || ''
      ed.classList.remove('hide'); $('ft-preview-text').classList.add('hide'); ed.focus()
    })
    $('ft-edit').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); approve() } })
    $('ft-sign').addEventListener('click', openSigning)
    $('ft-explain').addEventListener('click', explainNow)
    $('ft-more').addEventListener('click', () => { $('ft-menu').classList.toggle('hide'); $('ft-more').classList.toggle('on') })
    $('ft-min').addEventListener('click', () => { $('ft-wrap').classList.add('hide'); $('ft-open').classList.remove('hide') })
    $('ft-open').addEventListener('click', () => { $('ft-wrap').classList.remove('hide'); $('ft-open').classList.add('hide'); input.focus() })
    $('ft-burn').addEventListener('change', (e) => { state.burn = e.target.checked; window.postMessage({ fingertip: 'burn', on: state.burn }, '*'); render() })
    $('ft-chat').addEventListener('change', (e) => { state.chat = e.target.checked })
    $('ft-voice').addEventListener('change', (e) => { state.voice = e.target.checked })
    $('ft-live').addEventListener('change', (e) => setLive(e.target.checked))
    $('ft-ask').addEventListener('keydown', (e) => e.stopPropagation())
    $('ft-options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ ft: 'options' }) })
    setMode('ai')
    render()
    checkServer()
  }

  function setMode(m) {
    state.mode = m
    const $ = state.$
    $('ft-mode-ai').classList.toggle('on', m === 'ai'); $('ft-mode-ai').setAttribute('aria-checked', String(m === 'ai'))
    $('ft-mode-exact').classList.toggle('on', m === 'exact'); $('ft-mode-exact').setAttribute('aria-checked', String(m === 'exact'))
    $('ft-input').placeholder = m === 'ai' ? 'Type a few words, press Enter (e.g. yes friday 3)' : 'Type exactly what to show, press Enter'
  }

  function render() {
    const $ = state.$
    if (!$) return
    $('ft-cam').textContent = !state.burn ? 'Off.' : state.wrapped?.video ? 'Camera hooked ✓' : 'Waiting for your camera. If it was already on, turn it off and on once.'
    $('ft-dot').className = `dot ${state.serverOk === true ? 'ok' : state.serverOk === false ? 'bad' : ''}`
    $('ft-dot').title = state.serverOk ? `Connected to ${state.server}` : `Server not reachable: ${state.server}`
    $('ft-server').textContent = `${state.server} ${state.serverOk ? '✓' : state.serverOk === false ? '✗ not reachable' : ''}`
  }

  let toastTimer
  function toast(text, kind = 'info', ms = 4500) {
    const t = state.$('ft-toast')
    t.textContent = text; t.className = `toast ${kind}`
    clearTimeout(toastTimer)
    if (ms) toastTimer = setTimeout(() => t.classList.add('hide'), ms)
  }

  async function checkServer() {
    const r = await api('/api/health')
    state.server = r.server || state.server
    state.serverOk = !!r.ok
    render()
    if (!r.ok) toast(`${r.error} AI Assist and Explain need it; Exact captions still work.`, 'bad', 9000)
  }

  // ------------------------------------------------------------ type -> (AI) -> approve -> camera
  async function submit() {
    const text = clean(state.$('ft-input').value)
    if (!text) { toast('Type something first.', 'bad', 2500); return }
    if (state.preview && state.$('ft-edit').classList.contains('hide') && text === state.preview.source) { approve(); return }
    if (state.mode === 'exact') { await share(text); state.$('ft-input').value = ''; return }
    toast('Writing a natural sentence…', 'info', 0)
    const r = await api('/api/expand', { text, style: 'casual' })
    if (!r.ok) { toast(`AI Assist failed: ${r.error}`, 'bad', 8000); return }
    showPreview(r.data.text, 'AI suggestion', text)
    toast(`Ready in ${r.ms} ms. Press Enter or Show to put it in your camera.`, 'info', 4000)
  }

  function showPreview(text, kind, source = '') {
    const $ = state.$
    state.preview = { text, source }
    $('ft-preview-k').textContent = kind
    $('ft-preview-text').textContent = text
    $('ft-preview-text').classList.remove('hide')
    $('ft-edit').classList.add('hide')
    $('ft-preview').classList.remove('hide')
  }

  function clearPreview() {
    state.preview = null
    state.$('ft-preview').classList.add('hide')
  }

  async function approve() {
    const $ = state.$
    const editing = !$('ft-edit').classList.contains('hide')
    const text = clean(editing ? $('ft-edit').value : state.preview?.text)
    if (!text) return
    clearPreview()
    $('ft-input').value = ''
    await share(text)
  }

  async function share(text) {
    const done = []
    const problems = []
    if (state.burn) {
      burn(text, true)
      if (state.wrapped?.video) done.push('in your camera for everyone')
      else problems.push('your camera isn\'t hooked yet (turn it off and on once)')
    }
    if (state.chat) {
      const c = await postToMeetChat(text)
      ;(c.ok ? done : problems).push(c.ok ? 'in Meet chat' : c.reason)
    }
    if (state.voice) {
      const r = await api('/api/tts', { text }, true)
      if (r.ok) {
        const bytes = Uint8Array.from(atob(r.audio), (ch) => ch.charCodeAt(0))
        window.postMessage({ fingertip: 'play', audio: bytes.buffer }, '*', [bytes.buffer])
        done.push('spoken')
      } else problems.push(`voice failed: ${r.error}`)
    }
    if (!state.burn && !state.chat && !state.voice) problems.push('every output is off (⋯ settings)')
    toast(`“${text}” ${done.length ? '→ ' + done.join(', ') : ''}${problems.length ? (done.length ? ' · ' : '') + problems.join(' · ') : ''}`,
      problems.length && !done.length ? 'bad' : 'good', 5000)
  }

  // Meet chat (best effort: Meet has no public API for it)
  function meetChatBox() {
    return document.querySelector('textarea[aria-label*="Send a message" i], textarea[aria-label*="message" i], div[contenteditable="true"][aria-label*="message" i]')
  }
  async function postToMeetChat(text) {
    if (!isMeet) return { ok: false, reason: 'chat posting is Meet-only' }
    let box = meetChatBox()
    if (!box) {
      document.querySelector('button[aria-label*="Chat with everyone" i], button[aria-label*="chat" i][aria-label*="everyone" i]')?.click()
      for (let i = 0; i < 15 && !box; i += 1) { await new Promise((r) => setTimeout(r, 100)); box = meetChatBox() }
    }
    if (!box) return { ok: false, reason: 'Meet chat box not found' }
    box.focus()
    if (box instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text)
    } else box.textContent = text
    box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    await new Promise((r) => setTimeout(r, 60))
    const send = document.querySelector('button[aria-label*="Send a message" i], button[aria-label*="send" i]')
    if (send && !send.disabled) send.click()
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }

  // ------------------------------------------------------------ Show & explain
  const explain = { busy: false, live: false, timer: null }
  function snapCamera(timeout = 2500) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('no camera picture. Is your camera on?')) }, timeout)
      function on(event) {
        if (event.source !== window || event.data?.fingertip !== 'snapped') return
        clearTimeout(t); window.removeEventListener('message', on); resolve(event.data.image)
      }
      window.addEventListener('message', on)
      window.postMessage({ fingertip: 'snap' }, '*')
    })
  }
  async function explainNow() {
    if (explain.busy) return
    if (!state.wrapped?.video) { toast('Explain needs your camera on (turn it off and on once if it was already on).', 'bad', 6000); return }
    explain.busy = true
    const btn = state.$('ft-explain')
    btn.classList.add('on')
    if (!explain.live) toast('Looking at what you\'re showing…', 'info', 0)
    try {
      const image = await snapCamera()
      const r = await api('/api/explain-frame', { image, question: clean(state.$('ft-ask').value) })
      if (!r.ok) throw new Error(r.error)
      window.postMessage({ fingertip: 'annotate', items: r.data.items, live: explain.live }, '*')
      if (r.data.summary && !explain.live) burn(r.data.summary, true)
      if (!explain.live) {
        toast(r.data.items.length ? `Labelled for everyone (${r.ms} ms): ${r.data.items.map((it, i) => `${i + 1}. ${it.label}`).join('  ')}`
          : 'Nothing clear to label. Hold it closer to the camera.', r.data.items.length ? 'good' : 'bad', 7000)
      }
    } catch (e) {
      toast(`Explain failed: ${e.message}`, 'bad', 7000)
    } finally {
      explain.busy = false
      if (!explain.live) btn.classList.remove('on')
    }
  }
  function setLive(on) {
    explain.live = on
    clearInterval(explain.timer)
    state.$('ft-explain').classList.toggle('on', on)
    if (on) { explainNow(); explain.timer = setInterval(explainNow, 3500) }
    else window.postMessage({ fingertip: 'annotate', items: [], live: false }, '*')
  }

  // ------------------------------------------------------------ signing window
  function openSigning() {
    const popup = window.open(`${state.server}/#meet`, 'fingertip-signing', 'width=410,height=760')
    if (!popup) toast('Allow pop-ups for this site to open the signing camera.', 'bad', 7000)
    else toast('Signing window open. Your signs show live in your camera; the sentence comes back here to approve.', 'info', 6000)
  }
  window.addEventListener('message', (event) => {
    let origin
    try { origin = new URL(state.server).origin } catch { return }
    if (event.origin !== origin) return
    const m = event.data
    if (!m || m.source !== 'sign2speak') return
    if (m.type === 'partial') { if (state.burn) burn(clean(m.text), false); return }
    if (m.type === 'send') { build(); showPreview(clean(m.text), 'From your signs'); toast('Signed sentence ready. Show it, edit it, or ✕.', 'info', 5000) }
  })

  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); explainNow() }
  }, true)

  chrome.runtime.sendMessage({ ft: 'server' }, (r) => { if (r?.server) state.server = r.server; render() })
  const ready = () => build()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
})()
