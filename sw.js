// Service worker : RÉSEAU D'ABORD (toujours la dernière version publiée), cache en secours hors ligne.
// Le pré-chargement contourne le cache HTTP du navigateur ({cache:'reload'}) : un ancien app.js
// ne peut plus se mélanger à un nouveau style.css lors d'une mise à jour.
const VERSION = 'v7'; // à incrémenter à chaque modification des fichiers de l'app
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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
  e.respondWith(
    fetch(req, { cache: 'no-cache' })            // revalide auprès de GitHub Pages à chaque ouverture
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })) // hors ligne : dernière version connue
  );
});
