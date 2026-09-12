const socket = io();
let currentUser = null;
let systemSettings = {};

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    fetchSettings();
    checkAuth();
});

// Навигация по вкладкам (ПК + Мобильная)
Function initTabs() {
    Const navButtons = document.querySelectorAll('[data-tab]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            document.querySelectorAll(`[data-tab=»${targetTab}»]`).forEach(b => b.classList.add('active'));
            const content = document.getElementById(`tab-${targetTab}`);
            if (content) content.classList.add('active');
        });
    });
}

// Получение глобальных настроек
Async function fetchSettings() {
    Try {
        Const res = await fetch('/api/settings');
        systemSettings = await res.json();
        applySettings();
    } catch (err) {
        Console.error('Ошибка загрузки настроек:', err);
    }
}

Function applySettings() {
    // 1. Технические работы
    Const maintScreen = document.getElementById('maintenance-screen');
    If (systemSettings.maintenance_mode && (!currentUser || !currentUser.isTeacher)) {
        maintScreen.classList.remove('hidden');
    } else {
        maintScreen.classList.add('hidden');
    }

    // 2. Закрытый чат (Если учитель, но чат закрыт — скрываем вкладку)
    Const chatNavBtn = document.getElementById('nav-chat-btn');
    Const mobileChatBtn = document.getElementById('mobile-nav-chat-btn');
    If (currentUser && currentUser.isTeacher && currentUser.username !== 'root_teacher' && systemSettings.private_chat_mode) {
        If (chatNavBtn) chatNavBtn.classList.add('hidden');
        If (mobileChatBtn) mobileChatBtn.classList.add('hidden');
    } else {
        If (chatNavBtn) chatNavBtn.classList.remove('hidden');
        If (mobileChatBtn) mobileChatBtn.classList.remove('hidden');
    }

    // 3. Режим Экзаменов
    Const chatInputForm = document.getElementById('chat-form');
    Const chatBlockedNotice = document.getElementById('chat-blocked-notice');
    If (systemSettings.exams_mode && (!currentUser || !currentUser.isTeacher)) {
        If (chatInputForm) chatInputForm.classList.add('hidden');
        If (chatBlockedNotice) chatBlockedNotice.classList.remove('hidden');
    } else {
        If (chatInputForm) chatInputForm.classList.remove('hidden');
        If (chatBlockedNotice) chatBlockedNotice.classList.add('hidden');
    }
}

// Слушатель событий настроек в реальном времени
Socket.on('settings_updated', (newSettings) => {
    systemSettings = newSettings;
    applySettings();
});

Function checkAuth() {
    Const token = localStorage.getItem('token');
    Const userStr = localStorage.getItem('user');
    If (token && userStr) {
        currentUser = JSON.parse(userStr);
        document.getElementById('user-display-name').innerText = currentUser.fullName;
        applySettings();
    }
}
