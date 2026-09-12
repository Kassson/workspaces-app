/* ===================== ОБЩАЯ ЛОГИКА ПОРТАЛА (студент + преподаватель) ===================== */

let systemSettings = {};
let currentSpace = null;
let currentUser = null;
window._hwStudents = [];
window._currentHwStatsId = null;

// ---------- ГЛОБАЛЬНЫЕ НАСТРОЙКИ ----------
async function loadAndApplySettings(user) {
    try { systemSettings = await apiGet('/api/settings'); } catch (e) { systemSettings = {}; }
    applyGlobalSettings(user);
}
socket.on('settings_updated', (s) => { systemSettings = s; applyGlobalSettings(window.__currentUser); });

function applyGlobalSettings(user) {
    window.__currentUser = user;
    const banner = document.getElementById('announcementBanner');
    if (banner) {
        if (systemSettings.global_announcement) { banner.textContent = '📢 ' + systemSettings.global_announcement; banner.classList.add('show'); }
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

// ---------- СЕГОДНЯ ----------
async function renderTodayTab(container, spaceId) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const { lessons, overrides } = await apiGet(`/api/schedule/${spaceId}`);
        const today = new Date();
        const dow = isoDowFromDate(today);
        const dateStr = ymd(today);
        const todays = lessons.filter(l => l.day_of_week === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));

        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <h1 class="page-title" style="margin-bottom:0;">Сегодня — ${WEEKDAY_NAMES[dow]}</h1>
                <a class="btn-small" href="/api/schedule/${spaceId}/ics?token=${encodeURIComponent(localStorage.getItem('token'))}" target="_blank">📤 Экспорт .ics</a>
            </div>
            <div style="margin-top:16px;">
                ${todays.length ? todays.map(l => lessonCardHtml(l, overrides, dateStr, false)).join('') : '<p class="empty-state">Пар сегодня нет 🎉</p>'}
            </div>`;
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка'}</p>`; }
}

// ---------- РАСПИСАНИЕ ----------
async function renderScheduleTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const { lessons, overrides } = await apiGet(`/api/schedule/${spaceId}`);
        const today = new Date();
        const todayDow = isoDowFromDate(today);

        let html = `<h1 class="page-title">Расписание</h1>`;
        if (isAdmin) {
            html += `
                <div class="schedule-actions">
                    <button class="btn-small" onclick="openAddLessonSheet('${spaceId}')">➕ Добавить урок</button>
                    <button class="btn-small" onclick="openScheduleImport()">📥 Импорт расписания</button>
                    <button class="btn-small" onclick="exportSchedule()">📤 Экспорт TXT</button>
                    <button class="btn-small" onclick="exportScheduleICS()">📅 Экспорт .ics</button>
                </div>`;
        }
        html += `<div class="day-tabs">`;
        for (let d = 1; d <= 7; d++) {
            const cls = d === todayDow ? 'today' : (d < todayDow ? 'past' : '');
            html += `<div class="day-tab ${cls} ${d === todayDow ? 'active' : ''}" data-day="${d}" onclick="selectScheduleDay(this,'${spaceId}')">${WEEKDAY_SHORT[d]}${d === todayDow ? ' • Сегодня' : ''}</div>`;
        }
        html += `</div><div id="scheduleDayContent"></div>`;
        container.innerHTML = html;
        window.__scheduleData = { lessons, overrides, spaceId, isAdmin };
        renderScheduleDay(todayDow, spaceId);
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка'}</p>`; }
}

function selectScheduleDay(el, spaceId) {
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderScheduleDay(parseInt(el.dataset.day), spaceId);
}

