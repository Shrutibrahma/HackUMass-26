import { access, readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
const requiredMatches = ['https://meet.google.com/*', 'https://app.zoom.us/wc/*']
const matches = manifest.content_scripts?.flatMap((entry) => entry.matches || []) || []

if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3')
if (!manifest.content_scripts?.length) throw new Error('content_scripts is required')
if (!manifest.web_accessible_resources?.some((entry) => entry.resources?.includes('inject.js'))) {
  throw new Error('inject.js must be web-accessible')
}
for (const match of requiredMatches) {
  if (!matches.includes(match)) throw new Error(`missing supported match: ${match}`)
}
if (manifest.icons) throw new Error('Do not reference icons that are absent from the package')

const declaredFiles = [
  manifest.options_page,
  ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  ...manifest.web_accessible_resources.flatMap((entry) => entry.resources || []),
]
for (const file of declaredFiles) await access(new URL(`./${file}`, import.meta.url))

console.log(`Manifest OK: ${manifest.name} ${manifest.version}; ${matches.length} supported URL patterns.`)
