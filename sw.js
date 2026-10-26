// Offline shell for FINZ. Network first: online you always get the latest build; offline you get the last one seen.
// Only this app's own GET requests are handled. Firebase, rates and fonts always go straight to the network.
const CACHE_NAME = 'finz-v17-2.9.0';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './assets/app.js',
    './assets/app.css'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n.startsWith('finz-') && n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(request).then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        }).catch(() => caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
});
