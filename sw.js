// Service worker for the GVDG live-scoring app (score.html). Caches the app shell so the page loads on a
// dead-cell course; the dynamic data (Worker API at a DIFFERENT origin) is never intercepted here — score
// writes made offline are queued in the page (localStorage) and flushed on reconnect.
const CACHE = "gvdg-score-v2";
const SHELL = ["score.html", "img/logo.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only the same-origin app shell + static assets. The cross-origin Worker API (auth.*) and fonts pass
  // straight through to the network — we never cache API responses or mutations.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("score.html")); // offline navigation → the cached app shell
    }),
  );
});
