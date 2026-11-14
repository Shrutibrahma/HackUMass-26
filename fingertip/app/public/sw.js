// Minimal service worker: makes the app installable and loads the shell offline.
// Calls always need the network; API and socket requests are never cached.
const CACHE = 's2s-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/twilio')) return
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone()
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
      return r
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  )
})


