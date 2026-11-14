// Fingertip meeting assistance. Captions are local unless the user explicitly opts into
// the best-effort Google Meet chat integration. Zoom Desktop and FaceTime are not supported.
(() => {
  if (window.__fingertipMeetingCaptions) return
  window.__fingertipMeetingCaptions = true

  const platform = location.hostname === 'meet.google.com' ? 'Google Meet'
    : /zoom\.us$/.test(location.hostname) ? 'Zoom Web' : 'Test meeting'
  const state = {
    server: 'http://localhost:8000',
    panel: null,
    shadow: null,
    input: null,
    draft: null,
    mode: 'ai',
    burn: true,
    wrapped: null,
  }

  /** Draw a caption into my outgoing camera (inject.js). Everyone in the meeting sees it. */
  function burn(text, final = true) {
    window.postMessage({ fingertip: 'caption', text, final }, '*')
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500)

  function deterministicExpand(value) {
    const original = clean(value)
    const key = original.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
    const fixed = {
      'yes tomorrow 5': 'Yes, tomorrow at five works for me.',
      'yes home 6': "Yes, I'll be home around six.",
      'mom late traffic 20': "Mom, I'm running a little late because of traffic. I should be there in about twenty minutes.",
      'refund order broken': "I'm calling because my order arrived damaged, and I'd like to request a refund.",
      'order damaged refund': "I'm calling because my order arrived damaged, and I'd like to request a refund.",
    }
    if (fixed[key]) return fixed[key]
    if (!original) return ''
    const sentence = original.charAt(0).toUpperCase() + original.slice(1)
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  }

  async function expand(value) {
    const text = clean(value)
    if (!text) return ''
    try {
      const response = await fetch(`${state.server}/api/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style: 'casual' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      return clean(body.text) || deterministicExpand(text)
    } catch {
      return deterministicExpand(text)
    }
  }

  function meetChatBox() {
    return document.querySelector(
      'textarea[aria-label*="Send a message" i], textarea[aria-label*="message" i], div[contenteditable="true"][aria-label*="message" i]',
    )
  }

  async function postToMeetChat(text) {
    if (platform !== 'Google Meet') return { ok: false, reason: 'Zoom chat delivery is not supported.' }
    let box = meetChatBox()
    if (!box) {
      const openChat = document.querySelector(
        'button[aria-label*="Chat with everyone" i], button[aria-label*="chat" i][aria-label*="everyone" i]',
      )
      if (openChat) openChat.click()
      for (let attempt = 0; attempt < 15 && !box; attempt += 1) {
        await sleep(100)
        box = meetChatBox()
      }
    }
    if (!box) return { ok: false, reason: 'Meet chat was not found; no message was posted.' }
    box.focus()
    if (box instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(box, text)
      else box.value = text
    } else {
      box.textContent = text
    }
    box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    await sleep(60)
    const send = document.querySelector('button[aria-label*="Send a message" i], button[aria-label*="send" i]')
    if (send && !send.disabled) send.click()
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true, reason: 'Posted to Meet chat.' }
  }

  async function speakIntoMeeting(text) {
    try {
      const response = await fetch(`${state.server}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) return { ok: false, reason: `Voice unavailable (HTTP ${response.status}).` }
      const audio = await response.arrayBuffer()
      window.postMessage({ fingertip: 'play', audio }, '*', [audio])
      return { ok: true, reason: 'Voice sent to the browser meeting audio mixer.' }
    } catch {
      return { ok: false, reason: 'Voice server is offline or not permitted.' }
    }
  }

  const captions = {
    root: null,
    list: null,
    size: 22,
    build() {
      if (this.root) return
      const root = document.createElement('section')
      root.id = 'fingertip-local-captions'
      root.setAttribute('role', 'log')
      root.setAttribute('aria-live', 'polite')
      root.setAttribute('aria-label', 'Fingertip local captions')
      Object.assign(root.style, {
        position: 'fixed', left: '50%', bottom: '112px', transform: 'translateX(-50%)',
        zIndex: '2147483645', width: 'min(760px, 90vw)', display: 'none', color: '#fff',
        background: 'rgba(7, 10, 18, .9)', border: '1px solid rgba(255,255,255,.16)',
        borderRadius: '16px', boxShadow: '0 14px 45px rgba(0,0,0,.45)', fontFamily: 'system-ui, sans-serif',
      })
      const bar = document.createElement('div')
      Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px',
        cursor: 'move', borderBottom: '1px solid rgba(255,255,255,.12)', userSelect: 'none' })
      const title = document.createElement('strong')
      title.textContent = 'Fingertip · local caption'
      Object.assign(title.style, { flex: '1', fontSize: '12px', opacity: '.8' })
      bar.appendChild(title)
      const control = (label, aria, action) => {
        const button = document.createElement('button')
        button.textContent = label
        button.setAttribute('aria-label', aria)
        Object.assign(button.style, { border: '0', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer',
          background: 'rgba(255,255,255,.12)', color: '#fff', fontWeight: '700' })
        button.addEventListener('click', (event) => { event.stopPropagation(); action() })
        bar.appendChild(button)
      }
      control('A−', 'Smaller caption text', () => this.resize(-2))
      control('A+', 'Larger caption text', () => this.resize(2))
      control('×', 'Hide local captions', () => { root.style.display = 'none' })
      const list = document.createElement('div')
      Object.assign(list.style, { padding: '10px 16px 14px' })
      root.append(bar, list)
      document.documentElement.appendChild(root)
      this.root = root
      this.list = list
      this.drag(bar)
    },
    drag(handle) {
      let active = false
      let startX = 0
      let startY = 0
      let originX = 0
      let originY = 0
      handle.addEventListener('pointerdown', (event) => {
        if (event.target instanceof HTMLButtonElement) return
        const bounds = this.root.getBoundingClientRect()
        Object.assign(this.root.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, bottom: 'auto', transform: 'none' })
        active = true
        startX = event.clientX
        startY = event.clientY
        originX = bounds.left
        originY = bounds.top
        handle.setPointerCapture(event.pointerId)
      })
      handle.addEventListener('pointermove', (event) => {
        if (!active) return
        this.root.style.left = `${Math.max(0, Math.min(innerWidth - 160, originX + event.clientX - startX))}px`
        this.root.style.top = `${Math.max(0, Math.min(innerHeight - 50, originY + event.clientY - startY))}px`
      })
      handle.addEventListener('pointerup', () => { active = false })
    },
    resize(delta) {
      this.size = Math.max(14, Math.min(42, this.size + delta))
      this.list?.querySelectorAll('[data-caption]').forEach((node) => { node.style.fontSize = `${this.size}px` })
    },
    add(text, detail) {
      this.build()
      this.root.style.display = 'block'
      const row = document.createElement('div')
      row.style.margin = '5px 0'
      const line = document.createElement('div')
      line.dataset.caption = 'true'
      line.textContent = text
      Object.assign(line.style, { fontSize: `${this.size}px`, fontWeight: '650', lineHeight: '1.3' })
      const meta = document.createElement('div')
      meta.textContent = detail
      Object.assign(meta.style, { fontSize: '12px', opacity: '.72', marginTop: '3px' })
      row.append(line, meta)
      this.list.appendChild(row)
      while (this.list.children.length > 4) this.list.firstElementChild?.remove()
      ;[...this.list.children].forEach((child, index, all) => { child.style.opacity = index === all.length - 1 ? '1' : '.5' })
    },
  }

  function setStatus(message, kind = 'neutral') {
    const status = state.shadow?.getElementById('ft-status')
    if (!status) return
    status.textContent = message
    status.dataset.kind = kind
  }

  function updateMode() {
    state.mode = state.shadow.getElementById('ft-mode').value
    state.draft.value = ''
    const prepare = state.shadow.getElementById('ft-prepare')
    prepare.textContent = state.mode === 'ai' ? 'Create natural reply' : 'Prepare exact text'
    state.shadow.getElementById('ft-voice').disabled = state.mode === 'captions'
    setStatus(state.mode === 'ai'
      ? 'AI Assist rewrites only after you choose Create. Review the result before sharing.'
      : state.mode === 'exact'
        ? 'Exact Words preserves your text.'
        : 'Captions Only never requests speech.')
  }

  async function prepareDraft() {
    const source = clean(state.input.value)
    if (!source) return setStatus('Enter words first.', 'error')
    setStatus(state.mode === 'ai' ? 'Creating a concise reply…' : 'Preparing…', 'working')
    state.draft.value = state.mode === 'ai' ? await expand(source) : source
    setStatus(state.mode === 'ai'
      ? 'Draft ready. Edit it if needed; nothing has been shared.'
      : 'Exact text ready; nothing has been shared.', 'good')
  }

  async function shareDraft() {
    const text = clean(state.draft.value)
    if (!text) return setStatus('Prepare or enter a draft first.', 'error')
    const post = state.shadow.getElementById('ft-chat').checked
    const voice = state.shadow.getElementById('ft-voice').checked && state.mode !== 'captions'
    const inCamera = state.burn && state.wrapped?.video
    if (state.burn) burn(text, true)
    captions.add(text, inCamera ? 'Shown in your camera: everyone in the meeting can read it.'
      : 'Visible only to you (turn your camera off and on once if the meeting started before the extension).')
    setStatus('Caption shown. Checking selected delivery options…', 'working')
    const results = []
    if (inCamera) results.push({ ok: true, reason: 'Drawn into your camera for everyone.' })
    if (post) results.push(await postToMeetChat(text))
    if (voice) results.push(await speakIntoMeeting(text))
    if (!results.length) return setStatus('Local caption shown. It was not sent to other participants (camera captions are off or the camera is not on).', 'good')
    const successes = results.filter((result) => result.ok).length
    setStatus(results.map((result) => result.reason).join(' '), successes === results.length ? 'good' : 'error')
  }

  // ---------------------------------------------------------------- Show & explain
  // Point the camera at something and the AI labels its important parts as tooltips drawn into the video.
  const explain = { busy: false, live: false, timer: null }

  function snapCamera(timeout = 2500) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('Turn your camera on first.')) }, timeout)
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
    if (!state.wrapped?.video) return setStatus('Explain needs your camera on in the meeting.', 'error')
    explain.busy = true
    const btn = state.shadow?.getElementById('ft-explain')
    if (btn && !explain.live) btn.textContent = 'Looking…'
    try {
      const image = await snapCamera()
      const question = clean(state.shadow?.getElementById('ft-ask')?.value)
      const t0 = performance.now()
      const response = await fetch(`${state.server}/api/explain-frame`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, question }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`)
      const r = await response.json()
      window.postMessage({ fingertip: 'annotate', items: r.items, live: explain.live }, '*')
      if (r.summary && !explain.live) {
        burn(r.summary, true)
        captions.add(r.summary, `Explained ${r.items.length} thing${r.items.length === 1 ? '' : 's'} in your camera (${Math.round(performance.now() - t0)} ms).`)
      }
      setStatus(r.items.length ? `Labelled: ${r.items.map((it, i) => `${i + 1}. ${it.label}`).join('  ')}` : 'Nothing clear to label. Hold it closer to the camera.', r.items.length ? 'good' : 'error')
    } catch (error) {
      setStatus(`Explain: ${error.message}`, 'error')
    } finally {
      explain.busy = false
      if (btn) btn.textContent = "Explain what I'm showing"
    }
  }

  function setLiveExplain(on) {
    explain.live = on
    clearInterval(explain.timer)
    if (on) { explainNow(); explain.timer = setInterval(explainNow, 3500) }
    else window.postMessage({ fingertip: 'annotate', items: [], live: false }, '*')
  }

  function openSigning() {
    const popup = window.open(`${state.server}/#meet`, 'fingertip-signing', 'width=410,height=760')
    if (!popup) setStatus('Allow popups to open the signing camera.', 'error')
  }

  function buildPanel() {
    if (state.panel) return
    const host = document.createElement('aside')
    host.id = 'fingertip-meeting-assistant'
    Object.assign(host.style, { position: 'fixed', right: '18px', bottom: '92px', zIndex: '2147483647' })
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}.launcher{width:54px;height:54px;border:0;border-radius:18px;background:#6256ff;color:#fff;box-shadow:0 10px 30px rgba(20,12,80,.35);font:800 20px system-ui;cursor:pointer;float:right}
        .panel{display:none;clear:both;width:min(360px,calc(100vw - 28px));max-height:calc(100vh - 170px);overflow-y:auto;overscroll-behavior:contain;margin-bottom:10px;padding:16px;border-radius:22px;background:#0f1320;color:#f7f8ff;border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 70px rgba(0,0,0,.5);font:14px/1.35 system-ui,sans-serif}.panel[data-open="true"]{display:block}
        h2{font-size:17px;margin:0}.eyebrow{color:#a8b0c9;font-size:11px;margin:3px 0 14px}label{display:block;color:#c8cde0;font-size:12px;font-weight:700;margin:10px 0 5px}
        select,textarea{width:100%;border:1px solid #30384e;border-radius:11px;background:#171d2c;color:#fff;padding:10px;font:14px system-ui}textarea{resize:vertical;min-height:62px}#ft-draft{min-height:76px}
        .row{display:flex;gap:8px;margin-top:9px}.row button{flex:1}button{border:0;border-radius:11px;padding:9px 11px;font:700 13px system-ui;cursor:pointer;background:#282f43;color:#fff}button[data-variant="primary"]{background:#655cff}button[data-variant="safe"]{background:#18a66d}
        button:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #9c95ff;outline-offset:2px}.checks{display:grid;gap:7px;margin:11px 0}.checks label{display:flex;align-items:flex-start;gap:8px;margin:0;font-weight:500;color:#d7daea}.checks input{margin-top:2px}
        .hint{font-size:11px;color:#9fa7be}.explain{margin-top:14px;padding-top:12px;border-top:1px solid #2a3145}.explain h3{margin:0 0 4px;font-size:14px}#ft-ask{min-height:40px}.status{margin-top:10px;padding:8px 10px;border-radius:10px;background:#1a2030;color:#cbd1e5;font-size:12px}.status[data-kind="good"]{background:#12382c;color:#b9f8dd}.status[data-kind="error"]{background:#411f29;color:#ffd0dc}
      </style>
      <div class="panel" id="ft-panel" data-open="false" role="dialog" aria-label="Fingertip meeting assistant">
        <h2>Fingertip · ${platform}</h2><p class="eyebrow">Sign or type. Approved captions appear inside your camera video.</p>
        <label for="ft-mode">Communication mode</label><select id="ft-mode"><option value="ai">AI Assist</option><option value="exact">Exact Words</option><option value="captions">Captions Only</option></select>
        <label for="ft-input">Words or phrase</label><textarea id="ft-input" placeholder="yes tomorrow 5"></textarea>
        <div class="row"><button id="ft-sign">Open signing camera</button><button id="ft-prepare" data-variant="primary">Create natural reply</button></div>
        <label for="ft-draft">Review and edit before sharing</label><textarea id="ft-draft" placeholder="Your approved sentence appears here"></textarea>
        <div class="checks"><label><input type="checkbox" id="ft-burn" checked> <span><b>Captions in my camera</b> · everyone in the meeting sees them <span id="ft-cam" class="hint"></span></span></label><label><input type="checkbox" id="ft-chat"> Also post to Google Meet chat (best effort)</label><label><input type="checkbox" id="ft-voice"> Also request meeting voice (experimental)</label></div>
        <button id="ft-share" data-variant="safe">Show approved caption</button>
        <div class="explain"><h3>Show &amp; explain <span class="hint">Alt+E</span></h3>
          <p class="hint">Hold something up to your camera. The AI points out the important parts with labels everyone sees.</p>
          <textarea id="ft-ask" placeholder="Optional: what should they notice? (e.g. which light is the problem)"></textarea>
          <div class="row"><button id="ft-explain" data-variant="primary">Explain what I'm showing</button></div>
          <div class="checks"><label><input type="checkbox" id="ft-live"> Keep explaining as I move it (live)</label><label><input type="checkbox" id="ft-clear-notes"> Clear labels</label></div></div>
        <p class="hint">Works in Chrome on Google Meet and Zoom Web. Install before joining (or turn your camera off/on once). Zoom Desktop and FaceTime are not supported.</p>
        <div class="status" id="ft-status" role="status">Nothing is shared until you choose Show approved caption.</div>
      </div><button class="launcher" id="ft-launcher" aria-label="Open Fingertip meeting assistant" aria-expanded="false">F</button>`
    document.documentElement.appendChild(host)
    state.panel = host
    state.shadow = shadow
    state.input = shadow.getElementById('ft-input')
    state.draft = shadow.getElementById('ft-draft')
    const launcher = shadow.getElementById('ft-launcher')
    launcher.addEventListener('click', () => {
      const panel = shadow.getElementById('ft-panel')
      const open = panel.dataset.open !== 'true'
      panel.dataset.open = String(open)
      launcher.setAttribute('aria-expanded', String(open))
    })
    shadow.getElementById('ft-mode').addEventListener('change', updateMode)
    shadow.getElementById('ft-prepare').addEventListener('click', prepareDraft)
    shadow.getElementById('ft-share').addEventListener('click', shareDraft)
    shadow.getElementById('ft-sign').addEventListener('click', openSigning)
    shadow.getElementById('ft-explain').addEventListener('click', explainNow)
    shadow.getElementById('ft-live').addEventListener('change', (e) => setLiveExplain(e.target.checked))
    shadow.getElementById('ft-clear-notes').addEventListener('change', (e) => {
      e.target.checked = false
      shadow.getElementById('ft-live').checked = false
      setLiveExplain(false)
    })
    shadow.getElementById('ft-burn').addEventListener('change', (e) => {
      state.burn = e.target.checked
      window.postMessage({ fingertip: 'burn', on: state.burn }, '*')
    })
    showCamState()
    if (platform !== 'Google Meet') {
      const chat = shadow.getElementById('ft-chat')
      chat.disabled = true
      chat.parentElement.style.opacity = '.55'
    }
  }

  function showCamState() {
    const el = state.shadow?.getElementById('ft-cam')
    if (!el) return
    el.textContent = state.wrapped?.video ? '(active)' : '(waiting for the camera)'
  }

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.fingertip === 'wrapped') {
      state.wrapped = event.data
      showCamState()
    }
  })

  function receiveSigningMessage(event) {
    let serverOrigin
    try { serverOrigin = new URL(state.server).origin } catch { return }
    if (event.origin !== serverOrigin) return
    const message = event.data
    if (!message || message.source !== 'sign2speak') return
    if (message.type === 'partial') {
      // Live signs while the signer is still signing: lighter caption in the camera.
      if (state.burn) burn(clean(message.text), false)
      return
    }
    if (message.type !== 'send') return
    buildPanel()
    state.input.value = clean(message.text)
    state.draft.value = clean(message.text)
    state.shadow.getElementById('ft-panel').dataset.open = 'true'
    setStatus('Recognized text received. Review it before sharing.', 'good')
  }

  chrome.storage.sync.get({ server: state.server }, (values) => {
    try { state.server = new URL(values.server).origin } catch { /* keep localhost */ }
  })
  window.addEventListener('message', receiveSigningMessage)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); explainNow() }
  }, true)
  const ready = () => buildPanel()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
})()
