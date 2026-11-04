// SPDX-License-Identifier: AGPL-3.0-or-later
// ModelScript Service Worker - Offline Caching & PWA Support

const CACHE_NAME = "modelscript-v1";
const STATIC_ASSETS = [
  "/",
  "/maintenance.html",
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

  // 1a. Content-hashed build assets (CacheFirst, guarding against SPA HTML fallbacks)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cachedResponse) => {
          const cachedType = (cachedResponse && cachedResponse.headers.get("content-type")) || "";
          if (cachedResponse && !cachedType.includes("text/html")) {
            return cachedResponse;
          }
          if (cachedResponse && cachedType.includes("text/html")) {
            cache.delete(request);
          }
          return fetch(request).then((networkResponse) => {
            const contentType = (networkResponse && networkResponse.headers.get("content-type")) || "";
            if (networkResponse && networkResponse.status === 200 && !contentType.includes("text/html")) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          });
        }),
      ),
    );
    return;
  }

  // 1b. Unhashed WASM parsers & LSP server bundles (StaleWhileRevalidate so updates propagate)
  if (url.pathname.endsWith(".wasm") || url.pathname.startsWith("/lsp/server/dist/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || fetchPromise;
        }),
      ),
    );
    return;
  }

  // 1c. Pre-baked binary symbol tables (.sym.bin, symbols.bin) for air-gapped offline rehydration
  if (
    url.pathname.endsWith(".sym.bin") ||
    url.pathname.includes("/symbols.bin") ||
    url.pathname.startsWith("/api/v1/libraries/")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || fetchPromise;
        }),
      ),
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
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put("/", responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match("/").then((cached) => cached || Response.error());
        }),
    );
    return;
  }
});

// ── Web Push Event Handling (RFC 8030 / RFC 8292) ───────────────────
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || "Ansatz Notification";
  const options = {
    body: data.body || "New engineering event in Ansatz.",
    icon: data.icon || "/favicon.ico",
    badge: data.badge || "/favicon.ico",
    data: data.data || { url: "/notifications" },
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click Event Handling ───────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          const clientUrl = new URL(client.url);
          const target = new URL(targetUrl, self.location.origin);
          if (clientUrl.pathname === target.pathname) {
            return client.focus();
          }
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