function renderScheduleDay(dow, spaceId) {
    const { lessons, overrides, isAdmin } = window.__scheduleData;
    const today = new Date();
    const todayDow = isoDowFromDate(today);
    const diff = dow - todayDow;
    const targetDate = new Date(today); targetDate.setDate(today.getDate() + diff);
    const dateStr = ymd(targetDate);
    const isPast = dow < todayDow;

    const dayLessons = lessons.filter(l => l.day_of_week === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const box = document.getElementById('scheduleDayContent');
    if (!dayLessons.length) { box.innerHTML = '<p class="empty-state">Уроков нет</p>'; return; }
    box.innerHTML = dayLessons.map(l => lessonCardHtml(l, overrides, dateStr, isPast, isAdmin, spaceId)).join('');
}

function lessonCardHtml(l, overrides, dateStr, isPast, isAdmin, spaceId) {
    const ov = overrides.find(o => o.schedule_id === l.id && (o.override_date.slice ? o.override_date.slice(0, 10) : ymd(new Date(o.override_date))) === dateStr);
    const canceled = ov && ov.is_canceled;
    const replaced = ov && !ov.is_canceled && ov.replacement_subject;
    let cls = 'lesson-card' + (isPast ? ' past' : '') + (canceled ? ' canceled' : '') + (replaced ? ' replaced' : '');
    const subject = replaced ? ov.replacement_subject : l.subject_name;
    const room = replaced ? ov.replacement_classroom : l.classroom;
    const teacher = replaced ? ov.replacement_teacher : l.teacher_name;

    return `<div class="${cls}">
        <div class="lesson-row">
            <div class="lesson-time">${fmtTime(l.start_time)}<br>${fmtTime(l.end_time)}</div>
            <div>
                ${canceled ? '<span class="lesson-tag canceled-tag">УРОК ОТМЕНЁН</span><br>' : ''}
                ${replaced ? '<span class="lesson-tag replaced-tag">ЗАМЕНА</span><br>' : ''}
                <div class="lesson-sub">${escapeHtml(canceled ? l.subject_name : subject)}</div>
                <div class="lesson-meta">${escapeHtml(room || '')} ${teacher ? '• ' + escapeHtml(teacher) : ''}</div>
            </div>
        </div>
        ${isAdmin ? `<button class="btn-small" onclick='openEditLessonSheet(${JSON.stringify(l).replace(/'/g, "&#39;")}, ${JSON.stringify(dateStr)}, ${JSON.stringify(spaceId)})'>✏️ Edit</button>` : ''}
    </div>`;
}

// ---------- ДОМАШНИЕ ЗАДАНИЯ ----------
async function renderHomeworkTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const list = await apiGet(`/api/homework/${spaceId}`);
        let html = `<h1 class="page-title">Домашние задания</h1>`;
        if (isAdmin) html += `<button class="btn-small" onclick="openAddHomeworkSheet('${spaceId}')" style="margin-bottom:14px;">➕ Добавить ДЗ</button>`;
        if (!list.length) html += '<p class="empty-state">Заданий пока нет</p>';
        else html += list.map(hw => homeworkCardHtml(hw, isAdmin, spaceId)).join('');
        container.innerHTML = html;
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка'}</p>`; }
}

function homeworkCardHtml(hw, isAdmin, spaceId) {
    const due = new Date(hw.due_date).toLocaleDateString('ru-RU');
    const remote = systemSettings.remote_mode;

    // Для преподавателя/админа: только Статистика и Удалить
    if (isAdmin) {
        return `<div class="hw-card ${hw.is_done ? 'done' : ''}">
            <div class="hw-top">
                <span class="hw-subject">${escapeHtml(hw.subject_name)}</span>
                <span class="hw-due">до ${due}</span>
            </div>
            <div class="hw-title">${escapeHtml(hw.title)}</div>
            <div class="hw-actions">
                <button class="btn-small hw-stats-btn" onclick="openHomeworkStats('${hw.id}')">📊 Статистика</button>
                <button class="btn-small" onclick="deleteHomework('${hw.id}','${spaceId}')">🗑 Удалить</button>
            </div>
        </div>`;
    }

    // Для ученика
    return `<div class="hw-card ${hw.is_done ? 'done' : ''}">
        <div class="hw-top">
            <span class="hw-subject">${escapeHtml(hw.subject_name)}</span>
            <span class="hw-due">до ${due}</span>
        </div>
        <div class="hw-title">${escapeHtml(hw.title)}</div>
        <div class="hw-actions">
            ${hw.is_done ? `
                <span class="badge badge-green">✅ Сдано</span>
                ${hw.attachment_url ? `<img src="${hw.attachment_url}" style="max-width:80px;border-radius:8px;">` : ''}
                <button class="btn-small" onclick="uncompleteHomework('${hw.id}','${spaceId}')">Отменить</button>
            ` : remote ? `
                <label class="btn-small" style="cursor:pointer;">📷 Прикрепить фото
                    <input type="file" accept="image/*" style="display:none" onchange="submitHomeworkPhoto('${hw.id}','${spaceId}', this)">
                </label>
            ` : `
                <button class="btn-small" onclick="completeHomework('${hw.id}','${spaceId}')">☑️ Выполнено</button>
            `}
        </div>
    </div>`;
}

async function completeHomework(id, spaceId) {
    try { await apiPost(`/api/homework/${id}/complete`, {}); renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false); }
    catch (e) { alert(e.error || 'Ошибка'); }
}
async function uncompleteHomework(id, spaceId) {
    try { await apiDelete(`/api/homework/${id}/complete`); renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false); }
    catch (e) { alert(e.error || 'Ошибка'); }
}
async function submitHomeworkPhoto(id, spaceId, input) {
    const file = input.files[0]; if (!file) return;
    try {
        const dataUrl = await compressImageFile(file);
        await apiPost(`/api/homework/${id}/complete`, { attachment: dataUrl });
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false);
    } catch (e) { alert(e.error || 'Не удалось загрузить фото'); }
}
async function deleteHomework(id, spaceId) {
    if (!confirm('Удалить задание?')) return;
    try { await apiDelete(`/api/homework/${id}`); renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, true); }
    catch (e) { alert(e.error || 'Ошибка'); }
}
function currentHwContainerId() { return document.getElementById('tab-hw') ? 'tab-hw' : 'tab-homework'; }

