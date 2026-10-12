// ============================================================================
//  dev-api-test.js — сквозная проверка HTTP/Socket API на поддельной БД.
//  Запуск: node dev-api-test.js
// ============================================================================
process.env.PORT = process.env.PORT || '3111';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock/mock';

const path = require('path');
const Module = require('module');

// --- Подменяем драйвер pg ДО загрузки server.js ---
const mockPg = require('./dev-mock-pg');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'pg') return mockPg;
    return originalRequire.apply(this, arguments);
};

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let failures = 0;
let passes = 0;

function ok(name, condition, extra) {
    if (condition) { passes++; console.log(`  ✅ ${name}`); }
    else { failures++; console.log(`  ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

async function api(method, url, { token, body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    const text = await res.text();
    if (raw) return { status: res.status, text, headers: res.headers };
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = { _raw: text }; }
    return { status: res.status, json, text };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('▶ Запуск сервера на поддельной БД…');
    require(path.join(__dirname, 'server.js'));

    // Ждём, пока сервер поднимется
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(BASE + '/api/ping');
            if (r.ok) break;
        } catch (e) { /* ещё не поднялся */ }
        await sleep(250);
    }

    const { db } = mockPg;
    const bcrypt = require('bcryptjs');

    console.log('\n=== 1. Регистрация и вход ===');
    let r = await api('POST', '/api/auth/register', { body: { firstName: 'Иван', lastName: 'Петров', nickName: 'ivan_p', email: 'ivan@gmail.com', password: 'password123' } });
    ok('регистрация ученика', r.status === 200, r.json);

    r = await api('POST', '/api/auth/login', { body: { login: 'ivan_p', password: 'password123', isTeacher: false } });
    ok('вход ученика', r.status === 200 && r.json.token, r.json);
    const studentToken = r.json.token;
    const studentId = r.json.user.id;

    // Второй ученик
    await api('POST', '/api/auth/register', { body: { firstName: 'Пётр', lastName: 'Сидоров', nickName: 'petr_s', email: 'petr@gmail.com', password: 'password123' } });
    r = await api('POST', '/api/auth/login', { body: { login: 'petr_s', password: 'password123' } });
    const student2Token = r.json.token;
    const student2Id = r.json.user.id;

    // Учитель (root)
    const rootHash = await bcrypt.hash('RootPass123', 4);
    const rootId = require('crypto').randomUUID();
    db.users.push({
        id: rootId, username: 'root_teacher', full_name: 'Главный Админ', email: 'root@college.local',
        password_hash: rootHash, is_teacher: true, is_teacher_verified: true, verification_code: 'ROOT',
        avatar_emoji: '👑', theme: 'auto', email_verified: true, created_at: new Date()
    });
    r = await api('POST', '/api/auth/login', { body: { login: 'root_teacher', password: 'RootPass123', isTeacher: true } });
    ok('вход root-преподавателя', r.status === 200 && r.json.token, r.json);
    const teacherToken = r.json.token;

    console.log('\n=== 2. Группа и настройки ===');
    r = await api('POST', '/api/spaces', { token: teacherToken, body: { name: 'Группа ИС-21' } });
    ok('создание группы', r.status === 200 && r.json.id, r.json);
    const spaceId = r.json.id;

    r = await api('POST', '/api/spaces/join', { token: studentToken, body: { code: r.json.invite_code } });
    ok('ученик вступил в группу', r.status === 200, r.json);
    const space = (await api('POST', '/api/spaces/join', { token: student2Token, body: { code: (await api('GET', '/api/spaces/mine', { token: teacherToken })).json[0].invite_code } })).json;
    ok('второй ученик вступил в группу', !!space.id, space);

    r = await api('GET', `/api/spaces/${spaceId}/settings`, { token: teacherToken });
    ok('настройки группы читаются', r.status === 200 && r.json.settings, r.json);
    ok('по умолчанию feature_homework включён', r.json.settings.feature_homework === true);
    ok('по умолчанию homework_post_policy=admins', r.json.settings.homework_post_policy === 'admins');

    r = await api('POST', `/api/spaces/${spaceId}/rename`, { token: teacherToken, body: { name: 'ИС-21 (новая)' } });
    ok('переименование группы', r.status === 200 && r.json.name === 'ИС-21 (новая)', r.json);

    r = await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { homework_post_policy: 'all', members_can_chat: false, feature_games: false } });
    ok('обновление настроек группы', r.status === 200 && r.json.homework_post_policy === 'all' && r.json.members_can_chat === false && r.json.feature_games === false, r.json);

    r = await api('POST', `/api/spaces/${spaceId}/settings`, { token: studentToken, body: { homework_post_policy: 'all' } });
    ok('ученик не может менять настройки группы (403)', r.status === 403, r.json);

    r = await api('POST', `/api/spaces/${spaceId}/rename`, { token: studentToken, body: { name: 'Взлом' } });
    ok('ученик не может переименовать группу (403)', r.status === 403, r.json);

    console.log('\n=== 3. Домашние задания и вложения (главный баг) ===');
    // Ученик теперь может добавлять ДЗ (policy=all)
    r = await api('POST', '/api/homework', { token: studentToken, body: { spaceId, subjectName: 'Математика', title: 'Номера 1-10', dueDate: '2030-01-15' } });
    ok('ученик добавляет ДЗ при политике all', r.status === 200 && r.json.id, r.json);
    const hwByStudent = r.json.id;

    // Возвращаем политику к admins
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { homework_post_policy: 'admins' } });
    r = await api('POST', '/api/homework', { token: studentToken, body: { spaceId, subjectName: 'Физика', title: 'Параграф 3', dueDate: '2030-01-16' } });
    ok('ученик НЕ может добавлять ДЗ при политике admins (403)', r.status === 403, r.json);

    // Учитель создаёт ДЗ с файлом
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'task.png');
    fd.append('spaceId', spaceId);
    r = await api('POST', '/api/files/upload', { token: teacherToken, body: fd });
    ok('загрузка файла возвращает id и key', r.status === 200 && r.json.id && r.json.key, r.json);
    const taskFileId = r.json.id;
    const taskFileKey = r.json.key;

    r = await api('POST', '/api/homework', { token: teacherToken, body: { spaceId, subjectName: 'Математика', title: 'С фото задания', dueDate: '2030-02-01', fileIds: [taskFileId] } });
    ok('ДЗ с вложением создано', r.status === 200 && r.json.id, r.json);
    const hwId = r.json.id;
    ok('ответ содержит ссылку на фото задания', Array.isArray(r.json.taskAttachmentUrls) && r.json.taskAttachmentUrls.length === 1, r.json.taskAttachmentUrls);
    ok('в БД сохранён КЛЮЧ, а не ссылка', Array.isArray(r.json.attachment_keys) && r.json.attachment_keys[0] === taskFileKey, r.json.attachment_keys);

    // Ключевой тест: ссылки переживают «истечение» (выдаются заново при чтении)
    r = await api('GET', `/api/homework/${spaceId}`, { token: studentToken });
    ok('список ДЗ читается учеником', r.status === 200 && Array.isArray(r.json), r.json);
    const hwRow = r.json.find(h => h.id === hwId);
    ok('фото задания приходит в списке', !!hwRow && Array.isArray(hwRow.taskAttachmentUrls) && hwRow.taskAttachmentUrls.length === 1, hwRow && hwRow.taskAttachmentUrls);
    const firstUrl = hwRow && hwRow.taskAttachmentUrls[0];
    ok('ссылка ведёт на раздачу локальных файлов', typeof firstUrl === 'string' && firstUrl.startsWith('/api/local-files/'), firstUrl);

    // Ссылка реально отдаётся сервером
    if (firstUrl) {
        const fileRes = await fetch(BASE + firstUrl);
        ok('файл отдаётся по ссылке (200)', fileRes.status === 200, fileRes.status);
        const bytes = Buffer.from(await fileRes.arrayBuffer());
        ok('содержимое файла не пустое', bytes.length > 0, bytes.length);
    }

    // Ученик сдаёт ДЗ с фото
    const fd2 = new FormData();
    fd2.append('file', new Blob([png], { type: 'image/png' }), 'my_homework.png');
    fd2.append('spaceId', spaceId);
    r = await api('POST', '/api/files/upload', { token: studentToken, body: fd2 });
    ok('ученик загрузил фото сдачи', r.status === 200 && r.json.id, r.json);
    const submissionFileId = r.json.id;

    r = await api('POST', `/api/homework/${hwId}/complete`, { token: studentToken, body: { fileIds: [submissionFileId] } });
    ok('сдача ДЗ принята', r.status === 200 && Array.isArray(r.json.attachmentUrls) && r.json.attachmentUrls.length === 1, r.json);
    ok('сдача вернула рабочую ссылку', typeof r.json.attachmentUrls[0] === 'string' && r.json.attachmentUrls[0].length > 0, r.json.attachmentUrls);
    ok('сдача хранит ключи', Array.isArray(r.json.attachment_keys) && r.json.attachment_keys.length === 1, r.json.attachment_keys);

    // Повторное чтение списка: сдача видна и ссылка свежая
    r = await api('GET', `/api/homework/${spaceId}`, { token: studentToken });
    const hwAfter = r.json.find(h => h.id === hwId);
    ok('ДЗ помечено как сданное', hwAfter && hwAfter.is_done === true, hwAfter && hwAfter.is_done);
    ok('фото сдачи доступно в списке', hwAfter && hwAfter.attachment_urls && hwAfter.attachment_urls.length === 1, hwAfter && hwAfter.attachment_urls);
    ok('фото задания всё ещё доступно', hwAfter && hwAfter.taskAttachmentUrls && hwAfter.taskAttachmentUrls.length === 1, hwAfter && hwAfter.taskAttachmentUrls);

    console.log('\n=== 4. Статистика ДЗ ===');
    r = await api('GET', `/api/homework/${hwId}/stats`, { token: teacherToken });
    ok('статистика доступна учителю', r.status === 200 && typeof r.json.percentage === 'number', r.json);
    ok('процент посчитан (1 из 2 = 50%)', r.json.percentage === 50, { pct: r.json.percentage, done: r.json.completed, total: r.json.total });
    const st = r.json.students.find(s => s.id === studentId);
    ok('у сдавшего ученика есть ссылка на фото', st && Array.isArray(st.attachmentUrls) && st.attachmentUrls.length === 1, st);

    r = await api('GET', `/api/homework/${hwId}/stats`, { token: studentToken });
    ok('ученику статистика запрещена (403)', r.status === 403, r.json);

    console.log('\n=== 5. Права и безопасность ===');
    r = await api('POST', `/api/spaces/${spaceId}/settings`, { token: studentToken, body: {} });
    ok('настройки группы недоступны ученику', r.status === 403);

    // Загрузка файла в чужую группу
    const otherSpace = (await api('POST', '/api/spaces', { token: teacherToken, body: { name: 'Другая группа' } })).json;
    const fd3 = new FormData();
    fd3.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    fd3.append('spaceId', otherSpace.id);
    r = await api('POST', '/api/files/upload', { token: studentToken, body: fd3 });
    ok('загрузка в чужую группу запрещена (403)', r.status === 403, r.json);

    // Привязка своего файла к чужому сообщению
    const otherMsg = await api('POST', '/api/files/attachments', { token: studentToken, body: { fileIds: [submissionFileId], messageId: 'not-a-uuid' } });
    ok('некорректный messageId отклонён', otherMsg.status === 400, otherMsg.json);

    console.log('\n=== 6. Журнал и оценки ===');
    r = await api('POST', '/api/grades', { token: teacherToken, body: { spaceId, studentName: 'Иван Петров', subjectName: 'Математика', gradeValue: 5, lessonDate: '2030-01-10', studentUserId: studentId } });
    ok('учитель ставит оценку', r.status === 200 && r.json.id, r.json);

    r = await api('POST', '/api/grades', { token: studentToken, body: { spaceId, studentName: 'Иван Петров', subjectName: 'Математика', gradeValue: 2, lessonDate: '2030-01-11' } });
    ok('ученик не может ставить оценки (403)', r.status === 403, r.json);

    console.log('\n=== 7. Журнал: скрытые ученики (был баг req.userId) ===');
    r = await api('POST', `/api/spaces/${spaceId}/members/${studentId}/hide`, { token: teacherToken, body: { hidden: true } });
    ok('скрытие ученика root-учителем', r.status === 200 && r.json.hidden === true, r.json);
    r = await api('POST', `/api/spaces/${spaceId}/members/${studentId}/hide`, { token: teacherToken, body: { hidden: 'false' } });
    ok('строка "false" отклонена (400)', r.status === 400, r.json);
    r = await api('POST', `/api/spaces/${spaceId}/members/${studentId}/hide`, { token: teacherToken, body: { hidden: false } });
    ok('показ ученика обратно', r.status === 200 && r.json.hidden === false, r.json);

    console.log('\n=== 8. Чат: права ===');
    r = await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_chat: true, feature_chat: true } });
    ok('чат включён', r.status === 200);

    console.log('\n=== 9. Удаление ДЗ и заметки ===');
    r = await api('DELETE', `/api/homework/${hwByStudent}`, { token: studentToken });
    ok('автор-ученик удаляет своё ДЗ', r.status === 200, r.json);
    r = await api('DELETE', `/api/homework/${hwId}`, { token: studentToken });
    ok('ученик НЕ может удалить чужое ДЗ (403)', r.status === 403, r.json);
    r = await api('DELETE', `/api/homework/${hwId}`, { token: teacherToken });
    ok('учитель удаляет ДЗ', r.status === 200, r.json);

    console.log('\n=== 10. Настройки группы: реальное применение ===');
    // feature_homework = false → ученик не может сдать ДЗ
    r = await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { feature_homework: false } });
    ok('отключение ДЗ в настройках', r.status === 200 && r.json.feature_homework === false, r.json.feature_homework);
    const hwNoFeature = (await api('POST', '/api/homework', { token: teacherToken, body: { spaceId, subjectName: 'История', title: 'X', dueDate: '2030-03-01' } }));
    ok('создание ДЗ запрещено при feature_homework=false', hwNoFeature.status === 403, hwNoFeature.json);
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { feature_homework: true } });

    // homework_complete_policy = admins → ученик не может отмечать сдачу
    const hw2 = (await api('POST', '/api/homework', { token: teacherToken, body: { spaceId, subjectName: 'История', title: 'Глава 2', dueDate: '2030-03-01' } })).json;
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { homework_complete_policy: 'admins' } });
    r = await api('POST', `/api/homework/${hw2.id}/complete`, { token: studentToken, body: {} });
    ok('ученик не может отметить сдачу при policy=admins (403)', r.status === 403, r.json);
    r = await api('POST', `/api/homework/${hw2.id}/complete`, { token: teacherToken, body: {} });
    ok('преподаватель может отметить сдачу за ученика… (ожидаем 200)', r.status === 200, r.json);
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { homework_complete_policy: 'all' } });

    // feature_chat = false → чат недоступен ученику
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { feature_chat: false } });
    r = await api('GET', `/api/chat/${spaceId}/messages`, { token: studentToken });
    ok('ученик не видит чат при feature_chat=false (403)', r.status === 403, r.json);
    r = await api('GET', `/api/chat/${spaceId}/messages`, { token: teacherToken });
    ok('преподаватель видит чат даже при feature_chat=false', r.status === 200 && Array.isArray(r.json), r.status);
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { feature_chat: true } });

    // members_can_see_members = false → ученик видит только себя
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_see_members: false } });
    r = await api('GET', `/api/spaces/${spaceId}/members`, { token: studentToken });
    ok('ученик видит только себя при скрытом списке', r.status === 200 && r.json.length === 1 && r.json[0].id === studentId, r.json.map(m => m.username));
    r = await api('GET', `/api/spaces/${spaceId}/members`, { token: teacherToken });
    ok('преподаватель видит всех участников', r.status === 200 && r.json.length === 2, r.json.length);
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_see_members: true } });

    // Только переданные поля меняются, остальные не сбрасываются
    const beforeSettings = (await api('GET', `/api/spaces/${spaceId}/settings`, { token: teacherToken })).json.settings;
    const afterPatch = (await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_react: false } })).json;
    ok('частичное обновление не сбрасывает другие настройки',
        afterPatch.members_can_react === false
        && afterPatch.feature_schedule === beforeSettings.feature_schedule
        && afterPatch.homework_post_policy === beforeSettings.homework_post_policy,
        { after: afterPatch.members_can_react, feature_schedule: afterPatch.feature_schedule });
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_react: true } });

    // Сводка по группе
    r = await api('GET', `/api/spaces/${spaceId}/overview`, { token: teacherToken });
    ok('сводка по группе доступна преподавателю', r.status === 200 && r.json.stats && r.json.stats.students === 2, r.json);
    r = await api('GET', `/api/spaces/${spaceId}/overview`, { token: studentToken });
    ok('сводка по группе недоступна ученику (403)', r.status === 403, r.json);

    console.log('\n=== 10.1 Права админов группы (members_can_manage) ===');
    // Делаем первого ученика админом группы
    await api('POST', `/api/spaces/${spaceId}/members/${studentId}/role`, { token: teacherToken, body: { role: 'admin' } });
    const adminToken = (await api('POST', '/api/auth/login', { body: { login: 'ivan_p', password: 'password123' } })).json.token;
    r = await api('POST', `/api/spaces/${spaceId}/members/${student2Id}/mute`, { token: adminToken, body: { minutes: 5 } });
    ok('админ группы может замутить участника (members_can_manage=true)', r.status === 200, r.json);
    await api('DELETE', `/api/spaces/${spaceId}/members/${student2Id}/mute`, { token: adminToken });

    // Запрещаем управление
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_manage: false } });
    r = await api('POST', `/api/spaces/${spaceId}/members/${student2Id}/mute`, { token: adminToken, body: { minutes: 5 } });
    ok('админ группы НЕ может мутить при members_can_manage=false (403)', r.status === 403, r.json);
    r = await api('POST', `/api/spaces/${spaceId}/members/${student2Id}/mute`, { token: teacherToken, body: { minutes: 5 } });
    ok('преподаватель может мутить всегда', r.status === 200, r.json);
    await api('DELETE', `/api/spaces/${spaceId}/members/${student2Id}/mute`, { token: teacherToken });
    await api('POST', `/api/spaces/${spaceId}/settings`, { token: teacherToken, body: { members_can_manage: true } });
    // Возвращаем роль ученику
    await api('POST', `/api/spaces/${spaceId}/members/${studentId}/role`, { token: teacherToken, body: { role: 'member' } });

    // /api/spaces/mine отдаёт настройки
    r = await api('GET', '/api/spaces/mine', { token: studentToken });
    {
        const list = Array.isArray(r.json) ? r.json : [];
        const target = list.find(s => s.id === spaceId);
        ok('/api/spaces/mine возвращает настройки группы',
            !!target && !!target.settings && target.settings.feature_schedule !== undefined,
            { status: r.status, count: list.length, raw: JSON.stringify(r.json).slice(0, 200) });
    }

    console.log('\n=== 11. Сервер не падал ===');
    r = await api('GET', '/api/health', { raw: true });
    ok('health отвечает', r.status === 200, r.status);

    console.log(`\n──────────────\nПройдено: ${passes}, провалено: ${failures}\n`);
    process.exitCode = failures ? 1 : 0;
    // Сервер держит открытые сокеты — закрываем процесс принудительно
    setTimeout(() => process.exit(failures ? 1 : 0), 100);
})().catch(e => {
    console.error('ТЕСТ УПАЛ:', e);
    process.exit(2);
});
