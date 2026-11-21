/* Incremented automatically by prepare-offline.mjs through the asset-list hash. */
importScripts('./offline-assets.js');
const cachePrefix = 'leaf-' + self.registration.scope + '-';
const cacheName = cachePrefix + self.LEAF_VERSION;
const voiceCacheName = 'leaf-voices-' + self.registration.scope;
self.addEventListener('install', event => {
  // Stage updates atomically. Existing tabs opt in before replacing their shell.
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(self.LEAF_ASSETS.map(url => new Request(new URL(url, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    // AI assets are downloaded only after the user chooses that feature. Keep
    // their cache independent from app upgrades and never precache the model.
    if (url.pathname.includes('/vendor/kokoro/')) {
      const voices = await caches.open(voiceCacheName);
      return await voices.match(event.request) || fetch(event.request);
    }
    const hit = await cache.match(event.request);
    if (hit) return hit;
    if (event.request.mode === 'navigate') return await cache.match('./index.html') || fetch(event.request);
    return fetch(event.request);
  }));
});
