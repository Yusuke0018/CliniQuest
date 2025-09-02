// Simple offline cache for essential assets
const CACHE_NAME = 'cliniquest-v7';
const ASSETS = [
  './',
  './index.html?v=20250902-6',
  './styles.css?v=20250902-6',
  './app.js?v=20250902-6',
  './manifest.webmanifest?v=20250902-6',
  './404.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((resp) => {
            const copy = resp.clone();
            caches
              .open(CACHE_NAME)
              .then((c) => c.put(request, copy))
              .catch(() => {});
            return resp;
          })
          .catch(() => cached),
    ),
  );
});
