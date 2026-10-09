// SPDX-License-Identifier: AGPL-3.0-or-later
// ModelScript Service Worker - Offline Caching & PWA Support

const CACHE_NAME = "modelscript-v1";
const STATIC_ASSETS = [
  "/",
  "/ms-logo.png",
  "/ms-logo-light.png",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/robots.txt",
];

// Install event: Pre-cache static shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Activate event: Clean up stale caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch event: Apply caching strategies based on URL pattern
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests, extension schemes, and WebSocket handshakes
  if (request.method !== "GET" || !url.protocol.startsWith("http")) {
    return;
  }

  // 1. WASM parsers & Static build assets (CacheFirst with network fallback)
  if (
    url.pathname.endsWith(".wasm") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/lsp/server/dist/")
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        });
      }),
    );
    return;
  }

  // 2. Timeline & Artifact Views API (NetworkFirst with Cache Fallback for offline resilience)
  if (url.pathname.startsWith("/api/v1/social/timeline") || url.pathname.startsWith("/api/v1/social/artifact-views/")) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // 3. Navigation requests (NetworkFirst with offline fallback)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match("/").then((cached) => cached || Response.error());
      }),
    );
    return;
  }
});
