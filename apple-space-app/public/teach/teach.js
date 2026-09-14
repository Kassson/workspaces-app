let currentTeacher = null;

document.addEventListener('DOMContentLoaded', () => {
    checkTeachAuth();
    initTeachTabs();
    initAuthForms();
});

function initAuthForms() {
    // Вход
    document.getElementById('teach-login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const login = document.getElementById('teach-login').value;
        const password = document.getElementById('teach-pass').value;

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('teach_token', data.token);
            localStorage.setItem('teach_user', JSON.stringify(data.user));
            location.reload();
        } else {
            alert(data.error);
        }
    });

    // Регистрация с ФИО полностью
    document.getElementById('teach-reg-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const fullName = document.getElementById('reg-fullname').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;

        const res = await fetch('/api/auth/register-teacher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, fullName, email, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('teach_token', data.token);
            localStorage.setItem('teach_user', JSON.stringify(data.user));
            location.reload();
        } else {
            alert(data.error);
        }
    });
}

function checkTeachAuth() {
    const token = localStorage.getItem('teach_token');
    const userStr = localStorage.getItem('teach_user');

    if (token && userStr) {
        currentTeacher = JSON.parse(userStr);
        document.getElementById('teach-auth-card').classList.add('hidden');

        if (!currentTeacher.isTeacherVerified) {
            document.getElementById('unverified-banner').classList.remove('hidden');
            document.getElementById('my-verification-code').innerText = currentTeacher.verificationCode || 'T-XXXX';
        } else {
            document.getElementById('teach-dashboard').classList.remove('hidden');
            document.getElementById('teacher-name').innerText = currentTeacher.fullName;

            if (currentTeacher.username === 'root_teacher') {
                document.getElementById('root-tab-btn').classList.remove('hidden');
                loadRootSettings();
            }
            loadPendingVerifications();
        }
    }
}

// Загрузка неотвеченных запросов на верификацию
async function loadPendingVerifications() {
    const token = localStorage.getItem('teach_token');
    const res = await fetch('/api/teach/pending-verifications', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const list = await res.json();
    const container = document.getElementById('pending-list');
    if (!container) return;

    if (list.length === 0) {
        container.innerHTML = '<p>Заявок на верификацию нет.</p>';
        return;
    }

    container.innerHTML = list.map(t => `
        <div class="card" style="padding: 16px; background:#1C1C1E; margin-bottom:10px; border-radius:12px;">
            <h3>${t.full_name}</h3>
            <p>Логин: ${t.username} | Email: ${t.email}</p>
            <p>Код: <b style="color:#0A84FF;">${t.verification_code}</b></p>
            <button onclick="verifyTeacher('${t.id}')" class="btn-primary" style="margin-top:8px;">Подтвердить коллегу</button>
        </div>
    `).join('');
}

async function verifyTeacher(teacherId) {
    const token = localStorage.getItem('teach_token');
    await fetch('/api/teach/verify', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ teacherId })
    });
    loadPendingVerifications();
}

// Настройки Root Teacher (4 тумблера)
async function loadRootSettings() {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    document.getElementById('switch-remote').checked = settings.remote_mode;
    document.getElementById('switch-maint').checked = settings.maintenance_mode;
    document.getElementById('switch-exams').checked = settings.exams_mode;
    document.getElementById('switch-private').checked = settings.private_chat_mode;
    document.getElementById('announcement-text').value = settings.global_announcement || '';
}

document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const token = localStorage.getItem('teach_token');
    const body = {
        remote_mode: document.getElementById('switch-remote').checked,
        maintenance_mode: document.getElementById('switch-maint').checked,
        exams_mode: document.getElementById('switch-exams').checked,
        private_chat_mode: document.getElementById('switch-private').checked,
        global_announcement: document.getElementById('announcement-text').value
    };

    const res = await fetch('/api/settings/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });

    if (res.ok) {
        alert('Настройки колледжа успешно сохранены!');
    } else {
        alert('Ошибка при сохранении');
    }
});

function initTeachTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-sec').forEach(s => s.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${target}`)?.classList.add('active');
        });
    });
}

function toggleAuthMode(mode) {
    if (mode === 'reg') {
        document.getElementById('teach-login-form').classList.add('hidden');
        document.getElementById('teach-reg-form').classList.remove('hidden');
    } else {
        document.getElementById('teach-reg-form').classList.add('hidden');
        document.getElementById('teach-login-form').classList.remove('hidden');
    }
}

document.getElementById('teach-logout')?.addEventListener('click', () => {
    localStorage.removeItem('teach_token');
    localStorage.removeItem('teach_user');
    location.reload();
});
