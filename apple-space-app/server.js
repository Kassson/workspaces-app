require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET не задан или короче 32 символов');
    process.exit(1);
}
if (!process.env.ROOT_TEACHER_PASSWORD) {
    console.error('❌ ROOT_TEACHER_PASSWORD не задан в .env');
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/teach', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teach', 'index.html')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET;

// ================= РАСПИСАНИЕ ЗВОНКОВ =================
const LESSON_TIMES = {
    1: { start: '09:00', end: '09:45' },
    2: { start: '10:00', end: '10:45' },
    3: { start: '11:00', end: '11:45' },
    4: { start: '12:00', end: '12:45' },
    5: { start: '13:05', end: '13:50' },
    6: { start: '14:10', end: '14:55' },
    7: { start: '15:05', end: '15:50' },
    8: { start: '15:55', end: '16:40' }
};
const DAY_MAP = {
    'ПОНЕДЕЛЬНИК': 1, 'ПН': 1,
    'ВТОРНИК': 2, 'ВТ': 2,
    'СРЕДА': 3, 'СР': 3,
    'ЧЕТВЕРГ': 4, 'ЧТ': 4,
    'ПЯТНИЦА': 5, 'ПТ': 5,
    'СУББОТА': 6, 'СБ': 6,
    'ВОСКРЕСЕНЬЕ': 7, 'ВС': 7
};

// ПУСТОЙ ШАБЛОН — заполняется пользователем вручную
const DEFAULT_SCHEDULE_TEMPLATE = `День\t№ урока\tПредмет\tКабинет
ПОНЕДЕЛЬНИК\t1\t\t
ПОНЕДЕЛЬНИК\t2\t\t
ПОНЕДЕЛЬНИК\t3\t\t
ПОНЕДЕЛЬНИК\t4\t\t
ПОНЕДЕЛЬНИК\t5\t\t
ПОНЕДЕЛЬНИК\t6\t\t
ПОНЕДЕЛЬНИК\t7\t\t
ПОНЕДЕЛЬНИК\t8\t\t
ВТОРНИК\t1\t\t
ВТОРНИК\t2\t\t
ВТОРНИК\t3\t\t
ВТОРНИК\t4\t\t
ВТОРНИК\t5\t\t
ВТОРНИК\t6\t\t
ВТОРНИК\t7\t\t
ВТОРНИК\t8\t\t
СРЕДА\t1\t\t
СРЕДА\t2\t\t
СРЕДА\t3\t\t
СРЕДА\t4\t\t
СРЕДА\t5\t\t
СРЕДА\t6\t\t
СРЕДА\t7\t\t
СРЕДА\t8\t\t
ЧЕТВЕРГ\t1\t\t
ЧЕТВЕРГ\t2\t\t
ЧЕТВЕРГ\t3\t\t
ЧЕТВЕРГ\t4\t\t
ЧЕТВЕРГ\t5\t\t
ЧЕТВЕРГ\t6\t\t
ЧЕТВЕРГ\t7\t\t
ЧЕТВЕРГ\t8\t\t
ПЯТНИЦА\t1\t\t
ПЯТНИЦА\t2\t\t
ПЯТНИЦА\t3\t\t
ПЯТНИЦА\t4\t\t
ПЯТНИЦА\t5\t\t
ПЯТНИЦА\t6\t\t
ПЯТНИЦА\t7\t\t
ПЯТНИЦА\t8\t\t`;