// ---------- СТАТИСТИКА ДЗ (с обводками) ----------
async function openHomeworkStats(homeworkId) {
    if (!currentSpace) return;
    // ДОП. ЗАЩИТА на клиенте — только админ/преподаватель
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;
    if (!isAdminViewer) return alert('Только преподаватель или админ может видеть статистику');

    window._currentHwStatsId = homeworkId;

    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div><p class="empty-state">Загрузка…</p></div>`;
    document.getElementById('sheetOverlay').classList.add('show');

    try {
        const s = await apiGet(`/api/homework/${homeworkId}/stats`);
        window._hwStudents = s.students || [];

        const size = 140, stroke = 18, r = (size - stroke) / 2, c = 2 * Math.PI * r;
        const dash = (s.percentage / 100) * c;

        let html = `
            <h2 class="app-title" style="font-size:1.3rem;">📊 Статистика ДЗ</h2>
            <div style="text-align:center; margin:14px 0;">
                <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);">
                    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card-border)" stroke-width="${stroke}"></circle>
                    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--success)" stroke-width="${stroke}"
                            stroke-dasharray="${dash} ${c}" stroke-linecap="round"></circle>
                </svg>
                <div style="margin-top:-95px; margin-bottom:60px; font-size:1.6rem; font-weight:700;">${s.percentage}%</div>
                <p style="color:var(--text-secondary);">Выполнили: <b>${s.completed}</b> из <b>${s.total}</b></p>
                ${s.isOverdue ? '<p style="color:var(--danger); font-size:0.85rem; font-weight:600;">⏰ Срок сдачи истёк</p>' : ''}
            </div>
            <h3 style="margin-top:8px; font-size:1rem;">Ученики</h3>
            <div class="hw-students-list">
        `;

        if (!s.students.length) {
            html += `<p class="empty-state" style="padding:20px 0;">В группе нет учеников</p>`;
        } else {
            s.students.forEach(st => {
                let borderColor = '#9ca3af';
                let label = '⏳ Не сдано';
                let labelColor = 'var(--text-secondary)';
                let clickable = false;
                let opacity = 1;

                if (st.status === 'done') {
                    borderColor = 'var(--success)';
                    label = '✅ Сдано';
                    labelColor = 'var(--success)';
                    clickable = true;
                } else if (st.status === 'overdue') {
                    borderColor = 'var(--danger)';
                    label = '⏰ Просрочено';
                    labelColor = 'var(--danger)';
                    opacity = 0.85;
                } else {
                    borderColor = '#9ca3af';
                    label = '⏳ Не сдано';
                    labelColor = 'var(--text-secondary)';
                    opacity = 0.8;
                }

                html += `
                    <div class="hw-student-item" style="border-color:${borderColor}; opacity:${opacity}; ${clickable ? 'cursor:pointer;' : ''}"
                         ${clickable ? `onclick="openStudentSubmission('${st.id}')"` : ''}>
                        <div class="member-avatar">${escapeHtml(st.avatarEmoji || '👤')}</div>
                        <div class="member-info">
                            <div class="member-name">${escapeHtml(st.fullName)}</div>
                            <div class="member-username">@${escapeHtml(st.username)}</div>
                        </div>
                        <span style="font-size:0.78rem; font-weight:600; color:${labelColor}; white-space:nowrap;">${label}</span>
                    </div>
                `;
            });
        }
        html += `</div>`;
        html += `<button class="btn-secondary" style="margin-top:14px;" onclick="closeDynamicSheet()">Закрыть</button>`;

        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div>${html}</div>`;
    } catch (e) {
        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><p class="empty-state">Ошибка: ${escapeHtml(e.error || '')}</p><button class="btn-secondary" onclick="closeDynamicSheet()">Закрыть</button></div>`;
    }
}

// ---------- ПРОСМОТР ФОТО УЧЕНИКА ----------
function openStudentSubmission(userId) {
    // ДОП. ЗАЩИТА на клиенте
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;
    if (!isAdminViewer) return alert('Только преподаватель или админ может видеть работы учеников');

    const st = window._hwStudents.find(x => x.id === userId);
    if (!st) return;

    let timeStr = '—';
    if (st.completedAt) {
        const d = new Date(st.completedAt);
        timeStr = d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    let imgHTML = '';
    if (st.attachmentUrl) {
        imgHTML = `
            <p style="color:var(--text-secondary); font-size:0.85rem; margin: 8px 0 6px;">📷 Фото работы:</p>
            <img src="${st.attachmentUrl}" style="width:100%; border-radius:12px; box-shadow: 0 6px 24px rgba(0,0,0,0.15);" />
        `;
    } else {
        imgHTML = `
            <div style="text-align:center; padding: 30px 20px; color: var(--text-secondary); background: var(--input-bg); border-radius:12px; margin-top:12px; border: 2px dashed var(--card-border);">
                <div style="font-size:2.5rem; margin-bottom:8px;">☑️</div>
                <div>Ученик отметил ДЗ как выполненное без фото</div>
            </div>
        `;
    }

    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `
        <div class="sheet show" id="dynamicSheet">
            <div class="sheet-handle"></div>
            <h2 class="app-title" style="font-size:1.3rem;">📝 Работа ученика</h2>
            <div style="display:flex; align-items:center; gap:12px; margin: 12px 0;">
                <div class="member-avatar" style="font-size:2.2rem;">${escapeHtml(st.avatarEmoji || '👤')}</div>
                <div>
                    <div style="font-weight:600;">${escapeHtml(st.fullName)}</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem;">@${escapeHtml(st.username)}</div>
                </div>
            </div>
            <div style="background: var(--input-bg); padding: 10px 14px; border-radius: 10px; margin-bottom: 12px;">
                <div style="font-size:0.8rem; color:var(--text-secondary);">🕐 Отправлено:</div>
                <div style="font-weight: 600;">${timeStr}</div>
            </div>
            ${imgHTML}
            <button class="btn-secondary" style="margin-top:14px;" onclick="openHomeworkStats(window._currentHwStatsId)">← Назад к статистике</button>
            <button class="btn-secondary" style="margin-top:8px;" onclick="closeDynamicSheet()">Закрыть</button>
        </div>`;
    document.getElementById('sheetOverlay').classList.add('show');
}

// ---------- ИМПОРТ / ЭКСПОРТ РАСПИСАНИЯ ----------
function openScheduleImport() {
    if (!currentSpace) return alert('Выберите группу');
    showFormSheet('📥 Импорт расписания', `
        <p style="color:var(--text-secondary); font-size:0.85rem; text-align:left;">
            Вставьте расписание из Excel/Google Sheets.<br>
            Формат: <code>ДЕНЬ&nbsp;&nbsp;№&nbsp;&nbsp;Предмет&nbsp;&nbsp;Кабинет</code>
        </p>
        <div class="form-group">
            <textarea name="text" class="form-control" rows="12" placeholder="ПОНЕДЕЛЬНИК&#9;1&#9;Биология&#9;8&#10;..." required></textarea>
        </div>
        <div class="form-group" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="replaceAll" id="replaceAllChk" checked>
            <label for="replaceAllChk" style="margin:0;">Заменить всё расписание</label>
        </div>
    `, async (fd) => {
        const r = await apiPost('/api/schedule/import', { spaceId: currentSpace.id, text: fd.get('text'), replaceAll: fd.get('replaceAll') === 'on' });
        let msg = `✅ Импортировано уроков: ${r.imported}`;
        if (r.skipped && r.skipped.length) msg += `\n⏭️ Пропущено: ${r.skipped.length}`;
        if (r.errors && r.errors.length) msg += `\n⚠️ Ошибок: ${r.errors.length}`;
        alert(msg);
        refreshCurrentTab();
    }, 'Импортировать');
}

function exportSchedule() {
    if (!currentSpace) return alert('Выберите группу');
    const token = localStorage.getItem('token');
    window.open(`/api/schedule/${currentSpace.id}/export?token=${encodeURIComponent(token)}`, '_blank');
}

function exportScheduleICS() {
    if (!currentSpace) return alert('Выберите группу');
    const token = localStorage.getItem('token');
    window.open(`/api/schedule/${currentSpace.id}/ics?token=${encodeURIComponent(token)}`, '_blank');
}

// ---------- ЧАТ ----------
let chatJoinedSpace = null;
function renderChatTab(container, spaceId, isAdmin, currentUserId) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = `
        <h1 class="page-title">Чат группы</h1>
        <div class="chat-wrap">
            <div class="chat-messages" id="chatMessages"></div>
            <div class="chat-input-row">
                <textarea id="chatInput" rows="1" placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)"></textarea>
                <button class="btn-primary" style="width:auto; margin:0;" onclick="sendChatMessage('${spaceId}')">➤</button>
            </div>
            <div class="chat-blocked-notice hidden">🎓 Отправка сообщений отключена на время экзаменов.</div>
        </div>`;
    applyGlobalSettings(window.__currentUser);
    loadChatHistory(spaceId, isAdmin, currentUserId);
    if (chatJoinedSpace !== spaceId) {
        socket.emit('join_space', { spaceId, token: localStorage.getItem('token') });
        chatJoinedSpace = spaceId;
    }
    const input = document.getElementById('chatInput');
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(spaceId); } };
    socket.off('new_message'); socket.off('message_deleted');
    socket.on('new_message', (msg) => { if (msg.space_id === spaceId) appendChatMessage(msg, isAdmin, currentUserId); });
    socket.on('message_deleted', ({ messageId }) => { document.getElementById('msg-' + messageId)?.remove(); });
}

async function loadChatHistory(spaceId, isAdmin, currentUserId) {
    try {
        const rows = await apiGet(`/api/chat/${spaceId}/messages`);
        const box = document.getElementById('chatMessages');
        if (!box) return;
        box.innerHTML = '';
        rows.forEach(m => appendChatMessage(m, isAdmin, currentUserId));
        box.scrollTop = box.scrollHeight;
    } catch (e) {}
}

function appendChatMessage(m, isAdmin, currentUserId) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    const mine = m.user_id === currentUserId;
    const el = document.createElement('div');
    el.className = 'chat-bubble' + (mine ? ' mine' : '');
    el.id = 'msg-' + m.id;
    el.innerHTML = `
        <div class="who">${escapeHtml(m.full_name)}${m.is_teacher ? ' <span class="teacher-badge">👑</span>' : ''}</div>
        <div class="txt">${escapeHtml(m.message)}</div>
        ${isAdmin ? `<button class="del-btn" onclick="deleteChatMessage('${m.id}')">✕</button>` : ''}`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
}

function sendChatMessage(spaceId) {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('send_message', { message: text });
    input.value = '';
}
function deleteChatMessage(id) { socket.emit('delete_message', { messageId: id }); }

// ---------- УЧАСТНИКИ ----------
const ROLE_LABELS = { admin: '👑 Админ', member: '👤 Участник' };

async function renderMembersTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const members = await apiGet(`/api/spaces/${spaceId}/members`);
        if (!members.length) { container.innerHTML = '<p class="empty-state">В группе пока никого</p>'; return; }
        let html = '<h1 class="page-title">Участники группы</h1><div class="settings-card">';
        html += members.map(m => `
            <div class="member-row" onclick='openMemberProfile(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
                <div class="member-avatar">${escapeHtml(m.avatar_emoji || '👤')}</div>
                <div class="member-info">
                    <div class="member-name">${escapeHtml(m.full_name)}</div>
                    <div class="member-username">@${escapeHtml(m.username)}${m.is_teacher ? ' · 🎓' : ''}</div>
                </div>
                <span class="code-pill">${ROLE_LABELS[m.role] || m.role}</span>
            </div>
        `).join('');
        html += '</div>';
        container.innerHTML = html;
    } catch (e) { container.innerHTML = `<p class="empty-state">Ошибка: ${escapeHtml(e.error || '')}</p>`; }
}

async function openMemberProfile(member) {
    const isSelf = member.id === currentUser?.id;
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;

    // ЗАЩИТА: обычный ученик может смотреть только свой профиль
    if (!isSelf && !isAdminViewer) {
        return alert('Только преподаватель или админ может просматривать профили участников');
    }

    const muted = member.muted_until && new Date(member.muted_until) > new Date();
    const manageable = isAdminViewer && !isSelf;

    const body = `
        <div style="text-align:center; margin-bottom:16px;">
            <div style="font-size:4rem;">${escapeHtml(member.avatar_emoji || '👤')}</div>
            <h2 style="margin:8px 0 4px;">${escapeHtml(member.full_name)}</h2>
            <p style="color:var(--text-secondary); margin:0;">@${escapeHtml(member.username)}</p>
            <p style="margin:8px 0 0;"><span class="code-pill">${ROLE_LABELS[member.role] || member.role}</span>
                ${muted ? '<span class="code-pill" style="background:var(--warning); color:#fff;">🔇 Мут</span>' : ''}
                ${isSelf ? '<span class="code-pill" style="background:var(--accent-blue); color:#fff;">Вы</span>' : ''}
            </p>
        </div>
        ${manageable ? `
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
                ${member.role !== 'admin' ? `<button class="btn-small" onclick="changeMemberRole('${member.id}', 'admin')">👑 Сделать админом</button>` : `<button class="btn-small" onclick="changeMemberRole('${member.id}', 'member')">⬇️ Снять админа</button>`}
                ${muted
                    ? `<button class="btn-small" onclick="unmuteMember('${member.id}')">🔊 Снять мут</button>`
                    : `<button class="btn-small" onclick="muteMember('${member.id}')">🔇 Замутить</button>`}
                <button class="btn-small" style="background:var(--warning); color:#fff;" onclick="blockMember('${member.id}', '${escapeHtml(member.full_name).replace(/'/g, "\\'")}')">🚫 Забанить</button>
                <button class="btn-small" style="background:var(--danger); color:#fff;" onclick="kickMember('${member.id}', '${escapeHtml(member.full_name).replace(/'/g, "\\'")}')">🚪 Исключить</button>
            </div>
        ` : ''}
    `;

    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div>${body}<button type="button" class="btn-secondary" style="margin-top:14px;" onclick="closeDynamicSheet()">Закрыть</button></div>`;
    document.getElementById('sheetOverlay').classList.add('show');
}

