const SHELL_CACHE = "idb-shell-v15";
const API_CACHE = "idb-api-v3";
const CACHES = [SHELL_CACHE, API_CACHE];

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/weather/",
  "/weather/index.html",
  "/quake/",
  "/quake/index.html",
  "/crypto/",
  "/crypto/index.html",
  "/emsifa/",
  "/emsifa/index.html",
  "/kodepos/",
  "/kodepos/index.html",
  "/holidays/",
  "/holidays/index.html",
  "/quran/",
  "/quran/index.html",
  "/css/theme.css",
  "/css/index.css",
  "/css/weather.css",
  "/css/quake.css",
  "/css/crypto.css",
  "/css/emsifa.css",
  "/css/kodepos.css",
  "/css/holidays.css",
  "/css/quran.css",
  "/js/icons.js",
  "/js/theme.js",
  "/js/index.js",
  "/js/weather.js",
  "/js/quake.js",
  "/js/crypto.js",
  "/js/emsifa.js",
  "/js/kodepos.js",
  "/js/holidays.js",
  "/js/quran.js",
  "/manifest.json",
  "/favicon.ico",
  "/IDB-main.png",
  "/IDB-192.png",
  "/IDB-512.png"
];

/* -- Install: cache the app shell -- */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
    .then(cache => cache.addAll(SHELL_ASSETS))
    .then(() => self.skipWaiting())
  );
});

/* -- Activate: drop old cache versions -- */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
    .then(keys =>
      Promise.all(
        keys
        .filter(k => !CACHES.includes(k))
        .map(k => caches.delete(k))
      )
    )
    .then(() => self.clients.claim())
  );
});

/* -- Fetch: strategy per route -- */

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Our serverless API - stale-while-revalidate, so once a request has been
  // made once it keeps working offline, and refreshes quietly whenever a
  // connection is available.
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Google Fonts - cache-first (immutable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else on our own origin (shell HTML/CSS/JS/images) - cache-first
  if (sameOrigin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Other cross-origin requests (e.g. Quran recitation audio) are left to
  // the network as usual and are not cached.
});

/* -- Strategies -- */

async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Refresh in the background; don't let the caller wait on it, and
    // don't let a network failure surface as an unhandled rejection.
    networkFetch.catch(() => {});
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;

  return new Response(
    JSON.stringify({ success: false, error: 'Offline, and no cached data is available yet for this request.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}