// ================= ПОЧТА =================
const ALLOWED_DOMAINS = ['gmail.com', 'mail.ru', 'yandex.ru', 'rambler.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'ya.ru', 'outlook.com', 'yahoo.com'];
function isValidEmailDomain(email) {
    if (!email) return false;
    const match = String(email).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
    if (!match) return false;
    return ALLOWED_DOMAINS.includes(match[1].toLowerCase());
}

// ================= ФИЛЬТР ЦЕНЗУРЫ =================
const BANNED_SUBSTRINGS = [
    'admin', 'administrator', 'root', 'moderator', 'support', 'system', 'null', 'undefined',
    'админ', 'администратор', 'модератор', 'рут', 'систем',
    'бля', 'хуй', 'хуе', 'хер', 'пизд', 'ебан', 'еба', 'сук', 'мраз', 'гандон', 'долбоеб', 'долбоёб',
    'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'faggot',
    'гитлер', 'hitler', 'сталин', 'stalin', 'ленин', 'lenin', 'путин', 'putin',
    'зеленский', 'zelensky', 'трамп', 'trump', 'байден', 'biden'
];
function containsBannedWord(text) {
    if (!text) return false;
    const normalized = String(text).toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    return BANNED_SUBSTRINGS.some(bad => normalized.includes(bad));
}
function violatesProfanityFilter(...fields) { return fields.some(f => containsBannedWord(f)); }

function generateCode(len = 4) { let c = ''; for (let i = 0; i < len; i++) c += Math.floor(Math.random() * 10); return c; }
function generateInviteCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

// ================= JWT =================
function verifyJWT(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(403).json({ error: 'Нет доступа' });
    try { req.userId = jwt.verify(token, JWT_SECRET).userId; next(); }
    catch (e) { res.status(403).json({ error: 'Неверный или истёкший токен' }); }
}

async function getUserById(id) { const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]); return r.rows[0] || null; }
function isSuperAdmin(user) { return !!(user && user.is_teacher && user.is_teacher_verified); }
async function isSpaceAdmin(user, spaceId) {
    if (isSuperAdmin(user)) return true;
    const r = await pool.query("SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2 AND role IN ('admin','starosta')", [spaceId, user.id]);
    return r.rows.length > 0;
}
async function isSpaceMember(user, spaceId) {
    if (isSuperAdmin(user)) return true;
    const r = await pool.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, user.id]);
    return r.rows.length > 0;
}
async function isSpaceBlocked(userId, spaceId) {
    const r = await pool.query('SELECT 1 FROM space_blocked WHERE space_id = $1 AND user_id = $2', [spaceId, userId]);
    return r.rows.length > 0;
}

function publicUser(u) {
    if (!u) return null;
    return {
        id: u.id, username: u.username, fullName: u.full_name, email: u.email,
        isTeacher: u.is_teacher, isTeacherVerified: u.is_teacher_verified,
        verificationCode: u.verification_code,
        avatarEmoji: u.avatar_emoji || '👤',
        isRoot: u.username === 'root_teacher'
    };
}

// ================= РЕГИСТРАЦИЯ / ВХОД =================
app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, nickName, email, password } = req.body;
    if (!firstName || !lastName || !nickName || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(email)) return res.status(400).json({ error: 'Введите реальный адрес почты (gmail.com, mail.ru, yandex.ru и др.)' });
    if (violatesProfanityFilter(firstName, lastName, nickName)) return res.status(400).json({ error: 'Имя или логин содержит запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified) VALUES ($1, $2, $3, $4, false, false)',
            [nickName, `${firstName} ${lastName}`, email, hash]
        );
        res.json({ message: 'Успех' });
    } catch (err) { res.status(400).json({ error: 'Почта или логин уже заняты' }); }
});

app.post('/api/teach/register', async (req, res) => {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(email)) return res.status(400).json({ error: 'Введите реальный адрес почты' });
    if (violatesProfanityFilter(fullName)) return res.status(400).json({ error: 'ФИО содержит запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const code = 'T-' + generateCode(4);
        const username = email.split('@')[0] + '_' + generateCode(3);
        await pool.query(
            'INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code) VALUES ($1, $2, $3, $4, true, false, $5)',
            [username, fullName, email, hash, code]
        );
        res.json({ code });
    } catch (err) { res.status(400).json({ error: 'Email уже используется' }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { login, password, isTeacher } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userRes.rows.length) return res.status(400).json({ error: 'Пользователь не найден' });
        const user = userRes.rows[0];
        if (isTeacher && !user.is_teacher) return res.status(403).json({ error: 'Это аккаунт студента' });
        if (!isTeacher && user.is_teacher) return res.status(403).json({ error: 'Это аккаунт преподавателя' });
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Неверный пароль' });
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: publicUser(user) });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/auth/me', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user: publicUser(user) });
});