async function changeMemberRole(userId, role) {
    try {
        await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/role`, { role });
        closeDynamicSheet();
        refreshCurrentTab();
    } catch (e) { alert(e.error || 'Ошибка'); }
}

function muteMember(userId) {
    showFormSheet('Замутить участника', `
        <div class="form-group"><label>Время мута (минуты)</label>
            <input type="number" name="minutes" class="form-control" value="60" min="1" required>
        </div>
    `, async (fd) => {
        await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/mute`, { minutes: parseInt(fd.get('minutes')) });
        closeDynamicSheet();
        refreshCurrentTab();
    }, 'Замутить');
}

async function unmuteMember(userId) {
    try {
        await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}/mute`);
        closeDynamicSheet();
        refreshCurrentTab();
    } catch (e) { alert(e.error || 'Ошибка'); }
}

function blockMember(userId, fullName) {
    if (!confirm(`Забанить «${fullName}»?`)) return;
    showFormSheet(`Забанить «${fullName}»`, `
        <div class="form-group"><label>Причина (необязательно)</label>
            <input type="text" name="reason" class="form-control" placeholder="Например: спам">
        </div>
    `, async (fd) => {
        await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/block`, { reason: fd.get('reason') || null });
        closeDynamicSheet();
        refreshCurrentTab();
    }, 'Забанить');
}

