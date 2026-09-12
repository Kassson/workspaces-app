/* ===================== ОБЩИЕ УТИЛИТЫ (студент + преподаватель) ===================== */

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

// ---- Регистрация Service Worker (установка PWA в 1 клик) ----
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

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

// ---- Self-ping каждые 10 минут, чтобы бесплатный сервер Render не засыпал ----
function startSelfPing() {
    const ping = () => fetch('/api/ping').catch(() => {});
    ping();
    setInterval(ping, 10 * 60 * 1000);
}

// ---- Sheet modal (шторка снизу на моб., окно по центру на ПК) ----
function openSheet(id) {
    document.getElementById('sheetOverlay')?.classList.add('show');
    document.getElementById(id)?.classList.add('show');
}
function closeSheet(id) {
    document.getElementById('sheetOverlay')?.classList.remove('show');
    document.getElementById(id)?.classList.remove('show');
}

// ---- Сжатие фото на клиенте перед отправкой (Base64/JPEG) ----
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