// ================= РЕДАКТИРОВАНИЕ ПРОФИЛЯ =================
app.post('/api/auth/update-profile', verifyJWT, async (req, res) => {
    const { firstName, lastName, nickname, avatarEmoji } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'Имя и фамилия обязательны' });
    if (violatesProfanityFilter(firstName, lastName, nickname)) return res.status(400).json({ error: 'Имя или ник содержит запрещённые слова' });
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const newNickname = user.is_teacher ? user.username : (nickname || user.username);
    try {
        await pool.query(
            'UPDATE users SET full_name = $1, username = $2, avatar_emoji = $3 WHERE id = $4',
            [`${firstName} ${lastName}`, newNickname, avatarEmoji || '👤', user.id]
        );
        const updated = await getUserById(user.id);
        res.json({ success: true, user: publicUser(updated) });
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Такой логин уже занят' });
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

// ================= ВЕРИФИКАЦИЯ ПРЕПОДАВАТЕЛЕЙ =================
app.post('/api/teach/verify-colleague', verifyJWT, async (req, res) => {
    const verifier = await getUserById(req.userId);
    if (!isSuperAdmin(verifier)) return res.status(403).json({ error: 'Только подтверждённые преподаватели могут верифицировать коллег' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });
    const target = await pool.query('SELECT * FROM users WHERE verification_code = $1 AND is_teacher = true', [code.trim().toUpperCase()]);
    if (!target.rows.length) return res.status(400).json({ error: 'Код не найден' });
    if (target.rows[0].is_teacher_verified) return res.status(400).json({ error: 'Этот преподаватель уже подтверждён' });
    await pool.query('UPDATE users SET is_teacher_verified = true, verified_by = $1 WHERE id = $2', [verifier.id, target.rows[0].id]);
    res.json({ message: `Преподаватель ${target.rows[0].full_name} подтверждён!` });
});

// ================= ГЛОБАЛЬНЫЕ НАСТРОЙКИ =================
app.get('/api/settings', async (req, res) => {
    const r = await pool.query('SELECT * FROM system_settings WHERE id = 1');
    res.json(r.rows[0] || {});
});
app.post('/api/settings/update', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user || user.username !== 'root_teacher') return res.status(403).json({ error: 'Только Root Teacher может менять глобальные настройки' });
    const { remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement } = req.body;
    const r = await pool.query(
        `UPDATE system_settings SET remote_mode=$1, maintenance_mode=$2, exams_mode=$3, private_chat_mode=$4, global_announcement=$5 WHERE id = 1 RETURNING *`,
        [!!remote_mode, !!maintenance_mode, !!exams_mode, !!private_chat_mode, global_announcement || '']
    );
    io.emit('settings_updated', r.rows[0]);
    res.json(r.rows[0]);
});

// ================= ПРОСТРАНСТВА =================
app.post('/api/spaces', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Создавать пространства могут только подтверждённые преподаватели' });
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название группы' });
    let inviteCode;
    for (let i = 0; i < 5; i++) {
        inviteCode = generateInviteCode();
        const exists = await pool.query('SELECT 1 FROM spaces WHERE invite_code = $1', [inviteCode]);
        if (!exists.rows.length) break;
    }
    const r = await pool.query('INSERT INTO spaces (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *', [name.trim(), inviteCode, user.id]);
    await pool.query("INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'admin')", [r.rows[0].id, user.id]);
    res.json(r.rows[0]);
});

app.post('/api/spaces/join', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код приглашения' });
    const space = await pool.query('SELECT * FROM spaces WHERE invite_code = $1', [code.trim().toUpperCase()]);
    if (!space.rows.length) return res.status(404).json({ error: 'Группа с таким кодом не найдена' });

    if (await isSpaceBlocked(user.id, space.rows[0].id)) {
        return res.status(403).json({ error: 'Вы заблокированы в этой группе. Обратитесь к администратору.' });
    }

    await pool.query(
        `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (space_id, user_id) DO NOTHING`,
        [space.rows[0].id, user.id]
    );
    res.json(space.rows[0]);
});

app.get('/api/spaces/mine', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (isSuperAdmin(user)) {
        const r = await pool.query('SELECT *, true AS is_admin FROM spaces ORDER BY created_at DESC');
        return res.json(r.rows);
    }
    const r = await pool.query(
        `SELECT s.*, (sm.role = 'admin' OR sm.role = 'starosta') AS is_admin FROM spaces s
         JOIN space_members sm ON sm.space_id = s.id WHERE sm.user_id = $1 ORDER BY s.created_at DESC`,
        [user.id]
    );
    res.json(r.rows);
});

