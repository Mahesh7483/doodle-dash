// Doodle Dash service worker: makes the game installable and opens the app shell offline.
// Network first for everything, so players always get the latest deploy when online; the cache
// is only a fallback. The game itself (Socket.IO) never goes through here.

const CACHE = 'dd-shell-v1';
const SHELL = '/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const PASS = /^\/(socket\.io|api|new|stats|qr|healthz|tv)(\/|$)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || PASS.test(url.pathname)) return;
  const page = req.mode === 'navigate';
  // Every page (/, /r/CODE) is the same app, so one cached copy of it is enough.
  const key = page ? SHELL : req;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error()))
  );
});
