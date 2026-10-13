// Bump CACHE_NAME when this worker changes.
const CACHE_NAME = "autoflash-offline-v2";
const OFFLINE_PAGE = "/study-offline";
const ICON_URLS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ICON_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Icons and the saved-decks page are stored after a normal load.
// They are used only when the network fails. API calls, server actions, and other pages stay on the network.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (event.request.headers.has("range")) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(networkFirst(event.request, false));
    return;
  }

  // Only the HTML page is stored. Data requests for the same address stay on the network.
  if (isOfflineHtml(url, event.request)) {
    event.respondWith(networkFirst(event.request, true));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(navigateOrOffline(event.request));
  }
});

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/") || pathname === "/favicon.ico";
}

function isOfflinePath(url) {
  return url.pathname === OFFLINE_PAGE || url.pathname === `${OFFLINE_PAGE}/`;
}

function isOfflineHtml(url, request) {
  if (!isOfflinePath(url)) return false;
  if (request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1") return false;
  if (url.searchParams.has("_rsc")) return false;
  const accept = request.headers.get("accept") || "";
  return request.mode === "navigate" || accept.includes("text/html");
}

function shouldStore(response, isDocument) {
  if (!response || !response.ok || response.type !== "basic") return false;
  if (!isDocument) return true;
  if (response.redirected) return false;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return false;
  return isOfflinePath(new URL(response.url));
}

async function networkFirst(request, isDocument) {
  try {
    const response = await fetch(request);
    if (shouldStore(response, isDocument)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(isDocument ? OFFLINE_PAGE : request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(isDocument ? OFFLINE_PAGE : request);
    if (cached) return cached;
    throw error;
  }
}

async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(OFFLINE_PAGE);
    if (!cached) {
      return new Response("Open a deck while you are online. It stays on this phone after that.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const url = new URL(request.url);
    if (isOfflinePath(url)) return cached;
    return Response.redirect(OFFLINE_PAGE, 302);
  }
}
