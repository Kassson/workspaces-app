/* ===================== ОБЩИЕ УТИЛИТЫ (студент + преподаватель) ===================== */

// ---- Socket.io с токеном ----
const socket = io({ query: { token: localStorage.getItem('token') || '' } });

// ---- Тема: авто на телефоне, сохранённая в аккаунте на ПК ----
(function initTheme() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    function getEffectiveTheme() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const userTheme = user.theme || 'auto';

        if (isMobile) {
            // На телефоне всегда системная
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        // На ПК: если пользователь выбрал вручную — его выбор; если авто — берём системную
        if (userTheme === 'light' || userTheme === 'dark') return userTheme;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    applyTheme(getEffectiveTheme());

    // Следим за системной темой
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        applyTheme(getEffectiveTheme());
    });

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            // Сохраняем в аккаунт
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            user.theme = next;
            localStorage.setItem('user', JSON.stringify(user));
            try {
                await apiPost('/api/auth/update-profile', {
                    firstName: (user.fullName || '').split(' ')[0] || '',
                    lastName: (user.fullName || '').split(' ').slice(1).join(' ') || '',
                    nickname: user.isTeacher ? null : user.username,
                    avatarEmoji: user.avatarEmoji,
                    theme: next
                });
            } catch (e) { /* тихо */ }
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
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка запроса' }));
        throw err;
    }
    return res.json();
}
async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body || {})
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка запроса' }));
        throw err;
    }
    return res.json();
}
async function apiPatch(url, body) {
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body || {})
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка запроса' }));
        throw err;
    }
    return res.json();
}
async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE', headers: { ...authHeaders() } });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка запроса' }));
        throw err;
    }
    return res.json();
}

// ---- Self-ping ----
function startSelfPing() {
    const ping = () => fetch('/api/ping').catch(() => {});
    ping();
    setInterval(ping, 10 * 60 * 1000);
}

// ============================================================================
//  TOASTS — кастомные уведомления вместо alert()
// ============================================================================
function ensureToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
            max-width: 90%;
            width: 360px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

function showToast(text, type = 'info', duration = 3000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    const colors = {
        success: { bg: '#30d158', icon: '✓' },
        error:   { bg: '#ff453a', icon: '✕' },
        warning: { bg: '#ff9f0a', icon: '!' },
        info:    { bg: '#0a84ff', icon: 'i' }
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = `
        background: ${c.bg};
        color: #fff;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.25s ease;
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    toast.innerHTML = `<span style="font-size:16px;">${c.icon}</span><span>${escapeHtml(text)}</span>`;

    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// ============================================================================
//  CONFIRM — кастомная модалка вместо confirm()
// ============================================================================
function showConfirm(title, text = '', okLabel = 'OK', cancelLabel = 'Отмена', danger = false) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            animation: fadeIn 0.15s ease;
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            background: var(--bg-card, #fff);
            border-radius: 16px;
            padding: 22px;
            max-width: 380px;
            width: 100%;
            box-shadow: 0 12px 40px rgba(0,0,0,0.25);
            animation: slideUp 0.2s ease;
        `;
        box.innerHTML = `
            <h3 style="margin:0 0 8px; font-size:1.1rem; color: var(--text, #000);">${escapeHtml(title)}</h3>
            ${text ? `<p style="margin:0 0 18px; color: var(--text-secondary, #666); font-size:0.9rem;">${escapeHtml(text)}</p>` : '<div style="height:8px"></div>'}
            <div style="display:flex; gap:10px;">
                <button class="confirm-cancel" style="flex:1; padding:10px; border-radius:10px; border:none; background: var(--input-bg, #f0f0f0); color: var(--text, #000); font-size:14px; cursor:pointer;">${escapeHtml(cancelLabel)}</button>
                <button class="confirm-ok" style="flex:1; padding:10px; border-radius:10px; border:none; background: ${danger ? '#ff453a' : '#0088cc'}; color:#fff; font-size:14px; cursor:pointer;">${escapeHtml(okLabel)}</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); resolve(val); }, 150);
        };
        box.querySelector('.confirm-ok').addEventListener('click', () => close(true));
        box.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    });
}

// ============================================================================
//  PROMPT — кастомный ввод вместо prompt()
// ============================================================================
function showPrompt(title, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            background: var(--bg-card, #fff);
            border-radius: 16px;
            padding: 22px;
            max-width: 380px;
            width: 100%;
        `;
        box.innerHTML = `
            <h3 style="margin:0 0 12px; font-size:1.1rem; color: var(--text, #000);">${escapeHtml(title)}</h3>
            <input type="text" class="prompt-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}"
                   style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--card-border, #ddd); background: var(--input-bg, #f7f7f7); color: var(--text, #000); font-size:15px; box-sizing:border-box;">
            <div style="display:flex; gap:10px; margin-top:16px;">
                <button class="prompt-cancel" style="flex:1; padding:10px; border-radius:10px; border:none; background: var(--input-bg, #f0f0f0); color: var(--text, #000); cursor:pointer;">Отмена</button>
                <button class="prompt-ok" style="flex:1; padding:10px; border-radius:10px; border:none; background:#0088cc; color:#fff; cursor:pointer;">OK</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const input = box.querySelector('.prompt-input');
        setTimeout(() => input.focus(), 100);

        const close = (val) => { overlay.remove(); resolve(val); };
        box.querySelector('.prompt-ok').addEventListener('click', () => close(input.value));
        box.querySelector('.prompt-cancel').addEventListener('click', () => close(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
    });
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

// ============================================================================
//  FORMAT helpers
// ============================================================================
function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}

function timeAgo(dateStr) {
    const date = new Date(dateStr);
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60) return 'только что';
    if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
    if (diff < 604800) return Math.floor(diff / 86400) + ' дн назад';
    return date.toLocaleDateString('ru-RU');
}

// ============================================================================
//  IMAGE VIEWER — полноэкранный просмотр фото
// ============================================================================
function openImageViewer(urls, startIndex = 0) {
    if (!urls || !urls.length) return;
    let current = Math.max(0, Math.min(startIndex, urls.length - 1));

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.95);
        z-index: 100001;
        display: flex; align-items: center; justify-content: center;
        user-select: none;
    `;
    const img = document.createElement('img');
    img.style.cssText = 'max-width:95%; max-height:95%; object-fit:contain; transition: opacity 0.2s;';
    img.src = urls[current];
    overlay.appendChild(img);

    const counter = document.createElement('div');
    counter.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);color:#fff;font-size:14px;opacity:0.8;';
    counter.textContent = `${current + 1} / ${urls.length}`;
    if (urls.length > 1) overlay.appendChild(counter);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.15);border:none;color:#fff;width:40px;height:40px;border-radius:50%;font-size:20px;cursor:pointer;';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    overlay.appendChild(closeBtn);

    if (urls.length > 1) {
        const prev = document.createElement('button');
        prev.style.cssText = 'position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:#fff;width:44px;height:44px;border-radius:50%;font-size:20px;cursor:pointer;';
        prev.textContent = '‹';
        prev.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
        overlay.appendChild(prev);

        const next = document.createElement('button');
        next.style.cssText = 'position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:#fff;width:44px;height:44px;border-radius:50%;font-size:20px;cursor:pointer;';
        next.textContent = '›';
        next.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
        overlay.appendChild(next);
    }

    function go(delta) {
        current = (current + delta + urls.length) % urls.length;
        img.style.opacity = '0';
        setTimeout(() => { img.src = urls[current]; img.style.opacity = '1'; if (counter) counter.textContent = `${current + 1} / ${urls.length}`; }, 150);
    }

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Свайпы
    let touchStartX = 0, touchStartY = 0;
    overlay.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) go(dx > 0 ? -1 : 1);
        else if (dy > 100 && Math.abs(dy) > Math.abs(dx)) close();
    });

    document.body.appendChild(overlay);
}

