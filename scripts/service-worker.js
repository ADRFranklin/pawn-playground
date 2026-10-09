'use strict';

// Replaced with a content fingerprint and exact asset list by the web build.
const CACHE_NAME = '__CACHE_NAME__';
const ASSETS = /*__PRECACHE__*/[];
const ASSET_PATHS = new Set(ASSETS);

self.addEventListener('install', event => {
  // A release becomes available offline only when every dependency is cached.
  // Keep updates waiting until existing tabs close; never reload an open editor.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('pawn-playground-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Sharing is always a live API request, never a cached document response.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const navigation = request.mode === 'navigate' &&
    (url.pathname === '/' || url.pathname === '/index.html' || /^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname));
  if (!navigation && !ASSET_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Serve one complete release, including its HTML, to avoid mixing versions.
    const cached = await cache.match(navigation ? '/' : url.pathname);
    return cached || fetch(request);
  })());
});
