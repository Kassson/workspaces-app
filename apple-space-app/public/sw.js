// ============================================================================
//  sw.js — Service Worker для приёма Web Push уведомлений
// ============================================================================
const CACHE_NAME = 'workspaces-v1';
const OFFLINE_URLS = [
    '/',
    '/style.css',
    '/shared.js',
    '/portal.js',
    '/push-client.js',
    '/manifest.json',
    '/icon.svg'
];

// ============================================================================
//  Установка — кэшируем базовые ресурсы
// ============================================================================
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(OFFLINE_URLS).catch(() => {});
        })
    );
});

// ============================================================================
//  Активация — очищаем старые кэши
// ============================================================================
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((names) => {
                return Promise.all(
                    names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
                );
            })
        ])
    );
});

// ============================================================================
//  Fetch — network-first для API, cache-first для статики
// ============================================================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Socket.IO и API — всегда из сети
    if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) {
        return; // не перехватываем
    }

    // Только GET
    if (event.request.method !== 'GET') return;

    // Внешние домены (Yandex Storage) — не кэшируем
    if (url.origin !== self.location.origin) return;

    // Статика — cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                // Офлайн — показываем главную
                if (event.request.mode === 'navigate') {
                    return caches.match('/');
                }
            });
        })
    );
});

// ============================================================================
//  Push — приём уведомлений
// ============================================================================
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Workspaces', body: event.data ? event.data.text() : '' };
    }

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

    event.waitUntil(
        self.registration.showNotification(title, options).then(() => {
            // Обновить бейдж приложения (если поддерживается)
            if ('setAppBadge' in navigator) {
                return fetch('/api/chat/unread').then(r => r.json()).then(counts => {
                    const total = Object.values(counts).reduce((a, b) => a + b, 0);
                    if (total > 0) navigator.setAppBadge(total).catch(() => {});
                    else navigator.clearAppBadge().catch(() => {});
                }).catch(() => {});
            }
        })
    );
});

// ============================================================================
//  Клик по уведомлению — открываем приложение
// ============================================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // Если есть открытая вкладка приложения — фокусируемся на ней
            for (const client of clients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            // Иначе открываем новую вкладку
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});

// ============================================================================
//  Закрытие уведомления
// ============================================================================
self.addEventListener('notificationclose', (event) => {
    // Можно отправить аналитику, пока не нужно
});