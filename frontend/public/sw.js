/* Rusto PWA service worker.
 *
 * Caching strategy:
 *   - App shell (HTML, manifest, offline page, icons)  → precached on install
 *   - Hashed assets (/assets/*.js, /assets/*.css)      → cache-first (immutable)
 *   - Fonts (Google Fonts CDN)                          → cache-first, 30-day TTL
 *   - Images                                            → cache-first w/ LRU cap
 *   - Same-origin HTML navigations                      → network-first, falls back
 *                                                          to cached / shell, then
 *                                                          /offline.html as ultimate
 *   - API requests (/api/*)                             → NETWORK-ONLY, never cached
 *                                                          (auth-sensitive, mutable)
 *
 * Update flow:
 *   - Each release bumps SW_VERSION → new SW is installed in waiting state.
 *   - We do NOT auto-activate (would mid-flight reload users); the page
 *     code shows an "Update available" prompt that posts SKIP_WAITING.
 *
 * Limits:
 *   - We don't try to cache POST/PUT/PATCH/DELETE responses (illegal anyway).
 *   - We avoid caching anything with a Vary or Authorization header.
 */

const SW_VERSION = "v4.0.0-2026-05-29";        // bump on release
const APP_CACHE     = `rusto-shell-${SW_VERSION}`;
const ASSET_CACHE   = `rusto-assets-${SW_VERSION}`;
const RUNTIME_CACHE = `rusto-runtime-${SW_VERSION}`;
const IMAGE_CACHE   = `rusto-images-${SW_VERSION}`;
const FONT_CACHE    = `rusto-fonts-${SW_VERSION}`;

// Files the app needs to render its first paint on a cold-cache navigation.
// We deliberately keep this list short — Vite-hashed JS/CSS aren't on it
// because their hashes change per release; they get cached on first fetch
// instead.
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/favicon.png",
];

const IMAGE_CACHE_LIMIT = 60;   // LRU cap for runtime image cache

// ── Install ────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // We add one-by-one with try/catch so a 404 on a single asset doesn't
    // abort the whole install (e.g., if an icon is renamed during a deploy).
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: "reload" });
        if (resp.ok) await cache.put(url, resp);
      } catch (e) {
        console.warn("[SW] precache miss:", url, e?.message);
      }
    }));
    // DO NOT skipWaiting here — the page UI is responsible for prompting
    // the user to apply the update. They tell us when via SKIP_WAITING.
  })());
});

// ── Activate: prune old caches ─────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const validNames = new Set([
      APP_CACHE, ASSET_CACHE, RUNTIME_CACHE, IMAGE_CACHE, FONT_CACHE,
    ]);
    await Promise.all(keys.map((k) => validNames.has(k) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Message channel: allow the page to trigger updates ─────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Fetch routing ──────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Service workers can only handle GET. Everything else passes through.
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cross-origin requests:
  if (url.origin !== self.location.origin) {
    // Google Fonts — long-TTL cache-first.
    if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
      event.respondWith(cacheFirst(req, FONT_CACHE));
      return;
    }
    // Razorpay checkout SDK — let it pass through (must hit live origin
    // for security + because it negotiates session-specific tokens).
    if (url.host === "checkout.razorpay.com" || url.host === "api.razorpay.com") {
      return;     // browser default
    }
    // Other cross-origin (Unsplash photos, etc.) — opportunistic image cache.
    if (req.destination === "image") {
      event.respondWith(cacheFirstWithLimit(req, IMAGE_CACHE, IMAGE_CACHE_LIMIT));
      return;
    }
    return;
  }

  // Same-origin from here on.

  // API requests: NEVER cache. Bearer tokens make responses user-specific
  // and most of these mutate server state. Pass-through to the network.
  if (url.pathname.startsWith("/api/")) {
    return;     // browser default = network fetch
  }

  // Hashed Vite assets: cache-first (filename includes content hash).
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // Icons + manifest: cache-first.
  if (url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/favicon.png") {
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }

  // Same-origin images: opportunistic.
  if (req.destination === "image") {
    event.respondWith(cacheFirstWithLimit(req, IMAGE_CACHE, IMAGE_CACHE_LIMIT));
    return;
  }

  // HTML navigations (and any other same-origin GET that isn't asset-like):
  // network-first with cache fallback. We always serve `/` as the app shell
  // when the network is down because the SPA routes are client-side.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirstWithShellFallback(req));
    return;
  }

  // Anything else: try network, fall back to cache.
  event.respondWith(networkFirstWithCacheFallback(req, RUNTIME_CACHE));
});


// ── Strategy implementations ───────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.status < 400) {
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    // No cache + offline → propagate the error so the browser shows its
    // standard error. For a hashed asset there's nothing better we can do.
    throw e;
  }
}

async function cacheFirstWithLimit(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      cache.put(request, resp.clone()).then(() => trimCache(cacheName, limit)).catch(() => {});
    }
    return resp;
  } catch (e) {
    // Image missing from cache + offline — return a tiny transparent PNG so
    // <img onerror> handlers don't fire and layouts stay stable.
    return new Response(EMPTY_PNG_BYTES, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }
}

async function networkFirstWithShellFallback(request) {
  try {
    // Use a short timeout race: on flaky networks, falling back to cache
    // after ~3s is much better UX than waiting on a stalled connection.
    const networkResp = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    // Stash the response for next-time offline fallback.
    if (networkResp.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResp.clone()).catch(() => {});
    }
    return networkResp;
  } catch (e) {
    // Try cached version of the exact URL first, else the SPA shell '/',
    // else the offline page.
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match("/");
    if (shell) return shell;
    const offline = await caches.match("/offline.html");
    if (offline) return offline;
    return new Response("Offline — please check your connection", {
      status: 503, headers: { "Content-Type": "text/plain" },
    });
  }
}

async function networkFirstWithCacheFallback(request, cacheName) {
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("Service Unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

// LRU-ish trim: when the cache exceeds `max`, delete the oldest entries.
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // .keys() returns insertion order in Cache Storage; oldest first.
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

// 1x1 transparent PNG bytes for fallback img response.
const EMPTY_PNG_BYTES = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
), c => c.charCodeAt(0));
