/* ===================== ОБЩИЕ УТИЛИТЫ (студент + преподаватель) ===================== */

// ---- Socket.io с токеном (для мультиплеера и чата) ----
const socket = io({ query: { token: localStorage.getItem('token') || '' } });

// ---- Тема (по умолчанию светлая) ----
(function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        btn.textContent = saved === 'dark' ? '☀️' : '🌙';
        btn.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            btn.textContent = next === 'dark' ? '☀️' : '🌙';
        });
    });
})();

// ---- API helpers ----
function authHeaders() {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}
async function apiGet(url) {
    const res = await fetch(url, { headers: { ...authHeaders() } });
    if (!res.ok) throw await res.json().catch(() => ({ error: 'Ошибка запроса' }));
    return res.json();
}
async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body || {})
    });
    if (!res.ok) throw await res.json().catch(() => ({ error: 'Ошибка запроса' }));
    return res.json();
}
async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE', headers: { ...authHeaders() } });
    if (!res.ok) throw await res.json().catch(() => ({ error: 'Ошибка запроса' }));
    return res.json();
}

// ---- Self-ping каждые 10 минут ----
function startSelfPing() {
    const ping = () => fetch('/api/ping').catch(() => {});
    ping();
    setInterval(ping, 10 * 60 * 1000);
}

// ---- Sheet modal ----
function openSheet(id) {
    document.getElementById('sheetOverlay')?.classList.add('show');
    document.getElementById(id)?.classList.add('show');
}
function closeSheet(id) {
    document.getElementById('sheetOverlay')?.classList.remove('show');
    document.getElementById(id)?.classList.remove('show');
}

// ---- Сжатие фото ----
function compressImageFile(file, maxSize = 1000, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; }
                else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtTime(t) { return t ? t.slice(0, 5) : ''; }

const WEEKDAY_NAMES = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function isoDowFromDate(date) { const d = date.getDay(); return d === 0 ? 7 : d; }
function ymd(date) { return date.toISOString().slice(0, 10); }

/* ===================== PUSH УВЕДОМЛЕНИЯ ===================== */

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSupported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window);
}

async function getPushPublicKey() {
    const r = await fetch('/api/push/public-key');
    const j = await r.json();
    return j.key;
}

async function isPushEnabled() {
    if (!pushSupported()) return false;
    try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) return false;
        const sub = await reg.pushManager.getSubscription();
        return !!sub;
    } catch (e) { return false; }
}

async function enablePush() {
    if (!pushSupported()) throw new Error('Браузер не поддерживает пуши');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Разрешение не выдано');
    const key = await getPushPublicKey();
    if (!key) throw new Error('Публичный ключ не получен с сервера');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
        });
    }
    await apiPost('/api/push/subscribe', sub.toJSON());
}

async function disablePush() {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
        await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
    }
}

// --- Глобальные муты пушей (для всего пользователя) ---
async function getPushMute() {
    try { return await apiGet('/api/push/mute'); }
    catch (e) { return { muted_until: null, muted_forever: false }; }
}
async function setPushMute(duration) {
    return apiPost('/api/push/mute', { duration });
}
async function clearPushMute() {
    return apiDelete('/api/push/mute');
}

// --- Муты чата (для конкретного пространства) ---
async function getChatMute(spaceId) {
    try { return await apiGet(`/api/spaces/${spaceId}/chat-mute`); }
    catch (e) { return { muted_until: null, muted_forever: false }; }
}
async function setChatMute(spaceId, duration) {
    return apiPost(`/api/spaces/${spaceId}/chat-mute`, { duration });
}
async function clearChatMute(spaceId) {
    return apiDelete(`/api/spaces/${spaceId}/chat-mute`);
}

// Регистрируем SW при загрузке страницы (нужно для iOS и получения ключа)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
}