// Смена кода приглашения
app.post('/api/spaces/:spaceId/rotate-invite-code', verifyJWT, requireSpaceAdmin, async (req, res) => {
    let newCode;
    for (let i = 0; i < 5; i++) {
        newCode = generateInviteCode();
        const exists = await pool.query('SELECT 1 FROM spaces WHERE invite_code = $1', [newCode]);
        if (!exists.rows.length) break;
    }
    await pool.query('UPDATE spaces SET invite_code = $1 WHERE id = $2', [newCode, req.params.spaceId]);
    res.json({ success: true, inviteCode: newCode });
});

// ================= УПРАВЛЕНИЕ УЧАСТНИКАМИ =================
app.get('/api/spaces/:spaceId/members', verifyJWT, requireSpaceAccess, async (req, res) => {
    const r = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.is_teacher, u.avatar_emoji, sm.role, sm.joined_at, sm.muted_until
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.space_id = $1
         ORDER BY CASE sm.role WHEN 'admin' THEN 0 WHEN 'starosta' THEN 1 ELSE 2 END, u.full_name`,
        [req.params.spaceId]
    );
    res.json(r.rows);
});

// Сменить роль
app.post('/api/spaces/:spaceId/members/:userId/role', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Роль должна быть admin или member' });
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });
    const r = await pool.query(
        'UPDATE space_members SET role = $1 WHERE space_id = $2 AND user_id = $3 RETURNING *',
        [role, req.params.spaceId, req.params.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Участник не найден' });
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json(r.rows[0]);
});

// Кикнуть (может вернуться)
app.delete('/api/spaces/:spaceId/members/:userId', verifyJWT, requireSpaceAdmin, async (req, res) => {
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя исключить себя' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ message: 'Участник исключён' });
});

// Мут
app.post('/api/spaces/:spaceId/members/:userId/mute', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { minutes } = req.body;
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя замутить себя' });
    const until = minutes > 0 ? new Date(Date.now() + minutes * 60000) : null;
    await pool.query('UPDATE space_members SET muted_until = $1 WHERE space_id = $2 AND user_id = $3', [until, req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true, mutedUntil: until });
});

// Размутить
app.delete('/api/spaces/:spaceId/members/:userId/mute', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('UPDATE space_members SET muted_until = NULL WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

// Забанить
app.post('/api/spaces/:spaceId/members/:userId/block', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { reason } = req.body;
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя забанить себя' });

    const target = await pool.query('SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Участник не найден' });
    if (target.rows[0].role === 'admin' && !req.currentUser.is_teacher) {
        return res.status(403).json({ error: 'Только преподаватель может забанить админа' });
    }

    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    await pool.query(
        'INSERT INTO space_blocked (space_id, user_id, blocked_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (space_id, user_id) DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, blocked_at = NOW()',
        [req.params.spaceId, req.params.userId, req.currentUser.id, reason || null]
    );
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

// Разбанить
app.delete('/api/spaces/:spaceId/blocked/:userId', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM space_blocked WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

// Черный список
app.get('/api/spaces/:spaceId/blacklist', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const blocked = await pool.query(
        `SELECT u.id, u.full_name, u.username, u.avatar_emoji, sb.reason, sb.blocked_at, 'blocked' AS type
         FROM space_blocked sb JOIN users u ON u.id = sb.user_id
         WHERE sb.space_id = $1 ORDER BY sb.blocked_at DESC`,
        [req.params.spaceId]
    );
    const muted = await pool.query(
        `SELECT u.id, u.full_name, u.username, u.avatar_emoji, sm.muted_until, 'muted' AS type
         FROM space_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.space_id = $1 AND sm.muted_until IS NOT NULL AND sm.muted_until > NOW()
         ORDER BY sm.muted_until DESC`,
        [req.params.spaceId]
    );
    res.json({ blocked: blocked.rows, muted: muted.rows });
});

// ================= ДОСТУП =================
async function requireSpaceAccess(req, res, next) {
    const user = await getUserById(req.userId);
    req.currentUser = user;
    const spaceId = req.params.spaceId || req.body.spaceId;
    if (!(await isSpaceMember(user, spaceId))) return res.status(403).json({ error: 'Нет доступа к этому пространству' });
    next();
}
async function requireSpaceAdmin(req, res, next) {
    const user = await getUserById(req.userId);
    req.currentUser = user;
    const spaceId = req.params.spaceId || req.body.spaceId;
    if (!(await isSpaceAdmin(user, spaceId))) return res.status(403).json({ error: 'Только преподаватель или админ может это делать' });
    next();
}

// ================= РАСПИСАНИЕ =================
app.get('/api/schedule/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = await pool.query('SELECT * FROM schedules WHERE space_id = $1 ORDER BY day_of_week, start_time', [req.params.spaceId]);
    const overrides = await pool.query(
        `SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE - INTERVAL '1 day' AND override_date <= CURRENT_DATE + INTERVAL '13 days'`,
        [req.params.spaceId]
    );
    res.json({ lessons: lessons.rows, overrides: overrides.rows });
});

app.post('/api/schedule', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { id, spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime } = req.body;
    if (!spaceId || !dayOfWeek || !subjectName || !startTime || !endTime) return res.status(400).json({ error: 'Заполните обязательные поля' });
    if (id) {
        const r = await pool.query(
            `UPDATE schedules SET subject_name=$1, classroom=$2, teacher_name=$3, start_time=$4, end_time=$5, day_of_week=$6 WHERE id = $7 AND space_id = $8 RETURNING *`,
            [subjectName, classroom, teacherName, startTime, endTime, dayOfWeek, id, spaceId]
        );
        return res.json(r.rows[0]);
    }
    const r = await pool.query(
        `INSERT INTO schedules (space_id, day_of_week, subject_name, classroom, teacher_name, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime]
    );
    res.json(r.rows[0]);
});

