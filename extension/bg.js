// Service worker: every call to the Fingertip server goes through here, from the extension's own origin.
// A meeting page (https://meet.google.com) calling a server on this laptop directly is blocked by Chrome's
// local-network protection and by CORS; the extension, with host permission for the server, is not.
const DEFAULT_SERVER = 'http://127.0.0.1:8000'

async function server() {
  const { server } = await chrome.storage.sync.get({ server: DEFAULT_SERVER })
  try { return new URL(server).origin } catch { return DEFAULT_SERVER }
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function call({ path, body, binary }) {
  const base = await server()
  const t0 = Date.now()
  try {
    const r = await fetch(base + path, body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const ms = Date.now() - t0
    if (!r.ok) {
      const detail = (await r.json().catch(() => ({}))).detail
      return { ok: false, status: r.status, error: detail || `Server answered ${r.status}`, server: base, ms }
    }
    if (binary) return { ok: true, audio: toBase64(await r.arrayBuffer()), server: base, ms }
    return { ok: true, data: await r.json(), server: base, ms }
  } catch (e) {
    return { ok: false, status: 0, error: `Can't reach the Fingertip server at ${base}. Is it running? (Options to change it)`, server: base }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.ft === 'api') { call(msg).then(reply); return true }
  if (msg?.ft === 'server') { server().then((s) => reply({ server: s })); return true }
  if (msg?.ft === 'options') { chrome.runtime.openOptionsPage(); reply({ ok: true }); return false }
  return false
})
