/* ==========================================================================
   Service worker — offline shell for the mobile PWA
   ========================================================================== */
const VERSION = 'sas-v6';
const SHELL = [
  '/mobile/',
  '/mobile/index.html',
  '/mobile/css/mobile.css',
  '/mobile/js/core.js',
  '/mobile/js/app.js',
  '/assets/base.css',
  '/vendor/jsQR.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /**
   * The kiosk credential is time-boxed to a minute. Serving a cached copy
   * would paint an already-expired code on the screen, so these calls are
   * always live — a kiosk that cannot reach the server must say so.
   */
  if (url.pathname.startsWith('/api/public/kiosk/')) return;

  // API calls: try the network, fall back to cache, never cache errors.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response(
          JSON.stringify({ ok: false, error: 'Anda sedang offline. Data terakhir yang tersimpan ditampilkan.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )))
    );
    return;
  }

  // Navigation: app shell first, then network.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/mobile/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/mobile/index.html').then((r) => r || caches.match('/mobile/')))
    );
    return;
  }

  // Static assets: cache-first with background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
