import { access, readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
const requiredMatches = ['https://meet.google.com/*', 'https://app.zoom.us/wc/*']
const scripts = manifest.content_scripts || []
const matches = [...new Set(scripts.flatMap((entry) => entry.matches || []))]

if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3')
if (!scripts.length) throw new Error('content_scripts is required')
const main = scripts.find((entry) => (entry.js || []).includes('inject.js'))
if (!main || main.world !== 'MAIN' || main.run_at !== 'document_start') {
  throw new Error('inject.js must run in the MAIN world at document_start (before the meeting asks for the camera)')
}
for (const match of requiredMatches) {
  if (!matches.includes(match)) throw new Error(`missing supported match: ${match}`)
}

const declaredFiles = [
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...scripts.flatMap((entry) => entry.js || []),
]
for (const file of declaredFiles) await access(new URL(`./${file}`, import.meta.url))

console.log(`Manifest OK: ${manifest.name} ${manifest.version}; ${matches.length} supported URL patterns.`)