async function kickMember(userId, fullName) {
    if (!confirm(`Исключить «${fullName}»?`)) return;
    try {
        await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}`);
        closeDynamicSheet();
        refreshCurrentTab();
    } catch (e) { alert(e.error || 'Ошибка'); }
}

// ---------- ЧЁРНЫЙ СПИСОК ----------
async function openBlacklist() {
    if (!currentSpace) return;
    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div><p class="empty-state">Загрузка…</p></div>`;
    document.getElementById('sheetOverlay').classList.add('show');
    try {
        const data = await apiGet(`/api/spaces/${currentSpace.id}/blacklist`);
        let html = `<h2 class="app-title" style="font-size:1.3rem;">🚫 Чёрный список</h2>`;
        if (data.blocked.length) {
            html += `<h3 style="margin-top:14px;">Забаненные</h3>`;
            html += data.blocked.map(b => `
                <div class="member-row">
                    <div class="member-avatar">${escapeHtml(b.avatar_emoji || '👤')}</div>
                    <div class="member-info">
                        <div class="member-name">${escapeHtml(b.full_name)}</div>
                        <div class="member-username">@${escapeHtml(b.username)}${b.reason ? ' · ' + escapeHtml(b.reason) : ''}</div>
                    </div>
                    <button class="btn-small" onclick="unblockMember('${b.id}')">✅ Разбанить</button>
                </div>
            `).join('');
        }
        if (data.muted.length) {
            html += `<h3 style="margin-top:14px;">Замученные</h3>`;
            html += data.muted.map(m => `
                <div class="member-row">
                    <div class="member-avatar">${escapeHtml(m.avatar_emoji || '👤')}</div>
                    <div class="member-info">
                        <div class="member-name">${escapeHtml(m.full_name)}</div>
                        <div class="member-username">до ${new Date(m.muted_until).toLocaleString('ru-RU')}</div>
                    </div>
                    <button class="btn-small" onclick="unmuteMemberFromBlacklist('${m.id}')">🔊 Снять</button>
                </div>
            `).join('');
        }
        if (!data.blocked.length && !data.muted.length) html += `<p class="empty-state">Список пуст ✨</p>`;
        html += `<button class="btn-secondary" style="margin-top:14px;" onclick="closeDynamicSheet()">Закрыть</button>`;
        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div>${html}</div>`;
    } catch (e) {
        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><p class="empty-state">Ошибка: ${escapeHtml(e.error || '')}</p><button class="btn-secondary" onclick="closeDynamicSheet()">Закрыть</button></div>`;
    }
}

