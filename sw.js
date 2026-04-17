const CACHE = 'draftpunk-v66';

const PRECACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './data.js',
    './DRAFTPUNK.png',
    './partner.png',
    './bosses/1.png',
    './bosses/2.png',
    './bosses/3.png',
    './bosses/4.png',
    './bosses/5.png',
    './bosses/6.png',
    './bosses/7.png',
    './bosses/8.png',
    './bosses/9.png',
    './bosses/10.png',
    './bosses/11.png',
    './bosses/12.png',
    './bosses/13.png',
    './bosses/14.png',
    './bosses/15.png',
    './wordrunner.html',
    './wordrunner.js',
    './wordrunner-data.js',
    './beat-notes.html',
    './beat-notes.js',
    './characters.html',
    './characters.js',
    './backup.js',
    './buddy-data.js',
    './sync.js',
    './theme.js',
    './sounds.js',
    './groups.html',
    './groups.js',
    './write.html',
    './write.js',
    './messages.html',
    './messages.js',
    './privacy.html',
    './terms.html',
    './sentry.js',
    './notes.html',
    './notes.js',
    './game.js',
    './game-manifest.json',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Network-first for HTML/JS/CSS — always serve fresh code, fall back to cache offline
// Cache-first for images — they rarely change
self.addEventListener('fetch', event => {
    // Cache API only supports GET — skip everything else (Firebase POST calls etc.)
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isImage = /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname);

    if (isImage) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (!response.ok) return response;
                    const clone = response.clone();
                    caches.open(CACHE).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
        );
    } else {
        event.respondWith(
            fetch(event.request).then(response => {
                if (!response.ok) return response;
                const clone = response.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => caches.match(event.request))
        );
    }
});
