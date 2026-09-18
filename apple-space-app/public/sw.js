// ============================================================================
//  sw.js — Service Worker
//  HTML и JS — network-first (всегда свежие).
//  CSS, иконки — cache-first с фоновым обновлением.
//  Новый SW активируется мгновенно + оповещает клиентов.
// ============================================================================
const CACHE_NAME = 'workspaces-v7';

const OFFLINE_URLS = [
    '/style.css',
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
        (async () => {
            const names = await caches.keys();
            await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
            await self.clients.claim();
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach(client => {
                try { client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }); } catch (e) {}
            });
        })()
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API и sockets — не кэшируем
    if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;
    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    const isHTML = event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
    const isJS = url.pathname.endsWith('.js');

    // HTML и JS — network-first (всегда свежие, кэш только как fallback)
    if (isHTML || isJS) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
                    }
                    return response;
                })
                .catch(() => caches.match(event.request).then(r => r || (isHTML ? caches.match('/') : undefined)))
        );
        return;
    }

    // CSS / иконки / манифест — cache-first с фоновым обновлением
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
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
