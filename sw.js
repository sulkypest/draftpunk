const CACHE = 'draftpunk-v17';

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
    './groups.html',
    './groups.js',
    './write.html',
    './write.js',
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

// Cache-first for everything
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, clone));
                return response;
            });
        })
    );
});
