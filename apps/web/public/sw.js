// DescontoReal service worker. It keeps an offline page and the hashed static files; it never keeps pages with
// prices, so nothing stale is shown offline, and it never touches the admin, account or API routes.
const VERSION = "1";
const OFFLINE_URL = "/offline";
const PAGES_CACHE = `paginas-${VERSION}`;
const STATIC_CACHE = `estaticos-${VERSION}`;
const PRIVATE_PATHS = /^\/(api|admin|entrar|auth|conta)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== PAGES_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || PRIVATE_PATHS.test(url.pathname)) {
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    // Hashed file names: a cached copy is always the right one.
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ??
            fetch(request).then((response) => {
              if (response.ok) {
                void cache.put(request, response.clone());
              }
              return response;
            }),
        ),
      ),
    );
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((offline) => offline ?? Response.error())),
    );
  }
});
