// Bump CACHE_NAME when this worker changes.
const CACHE_NAME = "autoflash-offline-v3";
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
      try {
        if (isDocument) await storeOfflinePage(response);
        else {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
      } catch {
        // A failed save must not block the page that just loaded.
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(isDocument ? OFFLINE_PAGE : request);
    if (cached) return cached;
    throw error;
  }
}

// The saved-decks page needs its scripts and styles, not only the HTML document.
async function storeOfflinePage(response) {
  const cache = await caches.open(CACHE_NAME);
  const html = await response.clone().text();
  await cache.put(
    OFFLINE_PAGE,
    new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );
  const seen = new Set();
  const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1]);
  await Promise.all(assets.map((path) => cacheAsset(cache, path, seen)));
}

async function cacheAsset(cache, path, seen) {
  if (seen.has(path)) return;
  seen.add(path);
  try {
    const asset = await fetch(path);
    if (!asset.ok) return;
    await cache.put(path, asset.clone());
    const type = asset.headers.get("content-type") || "";
    if (!type.includes("text/css")) return;
    const css = await asset.text();
    const files = [...css.matchAll(/url\((?:["']?)(\/_next\/static\/[^"')]+)/g)].map((match) => match[1]);
    await Promise.all(files.map((file) => cacheAsset(cache, file, seen)));
  } catch {
    // The next online visit tries this file again.
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
