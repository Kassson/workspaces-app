/* ===================== ОБЩАЯ ЛОГИКА ПОРТАЛА (студент + преподаватель) ===================== */
const socket = io();
let systemSettings = {};
let currentSpace = null; // { id, name, invite_code, is_admin }

// ---------- ГЛОБАЛЬНЫЕ НАСТРОЙКИ ----------
async function loadAndApplySettings(currentUser) {
    try { systemSettings = await apiGet('/api/settings'); } catch (e) { systemSettings = {}; }
    applyGlobalSettings(currentUser);
}
socket.on('settings_updated', (s) => { systemSettings = s; applyGlobalSettings(window.__currentUser); });

function applyGlobalSettings(currentUser) {
    window.__currentUser = currentUser;
    // Баннер объявления
    const banner = document.getElementById('announcementBanner');
    if (banner) {
        if (systemSettings.global_announcement) { banner.textContent = '📢 ' + systemSettings.global_announcement; banner.classList.add('show'); }
        else banner.classList.remove('show');
    }
    // Технические работы
    const maint = document.getElementById('maintenanceScreen');
    const isPrivileged = currentUser && currentUser.isTeacher; // преподаватели и root сохраняют доступ
    if (maint) {
        if (systemSettings.maintenance_mode && !isPrivileged) maint.classList.add('show');
        else maint.classList.remove('show');
    }
    // Экзамены — блокировка отправки для студентов (визуально, сервер тоже проверяет)
    document.querySelectorAll('.chat-input-row').forEach(el => {
        el.classList.toggle('hidden', !!systemSettings.exams_mode && currentUser && !currentUser.isTeacher);
    });
    document.querySelectorAll('.chat-blocked-notice').forEach(el => {
        el.classList.toggle('hidden', !(systemSettings.exams_mode && currentUser && !currentUser.isTeacher));
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
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка загрузки расписания'}</p>`; }
}

// ---------- РАСПИСАНИЕ (неделя) ----------
async function renderScheduleTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const { lessons, overrides } = await apiGet(`/api/schedule/${spaceId}`);
        const today = new Date();
        const todayDow = isoDowFromDate(today);

        let html = `<h1 class="page-title">Расписание</h1>`;
        if (isAdmin) html += `<button class="btn-small" onclick="openAddLessonSheet('${spaceId}')" style="margin-bottom:14px;">➕ Добавить урок</button>`;
        html += `<div class="day-tabs">`;
        for (let d = 1; d <= 7; d++) {
            const cls = d === todayDow ? 'today' : (d < todayDow ? 'past' : '');
            html += `<div class="day-tab ${cls} ${d === todayDow ? 'active' : ''}" data-day="${d}" onclick="selectScheduleDay(this,'${spaceId}')">${WEEKDAY_SHORT[d]}${d === todayDow ? ' • Сегодня' : ''}</div>`;
        }
        html += `</div><div id="scheduleDayContent"></div>`;
        container.innerHTML = html;
        window.__scheduleData = { lessons, overrides, spaceId, isAdmin };
        renderScheduleDay(todayDow, spaceId);
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка загрузки расписания'}</p>`; }
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
    // ближайшая дата для этого дня недели (для поиска override)
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
    } catch (e) { container.innerHTML = `<p class="empty-state">${e.error || 'Ошибка загрузки ДЗ'}</p>`; }
}

function homeworkCardHtml(hw, isAdmin, spaceId) {
    const due = new Date(hw.due_date).toLocaleDateString('ru-RU');
    const remote = systemSettings.remote_mode;
    return `<div class="hw-card ${hw.is_done ? 'done' : ''}">
        <div class="hw-top">
            <span class="hw-subject">${escapeHtml(hw.subject_name)}</span>
            <span class="hw-due">до ${due}</span>
        </div>
        <div class="hw-title">${escapeHtml(hw.title)}</div>
        <div class="hw-actions">
            ${isAdmin ? `
                <button class="btn-small" onclick="viewCompletions('${hw.id}')">👥 Кто сдал</button>
                <button class="btn-small" onclick="deleteHomework('${hw.id}','${spaceId}')">🗑 Удалить</button>
            ` : hw.is_done ? `
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
async function viewCompletions(id) {
    try {
        const rows = await apiGet(`/api/homework/${id}/completions`);
        if (!rows.length) return alert('Пока никто не сдал.');
        alert(rows.map(r => `${r.full_name} (${r.username})${r.attachment_url ? ' — с фото' : ''}`).join('\n'));
    } catch (e) { alert(e.error || 'Ошибка'); }
}
function currentHwContainerId() { return document.getElementById('tab-hw') ? 'tab-hw' : 'tab-homework'; }

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
    input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(spaceId); }
    };

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
    } catch (e) { /* ignore */ }
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

// ---------- УНИВЕРСАЛЬНАЯ ФОРМА В ШТОРКЕ (для преподавателя) ----------
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
        catch (err) { alert(err.error || 'Ошибка сохранения'); }
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
        <div class="form-group"><input name="replacementSubject" class="form-control" placeholder="Замена: новый предмет"></div>
        <div class="form-group"><input name="replacementClassroom" class="form-control" placeholder="Замена: кабинет"></div>
        <div class="form-group"><input name="replacementTeacher" class="form-control" placeholder="Замена: преподаватель"></div>
        <hr style="border:0; border-top:1px solid var(--card-border); margin:14px 0;">
        <button type="button" class="btn-danger" style="width:100%;" onclick="deleteLessonPermanently('${lesson.id}','${spaceId}')">🗑 Удалить урок из расписания навсегда</button>
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
        <button class="btn-primary" style="max-width:240px;" onclick="openSheet('joinSpaceSheet')">Присоединиться по коду</button>
    </div>`;
}