app.delete('/api/schedule/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const lesson = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (!lesson.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, lesson.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
    res.json({ message: 'Удалено' });
});

// ===== ИМПОРТ РАСПИСАНИЯ =====
app.post('/api/schedule/import', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, text, replaceAll } = req.body;
    if (!spaceId) return res.status(400).json({ error: 'Не указано пространство' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Вставьте текст расписания' });

    const lessons = [];
    const errors = [];
    const skipped = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        if (/^день\s/i.test(raw) || /№\s*урока/i.test(raw)) continue;
        const parts = raw.split(/\t+|\s{2,}/).map(p => p.trim()).filter(Boolean);
        if (parts.length < 3) { errors.push(`Строка ${i + 1}: не удалось разобрать — «${raw.slice(0, 40)}…»`); continue; }
        const dayOfWeek = DAY_MAP[parts[0].toUpperCase()];
        if (!dayOfWeek) { errors.push(`Строка ${i + 1}: неизвестный день «${parts[0]}»`); continue; }
        const lessonNum = parseInt(parts[1], 10);
        if (!lessonNum || !LESSON_TIMES[lessonNum]) { errors.push(`Строка ${i + 1}: неверный номер урока «${parts[1]}»`); continue; }
        const subjectName = parts[2];
        if (!subjectName) { skipped.push(`Строка ${i + 1}: ${parts[0]}, урок ${lessonNum} — пропущено (пустой предмет)`); continue; }
        lessons.push({ dayOfWeek, subjectName, classroom: parts[3] || null, startTime: LESSON_TIMES[lessonNum].start, endTime: LESSON_TIMES[lessonNum].end });
    }

    if (!lessons.length) return res.status(400).json({ error: 'Ни одной строки не удалось разобрать', details: errors.slice(0, 10), skipped: skipped.slice(0, 10) });

    try {
        if (replaceAll) await pool.query('DELETE FROM schedules WHERE space_id = $1', [spaceId]);
        const values = [], params = [];
        let p = 1;
        for (const l of lessons) {
            values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
            params.push(spaceId, l.dayOfWeek, l.subjectName, l.classroom, null, l.startTime, l.endTime);
        }
        await pool.query(`INSERT INTO schedules (space_id, day_of_week, subject_name, classroom, teacher_name, start_time, end_time) VALUES ${values.join(', ')}`, params);
        io.to(`space:${spaceId}`).emit('schedule_updated');
        res.json({ success: true, imported: lessons.length, errors: errors.slice(0, 10), skipped: skipped.slice(0, 10) });
    } catch (e) {
        console.error('Ошибка импорта:', e);
        res.status(500).json({ error: 'Ошибка сохранения: ' + e.message });
    }
});