async function unblockMember(userId) {
    try { await apiDelete(`/api/spaces/${currentSpace.id}/blocked/${userId}`); openBlacklist(); refreshCurrentTab(); }
    catch (e) { alert(e.error || 'Ошибка'); }
}

async function unmuteMemberFromBlacklist(userId) {
    try { await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}/mute`); openBlacklist(); refreshCurrentTab(); }
    catch (e) { alert(e.error || 'Ошибка'); }
}

async function rotateInviteCode() {
    if (!currentSpace) return;
    if (!confirm('Сменить код приглашения?')) return;
    try {
        const r = await apiPost(`/api/spaces/${currentSpace.id}/rotate-invite-code`, {});
        alert(`✅ Новый код: ${r.inviteCode}`);
        await window.__reloadSpaces?.();
    } catch (e) { alert(e.error || 'Ошибка'); }
}

// ---------- ПРОФИЛЬ ----------
const EMOJI_LIST = [
    '👤', '👨', '👩', '🧑', '👦', '👧', '👨‍🎓', '👩‍🎓', '🧑‍🎓', '👨‍🏫', '👩‍🏫',
    '😀', '😎', '🤓', '🥳', '🤔', '😴', '🧐', '🥸', '🤠', '😺', '🐶', '🐱', '🦊', '🐼', '🐨', '🦁', '🐯', '🦉', '🐧',
    '🍕', '🍔', '🍟', '🌮', '🍣', '🍎', '🍓', '🍉', '☕', '🍩', '🎂',
    '⚽', '🏀', '🎮', '🎧', '🎸', '🎨', '🚀', '⚡', '🔥', '⭐', '🌈', '💎', '🎯', '🏆', '🥇', '👑', '💡', '📚', '✏️', '🎓'
];
let _selectedEmoji = '👤';
let _editingProfileState = null;

function openEditProfile(keepState) {
    if (!currentUser) return;
    if (!keepState) {
        _selectedEmoji = currentUser.avatarEmoji || '👤';
        const parts = (currentUser.fullName || '').split(' ');
        _editingProfileState = {
            firstName: parts[0] || '',
            lastName: parts.slice(1).join(' ') || '',
            nickname: currentUser.isTeacher ? '' : (currentUser.username || '')
        };
    }
    const state = _editingProfileState || { firstName: '', lastName: '', nickname: '' };
    showFormSheet('✏️ Редактирование профиля', `
        <div style="text-align:center; margin:12px 0;">
            <div id="editAvatarPreview" style="font-size:4rem; cursor:pointer; user-select:none;" onclick="openEmojiPicker()">${_selectedEmoji}</div>
            <p style="color:var(--text-secondary); font-size:0.85rem; margin:4px 0 0;">Нажмите, чтобы сменить аватар</p>
        </div>
        <div class="form-group"><input name="firstName" class="form-control" placeholder="Имя" value="${escapeHtml(state.firstName)}" required></div>
        <div class="form-group"><input name="lastName" class="form-control" placeholder="Фамилия" value="${escapeHtml(state.lastName)}" required></div>
        ${currentUser.isTeacher ? '' : `<div class="form-group"><input name="nickname" class="form-control" placeholder="Ник (логин)" value="${escapeHtml(state.nickname)}"></div>`}
    `, async (fd) => {
        _editingProfileState = {
            firstName: fd.get('firstName') || '',
            lastName: fd.get('lastName') || '',
            nickname: fd.get('nickname') || ''
        };
        const r = await apiPost('/api/auth/update-profile', {
            firstName: _editingProfileState.firstName,
            lastName: _editingProfileState.lastName,
            nickname: currentUser.isTeacher ? null : _editingProfileState.nickname,
            avatarEmoji: _selectedEmoji
        });
        if (!r || !r.success) throw new Error((r && r.error) || 'Не удалось сохранить');
        currentUser = r.user;
        localStorage.setItem('user', JSON.stringify(r.user));
        closeDynamicSheet();
        alert('✅ Профиль сохранён');
        location.reload();
    }, 'Сохранить');
}

function openEmojiPicker() {
    const form = document.getElementById('dynamicSheetForm');
    if (form) {
        const fd = new FormData(form);
        _editingProfileState = {
            firstName: fd.get('firstName') || '',
            lastName: fd.get('lastName') || '',
            nickname: fd.get('nickname') || ''
        };
    }
    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `
        <div class="sheet show" id="dynamicSheet">
            <div class="sheet-handle"></div>
            <h2 class="app-title" style="font-size:1.2rem;">Выберите аватар</h2>
            <div class="emoji-grid">
                ${EMOJI_LIST.map(e => `<button type="button" class="emoji-btn" onclick="pickEmoji('${e}')">${e}</button>`).join('')}
            </div>
            <button type="button" class="btn-secondary" style="margin-top:14px;" onclick="openEditProfile(true)">Назад</button>
        </div>`;
    document.getElementById('sheetOverlay').classList.add('show');
}

function pickEmoji(e) { _selectedEmoji = e; openEditProfile(true); }

// ---------- УНИВЕРСАЛЬНАЯ ФОРМА ----------
function showFormSheet(title, bodyHtml, onSubmit, submitLabel = 'Сохранить') {
    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `
        <div class="sheet show" id="dynamicSheet">
            <div class="sheet-handle"></div>
            <h2 class="app-title" style="font-size:1.3rem;">${title}</h2>
            <form id="dynamicSheetForm">${bodyHtml}
                <button type="submit" class="btn-primary">${submitLabel}</button>
                <button type="button" class="btn-secondary" onclick="closeDynamicSheet()">Отмена</button>
            </form>
        </div>`;
    document.getElementById('sheetOverlay').classList.add('show');
    document.getElementById('dynamicSheetForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await onSubmit(new FormData(e.target)); closeDynamicSheet(); }
        catch (err) { alert(err.error || err.message || 'Ошибка'); }
    };
}
function closeDynamicSheet() {
    document.getElementById('sheetOverlay').classList.remove('show');
    document.getElementById('dynamicSheetRoot').innerHTML = '';
}

function openAddLessonSheet(spaceId) {
    showFormSheet('Новый урок', `
        <div class="form-group"><select name="dayOfWeek" class="form-control">
            ${WEEKDAY_NAMES.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}
        </select></div>
        <div class="form-group"><input name="subjectName" class="form-control" placeholder="Предмет" required></div>
        <div class="form-group"><input name="classroom" class="form-control" placeholder="Кабинет"></div>
        <div class="form-group"><input name="teacherName" class="form-control" placeholder="Преподаватель"></div>
        <div class="form-group" style="display:flex; gap:8px;">
            <input name="startTime" type="time" class="form-control" required>
            <input name="endTime" type="time" class="form-control" required>
        </div>
    `, async (fd) => {
        await apiPost('/api/schedule', {
            spaceId, dayOfWeek: parseInt(fd.get('dayOfWeek')), subjectName: fd.get('subjectName'),
            classroom: fd.get('classroom'), teacherName: fd.get('teacherName'),
            startTime: fd.get('startTime'), endTime: fd.get('endTime')
        });
        renderScheduleTab(document.getElementById('tab-schedule'), spaceId, true);
    }, 'Добавить');
}

function openEditLessonSheet(lesson, dateStr, spaceId) {
    showFormSheet(`Урок: ${lesson.subject_name}`, `
        <p class="app-subtitle" style="text-align:left; margin-bottom:10px;">Изменения на ${new Date(dateStr).toLocaleDateString('ru-RU')}</p>
        <div class="form-group"><label><input type="checkbox" name="isCanceled"> Отменить урок в этот день</label></div>
        <div class="form-group"><input name="replacementSubject" class="form-control" placeholder="Замена: предмет"></div>
        <div class="form-group"><input name="replacementClassroom" class="form-control" placeholder="Замена: кабинет"></div>
        <div class="form-group"><input name="replacementTeacher" class="form-control" placeholder="Замена: преподаватель"></div>
        <hr style="border:0; border-top:1px solid var(--card-border); margin:14px 0;">
        <button type="button" class="btn-danger" style="width:100%;" onclick="deleteLessonPermanently('${lesson.id}','${spaceId}')">🗑 Удалить урок навсегда</button>
    `, async (fd) => {
        await apiPost('/api/schedule/override', {
            spaceId, scheduleId: lesson.id, date: dateStr,
            isCanceled: fd.get('isCanceled') === 'on',
            replacementSubject: fd.get('replacementSubject') || null,
            replacementClassroom: fd.get('replacementClassroom') || null,
            replacementTeacher: fd.get('replacementTeacher') || null
        });
        renderScheduleTab(document.getElementById('tab-schedule'), spaceId, true);
    }, 'Сохранить изменение');
}

async function deleteLessonPermanently(id, spaceId) {
    if (!confirm('Удалить урок из расписания насовсем?')) return;
    try { await apiDelete(`/api/schedule/${id}`); closeDynamicSheet(); renderScheduleTab(document.getElementById('tab-schedule'), spaceId, true); }
    catch (e) { alert(e.error || 'Ошибка'); }
}

function openAddHomeworkSheet(spaceId) {
    showFormSheet('Новое домашнее задание', `
        <div class="form-group"><input name="subjectName" class="form-control" placeholder="Предмет" required></div>
        <div class="form-group"><textarea name="title" class="form-control" placeholder="Задание" required rows="3"></textarea></div>
        <div class="form-group"><input name="dueDate" type="date" class="form-control" required></div>
    `, async (fd) => {
        await apiPost('/api/homework', { spaceId, subjectName: fd.get('subjectName'), title: fd.get('title'), dueDate: fd.get('dueDate') });
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, true);
    }, 'Добавить');
}

function openJoinSpaceForm() {
    showFormSheet('Присоединиться к группе', `
        <div class="form-group"><input name="code" class="form-control" placeholder="Код приглашения" required style="text-transform:uppercase;"></div>
    `, async (fd) => {
        await apiPost('/api/spaces/join', { code: fd.get('code') });
        await window.__reloadSpaces?.();
    }, 'Присоединиться');
}

function openCreateSpaceForm() {
    showFormSheet('Новая группа', `
        <div class="form-group"><input name="name" class="form-control" placeholder="Название группы" required></div>
    `, async (fd) => {
        const space = await apiPost('/api/spaces', { name: fd.get('name') });
        alert(`Группа создана! Код приглашения: ${space.invite_code}`);
        await window.__reloadSpaces?.();
    }, 'Создать');
}

function emptySpaceState() {
    return `<div class="empty-state">
        <p>Вы пока не состоите ни в одной группе.</p>
        <button class="btn-primary" style="max-width:240px;" onclick="openJoinSpaceForm()">Присоединиться по коду</button>
    </div>`;
}

function refreshCurrentTab() {
    const activeTab = document.querySelector('.tab-section.active');
    if (activeTab) {
        const isAdmin = currentUser?.isTeacher || currentSpace?.is_admin;
        const spaceId = currentSpace?.id;
        if (activeTab.id === 'tab-schedule') renderScheduleTab(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-hw') renderHomeworkTab(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-members') renderMembersTab(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-today') renderTodayTab(activeTab, spaceId);
        else if (activeTab.id === 'tab-chat') renderChatTab(activeTab, spaceId, !!isAdmin, currentUser?.id);
    }
}
