// Service worker : app shell en cache-first, données (data/*.json) en network-first.
const VERSION = 'v4'; // à incrémenter à chaque modification des fichiers de l'app
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isData = new URL(req.url).pathname.includes('/data/');
  if (isData) {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return r;
    }).catch(() => caches.match(req)));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return r;
    })));
  }
});