// ===== ЭКСПОРТ РАСПИСАНИЯ =====
app.get('/api/schedule/:spaceId/export', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = (await pool.query('SELECT * FROM schedules WHERE space_id = $1 ORDER BY day_of_week, start_time', [req.params.spaceId])).rows;
    const DAY_NAMES = ['', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];

    let text;
    if (!lessons.length) {
        text = DEFAULT_SCHEDULE_TEMPLATE;
    } else {
        text = 'День\t№ урока\tПредмет\tКабинет\n';
        for (const l of lessons) {
            const num = Object.keys(LESSON_TIMES).find(k => LESSON_TIMES[k].start === l.start_time.slice(0, 5));
            text += `${DAY_NAMES[l.day_of_week]}\t${num || '?'}\t${l.subject_name}\t${l.classroom || ''}\n`;
        }
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="schedule.txt"');
    res.send(text);
});

// ===== ЗАМЕНЫ/ОТМЕНЫ =====
app.post('/api/schedule/override', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, scheduleId, date, isCanceled, replacementSubject, replacementClassroom, replacementTeacher } = req.body;
    if (!scheduleId || !date) return res.status(400).json({ error: 'Не указан урок или дата' });
    const r = await pool.query(
        `INSERT INTO schedule_overrides (space_id, schedule_id, override_date, is_canceled, replacement_subject, replacement_classroom, replacement_teacher)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (schedule_id, override_date) DO UPDATE SET
            is_canceled = EXCLUDED.is_canceled,
            replacement_subject = EXCLUDED.replacement_subject,
            replacement_classroom = EXCLUDED.replacement_classroom,
            replacement_teacher = EXCLUDED.replacement_teacher
         RETURNING *`,
        [spaceId, scheduleId, date, !!isCanceled, replacementSubject || null, replacementClassroom || null, replacementTeacher || null]
    );
    io.to(`space:${spaceId}`).emit('schedule_updated');
    res.json(r.rows[0]);
});

app.delete('/api/schedule/override/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const ov = await pool.query('SELECT * FROM schedule_overrides WHERE id = $1', [req.params.id]);
    if (!ov.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, ov.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM schedule_overrides WHERE id = $1', [req.params.id]);
    res.json({ message: 'Удалено' });
});

// ICS
app.get('/api/schedule/:spaceId/ics', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = (await pool.query('SELECT * FROM schedules WHERE space_id = $1', [req.params.spaceId])).rows;
    const overrides = (await pool.query(`SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE`, [req.params.spaceId])).rows;
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Workspaces//RU\r\nCALSCALE:GREGORIAN\r\n';
    const toICSDate = (d, t) => `${d.replace(/-/g, '')}T${t.replace(/:/g, '').slice(0, 6)}`;
    for (let offset = 0; offset < 14; offset++) {
        const day = new Date();
        day.setDate(day.getDate() + offset);
        const dow = day.getDay() === 0 ? 7 : day.getDay();
        const dateStr = day.toISOString().slice(0, 10);
        const dayLessons = lessons.filter(l => l.day_of_week === dow);
        for (const lesson of dayLessons) {
            const ov = overrides.find(o => o.schedule_id === lesson.id && o.override_date.toISOString().slice(0, 10) === dateStr);
            if (ov && ov.is_canceled) continue;
            const subject = ov && ov.replacement_subject ? ov.replacement_subject : lesson.subject_name;
            const room = ov && ov.replacement_classroom ? ov.replacement_classroom : lesson.classroom;
            ics += 'BEGIN:VEVENT\r\n';
            ics += `UID:${lesson.id}-${dateStr}@workspaces\r\n`;
            ics += `DTSTART:${toICSDate(dateStr, lesson.start_time)}\r\n`;
            ics += `DTEND:${toICSDate(dateStr, lesson.end_time)}\r\n`;
            ics += `SUMMARY:${subject}${room ? ' (' + room + ')' : ''}\r\n`;
            ics += 'END:VEVENT\r\n';
        }
    }
    ics += 'END:VCALENDAR\r\n';
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="schedule.ics"');
    res.send(ics);
});

// ================= ДОМАШНИЕ ЗАДАНИЯ =================
app.get('/api/homework/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const hw = await pool.query(
        `SELECT h.*, hc.attachment_url, hc.completed_at, (hc.id IS NOT NULL) AS is_done
         FROM homeworks h
         LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.user_id = $2
         WHERE h.space_id = $1 ORDER BY h.due_date ASC`,
        [req.params.spaceId, req.currentUser.id]
    );
    res.json(hw.rows);
});

