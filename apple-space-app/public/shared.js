/* ===================== ОБЩИЕ УТИЛИТЫ (студент + преподаватель) ===================== */

const socket = io({ query: { token: localStorage.getItem('token') || '' } });

// ============================================================================
//  ГЛОБАЛЬНЫЕ НАСТРОЙКИ
// ============================================================================
let systemSettings = {};

async function loadAndApplySettings(user) {
    try { systemSettings = await apiGet('/api/settings'); } catch (e) { systemSettings = {}; }
    applyGlobalSettings(user);
}

socket.on('settings_updated', (s) => {
    systemSettings = s;
    applyGlobalSettings(window.__currentUser);
});

function applyGlobalSettings(user) {
    window.__currentUser = user;
    const banner = document.getElementById('announcementBanner');
    if (banner) {
        if (systemSettings.global_announcement) { banner.textContent = systemSettings.global_announcement; banner.classList.add('show'); }
        else banner.classList.remove('show');
    }
    const maint = document.getElementById('maintenanceScreen');
    const isPrivileged = user && user.isTeacher;
    if (maint) {
        if (systemSettings.maintenance_mode && !isPrivileged) maint.classList.add('show');
        else maint.classList.remove('show');
    }
    document.querySelectorAll('.chat-input-row').forEach(el => {
        el.classList.toggle('hidden', !!systemSettings.exams_mode && user && !user.isTeacher);
    });
    document.querySelectorAll('.chat-blocked-notice').forEach(el => {
        el.classList.toggle('hidden', !(systemSettings.exams_mode && user && !user.isTeacher));
    });
}

// ============================================================================
//  ТЕМА
// ============================================================================
const _THEME_QUERY = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function getUserTheme() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.theme || 'auto';
    } catch (e) { return 'auto'; }
}

function getEffectiveTheme() {
    const userTheme = getUserTheme();
    if (userTheme === 'light' || userTheme === 'dark') return userTheme;
    return _THEME_QUERY.matches ? 'dark' : 'light';
}

applyTheme(getEffectiveTheme());

_THEME_QUERY.addEventListener('change', () => {
    if (getUserTheme() === 'auto') applyTheme(getEffectiveTheme());
});

async function setUserTheme(newTheme) {
    if (!['auto', 'light', 'dark'].includes(newTheme)) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    user.theme = newTheme;
    localStorage.setItem('user', JSON.stringify(user));
    applyTheme(getEffectiveTheme());
    refreshThemeButtons();
    try {
        await apiPost('/api/auth/update-profile', {
            firstName: (user.fullName || '').split(' ')[0] || '',
            lastName: (user.fullName || '').split(' ').slice(1).join(' ') || '',
            nickname: user.isTeacher ? null : user.username,
            avatarEmoji: user.avatarEmoji,
            theme: newTheme
        });
        showToast('Тема сохранена', 'success');
    } catch (e) { /* тихо */ }
}

function refreshThemeButtons() {
    const current = getUserTheme();
    document.querySelectorAll('.theme-option').forEach(btn => {
        const isActive = btn.dataset.themeVal === current;
        btn.style.background = isActive ? 'var(--accent-blue)' : 'var(--input-bg)';
        btn.style.color = isActive ? '#fff' : 'var(--text)';
        btn.style.borderColor = isActive ? 'var(--accent-blue)' : 'var(--card-border)';
    });
}

function initThemeButtons() {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => setUserTheme(btn.dataset.themeVal));
    });
    refreshThemeButtons();
}

function initThemeToggleButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const updateIcon = () => {
        const current = document.documentElement.getAttribute('data-theme');
        btn.textContent = current === 'dark' ? '☀️' : '🌙';
    };
    updateIcon();
    btn.addEventListener('click', async () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        await setUserTheme(next);
        updateIcon();
    });
}

// ============================================================================
//  СКРЫТИЕ/ПОКАЗ БОКОВОГО МЕНЮ (ПК)
// ============================================================================
function initSidebarToggle() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    try {
        if (localStorage.getItem('sidebarHidden') === '1') {
            dashboard.classList.add('sidebar-hidden');
        }
    } catch (e) {}

    document.querySelectorAll('.sidebar-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dashboard.classList.add('sidebar-hidden');
            try { localStorage.setItem('sidebarHidden', '1'); } catch (err) {}
        });
    });

    document.querySelectorAll('.sidebar-show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dashboard.classList.remove('sidebar-hidden');
            try { localStorage.setItem('sidebarHidden', '0'); } catch (err) {}
        });
    });
}

