// sw.js — minimal offline service worker (no build step, no dependencies).
// Strategy: the /api referee is ALWAYS live; app js/css are network-first so
// local edits show on reload; vendored libs and icons are cache-first; page
// navigations fall back to the cached shell when offline. Bump CACHE when the
// caching policy changes.
const CACHE = 'ai-dnd-v1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // the referee is always live

  const cachePut = (res) => {
    if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  };

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(cachePut).catch(() => caches.match('/index.html')));
    return;
  }

  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(cachePut)));
    return;
  }

  event.respondWith(fetch(req).then(cachePut).catch(() => caches.match(req)));
});
