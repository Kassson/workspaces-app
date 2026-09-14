/* ===================== ОБЩАЯ ЛОГИКА ПОРТАЛА (студент + преподаватель) ===================== */

let systemSettings = {};
let currentSpace = null;

window._hwStudents = [];
window._currentHwStatsId = null;
let _memberForStatusEdit = null;

// ===================== ЭКРАН ЗАГРУЗКИ =====================
function showLoadingScreen() {
    const el = document.getElementById('loadingScreen');
    if (el) el.classList.add('show');
}
function hideLoadingScreen() {
    const el = document.getElementById('loadingScreen');
    if (el) el.classList.remove('show');
}

// ===================== ГЛОБАЛЬНЫЕ НАСТРОЙКИ =====================
async function loadAndApplySettings(user) {
    try { systemSettings = await apiGet('/api/settings'); } catch (e) { systemSettings = {}; }
    applyGlobalSettings(user);
}
socket.on('settings_updated', (s) => { systemSettings = s; applyGlobalSettings(window.__currentUser); });

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

// ===================== РАСПИСАНИЕ =====================
let _scheduleViewMode = 'today';
let _scheduleWeekDay = null;

async function renderScheduleUnified(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const { lessons, overrides } = await apiGet(`/api/schedule/${spaceId}`);
        const today = new Date();
        const todayDow = isoDowFromDate(today);

        window.__scheduleData = { lessons, overrides, spaceId, isAdmin, todayDow };

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
            <h1 class="page-title" style="margin:0;">Расписание</h1>
            <a class="btn-small" href="/api/schedule/${spaceId}/ics?token=${encodeURIComponent(localStorage.getItem('token'))}" target="_blank">Календарь .ics</a>
        </div>`;

        html += `<div class="segmented-control">
            <button class="seg-btn ${_scheduleViewMode === 'today' ? 'active' : ''}" data-mode="today">Сегодня</button>
            <button class="seg-btn ${_scheduleViewMode === 'week' ? 'active' : ''}" data-mode="week">Неделя</button>
        </div>`;

        if (isAdmin) {
            html += `<div class="schedule-actions" style="margin-top:12px;">
                <button class="btn-small" onclick="openAddLessonSheet('${spaceId}')">Добавить урок</button>
                <button class="btn-small" onclick="openScheduleImport()">Импорт</button>
                <button class="btn-small" onclick="exportSchedule()">Экспорт TXT</button>
            </div>`;
        }

        html += `<div id="scheduleBody" style="margin-top:14px;"></div>`;
        container.innerHTML = html;

        container.querySelectorAll('.seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _scheduleViewMode = btn.dataset.mode;
                container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderScheduleBody();
            });
        });

        renderScheduleBody();
    } catch (e) {
        container.innerHTML = `<p class="empty-state">${escapeHtml(e.error || 'Ошибка')}</p>`;
    }
}

function renderScheduleBody() {
    const box = document.getElementById('scheduleBody');
    if (!box) return;
    const { lessons, overrides, todayDow, isAdmin, spaceId } = window.__scheduleData;
    const today = new Date();
    const dateStrToday = ymd(today);

    if (_scheduleViewMode === 'today') {
        const todayLessons = lessons.filter(l => l.day_of_week === todayDow).sort((a, b) => a.start_time.localeCompare(b.start_time));
        if (!todayLessons.length) {
            box.innerHTML = '<p class="empty-state">Пар сегодня нет</p>';
            return;
        }
        box.innerHTML = todayLessons.map(l => lessonCardHtml(l, overrides, dateStrToday, false, isAdmin, spaceId)).join('');
    } else {
        let html = `<div class="day-tabs">`;
        for (let d = 1; d <= 7; d++) {
            const cls = d === todayDow ? 'today' : (d < todayDow ? 'past' : '');
            html += `<div class="day-tab ${cls} ${(_scheduleWeekDay || todayDow) === d ? 'active' : ''}" data-day="${d}">${WEEKDAY_SHORT[d]}</div>`;
        }
        html += `</div><div id="scheduleDayBody" style="margin-top:12px;"></div>`;
        box.innerHTML = html;

        const targetDay = _scheduleWeekDay || todayDow;
        renderWeekDay(targetDay);

        box.querySelectorAll('.day-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                _scheduleWeekDay = parseInt(tab.dataset.day);
                box.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderWeekDay(_scheduleWeekDay);
            });
        });
    }
}

function renderWeekDay(dow) {
    const box = document.getElementById('scheduleDayBody');
    if (!box) return;
    const { lessons, overrides, todayDow, isAdmin, spaceId } = window.__scheduleData;
    const today = new Date();
    const diff = dow - todayDow;
    const targetDate = new Date(today); targetDate.setDate(today.getDate() + diff);
    const dateStr = ymd(targetDate);
    const isPast = dow < todayDow;

    const dayLessons = lessons.filter(l => l.day_of_week === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));
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
                ${canceled ? '<span class="lesson-tag canceled-tag">ОТМЕНЁН</span><br>' : ''}
                ${replaced ? '<span class="lesson-tag replaced-tag">ЗАМЕНА</span><br>' : ''}
                <div class="lesson-sub">${escapeHtml(canceled ? l.subject_name : subject)}</div>
                <div class="lesson-meta">${escapeHtml(room || '')} ${teacher ? '• ' + escapeHtml(teacher) : ''}</div>
            </div>
        </div>
        ${isAdmin ? `<button class="btn-small" onclick='openEditLessonSheet(${JSON.stringify(l).replace(/'/g, "&#39;")}, ${JSON.stringify(dateStr)}, ${JSON.stringify(spaceId)})'>Изменить</button>` : ''}
    </div>`;
}

// ===================== ДОМАШНИЕ ЗАДАНИЯ =====================
async function renderHomeworkTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const list = await apiGet(`/api/homework/${spaceId}`);
        let html = `<h1 class="page-title">Домашние задания</h1>`;
        html += `<div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
            <input type="text" id="hwSearch" class="form-control" placeholder="Поиск по ДЗ..." style="flex:1; min-width:200px;">
            ${isAdmin ? `<button class="btn-small" onclick="openAddHomeworkSheet('${spaceId}')">Добавить</button>` : ''}
        </div>`;
        html += `<div id="hwList"></div>`;
        container.innerHTML = html;

        const searchInput = document.getElementById('hwSearch');
        const renderList = (query = '') => {
            const filtered = query
                ? list.filter(hw =>
                    hw.title.toLowerCase().includes(query.toLowerCase()) ||
                    hw.subject_name.toLowerCase().includes(query.toLowerCase()))
                : list;
            const listBox = document.getElementById('hwList');
            if (!filtered.length) { listBox.innerHTML = '<p class="empty-state">Заданий пока нет</p>'; return; }
            listBox.innerHTML = filtered.map(hw => homeworkCardHtml(hw, isAdmin, spaceId)).join('');
        };
        renderList();
        searchInput.addEventListener('input', (e) => renderList(e.target.value));
    } catch (e) { container.innerHTML = `<p class="empty-state">${escapeHtml(e.error || 'Ошибка')}</p>`; }
}

function homeworkCardHtml(hw, isAdmin, spaceId) {
    const due = new Date(hw.due_date).toLocaleDateString('ru-RU');
    const remote = systemSettings.remote_mode;
    const gradeHtml = hw.grade_value
        ? `<span class="grade-badge" style="background:#30d158;color:#fff;padding:3px 10px;border-radius:8px;font-weight:700;">${hw.grade_value}</span>`
        : '';

    if (isAdmin) {
        return `<div class="hw-card ${hw.is_done ? 'done' : ''}">
            <div class="hw-top">
                <span class="hw-subject">${escapeHtml(hw.subject_name)}</span>
                <span class="hw-due">до ${due}</span>
            </div>
            <div class="hw-title">${escapeHtml(hw.title)}</div>
            <div class="hw-actions">
                <button class="btn-small" onclick="openHomeworkStats('${hw.id}')">Статистика</button>
                <button class="btn-small" onclick="deleteHomework('${hw.id}','${spaceId}')">Удалить</button>
            </div>
        </div>`;
    }

    let actionsHtml = '';
    if (hw.is_done) {
        actionsHtml = `
            <span class="badge badge-green">Сдано</span>
            ${gradeHtml}
            ${hw.attachment_url ? `<img src="${hw.attachment_url}" class="hw-photo-preview" style="max-width:80px;border-radius:8px;cursor:pointer;" onclick="openImageViewer(['${hw.attachment_url}'], 0)">` : ''}
            <button class="btn-small" onclick="uncompleteHomework('${hw.id}','${spaceId}')">Отменить</button>
        `;
    } else if (remote) {
        actionsHtml = `
            <label class="btn-small" style="cursor:pointer;">Прикрепить фото
                <input type="file" accept="image/*" style="display:none" onchange="submitHomeworkPhoto('${hw.id}','${spaceId}', this)">
            </label>
        `;
    } else {
        actionsHtml = `
            <button class="btn-small" onclick="completeHomework('${hw.id}','${spaceId}')">Выполнено</button>
            <label class="btn-small" style="cursor:pointer;">Прикрепить фото
                <input type="file" accept="image/*" style="display:none" onchange="submitHomeworkPhoto('${hw.id}','${spaceId}', this)">
            </label>
        `;
    }

    return `<div class="hw-card ${hw.is_done ? 'done' : ''}">
        <div class="hw-top">
            <span class="hw-subject">${escapeHtml(hw.subject_name)}</span>
            <span class="hw-due">до ${due}</span>
        </div>
        <div class="hw-title">${escapeHtml(hw.title)}</div>
        <div class="hw-actions">${actionsHtml}</div>
    </div>`;
}

async function completeHomework(id, spaceId) {
    try {
        await apiPost(`/api/homework/${id}/complete`, {});
        showToast('ДЗ отмечено как выполненное', 'success');
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false);
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}
async function uncompleteHomework(id, spaceId) {
    try {
        await apiDelete(`/api/homework/${id}/complete`);
        showToast('Отметка снята', 'info');
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false);
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}
async function submitHomeworkPhoto(id, spaceId, input) {
    const file = input.files[0]; if (!file) return;
    try {
        const uploaded = await uploadFiles([file], spaceId);
        if (!uploaded.length || uploaded[0].error) throw new Error(uploaded[0]?.error || 'Ошибка загрузки');
        await apiPost(`/api/homework/${id}/complete`, { attachment: uploaded[0].url });
        showToast('Фото загружено', 'success');
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, false);
    } catch (e) { showToast(e.error || 'Не удалось загрузить фото', 'error'); }
}
async function deleteHomework(id, spaceId) {
    const ok = await showConfirm('Удалить задание?', 'Это действие нельзя отменить', 'Удалить', 'Отмена', true);
    if (!ok) return;
    try {
        await apiDelete(`/api/homework/${id}`);
        showToast('Задание удалено', 'success');
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, true);
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}
function currentHwContainerId() { return document.getElementById('tab-hw') ? 'tab-hw' : 'tab-homework'; }

// ===================== СТАТИСТИКА ДЗ =====================
async function openHomeworkStats(homeworkId) {
    if (!currentSpace) return;
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;
    if (!isAdminViewer) return showToast('Только для преподавателя', 'error');

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
            <h2 class="app-title" style="font-size:1.3rem;">Статистика ДЗ</h2>
            <div style="text-align:center; margin:14px 0;">
                <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);">
                    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card-border)" stroke-width="${stroke}"></circle>
                    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#30d158" stroke-width="${stroke}"
                            stroke-dasharray="${dash} ${c}" stroke-linecap="round"></circle>
                </svg>
                <div style="margin-top:-95px; margin-bottom:60px; font-size:1.6rem; font-weight:700;">${s.percentage}%</div>
                <p style="color:var(--text-secondary);">Выполнили: <b>${s.completed}</b> из <b>${s.total}</b></p>
                ${s.isOverdue ? '<p style="color:#ff453a; font-size:0.85rem; font-weight:600;">Срок сдачи истёк</p>' : ''}
            </div>
            <h3 style="margin-top:8px; font-size:1rem;">Ученики</h3>
            <div class="hw-students-list">
        `;

        if (!s.students.length) {
            html += `<p class="empty-state" style="padding:20px 0;">В группе нет учеников</p>`;
        } else {
            const allPhotoUrls = s.students.filter(st => st.attachmentUrl).map(st => st.attachmentUrl);
            s.students.forEach((st) => {
                let borderColor = '#9ca3af';
                let label = 'Не сдано';
                let labelColor = 'var(--text-secondary)';
                let opacity = 1;

                if (st.status === 'done') {
                    borderColor = '#30d158';
                    label = 'Сдано';
                    labelColor = '#30d158';
                } else if (st.status === 'overdue') {
                    borderColor = '#ff453a';
                    label = 'Просрочено';
                    labelColor = '#ff453a';
                    opacity = 0.85;
                } else {
                    opacity = 0.8;
                }

                const photoIdx = st.attachmentUrl ? allPhotoUrls.indexOf(st.attachmentUrl) : -1;
                const photoPreview = st.attachmentUrl
                    ? `<img src="${st.attachmentUrl}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="event.stopPropagation();openImageViewer(${JSON.stringify(allPhotoUrls).replace(/"/g, '&quot;')}, ${photoIdx})">`
                    : '';

                const gradeSelect = `
                    <select onchange="setGradeFromStats('${st.id}', '${escapeHtml(st.fullName).replace(/'/g, "\\'")}', this.value, '${homeworkId}')"
                            style="padding:4px 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-weight:700;">
                        <option value="">—</option>
                        <option value="2" ${st.gradeValue === 2 ? 'selected' : ''}>2</option>
                        <option value="3" ${st.gradeValue === 3 ? 'selected' : ''}>3</option>
                        <option value="4" ${st.gradeValue === 4 ? 'selected' : ''}>4</option>
                        <option value="5" ${st.gradeValue === 5 ? 'selected' : ''}>5</option>
                    </select>
                `;

                html += `
                    <div class="hw-student-item" style="border-color:${borderColor}; opacity:${opacity}; display:flex; align-items:center; gap:10px;">
                        <div class="member-avatar">${escapeHtml(st.avatarEmoji || '👤')}</div>
                        <div class="member-info" style="flex:1;">
                            <div class="member-name">${escapeHtml(st.fullName)}</div>
                            <div class="member-username" style="color:${labelColor};">${label}</div>
                        </div>
                        ${photoPreview}
                        ${gradeSelect}
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

async function setGradeFromStats(studentUserId, studentName, value, homeworkId) {
    if (!currentSpace) return;
    try {
        const s = await apiGet(`/api/homework/${homeworkId}/stats`);
        const subjectName = s.subjectName || 'Предмет';

        await apiPost('/api/grades', {
            spaceId: currentSpace.id,
            studentName: studentName,
            studentUserId: studentUserId,
            subjectName: subjectName,
            gradeValue: value ? parseInt(value) : null,
            attendance: 'present',
            lessonDate: ymd(new Date()),
            homeworkId: homeworkId
        });
        showToast(value ? `Оценка ${value} выставлена` : 'Оценка снята', 'success');
    } catch (e) {
        showToast(e.error || 'Ошибка', 'error');
    }
}

// ============================================================================
//  ЖУРНАЛ — месяцы, слайдеры, экспорт/импорт
// ============================================================================

const MONTH_NAMES = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function formatMonthName(m) {
    if (!m) return '';
    const parts = m.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    return `${MONTH_NAMES[month]} ${year}`;
}

function getDaysOfMonth(monthStr) {
    const parts = monthStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const lastDay = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= lastDay; d++) {
        days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return days;
}

function monthKeyOf(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Глобальное состояние журнала
window.__journal = {
    spaceId: null,
    subject: null,
    month: null,
    subjects: [],
    months: [],
    students: [],
    allGrades: [],
    subjGrades: []
};

async function renderGradesTab(container, spaceId, isAdmin) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    if (currentUser?.isTeacher) {
        await renderTeacherJournal(container, spaceId);
    } else {
        await renderStudentGrades(container, spaceId);
    }
}

// ============================================================================
//  ЖУРНАЛ УЧИТЕЛЯ
// ============================================================================
async function renderTeacherJournal(container, spaceId) {
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';

    try {
        const allGrades = await apiGet(`/api/grades/${spaceId}`);
        const subjectsFromGrades = [...new Set(allGrades.map(g => g.subject_name).filter(Boolean))];

        let mySubjects = [];
        try {
            const ts = await apiGet(`/api/teacher-subjects/${spaceId}`);
            mySubjects = ts.map(s => s.subject_name);
        } catch (e) {}

        const subjects = [...new Set([...mySubjects, ...subjectsFromGrades])].sort();

        window.__journal.spaceId = spaceId;
        window.__journal.allGrades = allGrades;
        window.__journal.subjects = subjects;

        if (!subjects.length) {
            container.innerHTML = `
                <h1 class="page-title">Журнал</h1>
                <div class="settings-card" style="text-align:center;">
                    <p style="color:var(--text-secondary);margin-top:0;">Нет ни одного предмета. Добавьте первый, чтобы начать вести журнал.</p>
                    <button class="btn-primary" onclick="addJournalSubject('${spaceId}')">+ Добавить предмет</button>
                </div>
            `;
            return;
        }

        if (!window.__journal.subject || !subjects.includes(window.__journal.subject)) {
            window.__journal.subject = subjects[0];
        }

        const subjGrades = allGrades.filter(g => g.subject_name === window.__journal.subject);
        window.__journal.subjGrades = subjGrades;

        const monthsFromGrades = [...new Set(subjGrades.map(g => monthKeyOf(g.lesson_date)))].sort();
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (!monthsFromGrades.includes(currentMonth)) monthsFromGrades.push(currentMonth);
        monthsFromGrades.sort();

        if (!window.__journal.month || !monthsFromGrades.includes(window.__journal.month)) {
            window.__journal.month = monthsFromGrades[monthsFromGrades.length - 1];
        }
        window.__journal.months = monthsFromGrades;

        container.innerHTML = renderTeacherJournalHtml();
        attachJournalHandlers();
        await loadJournalStudents(spaceId);
        renderJournalTable();
    } catch (e) {
        container.innerHTML = `<p class="empty-state">Ошибка: ${escapeHtml(e.error || e.message)}</p>`;
    }
}

function renderTeacherJournalHtml() {
    const subjects = window.__journal.subjects || [];
    const subject = window.__journal.subject;
    const months = window.__journal.months || [];
    const month = window.__journal.month;

    let html = `<h1 class="page-title">Журнал</h1>`;

    // Предметы
    html += `<div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Предмет</div>`;
    html += `<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;">`;
    for (const s of subjects) {
        html += `<button class="day-tab ${s === subject ? 'active' : ''}" data-subj="${escapeHtml(s)}" style="flex-shrink:0;">${escapeHtml(s)}</button>`;
    }
    html += `<button class="day-tab" data-subj="__add__" style="flex-shrink:0;">+ предмет</button>`;
    html += `</div>`;

    // Месяцы
    html += `<div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Месяц</div>`;
    html += `<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;">`;
    for (const m of months) {
        html += `<button class="day-tab ${m === month ? 'active' : ''}" data-month="${m}" style="flex-shrink:0;">${formatMonthName(m)}</button>`;
    }
    html += `</div>`;

    // Кнопки
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn-small" onclick="journalAddLesson()">+ урок</button>
        <button class="btn-small" onclick="journalAddStudent()">+ ученик</button>
        <button class="btn-small" onclick="exportJournalExcel(window.__journal.spaceId)">Экспорт Excel</button>
        <button class="btn-small" onclick="importJournalExcel(window.__journal.spaceId)">Импорт Excel</button>
    </div>`;

    html += `<div id="journalTableWrap" class="journal-table-wrap"></div>`;

    return html;
}

function attachJournalHandlers() {
    document.querySelectorAll('[data-subj]').forEach(btn => {
        btn.addEventListener('click', () => {
            const s = btn.dataset.subj;
            if (s === '__add__') { addJournalSubject(window.__journal.spaceId); return; }
            window.__journal.subject = s;
            window.__journal.month = null;
            renderTeacherJournal(document.getElementById('tab-grades'), window.__journal.spaceId);
        });
    });
    document.querySelectorAll('[data-month]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.__journal.month = btn.dataset.month;
            renderTeacherJournal(document.getElementById('tab-grades'), window.__journal.spaceId);
        });
    });
}

async function addJournalSubject(spaceId) {
    const name = await showPrompt('Название предмета', 'Например: Математика');
    if (!name) return;
    try {
        await apiPost('/api/teacher-subjects', { spaceId, subjectName: name.trim() });
        window.__journal.subject = name.trim();
        window.__journal.month = null;
        await renderTeacherJournal(document.getElementById('tab-grades'), spaceId);
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

async function loadJournalStudents(spaceId) {
    try {
        const members = await apiGet(`/api/spaces/${spaceId}/members`);
        const namesFromMembers = members.map(m => m.full_name);
        const namesFromGrades = [...new Set(window.__journal.subjGrades.map(g => g.student_name))];

        let extra = [];
        try {
            const extraResp = await apiGet(`/api/journal-students/${spaceId}?subject=${encodeURIComponent(window.__journal.subject || '')}`);
            extra = extraResp.map(s => s.student_name);
        } catch (e) {}

        window.__journal.students = [...new Set([...namesFromMembers, ...namesFromGrades, ...extra])].sort();
    } catch (e) {
        window.__journal.students = [];
    }
}

function renderJournalTable() {
    const wrap = document.getElementById('journalTableWrap');
    if (!wrap) return;

    const students = window.__journal.students || [];
    const subjGrades = window.__journal.subjGrades || [];
    const month = window.__journal.month;

    if (!month) {
        wrap.innerHTML = '<p class="empty-state" style="padding:24px;">Выберите месяц</p>';
        return;
    }

    const days = getDaysOfMonth(month);

    if (!students.length) {
        wrap.innerHTML = '<p class="empty-state" style="padding:24px;">Нет учеников. Нажмите «+ ученик», чтобы добавить.</p>';
        return;
    }

    let html = `<table><thead><tr><th style="min-width:180px;">Ученик</th>`;
    for (const d of days) {
        const dayNum = parseInt(d.slice(8, 10));
        html += `<th style="min-width:38px;">${dayNum}</th>`;
    }
    html += `<th>Ср.</th></tr></thead><tbody>`;

    for (const st of students) {
        html += `<tr><td>${escapeHtml(st)}</td>`;
        const studentGrades = subjGrades.filter(g => g.student_name === st && g.grade_value);

        for (const d of days) {
            const cell = subjGrades.find(g => g.student_name === st && g.lesson_date && String(g.lesson_date).slice(0, 10) === d);
            let txt = '';
            let bg = '';
            if (cell) {
                if (cell.grade_value) txt = String(cell.grade_value);
                if (cell.attendance === 'absent') { txt = txt ? txt + '·Н' : 'Н'; bg = 'background:rgba(255,69,58,0.12)'; }
                else if (cell.attendance === 'late') { txt = txt ? txt + '·О' : 'О'; bg = 'background:rgba(255,159,10,0.12)'; }
            }
            const stEsc = escapeHtml(st).replace(/'/g, '&#39;');
            html += `<td style="${bg};cursor:pointer;" onclick="openGradeCell('${stEsc}', '${d}')">${txt || '·'}</td>`;
        }

        const avg = studentGrades.length
            ? (studentGrades.reduce((s, g) => s + g.grade_value, 0) / studentGrades.length).toFixed(2)
            : '—';
        html += `<td style="font-weight:700;color:#0088cc;">${avg}</td></tr>`;
    }

    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

async function openGradeCell(studentName, date) {
    const spaceId = window.__journal.spaceId;
    const subject = window.__journal.subject;
    const subjGrades = window.__journal.subjGrades || [];
    const existing = subjGrades.find(g => g.student_name === studentName && g.lesson_date && String(g.lesson_date).slice(0, 10) === date);

    const currentGrade = existing?.grade_value || '';
    const currentAttendance = existing?.attendance || 'present';

    const d = new Date(date);
    const dateLabel = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `
        <div class="sheet show" id="dynamicSheet">
            <div class="sheet-handle"></div>
            <h2 class="app-title" style="font-size:1.15rem;margin-bottom:6px;">${escapeHtml(studentName)}</h2>
            <p style="color:var(--text-secondary);font-size:0.85rem;margin:0 0 16px 0;">${escapeHtml(subject)} · ${dateLabel}</p>

            <div style="margin-bottom:16px;">
                <div style="font-weight:600;margin-bottom:8px;">Оценка</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="grade-btn ${currentGrade === '' ? 'active' : ''}" data-grade="">—</button>
                    <button class="grade-btn ${currentGrade === 2 ? 'active' : ''}" data-grade="2">2</button>
                    <button class="grade-btn ${currentGrade === 3 ? 'active' : ''}" data-grade="3">3</button>
                    <button class="grade-btn ${currentGrade === 4 ? 'active' : ''}" data-grade="4">4</button>
                    <button class="grade-btn ${currentGrade === 5 ? 'active' : ''}" data-grade="5">5</button>
                </div>
            </div>

            <div style="margin-bottom:16px;">
                <div style="font-weight:600;margin-bottom:8px;">Посещаемость</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="att-btn ${currentAttendance === 'present' ? 'active' : ''}" data-att="present">Был</button>
                    <button class="att-btn ${currentAttendance === 'late' ? 'active' : ''}" data-att="late">Опоздал</button>
                    <button class="att-btn ${currentAttendance === 'absent' ? 'active' : ''}" data-att="absent">Нет</button>
                </div>
            </div>

            <button class="btn-primary" id="gradeSaveBtn">Сохранить</button>
            ${existing ? `<button class="btn-danger" id="gradeDeleteBtn" style="margin-top:8px;">Удалить запись</button>` : ''}
            <button class="btn-secondary" style="margin-top:8px;" onclick="closeDynamicSheet()">Отмена</button>
        </div>`;
    document.getElementById('sheetOverlay').classList.add('show');

    let selGrade = currentGrade;
    let selAtt = currentAttendance;

    root.querySelectorAll('.grade-btn').forEach(b => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.grade-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            selGrade = b.dataset.grade;
        });
    });
    root.querySelectorAll('.att-btn').forEach(b => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.att-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            selAtt = b.dataset.att;
        });
    });

    root.querySelector('#gradeSaveBtn').addEventListener('click', async () => {
        try {
            const members = await apiGet(`/api/spaces/${spaceId}/members`);
            const match = members.find(m => m.full_name === studentName);
            await apiPost('/api/grades', {
                spaceId,
                studentName,
                studentUserId: match?.id || null,
                subjectName: subject,
                gradeValue: selGrade ? parseInt(selGrade) : null,
                attendance: selAtt,
                lessonDate: date
            });
            showToast('Сохранено', 'success');
            closeDynamicSheet();
            await renderTeacherJournal(document.getElementById('tab-grades'), spaceId);
        } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
    });

    const delBtn = root.querySelector('#gradeDeleteBtn');
    if (delBtn && existing) {
        delBtn.addEventListener('click', async () => {
            try {
                await apiDelete(`/api/grades/${existing.id}`);
                showToast('Удалено', 'success');
                closeDynamicSheet();
                await renderTeacherJournal(document.getElementById('tab-grades'), spaceId);
            } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
        });
    }
}

async function journalAddLesson() {
    const dateStr = await showPrompt('Дата урока (ДД.ММ.ГГГГ)', '01.09.2025');
    if (!dateStr) return;
    const m = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) { showToast('Формат: ДД.ММ.ГГГГ', 'error'); return; }
    const day = m[1].padStart(2, '0');
    const mon = m[2].padStart(2, '0');
    const year = m[3];
    const mk = `${year}-${mon}`;

    if (!window.__journal.months.includes(mk)) {
        window.__journal.months.push(mk);
        window.__journal.months.sort();
    }
    window.__journal.month = mk;
    showToast(`Открыт ${formatMonthName(mk)}. Кликните по дню ${day}, чтобы поставить оценку.`, 'success', 4000);
    renderTeacherJournal(document.getElementById('tab-grades'), window.__journal.spaceId);
}

async function journalAddStudent() {
    const spaceId = window.__journal.spaceId;
    const subject = window.__journal.subject;
    const name = await showPrompt('ФИО ученика', 'Иванов Иван');
    if (!name) return;
    try {
        await apiPost('/api/journal-students', { spaceId, subjectName: subject, studentName: name.trim() });
        await loadJournalStudents(spaceId);
        renderJournalTable();
        showToast('Ученик добавлен', 'success');
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

// ============================================================================
//  ЖУРНАЛ УЧЕНИКА
// ============================================================================
async function renderStudentGrades(container, spaceId) {
    container.innerHTML = '<p class="empty-state">Загрузка…</p>';
    try {
        const grades = await apiGet(`/api/grades/${spaceId}`);

        if (!grades.length) {
            container.innerHTML = `<h1 class="page-title">Журнал</h1><p class="empty-state">Оценок пока нет</p>`;
            return;
        }

        const bySubject = {};
        for (const g of grades) {
            if (!bySubject[g.subject_name]) bySubject[g.subject_name] = [];
            bySubject[g.subject_name].push(g);
        }

        let html = `<h1 class="page-title">Мои оценки</h1>`;

        for (const subj of Object.keys(bySubject).sort()) {
            const list = bySubject[subj];
            const numeric = list.filter(g => g.grade_value).map(g => g.grade_value);
            const avg = numeric.length ? (numeric.reduce((s, v) => s + v, 0) / numeric.length).toFixed(2) : '—';
            const absent = list.filter(g => g.attendance === 'absent').length;
            const late = list.filter(g => g.attendance === 'late').length;

            html += `<div class="settings-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-weight:700;font-size:1.05rem;">${escapeHtml(subj)}</div>
                    <div style="font-size:1.4rem;font-weight:800;color:#0088cc;">${avg}</div>
                </div>
                <div style="color:var(--text-secondary);font-size:0.8rem;margin-bottom:10px;">
                    Оценок: ${numeric.length} · Пропусков: ${absent} · Опозданий: ${late}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;

            const sorted = [...list].sort((a, b) => new Date(b.lesson_date) - new Date(a.lesson_date));
            for (const g of sorted) {
                const d = new Date(g.lesson_date);
                const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
                let marks = [];
                if (g.grade_value) marks.push(`<b style="color:#30d158;">${g.grade_value}</b>`);
                if (g.attendance === 'absent') marks.push('<span style="color:#ff453a;">Н</span>');
                else if (g.attendance === 'late') marks.push('<span style="color:#ff9f0a;">О</span>');
                if (!marks.length) marks.push('—');
                html += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--divider);">
                    <span style="color:var(--text-secondary);font-size:0.85rem;">${dateStr}</span>
                    <span>${marks.join(' · ')}</span>
                </div>`;
            }

            html += `</div></div>`;
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p class="empty-state">Ошибка: ${escapeHtml(e.error || '')}</p>`;
    }
}

// ============================================================================
//  EXCEL
// ============================================================================
async function exportJournalExcel(spaceId) {
    const subject = window.__journal?.subject || '';
    const month = window.__journal?.month || '';
    if (!subject || !month) { showToast('Выберите предмет и месяц', 'error'); return; }

    try {
        const url = `/api/grades/${spaceId}/export?subject=${encodeURIComponent(subject)}&month=${month}`;
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Ошибка выгрузки');
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `journal-${subject}-${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
        showToast('Файл выгружен', 'success');
    } catch (e) {
        showToast(e.message || 'Ошибка', 'error');
    }
}

function importJournalExcel(spaceId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`/api/grades/${spaceId}/import`, {
                method: 'POST',
                headers: authHeaders(),
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Ошибка импорта');
            showToast(`Импорт: +${data.inserted} новых, ${data.updated} обновлено`, 'success', 5000);
            // Переключаем на импортированный предмет и месяц
            if (data.subject) window.__journal.subject = data.subject;
            if (data.month) window.__journal.month = data.month;
            await renderTeacherJournal(document.getElementById('tab-grades'), spaceId);
        } catch (e) {
            showToast(e.message || 'Ошибка', 'error');
        }
    });
    input.click();
}

// ============================================================================
//  ЧАТ
// ============================================================================
let chatJoinedSpace = null;
let chatIsAdmin = false;
let chatCurrentUserId = null;
let typingUsers = new Map();

function renderChatTab(container, spaceId, isAdmin, currentUserId) {
    if (!spaceId) { container.innerHTML = emptySpaceState(); return; }
    chatIsAdmin = isAdmin;
    chatCurrentUserId = currentUserId;

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px;">
            <h1 class="page-title" style="margin:0;">Чат группы</h1>
            <button class="btn-small" id="chatMuteBtn">Уведомления</button>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:10px;">
            <input type="text" id="chatSearch" class="form-control" placeholder="Поиск по сообщениям..." style="flex:1;">
        </div>
        <div class="chat-wrap">
            <div class="chat-messages" id="chatMessages"></div>
            <div id="typingIndicator" style="padding:4px 12px; font-size:12px; color:var(--text-secondary); min-height:18px;"></div>
            <div id="filePreviewContainer" style="padding:0 12px;"></div>
            <div class="chat-input-row">
                <label class="attach-btn" style="cursor:pointer; padding:8px; display:flex; align-items:center;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                    <input type="file" id="chatFileInput" multiple style="display:none">
                </label>
                <textarea id="chatInput" rows="1" placeholder="Сообщение…"></textarea>
                <button class="btn-primary" style="width:auto; margin:0;" onclick="sendChatMessage('${spaceId}')">Отправить</button>
            </div>
            <div class="chat-blocked-notice hidden">Отправка сообщений отключена на время экзаменов.</div>
        </div>`;

    applyGlobalSettings(window.__currentUser);
    loadChatHistory(spaceId, isAdmin, currentUserId);

    if (chatJoinedSpace !== spaceId) {
        socket.emit('join_space', { spaceId, token: localStorage.getItem('token') });
        chatJoinedSpace = spaceId;
    }

    const muteBtn = document.getElementById('chatMuteBtn');
    if (muteBtn) {
        refreshChatMuteBtn(spaceId);
        muteBtn.addEventListener('click', (e) => { e.stopPropagation(); openChatMutePanel(spaceId); });
    }

    const searchInput = document.getElementById('chatSearch');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadChatHistory(spaceId, isAdmin, currentUserId, e.target.value);
        }, 300);
    });

    const fileInput = document.getElementById('chatFileInput');
    let pendingFiles = [];
    fileInput.addEventListener('change', () => {
        pendingFiles = Array.from(fileInput.files);
        renderFilePreview(pendingFiles);
    });
    window.__pendingFiles = () => pendingFiles;
    window.__clearPendingFiles = () => { pendingFiles = []; renderFilePreview([]); fileInput.value = ''; };

    const input = document.getElementById('chatInput');
    let typingStopTimer;
    input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(spaceId); return; }
        socket.emit('typing_start');
        clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(() => socket.emit('typing_stop'), 2000);
    };
    input.oninput = () => {
        socket.emit('typing_start');
        clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(() => socket.emit('typing_stop'), 2000);
    };
    input.onblur = () => { clearTimeout(typingStopTimer); socket.emit('typing_stop'); };

    socket.off('new_message'); socket.off('message_deleted'); socket.off('reaction_updated');
    socket.off('user_typing'); socket.off('user_stopped_typing');
    socket.on('new_message', (msg) => { if (msg.space_id === spaceId) appendChatMessage(msg, isAdmin, currentUserId); });
    socket.on('message_deleted', ({ messageId }) => { document.getElementById('msg-' + messageId)?.remove(); });
    socket.on('reaction_updated', ({ messageId }) => { reloadMessageReactions(messageId); });
    socket.on('user_typing', ({ userId, nickname }) => {
        typingUsers.set(userId, { nickname });
        renderTypingIndicator();
    });
    socket.on('user_stopped_typing', ({ userId }) => {
        typingUsers.delete(userId);
        renderTypingIndicator();
    });

    apiPost(`/api/chat/${spaceId}/mark-read`, {}).catch(() => {});
    updateBadges();
}

function renderTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (!el) return;
    const arr = Array.from(typingUsers.values());
    if (!arr.length) { el.textContent = ''; return; }
    let text;
    if (arr.length === 1) text = `@${arr[0].nickname} печатает…`;
    else if (arr.length === 2) text = `@${arr[0].nickname}, @${arr[1].nickname} печатают…`;
    else text = `@${arr[0].nickname}, @${arr[1].nickname} и ещё ${arr.length - 2} печатают…`;
    el.textContent = text;
}

function renderFilePreview(files) {
    const box = document.getElementById('filePreviewContainer');
    if (!box) return;
    if (!files.length) { box.innerHTML = ''; return; }
    box.innerHTML = files.map((f) => `
        <div style="display:inline-block;margin:4px;padding:6px 10px;background:var(--input-bg);border-radius:8px;font-size:12px;">
            ${escapeHtml(f.name)} (${formatBytes(f.size)})
        </div>
    `).join('');
}

async function loadChatHistory(spaceId, isAdmin, currentUserId, search = '') {
    try {
        const url = search
            ? `/api/chat/${spaceId}/messages?q=${encodeURIComponent(search)}`
            : `/api/chat/${spaceId}/messages`;
        const rows = await apiGet(url);
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

    const replyHtml = m.reply_to
        ? `<div class="chat-reply-quote" style="border-left:3px solid #0088cc; padding-left:8px; margin-bottom:6px; font-size:0.8rem; opacity:0.8;">
             <div style="font-weight:600;">${escapeHtml(m.reply_to.full_name || '')}</div>
             <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml((m.reply_to.message || '').slice(0, 60))}</div>
           </div>`
        : '';

    const filesHtml = (m.files && m.files.length)
        ? m.files.map((f) => {
            if (f.mime.startsWith('image/')) {
                const allUrls = m.files.filter(x => x.mime.startsWith('image/')).map(x => x.url);
                const myIdx = allUrls.indexOf(f.url);
                return `<img src="${f.url}" style="max-width:200px;border-radius:10px;margin-top:6px;cursor:pointer;display:block;" onclick="openImageViewer(${JSON.stringify(allUrls).replace(/"/g, '&quot;')}, ${myIdx})">`;
            }
            return `<a href="${f.url}" target="_blank" style="display:inline-block;padding:6px 10px;background:rgba(0,0,0,0.05);border-radius:8px;margin-top:6px;text-decoration:none;color:inherit;font-size:0.85rem;">
                ${escapeHtml(f.name)} (${formatBytes(f.size)})
            </a>`;
        }).join('')
        : '';

    const reactionsHtml = renderReactions(m.reactions || [], m.id);

    el.innerHTML = `
        <div class="who">${escapeHtml(m.full_name)}${m.is_teacher ? ' <span style="font-size:10px;">преподаватель</span>' : ''}</div>
        ${replyHtml}
        <div class="txt">${escapeHtml(m.message)}</div>
        ${filesHtml}
        <div class="reactions-row" id="reactions-${m.id}">${reactionsHtml}</div>
        <div class="chat-actions" style="display:flex; gap:6px; margin-top:4px; font-size:11px;">
            <button class="btn-tiny" onclick="replyToMessage('${m.id}', '${escapeHtml(m.full_name).replace(/'/g, "\\'")}', '${escapeHtml(m.message.slice(0, 40)).replace(/'/g, "\\'")}')">Ответить</button>
            <button class="btn-tiny" onclick="openReactionPicker('${m.id}')">Реакция</button>
            ${isAdmin ? `<button class="btn-tiny" onclick="deleteChatMessage('${m.id}')">Удалить</button>` : ''}
        </div>
    `;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
}

function renderReactions(reactions, messageId) {
    if (!reactions.length) return '';
    const counts = {};
    for (const r of reactions) {
        if (!counts[r.emoji]) counts[r.emoji] = { count: 0 };
        counts[r.emoji].count++;
    }
    return Object.entries(counts).map(([emoji, data]) =>
        `<span class="reaction-chip" style="display:inline-block;padding:2px 8px;margin:2px;background:var(--input-bg);border-radius:12px;font-size:13px;cursor:pointer;" onclick="toggleReaction('${messageId}', '${emoji}')">
            ${emoji} ${data.count}
        </span>`
    ).join('');
}

async function reloadMessageReactions(messageId) {
    try {
        const el = document.getElementById('reactions-' + messageId);
        if (!el) return;
        const rows = await apiGet(`/api/chat/${chatJoinedSpace}/messages`);
        const msg = rows.find(m => m.id === messageId);
        if (msg) el.innerHTML = renderReactions(msg.reactions || [], messageId);
    } catch (e) {}
}

const POSITIVE_REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥'];
const NEGATIVE_REACTIONS = ['👎', '😢', '😡', '🤔'];

function openReactionPicker(messageId) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-card);border-radius:16px 16px 0 0;padding:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:400px;width:100%;';
    const all = [...POSITIVE_REACTIONS, ...NEGATIVE_REACTIONS];
    box.innerHTML = all.map(e =>
        `<button style="font-size:26px;background:var(--input-bg);border:none;border-radius:50%;width:48px;height:48px;cursor:pointer;" onclick="toggleReaction('${messageId}','${e}'); this.closest('div').parentElement.remove();">${e}</button>`
    ).join('');
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function toggleReaction(messageId, emoji) {
    try {
        await apiPost(`/api/messages/${messageId}/react`, { emoji });
        reloadMessageReactions(messageId);
    } catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

let _replyToId = null;
function replyToMessage(messageId, name, preview) {
    _replyToId = messageId;
    const container = document.querySelector('.chat-input-row');
    if (!container) return;
    let previewEl = document.getElementById('replyPreview');
    if (previewEl) previewEl.remove();
    previewEl = document.createElement('div');
    previewEl.id = 'replyPreview';
    previewEl.style.cssText = 'padding:6px 10px;background:var(--input-bg);border-left:3px solid #0088cc;border-radius:8px;margin-bottom:6px;font-size:0.8rem;display:flex;justify-content:space-between;align-items:center;';
    previewEl.innerHTML = `<div><b>${escapeHtml(name)}</b><br>${escapeHtml(preview)}</div><button style="background:none;border:none;cursor:pointer;font-size:16px;" onclick="cancelReply()">✕</button>`;
    container.parentElement.insertBefore(previewEl, container);
}
function cancelReply() {
    _replyToId = null;
    document.getElementById('replyPreview')?.remove();
}

async function sendChatMessage(spaceId) {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    const files = window.__pendingFiles ? window.__pendingFiles() : [];
    if (!text && !files.length) return;

    try {
        let fileIds = [];
        if (files.length) {
            const uploaded = await uploadFiles(files, spaceId);
            fileIds = uploaded.filter(f => f.id).map(f => f.id);
        }

        const mentions = [];
        const mentionRegex = /@([a-zA-Z0-9_]+)/g;
        let match;
        while ((match = mentionRegex.exec(text)) !== null) mentions.push(match[1]);
        let mentionIds = [];
        if (mentions.length) {
            try {
                const members = await apiGet(`/api/spaces/${spaceId}/members`);
                for (const nick of mentions) {
                    const found = members.find(m => m.username === nick);
                    if (found) mentionIds.push(found.id);
                }
            } catch (e) {}
        }

        socket.emit('send_message', { message: text, replyToId: _replyToId, fileIds, mentions: mentionIds });
        input.value = '';
        cancelReply();
        if (window.__clearPendingFiles) window.__clearPendingFiles();
        socket.emit('typing_stop');
    } catch (e) {
        showToast(e.error || 'Ошибка отправки', 'error');
    }
}
function deleteChatMessage(id) { socket.emit('delete_message', { messageId: id }); }

// ===================== МУТЫ ЧАТА =====================
function formatMuteLabel(m) {
    if (!m) return 'Уведомления';
    if (m.muted_forever) return 'Выкл.';
    if (m.muted_until && new Date(m.muted_until) > new Date()) {
        const d = new Date(m.muted_until);
        return `до ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return 'Уведомления';
}

async function refreshChatMuteBtn(spaceId) {
    const btn = document.getElementById('chatMuteBtn');
    if (!btn) return;
    try {
        const m = await getChatMute(spaceId);
        btn.textContent = formatMuteLabel(m);
    } catch (e) {}
}

let _chatMutePanel = null;
function closeChatMutePanel() { if (_chatMutePanel) { _chatMutePanel.remove(); _chatMutePanel = null; } }

function openChatMutePanel(spaceId) {
    if (_chatMutePanel) { closeChatMutePanel(); return; }
    const btn = document.getElementById('chatMuteBtn');
    if (!btn) return;

    _chatMutePanel = document.createElement('div');
    _chatMutePanel.style.cssText = 'position:absolute;top:56px;right:16px;z-index:200;background:var(--bg-card);border:1px solid var(--card-border);border-radius:12px;padding:10px;min-width:200px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
    _chatMutePanel.innerHTML = `
        <div style="font-weight:600;font-size:0.9rem;padding:2px 4px 6px;">Заглушить чат</div>
        <button class="btn-small" data-dur="1h">На 1 час</button>
        <button class="btn-small" data-dur="8h">На 8 часов</button>
        <button class="btn-small" data-dur="24h">На 24 часа</button>
        <button class="btn-small" data-dur="forever">Навсегда</button>
        <button class="btn-small" data-dur="off" style="background:#0088cc;color:#fff;">Включить обратно</button>
    `;

    const chatTab = document.getElementById('tab-chat');
    if (chatTab && getComputedStyle(chatTab).position === 'static') chatTab.style.position = 'relative';
    (chatTab || document.body).appendChild(_chatMutePanel);

    _chatMutePanel.addEventListener('click', async (e) => {
        const target = e.target.closest('button[data-dur]');
        if (!target) return;
        const dur = target.dataset.dur;
        try {
            if (dur === 'off') await clearChatMute(spaceId);
            else await setChatMute(spaceId, dur);
            await refreshChatMuteBtn(spaceId);
            showToast('Настройки чата обновлены', 'success');
        } catch (err) { showToast(err.error || 'Ошибка', 'error'); }
        closeChatMutePanel();
    });

    setTimeout(() => {
        const handler = (ev) => {
            if (!_chatMutePanel) { document.removeEventListener('click', handler); return; }
            if (_chatMutePanel.contains(ev.target) || ev.target === btn) return;
            closeChatMutePanel();
            document.removeEventListener('click', handler);
        };
        document.addEventListener('click', handler);
    }, 0);
}

// ===================== УЧАСТНИКИ =====================
const ROLE_LABELS = { admin: 'Админ', starosta: 'Староста', member: 'Участник' };
function getMemberDisplayStatus(m) { return m.custom_status || ROLE_LABELS[m.role] || m.role; }

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
                    <div class="member-username">@${escapeHtml(m.username)}</div>
                </div>
                <span class="code-pill">${escapeHtml(getMemberDisplayStatus(m))}</span>
            </div>
        `).join('');
        html += '</div>';
        container.innerHTML = html;
    } catch (e) { container.innerHTML = `<p class="empty-state">Ошибка: ${escapeHtml(e.error || '')}</p>`; }
}