// ============================================================================
//  ЭКРАН ЗАГРУЗКИ
// ============================================================================
function showLoadingScreen() {
    const el = document.getElementById('loadingScreen');
    if (el) el.classList.add('show');
}
function hideLoadingScreen() {
    const el = document.getElementById('loadingScreen');
    if (el) el.classList.remove('show');
}

// ============================================================================
//  ДИНАМИЧЕСКАЯ ЗАГРУЗКА portal.js (с версией, чтобы не цеплялся кэш)
// ============================================================================
const APP_ASSET_VERSION = '12';

function loadPortalJs() {
    return new Promise((resolve, reject) => {
        if (window.__portalLoaded) return resolve();
        const s = document.createElement('script');
        s.src = '/portal.js?v=' + APP_ASSET_VERSION;
        s.onload = () => { window.__portalLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('Не удалось загрузить portal.js'));
        document.head.appendChild(s);
    });
}

// ============================================================================
//  АВТООБНОВЛЕНИЕ SERVICE WORKER
//  При обнаружении нового SW — сразу активируем и перезагружаем страницу.
// ============================================================================
let _swReloading = false;

function reloadOnce() {
    if (_swReloading) return;
    _swReloading = true;
    setTimeout(() => { location.reload(); }, 100);
}

if ('serviceWorker' in navigator) {
    // 1) Регистрируем SW — сразу после загрузки страницы
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
            .then(reg => {
                // Проверяем обновление сразу же
                reg.update().catch(() => {});

                // Слушаем нахождение нового SW
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // Новый SW готов, старый ещё работает → форсируем активацию
                            try { newWorker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
                        }
                    });
                });
            })
            .catch(() => {});
    });

    // 2) Слушаем сообщения от SW — при SW_UPDATED перезагружаемся
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SW_UPDATED') {
            reloadOnce();
        }
    });

    // 3) Если сменился контроллер SW — перезагружаемся
    let _refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_refreshing) return;
        _refreshing = true;
        reloadOnce();
    });

    // 4) Проверяем обновления каждые 3 минуты
    setInterval(() => {
        navigator.serviceWorker.getRegistration('/').then(reg => {
            if (reg) reg.update().catch(() => {});
        }).catch(() => {});
    }, 3 * 60 * 1000);

    // 5) Проверяем при возврате на вкладку (focus) и при visibilitychange
    window.addEventListener('focus', () => {
        navigator.serviceWorker.getRegistration('/').then(reg => {
            if (reg) reg.update().catch(() => {});
        }).catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            navigator.serviceWorker.getRegistration('/').then(reg => {
                if (reg) reg.update().catch(() => {});
            }).catch(() => {});
        }
    });
}

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

async function apiGetJSON(url, fallback = null) {
    try {
        const r = await fetch(url, { headers: authHeaders() });
        if (!r.ok) return fallback;
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return fallback;
        return await r.json();
    } catch (e) { return fallback; }
}

function startSelfPing() {
    const ping = () => fetch('/api/ping').catch(() => {});
    ping();
    setInterval(ping, 25 * 60 * 1000);
}

// ============================================================================
//  TOASTS
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
//  CONFIRM
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
//  PROMPT
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

function openSheet(id) {
    document.getElementById('sheetOverlay')?.classList.add('show');
    document.getElementById(id)?.classList.add('show');
}
function closeSheet(id) {
    document.getElementById('sheetOverlay')?.classList.remove('show');
    document.getElementById(id)?.classList.remove('show');
}

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

