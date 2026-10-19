/* Incremented automatically by prepare-offline.mjs through the asset-list hash. */
importScripts('./offline-assets.js');
const cachePrefix = 'leaf-' + self.registration.scope + '-';
const cacheName = cachePrefix + self.LEAF_VERSION;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(self.LEAF_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    if (event.request.mode === 'navigate') return await cache.match('./index.html') || fetch(event.request);
    return fetch(event.request);
  }));
});
