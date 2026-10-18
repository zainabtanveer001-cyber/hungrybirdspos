// Service worker for Hungry Birds POS — offline-first app shell caching.

const APP_VERSION = "3.7.0";
const CACHE_NAME = `hb-pos-cache-v${APP_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./netlify.toml"
];

// Pre-cache the app shell and take control immediately.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Remove old caches on activation.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("hb-pos-cache-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept Firebase / Firestore / Auth traffic — must always hit the network.
  if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    (url.hostname.includes("gstatic.com") && url.pathname.includes("firebasejs"))
  ) {
    return;
  }

  if (url.origin === self.location.origin) {
    // App shell: network-first so new deploys show immediately; fall back to cache when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Third-party CDN libraries (Tailwind, Dexie, jsPDF, html2canvas): stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});