// ============================================================================
//  ФОРМАТИРОВАНИЕ ВРЕМЕНИ (универсальное)
// ============================================================================
function fmtTime(t) {
    if (t === null || t === undefined || t === '') return '--:--';

    if (typeof t === 'string') {
        const m = t.match(/^(\d{1,2}):(\d{2})/);
        if (m) return String(m[1]).padStart(2, '0') + ':' + m[2];
        return t;
    }

    if (t instanceof Date) {
        if (isNaN(t.getTime())) return '--:--';
        return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    }

    if (typeof t === 'object') {
        const h = parseInt(t.hours ?? t.h ?? 0, 10) || 0;
        const m = parseInt(t.minutes ?? t.m ?? 0, 10) || 0;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    return '--:--';
}

const WEEKDAY_NAMES = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function isoDowFromDate(date) { const d = date.getDay(); return d === 0 ? 7 : d; }
function ymd(date) { return date.toISOString().slice(0, 10); }

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
//  ВОССТАНОВЛЕНИЕ ПАРОЛЯ
// ============================================================================
async function requestPasswordReset(login) {
    return apiPost('/api/auth/request-password-reset', { login });
}
async function getPasswordResetStatus(login) {
    try {
        const res = await fetch(`/api/auth/password-reset-status/${encodeURIComponent(login)}`);
        if (!res.ok) return { status: 'none' };
        return await res.json();
    } catch (e) { return { status: 'none' }; }
}
async function resetPasswordWithCode(login, code, newPassword) {
    return apiPost('/api/auth/reset-password-with-code', { login, code, newPassword });
}
async function resetPasswordWithToken(token, newPassword) {
    return apiPost('/api/auth/reset-password-with-token', { token, newPassword });
}
async function checkResetToken(token) {
    try {
        const res = await fetch(`/api/auth/check-reset-token/${encodeURIComponent(token)}`);
        if (!res.ok) return { valid: false };
        return await res.json();
    } catch (e) { return { valid: false }; }
}
async function getPasswordResetRequests() {
    return apiGet('/api/password-reset-requests');
}
async function approvePasswordReset(requestId) {
    return apiPost(`/api/password-reset-requests/${requestId}/approve`, {});
}
async function declinePasswordReset(requestId) {
    return apiDelete(`/api/password-reset-requests/${requestId}`);
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (location.protocol !== 'https:' &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1') {
        return false;
    }
    return true;
}

async function getPushPublicKey() {
    try {
        const r = await fetch('/api/push/public-key');
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return null;
        const j = await r.json();
        return j.key || null;
    } catch (e) { return null; }
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
    if (!pushSupported()) throw new Error('Браузер не поддерживает пуши (нужен HTTPS)');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Разрешение не выдано');
    const key = await getPushPublicKey();
    if (!key) throw new Error('Пуши не настроены на сервере. Обратитесь к администратору.');

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
    return (await apiGetJSON('/api/push/mute')) || { muted_until: null, muted_forever: false };
}
async function setPushMute(duration) { return apiPost('/api/push/mute', { duration }); }
async function clearPushMute() { return apiDelete('/api/push/mute'); }

async function getChatMute(spaceId) {
    return (await apiGetJSON(`/api/spaces/${spaceId}/chat-mute`)) || { muted_until: null, muted_forever: false };
}
async function setChatMute(spaceId, duration) { return apiPost(`/api/spaces/${spaceId}/chat-mute`, { duration }); }
async function clearChatMute(spaceId) { return apiDelete(`/api/spaces/${spaceId}/chat-mute`); }

async function getNotificationPrefs() {
    return await apiGetJSON('/api/notification-prefs');
}
async function saveNotificationPrefs(prefs) {
    return apiPost('/api/notification-prefs', prefs);
}

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

async function getUnreadCounts() {
    try { return await apiGet('/api/chat/unread'); }
    catch (e) { return {}; }
}

async function updateBadges() {
    const counts = await getUnreadCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

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

    if ('setAppBadge' in navigator) {
        if (total > 0) navigator.setAppBadge(total).catch(() => {});
        else navigator.clearAppBadge().catch(() => {});
    }
}

socket.on('unread_count_update', () => { updateBadges(); });

socket.on('space_deleted', ({ spaceId, name }) => {
    try {
        const activeId = localStorage.getItem('activeSpaceId');
        if (activeId === spaceId) {
            localStorage.removeItem('activeSpaceId');
        }
        showToast(`Пространство «${name || ''}» удалено администратором`, 'warning', 6000);
        setTimeout(() => location.reload(), 1200);
    } catch (e) {}
});

document.addEventListener('DOMContentLoaded', () => {
    initThemeToggleButton();
    initThemeButtons();
    initSidebarToggle();
});

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
