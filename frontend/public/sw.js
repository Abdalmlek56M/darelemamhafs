/* Shell-only cache. API responses and authentication/data endpoints are never cached. */
const CACHE = 'dar-shell-v0.8';
const SHELL = ['/', '/teacher', '/manifest.webmanifest', '/manifest-teacher.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('dar-shell-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (['script', 'style', 'font', 'image'].includes(event.request.destination)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then((response) => {
        if (response.ok) void cache.put(event.request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    }));
    return;
  }

  event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request)) || (await caches.match('/'))));
});