// Статистика по ДЗ
app.get('/api/homework/:id/stats', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    const spaceId = hw.rows[0].space_id;
    if (!(await isSpaceMember(user, spaceId))) return res.status(403).json({ error: 'Нет доступа' });

    const total = await pool.query('SELECT COUNT(*)::int AS c FROM space_members WHERE space_id = $1', [spaceId]);
    const completed = await pool.query('SELECT COUNT(*)::int AS c FROM homework_completions WHERE homework_id = $1', [req.params.id]);
    const percentage = total.rows[0].c > 0 ? Math.round((completed.rows[0].c / total.rows[0].c) * 100) : 0;

    const isAdmin = await isSpaceAdmin(user, spaceId);
    let students = [];
    if (isAdmin) {
        const r = await pool.query(
            `SELECT u.full_name, u.username, u.avatar_emoji, hc.completed_at
             FROM homework_completions hc JOIN users u ON u.id = hc.user_id
             WHERE hc.homework_id = $1 ORDER BY hc.completed_at DESC`,
            [req.params.id]
        );
        students = r.rows;
    }
    res.json({ percentage, completed: completed.rows[0].c, total: total.rows[0].c, students, canSeeStudents: isAdmin });
});

app.post('/api/homework', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, subjectName, title, dueDate } = req.body;
    if (!subjectName || !title || !dueDate) return res.status(400).json({ error: 'Заполните все поля' });
    const r = await pool.query('INSERT INTO homeworks (space_id, subject_name, title, due_date) VALUES ($1,$2,$3,$4) RETURNING *', [spaceId, subjectName, title, dueDate]);
    res.json(r.rows[0]);
});

app.delete('/api/homework/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, hw.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM homeworks WHERE id = $1', [req.params.id]);
    res.json({ message: 'Удалено' });
});

app.post('/api/homework/:id/complete', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const { attachment } = req.body;
    const r = await pool.query(
        `INSERT INTO homework_completions (homework_id, user_id, attachment_url) VALUES ($1,$2,$3)
         ON CONFLICT (homework_id, user_id) DO UPDATE SET attachment_url = EXCLUDED.attachment_url, completed_at = NOW() RETURNING *`,
        [req.params.id, user.id, attachment || null]
    );
    res.json(r.rows[0]);
});

app.delete('/api/homework/:id/complete', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    await pool.query('DELETE FROM homework_completions WHERE homework_id = $1 AND user_id = $2', [req.params.id, user.id]);
    res.json({ message: 'Отметка снята' });
});

app.get('/api/homework/:id/completions', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, hw.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    const r = await pool.query(
        `SELECT hc.*, u.full_name, u.username FROM homework_completions hc JOIN users u ON u.id = hc.user_id WHERE hc.homework_id = $1 ORDER BY hc.completed_at DESC`,
        [req.params.id]
    );
    res.json(r.rows);
});

// ================= ЧАТ =================
app.get('/api/chat/:spaceId/messages', verifyJWT, requireSpaceAccess, async (req, res) => {
    const r = await pool.query(
        `SELECT cm.*, u.full_name, u.username, u.is_teacher, u.avatar_emoji FROM chat_messages cm
         JOIN users u ON u.id = cm.user_id WHERE cm.space_id = $1 ORDER BY cm.created_at DESC LIMIT 50`,
        [req.params.spaceId]
    );
    res.json(r.rows.reverse());
});

