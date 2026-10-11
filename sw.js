// Offline support: always try the network first (so updates show immediately), fall back to the cache offline.
const CACHE = 'haushelden-v1';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  url.search = '';   // ?tag=… previews share the cached page
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(url.href, res.clone()));
    return res;
  }).catch(() => caches.match(url.href).then(r => r || caches.match('./'))));
});