// ============================================================================
//  FILE UPLOAD helper
// ============================================================================
async function uploadFiles(files, spaceId) {
    if (!files || !files.length) return [];
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    formData.append('spaceId', spaceId);

    const res = await fetch('/api/files/upload-many', {
        method: 'POST',
        headers: authHeaders(),
        body: formData
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка загрузки' }));
        throw err;
    }
    const data = await res.json();
    return data.files || [];
}

// ============================================================================
//  PUSH УВЕДОМЛЕНИЯ
// ============================================================================
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
    if (!key) throw new Error('Публичный ключ не получен');

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

async function getPushMute() {
    try { return await apiGet('/api/push/mute'); }
    catch (e) { return { muted_until: null, muted_forever: false }; }
}
async function setPushMute(duration) { return apiPost('/api/push/mute', { duration }); }
async function clearPushMute() { return apiDelete('/api/push/mute'); }

async function getChatMute(spaceId) {
    try { return await apiGet(`/api/spaces/${spaceId}/chat-mute`); }
    catch (e) { return { muted_until: null, muted_forever: false }; }
}
async function setChatMute(spaceId, duration) { return apiPost(`/api/spaces/${spaceId}/chat-mute`, { duration }); }
async function clearChatMute(spaceId) { return apiDelete(`/api/spaces/${spaceId}/chat-mute`); }

// ---- Настройки уведомлений ----
async function getNotificationPrefs() {
    try { return await apiGet('/api/notification-prefs'); }
    catch (e) { return null; }
}
async function saveNotificationPrefs(prefs) {
    return apiPost('/api/notification-prefs', prefs);
}

// ============================================================================
//  PRESENCE — активен ли пользователь
// ============================================================================
let _presenceInterval = null;
function startPresenceTracking() {
    if (_presenceInterval) return;

    const setActive = () => fetch('/api/presence/active', { method: 'POST', headers: authHeaders() }).catch(() => {});
    const setInactive = () => fetch('/api/presence/inactive', { method: 'POST', headers: authHeaders() }).catch(() => {});

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setActive();
        else setTimeout(() => { if (document.visibilityState !== 'visible') setInactive(); }, 30000);
    });

    setActive();
    _presenceInterval = setInterval(setActive, 60000);
}

// ============================================================================
//  UNREAD COUNTER
// ============================================================================
async function getUnreadCounts() {
    try { return await apiGet('/api/chat/unread'); }
    catch (e) { return {}; }
}

async function updateBadges() {
    const counts = await getUnreadCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // Обновляем бейдж на иконке чата
    const chatBtn = document.querySelector('[data-tab="tab-chat"]');
    if (chatBtn) {
        let badge = chatBtn.querySelector('.unread-badge');
        if (total > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#ff453a;color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;';
                chatBtn.style.position = 'relative';
                chatBtn.appendChild(badge);
            }
            badge.textContent = total > 99 ? '99+' : total;
        } else if (badge) {
            badge.remove();
        }
    }

    // PWA badge
    if ('setAppBadge' in navigator) {
        if (total > 0) navigator.setAppBadge(total).catch(() => {});
        else navigator.clearAppBadge().catch(() => {});
    }
}

socket.on('unread_count_update', () => { updateBadges(); });

// Регистрируем SW при загрузке
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
}

// CSS-анимации для toast/confirm
(function injectToastStyles() {
    if (document.getElementById('toastStyles')) return;
    const style = document.createElement('style');
    style.id = 'toastStyles';
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    `;
    document.head.appendChild(style);
})();