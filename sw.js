const CACHE_NAME = "our-goa-map-shell-v3";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/map-app.js",
  "./src/trip-data.js",
  "./src/maps-loader.js",
  "./src/route-tools.js",
  "./src/places-tools.js",
  "./src/geo-formats.js",
  "./src/formatters.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never intercept/cache Maps tiles, Google APIs, Place Photos, Routes responses or any cross-origin content.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/maps/") || url.pathname.includes("/routes/") || url.pathname.includes("/places/")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match("./index.html"))));
});
