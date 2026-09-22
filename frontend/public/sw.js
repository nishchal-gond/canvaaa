// Service Worker for LPH Sales Display
// Provides 100% offline slide and video playback if Wi-Fi drops on the commercial display

const CACHE_NAME = 'lph-sales-display-v5';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER intercept video streams, HTTP Range requests, or Server-Sent Events
  if (
    event.request.headers.get('range') ||
    event.request.destination === 'video' ||
    url.pathname.includes('/uploads/videos/') ||
    url.pathname.endsWith('.mp4') ||
    url.pathname.endsWith('.mov') ||
    url.pathname.endsWith('.webm')
  ) {
    return; // Pass through to native browser network handler
  }

  // 2. NEVER cache or intercept API routes or SSE stream - ALWAYS real-time from server
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 3. Cache-first for slide images and thumbnails
  if (
    url.pathname.startsWith('/uploads/slides/') ||
    url.pathname.startsWith('/uploads/thumbnails/') ||
    event.request.destination === 'image'
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for html, css, js
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
