// Simple offline cache for essential assets
const CACHE_NAME = 'cliniquest-v24';
const ASSETS = [
  './',
  './index.html?v=20250902-23',
  './styles.css?v=20250902-23',
  './app.js?v=20250902-23',
  './manifest.webmanifest?v=20250902-23',
  './404.html',
  './fonts/DotGothic16.ttf',
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
  const isHtml = request.mode === 'navigate' || request.destination === 'document';
  const isAsset = ['style', 'script', 'manifest', 'font', 'image'].includes(request.destination);

  if (isHtml || request.destination === 'script' || request.destination === 'style') {
    e.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }
  if (isAsset) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            const copy = resp.clone();
            caches
              .open(CACHE_NAME)
              .then((c) => c.put(request, copy))
              .catch(() => {});
            return resp;
          }),
      ),
    );
    return;
  }
  e.respondWith(fetch(request).catch(() => caches.match(request)));
});
