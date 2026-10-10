/* Freezers – service worker: web jde vždy čerstvě ze sítě, offline se ukáže poslední uložená verze. */
const CACHE = 'freezers-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // API, data a obrázky jdou normálně
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/').then(r => r || new Response('Jsi offline — připoj se k internetu.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});
