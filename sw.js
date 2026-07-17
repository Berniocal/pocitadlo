const CACHE = "pocitadlo-v7";
const APP_SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !["http:", "https:"].includes(url.protocol)) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (url.origin === self.location.origin && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then(r => r || caches.match("./index.html"))
    )
  );
});
