// ============================================================================
//  sw.js — Service Worker
//  Network-first для ВСЕГО. Мгновенная активация. Оповещение клиентов.
// ============================================================================
const CACHE_NAME = 'workspaces-v11';

self.addEventListener('install', (event) => {
    // Не ждём закрытия вкладок — активируемся сразу
    self.skipWaiting();
    event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // Удаляем все старые кэши
            const names = await caches.keys();
            await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
            // Забираем контроль над всеми вкладками
            await self.clients.claim();
            // Оповещаем клиентов — пусть перезагрузятся
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach(client => {
                try { client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }); } catch (e) {}
            });
        })()
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API и sockets — не трогаем
    if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;
    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    // ВСЁ остальное — network-first. Кэш только как fallback оффлайн.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    if (event.request.mode === 'navigate') return caches.match('/');
                    return new Response('Offline', { status: 503 });
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
