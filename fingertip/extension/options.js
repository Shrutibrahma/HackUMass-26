const input = document.getElementById('server')
const status = document.getElementById('status')
const save = document.getElementById('save')

chrome.storage.sync.get({ server: 'http://localhost:8000' }, (values) => { input.value = values.server })

save.addEventListener('click', async () => {
  status.textContent = ''
  let origin
  try {
    const url = new URL(input.value.trim())
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol')
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Remote servers must use HTTPS.')
    }
    origin = url.origin
  } catch (error) {
    status.textContent = error.message === 'Remote servers must use HTTPS.' ? error.message : 'Enter a valid HTTP(S) server URL.'
    return
  }

  if (origin.startsWith('https://')) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
    if (!granted) {
      status.textContent = 'Server permission was not granted; settings were not changed.'
      return
    }
  }
  await chrome.storage.sync.set({ server: origin })
  input.value = origin
  status.textContent = 'Saved. Reload any open meeting tab to apply it.'
})
