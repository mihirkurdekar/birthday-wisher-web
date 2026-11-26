// Service worker for Birthday Wisher PWA.
// Keeps the offline shell alive (the "This surprise was just for your birthday"
// page) and caches the HTML + essential assets.

const STATIC_CACHE = "birthday-wisher-static-v4";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll([
        "/",
        "/index.html",
        "/manifest.json",
        "/sw.js",
        "/jquery.min.js",
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("wish")) return; // always hit the network / Lambda

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});