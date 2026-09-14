// ============================================================================
//  sw.js — Service Worker
// ============================================================================
const CACHE_NAME = 'workspaces-v3';   // ← версия поднята, старый кэш удалится
const OFFLINE_URLS = [
    '/',
    '/style.css',
    '/shared.js',
    '/portal.js',
    '/manifest.json',
    '/icon.svg'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS).catch(() => {}))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((names) =>
                Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
            )
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;
    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200 || response.type !== 'basic') return response;
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                if (event.request.mode === 'navigate') return caches.match('/');
            });
        })
    );
});

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (e) { data = { title: 'Workspaces', body: event.data ? event.data.text() : '' }; }

    const title = data.title || 'Workspaces';
    const isPriority = !!data.priority;
    const options = {
        body: data.body || '',
        tag: data.tag,
        renotify: !!data.tag,
        requireInteraction: isPriority,
        data: { url: data.url || '/' },
        icon: '/icon.svg',
        badge: '/icon.svg',
        vibrate: isPriority ? [200, 100, 200, 100, 200] : [80, 40, 80],
        silent: false,
        timestamp: Date.now()
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
        })
    );
});

self.addEventListener('notificationclose', () => {});
