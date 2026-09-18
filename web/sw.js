const CACHE = "meri-schedule-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./work-calendar.css",
  "./settings-items.css",
  "./history.css",
  "./app.js",
  "./work-calendar.js",
  "./settings-items.js",
  "./history.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
