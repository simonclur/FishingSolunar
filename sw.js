// Service worker: makes the app shell (HTML/CSS/JS + bundled local tide
// data) available offline after the first successful visit. See
// docs/DATA_SOURCES.md "Offline behaviour" for the full offline strategy -
// this file only handles same-origin static assets; live API responses
// (weather/marine/WorldTides) are cached separately in localStorage by
// js/app.js (cachedFetch()), not here, since they're per-location/date and
// don't belong in a generic asset cache.

const CACHE_NAME = "fishing-solunar-shell-v4";
const PRECACHE_URLS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/locations.js",
  "js/astro.js",
  "js/moon.js",
  "js/solunar.js",
  "js/tides.js",
  "js/app.js",
  "data/tides/waddy-point-kgari-2026.csv",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GETs (the app shell + local tide CSVs), so the
// whole UI and tide calculation still work with no network at all. Anything
// cross-origin (Open-Meteo, WorldTides) is left to the browser's normal
// networking - those are handled by the localStorage cache in app.js instead,
// since a generic HTTP cache can't easily key on query-string date ranges.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
