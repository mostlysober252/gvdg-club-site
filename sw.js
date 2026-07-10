const CACHE = "gvdg-club-v86";
const OFFLINE_PAGE = "gvdg-members.html";
const ASSETS = [
  "tokens.css",
  "site.webmanifest",
  "pwa.js",
  "admin-app/admin-app.js",
  "home-app/home-app.js",
  "public-app/public-app.js",
  "tee-sign-preview-app/tee-sign-preview-app.js",
  "img/logo.png",
  "img/icons/app-icon-192.png",
  "img/icons/app-icon-512.png",
  "img/icons/maskable-icon-512.png",
  "img/icons/apple-touch-icon.png",
  OFFLINE_PAGE,
  "members-app/members-app.js",
  "score.html",
  "score-app/score-app.js"
];
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic";
}

function staticAsset(req, url) {
  return STATIC_DESTINATIONS.has(req.destination) || /\.(?:css|gif|ico|jpe?g|js|png|svg|webmanifest|webp)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match(OFFLINE_PAGE)))
    );
    return;
  }

  if (!staticAsset(req, url)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => (req.destination === "image" ? caches.match("img/logo.png") : Response.error()));
    })
  );
});
