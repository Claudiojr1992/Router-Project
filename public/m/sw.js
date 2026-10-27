// RoutProject · service worker do app do técnico
// Telas: rede primeiro, cópia guardada quando não há internet. Fotos já enviadas: guardadas para ver offline.
// Dados (/api) não passam pelo cache: o app guarda o que precisa no IndexedDB.
const VERSAO = 'rp-m-v6';
const FOTOS = 'rp-fotos-v1';
const SHELL = ['/m/', '/m/app.js', '/m/m.css', '/m/manifest.webmanifest', '/m/icon-192.png', '/m/icon-512.png', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && k !== FOTOS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/fotos/')) {
    e.respondWith(caches.open(FOTOS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/m/') || url.pathname === '/favicon.svg') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSAO).then((c) => c.put(req.mode === 'navigate' ? '/m/' : req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req.mode === 'navigate' ? '/m/' : req, { ignoreSearch: true })) || caches.match('/m/')));
  }
});
