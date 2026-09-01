const CACHE='algarve-reise-v9';
const STATIC=['./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // HTML/navigation: always try the newest version first.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, {cache:'no-store'})
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(()=>{});
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Other resources: network first, cache fallback.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(()=>{});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