async function openMemberProfile(member) {
    const isSelf = member.id === currentUser?.id;
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;
    if (!isSelf && !isAdminViewer) return showToast('Нет доступа', 'error');

    _memberForStatusEdit = member;
    const muted = member.muted_until && new Date(member.muted_until) > new Date();
    const manageable = isAdminViewer && !isSelf;
    const displayStatus = getMemberDisplayStatus(member);

    const statusBadge = manageable
        ? `<span class="code-pill" style="cursor:pointer;" onclick="openStatusEditor()">${escapeHtml(displayStatus)} ✎</span>`
        : `<span class="code-pill">${escapeHtml(displayStatus)}</span>`;

    const body = `
        <div style="text-align:center; margin-bottom:16px;">
            <div style="font-size:4rem;">${escapeHtml(member.avatar_emoji || '👤')}</div>
            <h2 style="margin:8px 0 4px;">${escapeHtml(member.full_name)}</h2>
            <p style="color:var(--text-secondary); margin:0;">@${escapeHtml(member.username)}</p>
            <p style="margin:8px 0 0;">
                ${statusBadge}
                ${muted ? '<span class="code-pill" style="background:#ff9f0a;color:#fff;">Мут</span>' : ''}
                ${isSelf ? '<span class="code-pill" style="background:#0088cc;color:#fff;">Вы</span>' : ''}
            </p>
        </div>
        ${manageable ? `
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
                ${member.role !== 'admin' ? `<button class="btn-small" onclick="changeMemberRole('${member.id}', 'admin')">Сделать админом</button>` : `<button class="btn-small" onclick="changeMemberRole('${member.id}', 'member')">Снять админа</button>`}
                ${muted ? `<button class="btn-small" onclick="unmuteMember('${member.id}')">Снять мут</button>` : `<button class="btn-small" onclick="muteMember('${member.id}')">Замутить</button>`}
                <button class="btn-small" style="background:#ff9f0a;color:#fff;" onclick="blockMember('${member.id}', '${escapeHtml(member.full_name).replace(/'/g, "\\'")}')">Забанить</button>
                <button class="btn-small" style="background:#ff453a;color:#fff;" onclick="kickMember('${member.id}', '${escapeHtml(member.full_name).replace(/'/g, "\\'")}')">Исключить</button>
            </div>
        ` : ''}
    `;

    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div>${body}<button type="button" class="btn-secondary" style="margin-top:14px;" onclick="closeDynamicSheet()">Закрыть</button></div>`;
    document.getElementById('sheetOverlay').classList.add('show');
}

function openStatusEditor() {
    const member = _memberForStatusEdit;
    if (!member) return;
    const isAdminViewer = currentUser?.isTeacher || currentSpace?.is_admin;
    if (!isAdminViewer) return showToast('Нет доступа', 'error');

    const currentStatus = member.custom_status || '';
    const roleLabel = ROLE_LABELS[member.role] || member.role;

    showFormSheet('Изменить статус', `
        <div class="form-group">
            <input name="customStatus" class="form-control" value="${escapeHtml(currentStatus)}" placeholder="Например: Староста" maxlength="50">
        </div>
        <p style="color:var(--text-secondary);font-size:0.8rem;">Оставьте пустым, чтобы вернуть роль (${escapeHtml(roleLabel)}).</p>
    `, async (fd) => {
        const status = (fd.get('customStatus') || '').trim();
        await apiPost(`/api/spaces/${currentSpace.id}/members/${member.id}/custom-status`, { customStatus: status });
        closeDynamicSheet();
        refreshCurrentTab();
        showToast('Статус сохранён', 'success');
    }, 'Сохранить');
}

async function changeMemberRole(userId, role) {
    try { await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/role`, { role }); closeDynamicSheet(); refreshCurrentTab(); showToast('Роль изменена', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

function muteMember(userId) {
    showFormSheet('Замутить участника', `
        <div class="form-group"><label>Время мута (минуты)</label>
            <input type="number" name="minutes" class="form-control" value="60" min="1" required>
        </div>
    `, async (fd) => {
        await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/mute`, { minutes: parseInt(fd.get('minutes')) });
        closeDynamicSheet(); refreshCurrentTab(); showToast('Участник замучен', 'success');
    }, 'Замутить');
}

async function unmuteMember(userId) {
    try { await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}/mute`); closeDynamicSheet(); refreshCurrentTab(); showToast('Мут снят', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

async function blockMember(userId, fullName) {
    const ok = await showConfirm(`Забанить «${fullName}»?`, '', 'Забанить', 'Отмена', true);
    if (!ok) return;
    showFormSheet(`Забанить «${fullName}»`, `
        <div class="form-group"><label>Причина (необязательно)</label>
            <input type="text" name="reason" class="form-control" placeholder="Например: спам">
        </div>
    `, async (fd) => {
        await apiPost(`/api/spaces/${currentSpace.id}/members/${userId}/block`, { reason: fd.get('reason') || null });
        closeDynamicSheet(); refreshCurrentTab(); showToast('Участник забанен', 'success');
    }, 'Забанить');
}

async function kickMember(userId, fullName) {
    const ok = await showConfirm(`Исключить «${fullName}»?`, '', 'Исключить', 'Отмена', true);
    if (!ok) return;
    try { await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}`); closeDynamicSheet(); refreshCurrentTab(); showToast('Участник исключён', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

// ===================== ЧЁРНЫЙ СПИСОК =====================
async function openBlacklist() {
    if (!currentSpace) return;
    const root = document.getElementById('dynamicSheetRoot');
    root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div><p class="empty-state">Загрузка…</p></div>`;
    document.getElementById('sheetOverlay').classList.add('show');
    try {
        const data = await apiGet(`/api/spaces/${currentSpace.id}/blacklist`);
        let html = `<h2 class="app-title" style="font-size:1.3rem;">Чёрный список</h2>`;
        if (data.blocked.length) {
            html += `<h3 style="margin-top:14px;">Забаненные</h3>`;
            html += data.blocked.map(b => `<div class="member-row"><div class="member-avatar">${escapeHtml(b.avatar_emoji || '👤')}</div><div class="member-info"><div class="member-name">${escapeHtml(b.full_name)}</div><div class="member-username">@${escapeHtml(b.username)}${b.reason ? ' · ' + escapeHtml(b.reason) : ''}</div></div><button class="btn-small" onclick="unblockMember('${b.id}')">Разбанить</button></div>`).join('');
        }
        if (data.muted.length) {
            html += `<h3 style="margin-top:14px;">Замученные</h3>`;
            html += data.muted.map(m => `<div class="member-row"><div class="member-avatar">${escapeHtml(m.avatar_emoji || '👤')}</div><div class="member-info"><div class="member-name">${escapeHtml(m.full_name)}</div><div class="member-username">до ${new Date(m.muted_until).toLocaleString('ru-RU')}</div></div><button class="btn-small" onclick="unmuteMemberFromBlacklist('${m.id}')">Снять</button></div>`).join('');
        }
        if (!data.blocked.length && !data.muted.length) html += `<p class="empty-state">Список пуст</p>`;
        html += `<button class="btn-secondary" style="margin-top:14px;" onclick="closeDynamicSheet()">Закрыть</button>`;
        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><div class="sheet-handle"></div>${html}</div>`;
    } catch (e) {
        root.innerHTML = `<div class="sheet show" id="dynamicSheet"><p class="empty-state">Ошибка</p><button class="btn-secondary" onclick="closeDynamicSheet()">Закрыть</button></div>`;
    }
}

async function unblockMember(userId) {
    try { await apiDelete(`/api/spaces/${currentSpace.id}/blocked/${userId}`); openBlacklist(); refreshCurrentTab(); showToast('Разбанен', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}
async function unmuteMemberFromBlacklist(userId) {
    try { await apiDelete(`/api/spaces/${currentSpace.id}/members/${userId}/mute`); openBlacklist(); refreshCurrentTab(); showToast('Мут снят', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

async function rotateInviteCode() {
    if (!currentSpace) return;
    const ok = await showConfirm('Сменить код приглашения?', 'Старый код станет недействительным', 'Сменить', 'Отмена');
    if (!ok) return;
    try { const r = await apiPost(`/api/spaces/${currentSpace.id}/rotate-invite-code`, {}); showToast(`Новый код: ${r.inviteCode}`, 'success'); await window.__reloadSpaces?.(); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

// ===================== ПРОФИЛЬ =====================
const EMOJI_LIST = ['👤','👨','👩','🧑','👦','👧','👨‍🎓','👩‍🎓','🧑‍🎓','👨‍🏫','👩‍🏫','😀','😎','🤓','🥳','🤔','😴','🧐','🥸','🤠','😺','🐶','🐱','🦊','🐼','🐨','🦁','🐯','🦉','🐧','🍕','🍔','🍟','🌮','🍣','🍎','🍓','🍉','☕','🍩','🎂','⚽','🏀','🎮','🎧','🎸','🎨','🚀','⚡','🔥','⭐','🌈','💎','🎯','🏆','🥇','👑','💡','📚','✏️','🎓'];
let _selectedEmoji = '👤';
let _editingProfileState = null;

function openEditProfile(keepState) {
    if (!currentUser) return;
    if (!keepState) {
        _selectedEmoji = currentUser.avatarEmoji || '👤';
        const parts = (currentUser.fullName || '').split(' ');
        _editingProfileState = { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '', nickname: currentUser.isTeacher ? '' : (currentUser.username || '') };
    }
    const state = _editingProfileState || { firstName: '', lastName: '', nickname: '' };
    showFormSheet('Редактирование профиля', `
        <div style="text-align:center; margin:12px 0;">
            <div style="font-size:4rem; cursor:pointer; user-select:none;" onclick="openEmojiPicker()">${_selectedEmoji}</div>
            <p style="color:var(--text-secondary); font-size:0.85rem; margin:4px 0 0;">Нажмите, чтобы сменить аватар</p>
        </div>
        <div class="form-group"><input name="firstName" class="form-control" placeholder="Имя" value="${escapeHtml(state.firstName)}" required></div>
        <div class="form-group"><input name="lastName" class="form-control" placeholder="Фамилия" value="${escapeHtml(state.lastName)}" required></div>
        ${currentUser.isTeacher ? '' : `<div class="form-group"><input name="nickname" class="form-control" placeholder="Ник" value="${escapeHtml(state.nickname)}"></div>`}
    `, async (fd) => {
        _editingProfileState = { firstName: fd.get('firstName') || '', lastName: fd.get('lastName') || '', nickname: fd.get('nickname') || '' };
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
        showToast('Профиль сохранён', 'success');
        setTimeout(() => location.reload(), 800);
    }, 'Сохранить');
}

function openEmojiPicker() {
    const form = document.getElementById('dynamicSheetForm');
    if (form) {
        const fd = new FormData(form);
        _editingProfileState = { firstName: fd.get('firstName') || '', lastName: fd.get('lastName') || '', nickname: fd.get('nickname') || '' };
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

// ===================== УНИВЕРСАЛЬНАЯ ФОРМА =====================
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
        catch (err) { showToast(err.error || err.message || 'Ошибка', 'error'); }
    };
}
function closeDynamicSheet() {
    document.getElementById('sheetOverlay').classList.remove('show');
    document.getElementById('dynamicSheetRoot').innerHTML = '';
    if (_chatMutePanel) closeChatMutePanel();
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
        await apiPost('/api/schedule', { spaceId, dayOfWeek: parseInt(fd.get('dayOfWeek')), subjectName: fd.get('subjectName'), classroom: fd.get('classroom'), teacherName: fd.get('teacherName'), startTime: fd.get('startTime'), endTime: fd.get('endTime') });
        showToast('Урок добавлен', 'success');
        renderScheduleUnified(document.getElementById('tab-schedule'), spaceId, true);
    }, 'Добавить');
}

function openEditLessonSheet(lesson, dateStr, spaceId) {
    showFormSheet(`Урок: ${lesson.subject_name}`, `
        <p class="app-subtitle" style="text-align:left; margin-bottom:10px;">Изменения на ${new Date(dateStr).toLocaleDateString('ru-RU')}</p>
        <div class="form-group"><label><input type="checkbox" name="isCanceled"> Отменить урок</label></div>
        <div class="form-group"><input name="replacementSubject" class="form-control" placeholder="Замена: предмет"></div>
        <div class="form-group"><input name="replacementClassroom" class="form-control" placeholder="Замена: кабинет"></div>
        <div class="form-group"><input name="replacementTeacher" class="form-control" placeholder="Замена: преподаватель"></div>
        <hr style="border:0; border-top:1px solid var(--card-border); margin:14px 0;">
        <button type="button" class="btn-danger" style="width:100%;" onclick="deleteLessonPermanently('${lesson.id}','${spaceId}')">Удалить урок навсегда</button>
    `, async (fd) => {
        await apiPost('/api/schedule/override', { spaceId, scheduleId: lesson.id, date: dateStr, isCanceled: fd.get('isCanceled') === 'on', replacementSubject: fd.get('replacementSubject') || null, replacementClassroom: fd.get('replacementClassroom') || null, replacementTeacher: fd.get('replacementTeacher') || null });
        showToast('Изменение сохранено', 'success');
        renderScheduleUnified(document.getElementById('tab-schedule'), spaceId, true);
    }, 'Сохранить');
}

async function deleteLessonPermanently(id, spaceId) {
    const ok = await showConfirm('Удалить урок насовсем?', '', 'Удалить', 'Отмена', true);
    if (!ok) return;
    try { await apiDelete(`/api/schedule/${id}`); closeDynamicSheet(); renderScheduleUnified(document.getElementById('tab-schedule'), spaceId, true); showToast('Урок удалён', 'success'); }
    catch (e) { showToast(e.error || 'Ошибка', 'error'); }
}

function openAddHomeworkSheet(spaceId) {
    showFormSheet('Новое домашнее задание', `
        <div class="form-group"><input name="subjectName" class="form-control" placeholder="Предмет" required></div>
        <div class="form-group"><textarea name="title" class="form-control" placeholder="Задание" required rows="3"></textarea></div>
        <div class="form-group"><input name="dueDate" type="date" class="form-control" required></div>
    `, async (fd) => {
        await apiPost('/api/homework', { spaceId, subjectName: fd.get('subjectName'), title: fd.get('title'), dueDate: fd.get('dueDate') });
        showToast('ДЗ добавлено', 'success');
        renderHomeworkTab(document.getElementById(currentHwContainerId()), spaceId, true);
    }, 'Добавить');
}

function openJoinSpaceForm() {
    showFormSheet('Присоединиться к группе', `
        <div class="form-group"><input name="code" class="form-control" placeholder="Код приглашения" required style="text-transform:uppercase;"></div>
    `, async (fd) => {
        await apiPost('/api/spaces/join', { code: fd.get('code') });
        showToast('Вы присоединились', 'success');
        await window.__reloadSpaces?.();
    }, 'Присоединиться');
}

function openCreateSpaceForm() {
    showFormSheet('Новая группа', `
        <div class="form-group"><input name="name" class="form-control" placeholder="Название пространства" required></div>
    `, async (fd) => {
        const space = await apiPost('/api/spaces', { name: fd.get('name') });
        showToast(`Группа создана. Код: ${space.invite_code}`, 'success', 6000);
        await window.__reloadSpaces?.();
    }, 'Создать');
}

function emptySpaceState() {
    return `<div class="empty-state">
        <p>Вы пока не состоите ни в одном пространстве.</p>
        <button class="btn-primary" style="max-width:240px;" onclick="openJoinSpaceForm()">Присоединиться по коду</button>
    </div>`;
}

function refreshCurrentTab() {
    const activeTab = document.querySelector('.tab-section.active');
    if (activeTab) {
        const isAdmin = currentUser?.isTeacher || currentSpace?.is_admin;
        const spaceId = currentSpace?.id;
        if (activeTab.id === 'tab-schedule') renderScheduleUnified(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-hw') renderHomeworkTab(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-members') renderMembersTab(activeTab, spaceId, !!isAdmin);
        else if (activeTab.id === 'tab-chat') renderChatTab(activeTab, spaceId, !!isAdmin, currentUser?.id);
        else if (activeTab.id === 'tab-grades') renderGradesTab(activeTab, spaceId, !!isAdmin);
    }
}

/* ===================== PUSH: КАРТОЧКА НАСТРОЕК ===================== */
async function renderPushSettingsCard() {
    const box = document.getElementById('pushSettingsContainer');
    if (!box) return;
    if (typeof pushSupported !== 'function' || !pushSupported()) {
        box.innerHTML = '<h3>Уведомления</h3><p style="color:var(--text-secondary); margin:0;">Этот браузер не поддерживает пуши.</p>';
        return;
    }
    const enabled = await isPushEnabled().catch(() => false);
    const mute = await getPushMute();
    const prefs = await getNotificationPrefs();
    if (!prefs) return;

    let statusText = 'Уведомления включены';
    if (!enabled) statusText = 'Уведомления выключены';
    else if (mute.muted_forever) statusText = 'Заглушены навсегда';
    else if (mute.muted_until && new Date(mute.muted_until) > new Date()) {
        const d = new Date(mute.muted_until);
        statusText = `Заглушены до ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    const prefRows = [
        { key: 'all_enabled', label: 'Все уведомления' },
        { key: 'chat_enabled', label: 'Сообщения в чате' },
        { key: 'schedule_enabled', label: 'Изменения в расписании' },
        { key: 'lesson_reminder_enabled', label: 'Напоминание о паре' },
        { key: 'new_homework_enabled', label: 'Новые домашние задания' },
        { key: 'homework_deadline_enabled', label: 'Дедлайн ДЗ' },
        { key: 'grades_enabled', label: 'Оценки' }
    ];

    box.innerHTML = `
        <h3>Уведомления</h3>
        <p style="color:var(--text-secondary); font-size:0.9rem; margin-top:0;">${statusText}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
            ${prefRows.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>${r.label}</span>
                    <label class="switch"><input type="checkbox" data-pref="${r.key}" ${prefs[r.key] ? 'checked' : ''}><span class="slider"></span></label>
                </div>
            `).join('')}
        </div>
        <p style="color:var(--text-secondary);font-size:0.8rem;margin-top:12px;">Ответы и упоминания, а также объявления колледжа приходят всегда.</p>
        <button class="btn-primary" id="pushSettingsBtn" style="margin-top:12px;">Настроить браузерные уведомления</button>
    `;

    box.querySelectorAll('input[data-pref]').forEach(input => {
        input.addEventListener('change', async () => {
            const newPrefs = { ...prefs };
            newPrefs[input.dataset.pref] = input.checked;
            try { await saveNotificationPrefs(newPrefs); showToast('Настройки сохранены', 'success'); }
            catch (e) { showToast('Ошибка', 'error'); }
        });
    });
    box.querySelector('#pushSettingsBtn').addEventListener('click', openPushSettingsModal);
}

async function openPushSettingsModal() {
    const root = document.getElementById('dynamicSheetRoot');
    const enabled = await isPushEnabled();
    const mute = await getPushMute();

    let statusText;
    if (mute.muted_forever) statusText = 'Заглушены навсегда';
    else if (mute.muted_until && new Date(mute.muted_until) > new Date()) {
        const d = new Date(mute.muted_until);
        statusText = `Заглушены до ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else if (!enabled) statusText = 'Уведомления выключены';
    else statusText = 'Уведомления включены';

    root.innerHTML = `
        <div class="sheet show" id="dynamicSheet">
            <div class="sheet-handle"></div>
            <h2 class="app-title" style="font-size:1.3rem;">Браузерные уведомления</h2>
            <p style="color:var(--text-secondary);font-size:0.9rem;text-align:center;margin:6px 0 16px 0;">${statusText}</p>
            <button class="btn-small" id="pushToggleBtn" style="width:100%;margin-bottom:16px;">${enabled ? 'Выключить полностью' : 'Включить в браузере'}</button>
            <p style="font-weight:600;margin:0 0 8px;font-size:0.9rem;">Заглушить на время:</p>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
                <button class="btn-small" data-dur="1h">На 1 час</button>
                <button class="btn-small" data-dur="8h">На 8 часов</button>
                <button class="btn-small" data-dur="24h">На 24 часа</button>
                <button class="btn-small" data-dur="forever" style="background:#ff453a;color:#fff;">Навсегда</button>
            </div>
            <button class="btn-primary" id="pushUnmuteBtn" style="width:100%;">Включить обратно</button>
            <button class="btn-secondary" style="margin-top:8px;" onclick="closeDynamicSheet()">Закрыть</button>
        </div>`;
    document.getElementById('sheetOverlay').classList.add('show');

    root.querySelector('#pushToggleBtn').addEventListener('click', async () => {
        try {
            if (await isPushEnabled()) await disablePush();
            else await enablePush();
            closeDynamicSheet();
            renderPushSettingsCard();
            showToast('Готово', 'success');
        } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
    });

    root.querySelector('#pushUnmuteBtn').addEventListener('click', async () => {
        try { await clearPushMute(); closeDynamicSheet(); renderPushSettingsCard(); showToast('Уведомления включены', 'success'); }
        catch (e) { showToast('Ошибка', 'error'); }
    });

    root.querySelectorAll('button[data-dur]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try { await setPushMute(btn.dataset.dur); closeDynamicSheet(); renderPushSettingsCard(); showToast('Заглушено', 'success'); }
            catch (e) { showToast('Ошибка', 'error'); }
        });
    });
}
