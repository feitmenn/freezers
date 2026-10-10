/* Freezers – service worker: web jde vždy čerstvě ze sítě, offline se ukáže poslední uložená verze. */
const CACHE = 'freezers-v2';
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

/* Push oznámení (rozvrh, připomínky) */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Freezers', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Freezers', {
    body: d.body || '', icon: '/app/icon-192.png', badge: '/app/icon-192.png', tag: d.tag || undefined,
    renotify: !!d.tag, data: { url: d.url || '/' }, vibrate: [120, 60, 120]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.location.origin)) { c.focus(); if ('navigate' in c) c.navigate(url); return; } }
    return self.clients.openWindow(url);
  }));
});
