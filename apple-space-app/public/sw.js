self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (e) { data = { title: 'Workspaces', body: event.data ? event.data.text() : '' }; }

    const title = data.title || 'Workspaces';
    const options = {
        body: data.body || '',
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || '/' },
        icon: '/icon.svg',
        badge: '/icon.svg',
        vibrate: [80, 40, 80]
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if ('focus' in c) { c.navigate(url); return c.focus(); }
            }
            return self.clients.openWindow ? self.clients.openWindow(url) : null;
        })
    );
});