// Governing: SPEC-0001 REQ "Installable Web App" (a new version loads on the next launch while online, never a
// stale cache), REQ "Offline Operation" (the shell opens without a network), design "Offline: service worker
// shell + local write queue"
//
// Network-first service worker for the app shell, ported from the prototype's sw.js: always try the network
// first (so a deploy shows up on the next launch), fall back to the cache offline. Household data is never
// cached here: it lives in the IndexedDB mirror, and /api/ requests bypass this worker.
const CACHE = "haushelden-v1";
const FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/app.css",
  "css/auth.css",
  "css/shop.css",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "js/errors.js",
  "js/dates.js",
  "js/routines.js",
  "js/merge.js",
  "js/outbox.js",
  "js/storage.js",
  "js/sse.js",
  "js/pb.js",
  "js/auth.js",
  "js/auth-ui.js",
  "js/data.js",
  "js/todos.js",
  "js/router.js",
  "js/shop.js",
  "js/rhythm.js",
  "js/shop-learning.js",
  "js/routes.js",
  "js/app.js",
  "js/screens/home.js",
  "js/screens/routinen.js",
  "js/screens/maskottchen.js",
  "js/screens/eltern.js",
  "js/screens/setup.js",
  "js/screens/anmelden.js",
  "js/screens/einladung.js",
  "js/screens/wer.js",
  "js/screens/shopping.js",
  "js/screens/gelernt.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Only the app shell: other origins, the API (household data) and the admin UI go straight to the network.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_/")
  )
    return;
  url.search = ""; // ?tag=… previews share the cached page
  e.respondWith(
    // "no-cache" revalidates with the server, so the browser's HTTP cache can never serve a stale version.
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(url.href, res.clone()));
        return res;
      })
      .catch(() => caches.match(url.href).then((r) => r || caches.match("./"))),
  );
});
