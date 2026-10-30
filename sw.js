// Service worker : RÉSEAU D'ABORD (toujours la dernière version publiée), cache en secours hors ligne.
// - Le pré-chargement contourne le cache HTTP du navigateur ({cache:'reload'}).
// - Il est TOLÉRANT : un fichier manquant (ex. une icône) n'empêche plus l'installation.
//   Avant, une seule absence bloquait toute mise à jour et l'ancienne version restait aux commandes.
const VERSION = 'v9'; // à incrémenter à chaque modification des fichiers de l'app
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest'];
const EXTRA = ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled([...CORE, ...EXTRA].map(u =>
        fetch(new Request(u, { cache: 'reload' })).then(r => (r.ok ? c.put(u, r) : null)))))
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