io.on('connection', (socket) => {
    socket.on('join_space', async ({ spaceId, token }) => {
        try {
            const { userId } = jwt.verify(token, JWT_SECRET);
            const user = await getUserById(userId);
            if (!user || !(await isSpaceMember(user, spaceId))) return;
            socket.userId = user.id;
            socket.spaceId = spaceId;
            socket.join(`space:${spaceId}`);
        } catch (e) {}
    });

    socket.on('send_message', async ({ message }) => {
        if (!socket.userId || !socket.spaceId || !message || !message.trim()) return;
        const user = await getUserById(socket.userId);
        const settings = (await pool.query('SELECT * FROM system_settings WHERE id = 1')).rows[0];
        if (settings.exams_mode && !user.is_teacher) return;
        const member = await pool.query('SELECT * FROM space_members WHERE space_id = $1 AND user_id = $2', [socket.spaceId, user.id]);
        if (member.rows[0]?.muted_until && new Date(member.rows[0].muted_until) > new Date()) return;
        const text = String(message).slice(0, 2000);
        const r = await pool.query('INSERT INTO chat_messages (space_id, user_id, message) VALUES ($1,$2,$3) RETURNING *', [socket.spaceId, user.id, text]);
        io.to(`space:${socket.spaceId}`).emit('new_message', { ...r.rows[0], full_name: user.full_name, username: user.username, is_teacher: user.is_teacher, avatar_emoji: user.avatar_emoji });
    });

    socket.on('delete_message', async ({ messageId }) => {
        if (!socket.userId || !socket.spaceId) return;
        const user = await getUserById(socket.userId);
        if (!(await isSpaceAdmin(user, socket.spaceId))) return;
        await pool.query('DELETE FROM chat_messages WHERE id = $1 AND space_id = $2', [messageId, socket.spaceId]);
        io.to(`space:${socket.spaceId}`).emit('message_deleted', { messageId });
    });

    socket.on('mute_user', async ({ userId, minutes }) => {
        if (!socket.userId || !socket.spaceId) return;
        const admin = await getUserById(socket.userId);
        if (!(await isSpaceAdmin(admin, socket.spaceId))) return;
        const until = new Date(Date.now() + (minutes || 10) * 60000);
        await pool.query('UPDATE space_members SET muted_until = $1 WHERE space_id = $2 AND user_id = $3', [until, socket.spaceId, userId]);
        io.to(`space:${socket.spaceId}`).emit('user_muted', { userId, until });
    });
});

// ================= ИГРЫ =================
const VALID_GAMES = ['2048', 'cyber-runner', 'brawl-royale', 'snake-arena', 'battle-tanks', 'cyber-arena'];
app.get('/api/games/:spaceId/:gameId/leaderboard', verifyJWT, requireSpaceAccess, async (req, res) => {
    const r = await pool.query(
        `SELECT gs.score, gs.updated_at, u.full_name, u.username FROM game_scores gs JOIN users u ON u.id = gs.user_id WHERE gs.space_id = $1 AND gs.game_id = $2 ORDER BY gs.score DESC LIMIT 20`,
        [req.params.spaceId, req.params.gameId]
    );
    res.json(r.rows);
});
app.post('/api/games/:spaceId/:gameId/score', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { score } = req.body;
    if (!VALID_GAMES.includes(req.params.gameId)) return res.status(400).json({ error: 'Неизвестная игра' });
    if (typeof score !== 'number' || score < 0) return res.status(400).json({ error: 'Некорректный счёт' });
    await pool.query(
        `INSERT INTO game_scores (space_id, user_id, game_id, score) VALUES ($1,$2,$3,$4) ON CONFLICT (space_id, user_id, game_id) DO UPDATE SET score = GREATEST(game_scores.score, EXCLUDED.score), updated_at = NOW()`,
        [req.params.spaceId, req.currentUser.id, req.params.gameId, Math.floor(score)]
    );
    res.json({ message: 'Сохранено' });
});
app.post('/api/games/:spaceId/:gameId/reset', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM game_scores WHERE space_id = $1 AND game_id = $2', [req.params.spaceId, req.params.gameId]);
    res.json({ message: 'Рекорды сброшены' });
});

// ================= СЛУЖЕБНЫЕ =================
app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));
async function cleanupOldMessages() {
    try { const r = await pool.query("DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'"); if (r.rowCount) console.log(`🧹 Удалено старых сообщений: ${r.rowCount}`); }
    catch (e) { console.error('Очистка чата:', e.message); }
}
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

async function ensureSchema() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
}
async function ensureRootTeacher() {
    const existing = await pool.query("SELECT * FROM users WHERE username = 'root_teacher'");
    if (existing.rows.length) return;
    const hash = await bcrypt.hash(process.env.ROOT_TEACHER_PASSWORD, 12);
    await pool.query(
        `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code) VALUES ('root_teacher', 'Главный Администратор Колледжа', $1, $2, true, true, 'ROOT')`,
        [process.env.ROOT_TEACHER_EMAIL || 'root@college.local', hash]
    );
    console.log('👑 Аккаунт root_teacher создан. Логин: root_teacher');
}

const PORT = process.env.PORT || 3000;
(async () => {
    try { await ensureSchema(); await ensureRootTeacher(); await cleanupOldMessages(); }
    catch (e) { console.error('Ошибка инициализации БД:', e.message); }
    server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
})();
