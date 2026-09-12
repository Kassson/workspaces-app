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

const ALLOWED_DOMAINS = ['gmail.com', 'mail.ru', 'yandex.ru', 'rambler.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'ya.ru', 'outlook.com', 'yahoo.com'];
function isValidEmailDomain(email) {
    if (!email) return false;
    const match = String(email).match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
    if (!match) return false;
    return ALLOWED_DOMAINS.includes(match[1].toLowerCase());
}

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

async function requireSpaceAccess(req, res, next) {
    const user = await getUserById(req.userId);
    req.currentUser = user;
    const spaceId = req.params.spaceId || req.body.spaceId;
    if (!(await isSpaceMember(user, spaceId))) return res.status(403).json({ error: 'Нет доступа' });
    next();
}
async function requireSpaceAdmin(req, res, next) {
    const user = await getUserById(req.userId);
    req.currentUser = user;
    const spaceId = req.params.spaceId || req.body.spaceId;
    if (!(await isSpaceAdmin(user, spaceId))) return res.status(403).json({ error: 'Только преподаватель или админ' });
    next();
}

// ================= РЕГИСТРАЦИЯ / ВХОД =================
app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, nickName, email, password } = req.body;
    if (!firstName || !lastName || !nickName || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(email)) return res.status(400).json({ error: 'Введите реальный адрес почты' });
    if (violatesProfanityFilter(firstName, lastName, nickName)) return res.status(400).json({ error: 'Запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified) VALUES ($1, $2, $3, $4, false, false)', [nickName, `${firstName} ${lastName}`, email, hash]);
        res.json({ message: 'Успех' });
    } catch (err) { res.status(400).json({ error: 'Почта или логин уже заняты' }); }
});

app.post('/api/teach/register', async (req, res) => {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(email)) return res.status(400).json({ error: 'Введите реальный адрес почты' });
    if (violatesProfanityFilter(fullName)) return res.status(400).json({ error: 'Запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const code = 'T-' + generateCode(4);
        const username = email.split('@')[0] + '_' + generateCode(3);
        await pool.query('INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code) VALUES ($1, $2, $3, $4, true, false, $5)', [username, fullName, email, hash, code]);
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
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json({ user: publicUser(user) });
});

app.post('/api/auth/update-profile', verifyJWT, async (req, res) => {
    const { firstName, lastName, nickname, avatarEmoji } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'Имя и фамилия обязательны' });
    if (violatesProfanityFilter(firstName, lastName, nickname)) return res.status(400).json({ error: 'Запрещённые слова' });
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    const newNickname = user.is_teacher ? user.username : (nickname || user.username);
    try {
        await pool.query('UPDATE users SET full_name = $1, username = $2, avatar_emoji = $3 WHERE id = $4', [`${firstName} ${lastName}`, newNickname, avatarEmoji || '👤', user.id]);
        const updated = await getUserById(user.id);
        res.json({ success: true, user: publicUser(updated) });
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Логин занят' });
        res.status(500).json({ error: 'Ошибка: ' + e.message });
    }
});

app.post('/api/teach/verify-colleague', verifyJWT, async (req, res) => {
    const verifier = await getUserById(req.userId);
    if (!isSuperAdmin(verifier)) return res.status(403).json({ error: 'Только подтверждённые' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });
    const target = await pool.query('SELECT * FROM users WHERE verification_code = $1 AND is_teacher = true', [code.trim().toUpperCase()]);
    if (!target.rows.length) return res.status(400).json({ error: 'Код не найден' });
    if (target.rows[0].is_teacher_verified) return res.status(400).json({ error: 'Уже подтверждён' });
    await pool.query('UPDATE users SET is_teacher_verified = true, verified_by = $1 WHERE id = $2', [verifier.id, target.rows[0].id]);
    res.json({ message: `Преподаватель ${target.rows[0].full_name} подтверждён!` });
});

app.get('/api/settings', async (req, res) => {
    const r = await pool.query('SELECT * FROM system_settings WHERE id = 1');
    res.json(r.rows[0] || {});
});
app.post('/api/settings/update', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user || user.username !== 'root_teacher') return res.status(403).json({ error: 'Только Root' });
    const { remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement } = req.body;
    const r = await pool.query(`UPDATE system_settings SET remote_mode=$1, maintenance_mode=$2, exams_mode=$3, private_chat_mode=$4, global_announcement=$5 WHERE id = 1 RETURNING *`, [!!remote_mode, !!maintenance_mode, !!exams_mode, !!private_chat_mode, global_announcement || '']);
    io.emit('settings_updated', r.rows[0]);
    res.json(r.rows[0]);
});

// ================= ПРОСТРАНСТВА =================
app.post('/api/spaces', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Только преподаватели' });
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название' });
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
    if (!code) return res.status(400).json({ error: 'Введите код' });
    const space = await pool.query('SELECT * FROM spaces WHERE invite_code = $1', [code.trim().toUpperCase()]);
    if (!space.rows.length) return res.status(404).json({ error: 'Группа не найдена' });
    if (await isSpaceBlocked(user.id, space.rows[0].id)) return res.status(403).json({ error: 'Вы заблокированы' });
    if (!isSuperAdmin(user)) {
        const existing = await pool.query('SELECT space_id FROM space_members WHERE user_id = $1 LIMIT 1', [user.id]);
        if (existing.rows.length && existing.rows[0].space_id !== space.rows[0].id) return res.status(400).json({ error: 'Вы уже в другой группе' });
    }
    await pool.query(`INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (space_id, user_id) DO NOTHING`, [space.rows[0].id, user.id]);
    res.json(space.rows[0]);
});

app.post('/api/spaces/:spaceId/leave', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (isSuperAdmin(user)) return res.status(400).json({ error: 'Преподаватели не могут покинуть' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, user.id]);
    res.json({ success: true });
});

app.get('/api/spaces/mine', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (isSuperAdmin(user)) {
        const r = await pool.query('SELECT *, true AS is_admin FROM spaces ORDER BY created_at DESC');
        return res.json(r.rows);
    }
    const r = await pool.query(`SELECT s.*, (sm.role = 'admin' OR sm.role = 'starosta') AS is_admin FROM spaces s JOIN space_members sm ON sm.space_id = s.id WHERE sm.user_id = $1 ORDER BY s.created_at DESC`, [user.id]);
    res.json(r.rows);
});

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

app.get('/api/spaces/:spaceId/members', verifyJWT, requireSpaceAccess, async (req, res) => {
    const r = await pool.query(`SELECT u.id, u.username, u.full_name, u.is_teacher, u.avatar_emoji, sm.role, sm.joined_at, sm.muted_until FROM space_members sm JOIN users u ON u.id = sm.user_id WHERE sm.space_id = $1 ORDER BY CASE sm.role WHEN 'admin' THEN 0 WHEN 'starosta' THEN 1 ELSE 2 END, u.full_name`, [req.params.spaceId]);
    res.json(r.rows);
});

app.post('/api/spaces/:spaceId/members/:userId/role', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Роль: admin или member' });
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });
    const r = await pool.query('UPDATE space_members SET role = $1 WHERE space_id = $2 AND user_id = $3 RETURNING *', [role, req.params.spaceId, req.params.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Не найден' });
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json(r.rows[0]);
});

app.delete('/api/spaces/:spaceId/members/:userId', verifyJWT, requireSpaceAdmin, async (req, res) => {
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя исключить себя' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ message: 'Исключён' });
});

app.post('/api/spaces/:spaceId/members/:userId/mute', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { minutes } = req.body;
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя замутить себя' });
    const until = minutes > 0 ? new Date(Date.now() + minutes * 60000) : null;
    await pool.query('UPDATE space_members SET muted_until = $1 WHERE space_id = $2 AND user_id = $3', [until, req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true, mutedUntil: until });
});

app.delete('/api/spaces/:spaceId/members/:userId/mute', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('UPDATE space_members SET muted_until = NULL WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

app.post('/api/spaces/:spaceId/members/:userId/block', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { reason } = req.body;
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя забанить себя' });
    const target = await pool.query('SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Не найден' });
    if (target.rows[0].role === 'admin' && !req.currentUser.is_teacher) return res.status(403).json({ error: 'Только преподаватель' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    await pool.query('INSERT INTO space_blocked (space_id, user_id, blocked_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (space_id, user_id) DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, blocked_at = NOW()', [req.params.spaceId, req.params.userId, req.currentUser.id, reason || null]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

app.delete('/api/spaces/:spaceId/blocked/:userId', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM space_blocked WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

app.get('/api/spaces/:spaceId/blacklist', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const blocked = await pool.query(`SELECT u.id, u.full_name, u.username, u.avatar_emoji, sb.reason, sb.blocked_at, 'blocked' AS type FROM space_blocked sb JOIN users u ON u.id = sb.user_id WHERE sb.space_id = $1 ORDER BY sb.blocked_at DESC`, [req.params.spaceId]);
    const muted = await pool.query(`SELECT u.id, u.full_name, u.username, u.avatar_emoji, sm.muted_until, 'muted' AS type FROM space_members sm JOIN users u ON u.id = sm.user_id WHERE sm.space_id = $1 AND sm.muted_until IS NOT NULL AND sm.muted_until > NOW() ORDER BY sm.muted_until DESC`, [req.params.spaceId]);
    res.json({ blocked: blocked.rows, muted: muted.rows });
});

// ================= РАСПИСАНИЕ =================
app.get('/api/schedule/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = await pool.query('SELECT * FROM schedules WHERE space_id = $1 ORDER BY day_of_week, start_time', [req.params.spaceId]);
    const overrides = await pool.query(`SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE - INTERVAL '1 day' AND override_date <= CURRENT_DATE + INTERVAL '13 days'`, [req.params.spaceId]);
    res.json({ lessons: lessons.rows, overrides: overrides.rows });
});

app.post('/api/schedule', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { id, spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime } = req.body;
    if (!spaceId || !dayOfWeek || !subjectName || !startTime || !endTime) return res.status(400).json({ error: 'Заполните поля' });
    if (id) {
        const r = await pool.query(`UPDATE schedules SET subject_name=$1, classroom=$2, teacher_name=$3, start_time=$4, end_time=$5, day_of_week=$6 WHERE id = $7 AND space_id = $8 RETURNING *`, [subjectName, classroom, teacherName, startTime, endTime, dayOfWeek, id, spaceId]);
        return res.json(r.rows[0]);
    }
    const r = await pool.query(`INSERT INTO schedules (space_id, day_of_week, subject_name, classroom, teacher_name, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime]);
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

app.post('/api/schedule/import', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, text, replaceAll } = req.body;
    if (!spaceId) return res.status(400).json({ error: 'Не указано пространство' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Вставьте текст' });
    const lessons = [], errors = [], skipped = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;
        if (/^день\s/i.test(raw) || /№\s*урока/i.test(raw)) continue;
        const parts = raw.split(/\t+|\s{2,}/).map(p => p.trim()).filter(Boolean);
        if (parts.length < 3) { errors.push(`Строка ${i + 1}`); continue; }
        const dayOfWeek = DAY_MAP[parts[0].toUpperCase()];
        if (!dayOfWeek) { errors.push(`Строка ${i + 1}: день`); continue; }
        const lessonNum = parseInt(parts[1], 10);
        if (!lessonNum || !LESSON_TIMES[lessonNum]) { errors.push(`Строка ${i + 1}: урок`); continue; }
        const subjectName = parts[2];
        if (!subjectName) { skipped.push(`Строка ${i + 1}`); continue; }
        lessons.push({ dayOfWeek, subjectName, classroom: parts[3] || null, startTime: LESSON_TIMES[lessonNum].start, endTime: LESSON_TIMES[lessonNum].end });
    }
    if (!lessons.length) return res.status(400).json({ error: 'Ничего не разобрано', details: errors.slice(0, 10) });
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/schedule/:spaceId/export', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = (await pool.query('SELECT * FROM schedules WHERE space_id = $1 ORDER BY day_of_week, start_time', [req.params.spaceId])).rows;
    const DAY_NAMES = ['', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];
    let text;
    if (!lessons.length) text = DEFAULT_SCHEDULE_TEMPLATE;
    else {
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

app.post('/api/schedule/override', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, scheduleId, date, isCanceled, replacementSubject, replacementClassroom, replacementTeacher } = req.body;
    if (!scheduleId || !date) return res.status(400).json({ error: 'Не указан урок' });
    const r = await pool.query(`INSERT INTO schedule_overrides (space_id, schedule_id, override_date, is_canceled, replacement_subject, replacement_classroom, replacement_teacher) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (schedule_id, override_date) DO UPDATE SET is_canceled = EXCLUDED.is_canceled, replacement_subject = EXCLUDED.replacement_subject, replacement_classroom = EXCLUDED.replacement_classroom, replacement_teacher = EXCLUDED.replacement_teacher RETURNING *`, [spaceId, scheduleId, date, !!isCanceled, replacementSubject || null, replacementClassroom || null, replacementTeacher || null]);
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

app.get('/api/schedule/:spaceId/ics', verifyJWT, requireSpaceAccess, async (req, res) => {
    const lessons = (await pool.query('SELECT * FROM schedules WHERE space_id = $1', [req.params.spaceId])).rows;
    const overrides = (await pool.query(`SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE`, [req.params.spaceId])).rows;
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Workspaces//RU\r\nCALSCALE:GREGORIAN\r\n';
    const toICSDate = (d, t) => `${d.replace(/-/g, '')}T${t.replace(/:/g, '').slice(0, 6)}`;
    for (let offset = 0; offset < 14; offset++) {
        const day = new Date(); day.setDate(day.getDate() + offset);
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
    const hw = await pool.query(`SELECT h.*, hc.attachment_url, hc.completed_at, (hc.id IS NOT NULL) AS is_done FROM homeworks h LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.user_id = $2 WHERE h.space_id = $1 ORDER BY h.due_date ASC`, [req.params.spaceId, req.currentUser.id]);
    res.json(hw.rows);
});

app.get('/api/homework/:id/stats', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    const spaceId = hw.rows[0].space_id;
    if (!(await isSpaceMember(user, spaceId))) return res.status(403).json({ error: 'Нет доступа' });

    // СТРОГАЯ ЗАЩИТА: только преподаватель/админ
    const isAdmin = await isSpaceAdmin(user, spaceId);
    if (!isAdmin) return res.status(403).json({ error: 'Только преподаватель/админ может видеть статистику' });

    const dueDate = hw.rows[0].due_date;
    const now = new Date();
    const dueDateObj = new Date(dueDate);
    dueDateObj.setHours(23, 59, 59, 999);
    const isOverdue = dueDateObj < now;

    // Все ученики группы + их статус
    const r = await pool.query(
        `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                hc.completed_at, hc.attachment_url,
                (hc.id IS NOT NULL) AS is_done
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN homework_completions hc ON hc.homework_id = $1 AND hc.user_id = u.id
         WHERE sm.space_id = $2 AND u.is_teacher = FALSE
         ORDER BY (hc.id IS NULL) ASC, u.full_name ASC`,
        [req.params.id, spaceId]
    );

    const students = r.rows.map(s => ({
        id: s.id,
        fullName: s.full_name,
        username: s.username,
        avatarEmoji: s.avatar_emoji || '👤',
        isDone: !!s.is_done,
        completedAt: s.completed_at,
        attachmentUrl: s.attachment_url,
        status: s.is_done ? 'done' : (isOverdue ? 'overdue' : 'pending')
    }));

    const totalCount = students.length;
    const completedCount = students.filter(s => s.isDone).length;
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    res.json({
        percentage,
        completed: completedCount,
        total: totalCount,
        students,
        dueDate,
        isOverdue,
        canSeeStudents: true
    });
});

app.post('/api/homework', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, subjectName, title, dueDate } = req.body;
    if (!subjectName || !title || !dueDate) return res.status(400).json({ error: 'Заполните поля' });
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
    const r = await pool.query(`INSERT INTO homework_completions (homework_id, user_id, attachment_url) VALUES ($1,$2,$3) ON CONFLICT (homework_id, user_id) DO UPDATE SET attachment_url = EXCLUDED.attachment_url, completed_at = NOW() RETURNING *`, [req.params.id, user.id, attachment || null]);
    res.json(r.rows[0]);
});

app.delete('/api/homework/:id/complete', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    await pool.query('DELETE FROM homework_completions WHERE homework_id = $1 AND user_id = $2', [req.params.id, user.id]);
    res.json({ message: 'Снято' });
});

app.get('/api/homework/:id/completions', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, hw.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    const r = await pool.query(`SELECT hc.id, hc.user_id, hc.completed_at, hc.attachment_url, u.full_name, u.username, u.avatar_emoji FROM homework_completions hc JOIN users u ON u.id = hc.user_id WHERE hc.homework_id = $1 AND u.is_teacher = FALSE ORDER BY hc.completed_at DESC`, [req.params.id]);
    res.json(r.rows);
});

// ================= ЧАТ =================
app.get('/api/chat/:spaceId/messages', verifyJWT, requireSpaceAccess, async (req, res) => {
    const r = await pool.query(`SELECT cm.*, u.full_name, u.username, u.is_teacher, u.avatar_emoji FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.space_id = $1 ORDER BY cm.created_at DESC LIMIT 50`, [req.params.spaceId]);
    res.json(r.rows.reverse());
});

// ================= ИГРЫ (REST) =================
const VALID_GAMES = ['2048', 'cyber-runner', 'brawl-royale', 'snake-arena', 'battle-tanks', 'cyber-arena'];

app.get('/api/games-global/:gameId/leaderboard', verifyJWT, async (req, res) => {
    if (!VALID_GAMES.includes(req.params.gameId)) return res.json([]);
    const r = await pool.query(
        `SELECT u.id, u.full_name, u.username, MAX(gs.score)::int AS score
         FROM game_scores gs JOIN users u ON u.id = gs.user_id
         WHERE gs.game_id = $1 GROUP BY u.id, u.full_name, u.username
         ORDER BY score DESC LIMIT 20`,
        [req.params.gameId]
    );
    res.json(r.rows);
});

app.get('/api/games/:spaceId/:gameId/leaderboard', verifyJWT, requireSpaceAccess, async (req, res) => {
    if (!VALID_GAMES.includes(req.params.gameId)) return res.json([]);
    const r = await pool.query(`SELECT gs.score, gs.updated_at, u.full_name, u.username FROM game_scores gs JOIN users u ON u.id = gs.user_id WHERE gs.space_id = $1 AND gs.game_id = $2 ORDER BY gs.score DESC LIMIT 20`, [req.params.spaceId, req.params.gameId]);
    res.json(r.rows);
});

app.post('/api/games/:spaceId/:gameId/score', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { score } = req.body;
    if (!VALID_GAMES.includes(req.params.gameId)) return res.status(400).json({ error: 'Неизвестная игра' });
    if (typeof score !== 'number' || score < 0) return res.status(400).json({ error: 'Счёт' });
    await pool.query(`INSERT INTO game_scores (space_id, user_id, game_id, score) VALUES ($1,$2,$3,$4) ON CONFLICT (space_id, user_id, game_id) DO UPDATE SET score = GREATEST(game_scores.score, EXCLUDED.score), updated_at = NOW()`, [req.params.spaceId, req.currentUser.id, req.params.gameId, Math.floor(score)]);
    res.json({ message: 'Сохранено' });
});

app.post('/api/games/:spaceId/:gameId/reset', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM game_scores WHERE space_id = $1 AND game_id = $2', [req.params.spaceId, req.params.gameId]);
    res.json({ message: 'Рекорды сброшены' });
});

// ================= МУЛЬТИПЛЕЕР: КОМНАТЫ =================
const gameRooms = {};
let roomCounter = 0;

const ROOM_CONFIG = {
    'battle-tanks': { min: 4, max: 4 },
    'brawl-royale': { min: 4, max: 10 },
    'cyber-arena':  { min: 4, max: 6 }
};

const BRAWL_CHARS = [
    { id: 'sniper',  name: 'Снайпер',   emoji: '🎯', color: '#ff5252', hp: 80,  speed: 3.2, dmg: 30, range: 380, bulletSpeed: 12, cd: 45 },
    { id: 'tank',    name: 'Танк',      emoji: '🛡️', color: '#4caf50', hp: 180, speed: 2.2, dmg: 18, range: 180, bulletSpeed: 8,  cd: 30 },
    { id: 'shooter', name: 'Стрелок',   emoji: '🔫', color: '#2196f3', hp: 100, speed: 3.0, dmg: 15, range: 260, bulletSpeed: 10, cd: 18 },
    { id: 'bomber',  name: 'Подрывник', emoji: '💣', color: '#ff9800', hp: 90,  speed: 2.8, dmg: 40, range: 130, bulletSpeed: 7,  cd: 60 }
];

const CYBER_WEAPONS = [
    { id: 'pistol',  name: 'Пистолет', dmg: 20, cd: 20, speed: 11, spread: 0.02, bullets: 1 },
    { id: 'smg',     name: 'ПП',       dmg: 10, cd: 8,  speed: 10, spread: 0.09, bullets: 1 },
    { id: 'shotgun', name: 'Дробовик', dmg: 15, cd: 45, speed: 9,  spread: 0.30, bullets: 5 }
];

function findOrCreateRoom(gameType) {
    for (const id in gameRooms) {
        const r = gameRooms[id];
        if (r.gameType === gameType && r.status === 'waiting' && r.players.length < ROOM_CONFIG[gameType].max) return r;
    }
    const roomId = 'room_' + (++roomCounter);
    gameRooms[roomId] = {
        id: roomId,
        gameType: gameType,
        status: 'waiting',
        players: [],
        minPlayers: ROOM_CONFIG[gameType].min,
        maxPlayers: ROOM_CONFIG[gameType].max,
        countdown: 5,
        state: null,
        round: 1,
        maxRounds: gameType === 'cyber-arena' ? 7 : 1,
        teamScore: { red: 0, blue: 0 }
    };
    return gameRooms[roomId];
}

function publicRoom(room) {
    return {
        id: room.id, gameType: room.gameType, status: room.status,
        countdown: room.countdown, players: room.players,
        minPlayers: room.minPlayers, maxPlayers: room.maxPlayers,
        round: room.round, maxRounds: room.maxRounds,
        teamScore: room.teamScore
    };
}

function checkRoomStart(room) {
    if (room.status !== 'waiting') return;
    const allReady = room.players.length >= room.minPlayers && room.players.every(p => p.ready);
    if (!allReady) return;
    room.status = 'countdown';
    room.countdown = 5;
    io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    const t = setInterval(() => {
        room.countdown--;
        if (room.countdown <= 0) { clearInterval(t); startRoomGame(room); }
        else io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    }, 1000);
}

function startRoomGame(room) {
    room.status = 'playing';
    const W = 800, H = 500;
    const n = room.players.length;
    const COLORS = ['#30d158', '#0a84ff', '#ff453a', '#ffd60a', '#bf5af2', '#00e5ff', '#ff9500', '#ff2d55', '#5e5ce6', '#32d74b'];

    if (room.gameType === 'battle-tanks') {
        const positions = [[80, 80], [W - 80, 80], [80, H - 80], [W - 80, H - 80]];
        room.state = {
            players: room.players.map((p, i) => ({
                id: p.id, fullName: p.fullName, color: COLORS[i],
                x: positions[i][0], y: positions[i][1],
                angle: i < 2 ? Math.PI / 2 : -Math.PI / 2,
                hp: 100, maxHp: 100,
                input: { dx: 0, dy: 0 }, fire: false, cd: 0, alive: true
            })),
            bullets: []
        };
    } else if (room.gameType === 'brawl-royale') {
        room.state = {
            zoneR: 900, zoneMin: 60, zoneShrink: 0.15,
            pickups: [], pickupsSpawnCd: 60,
            players: room.players.map((p, i) => {
                const c = BRAWL_CHARS[i % BRAWL_CHARS.length];
                const ang = (i / n) * Math.PI * 2;
                return {
                    id: p.id, fullName: p.fullName, charId: c.id, charName: c.name,
                    color: c.color, emoji: c.emoji,
                    x: W / 2 + Math.cos(ang) * 180, y: H / 2 + Math.sin(ang) * 120,
                    angle: 0, hp: c.hp, maxHp: c.hp,
                    dmgBonus: 0, speedBonus: 0,
                    input: { dx: 0, dy: 0 }, aim: { dx: 0, dy: 0, power: 0 },
                    cd: 0, superCharge: 0, superActive: 0, alive: true
                };
            }),
            bullets: []
        };
    } else if (room.gameType === 'cyber-arena') {
        const half = Math.floor(n / 2);
        room.state = {
            mapW: W, mapH: H,
            walls: [
                { x: 200, y: 120, w: 80, h: 30 },
                { x: 520, y: 120, w: 80, h: 30 },
                { x: 200, y: 350, w: 80, h: 30 },
                { x: 520, y: 350, w: 80, h: 30 },
                { x: 380, y: 220, w: 40, h: 60 }
            ],
            players: room.players.map((p, i) => {
                const isRed = i < half;
                const w = CYBER_WEAPONS[i % CYBER_WEAPONS.length];
                const idx = isRed ? i : (i - half);
                return {
                    id: p.id, fullName: p.fullName,
                    team: isRed ? 'red' : 'blue',
                    weaponId: w.id, weaponName: w.name,
                    x: isRed ? 100 : W - 100,
                    y: 80 + idx * 80,
                    angle: isRed ? 0 : Math.PI,
                    hp: 100, maxHp: 100,
                    input: { dx: 0, dy: 0 }, aim: { dx: 0, dy: 0, power: 0 },
                    cd: 0, alive: true
                };
            }),
            bullets: []
        };
    }
    io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    room.tickTimer = setInterval(() => tickRoomGame(room), 1000 / 30);
}

function tickRoomGame(room) {
    if (room.status !== 'playing') return;
    const W = 800, H = 500;

    // ====== BATTLE TANKS ======
    if (room.gameType === 'battle-tanks') {
        const sp = 3;
        room.state.players.forEach(p => {
            if (!p.alive) return;
            if (p.input) {
                var len = Math.hypot(p.input.dx, p.input.dy);
                if (len > 1) { p.input.dx /= len; p.input.dy /= len; }
                if (Math.abs(p.input.dx) > 0.05 || Math.abs(p.input.dy) > 0.05) {
                    p.angle = Math.atan2(p.input.dy, p.input.dx);
                    p.x += p.input.dx * sp; p.y += p.input.dy * sp;
                    p.x = Math.max(20, Math.min(W - 20, p.x));
                    p.y = Math.max(20, Math.min(H - 20, p.y));
                }
            }
            if (p.cd > 0) p.cd--;
            if (p.fire && p.cd <= 0) {
                p.cd = 25;
                room.state.bullets.push({
                    x: p.x + Math.cos(p.angle) * 22, y: p.y + Math.sin(p.angle) * 22,
                    vx: Math.cos(p.angle) * 9, vy: Math.sin(p.angle) * 9,
                    owner: p.id, dmg: 25, color: p.color, range: 600, life: 70
                });
                p.fire = false;
            }
        });
        for (let i = room.state.bullets.length - 1; i >= 0; i--) {
            const b = room.state.bullets[i];
            b.x += b.vx; b.y += b.vy; b.life--;
            if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || b.life <= 0) { room.state.bullets.splice(i, 1); continue; }
            for (const p of room.state.players) {
                if (!p.alive || p.id === b.owner) continue;
                if (Math.hypot(p.x - b.x, p.y - b.y) < 20) {
                    p.hp -= b.dmg;
                    room.state.bullets.splice(i, 1);
                    if (p.hp <= 0) { p.hp = 0; p.alive = false; }
                    break;
                }
            }
        }
        const alive = room.state.players.filter(p => p.alive);
        if (alive.length <= 1) { endRoomGame(room, alive[0] ? alive[0].fullName : 'Ничья'); return; }
    }

    // ====== BRAWL ROYALE ======
    else if (room.gameType === 'brawl-royale') {
        if (room.state.zoneR > room.state.zoneMin) room.state.zoneR -= room.state.zoneShrink;
        room.state.players.forEach(p => {
            if (!p.alive) return;
            const c = BRAWL_CHARS.find(x => x.id === p.charId);
            const sp = c.speed + p.speedBonus;
            if (p.input) {
                var len = Math.hypot(p.input.dx, p.input.dy);
                if (len > 1) { p.input.dx /= len; p.input.dy /= len; }
                if (Math.abs(p.input.dx) > 0.05 || Math.abs(p.input.dy) > 0.05) {
                    p.x += p.input.dx * sp; p.y += p.input.dy * sp;
                }
            }
            p.x = Math.max(20, Math.min(W - 20, p.x));
            p.y = Math.max(20, Math.min(H - 20, p.y));
            const dcx = p.x - W / 2, dcy = p.y - H / 2;
            if (Math.hypot(dcx, dcy) > room.state.zoneR) p.hp -= 0.4;
            if (p.cd > 0) p.cd--;
            if (p.aim && p.aim.power > 0.5 && p.cd <= 0) {
                const ang = Math.atan2(p.aim.dy, p.aim.dx);
                p.angle = ang;
                p.cd = c.cd;
                room.state.bullets.push({
                    x: p.x + Math.cos(ang) * 20, y: p.y + Math.sin(ang) * 20,
                    vx: Math.cos(ang) * c.bulletSpeed, vy: Math.sin(ang) * c.bulletSpeed,
                    owner: p.id, dmg: c.dmg + p.dmgBonus, color: p.color,
                    range: c.range, traveled: 0
                });
            }
            if (p.superActive > 0) {
                p.superActive--;
                if (p.superActive % 5 === 0) {
                    const ang = p.angle || 0;
                    for (let k = 0; k < 5; k++) {
                        const a2 = ang + (k - 2) * 0.25;
                        room.state.bullets.push({
                            x: p.x + Math.cos(a2) * 20, y: p.y + Math.sin(a2) * 20,
                            vx: Math.cos(a2) * 11, vy: Math.sin(a2) * 11,
                            owner: p.id, dmg: 20, color: p.color,
                            range: 400, traveled: 0
                        });
                    }
                }
            }
            p.superCharge = Math.min(100, p.superCharge + 0.15);
        });
        for (let i = room.state.bullets.length - 1; i >= 0; i--) {
            const b = room.state.bullets[i];
            b.x += b.vx; b.y += b.vy;
            b.traveled += Math.hypot(b.vx, b.vy);
            if (b.traveled > b.range || b.x < 0 || b.x > W || b.y < 0 || b.y > H) { room.state.bullets.splice(i, 1); continue; }
            for (const p of room.state.players) {
                if (!p.alive || p.id === b.owner) continue;
                if (Math.hypot(p.x - b.x, p.y - b.y) < 18) {
                    p.hp -= b.dmg;
                    room.state.bullets.splice(i, 1);
                    if (p.hp <= 0) {
                        p.alive = false; p.hp = 0;
                        const killer = room.state.players.find(x => x.id === b.owner);
                        if (killer) killer.superCharge = Math.min(100, killer.superCharge + 30);
                    }
                    break;
                }
            }
        }
        room.state.pickupsSpawnCd--;
        if (room.state.pickupsSpawnCd <= 0 && room.state.pickups.length < 6) {
            room.state.pickupsSpawnCd = 120 + Math.random() * 120;
            const types = ['hp', 'dmg', 'spd'];
            room.state.pickups.push({
                x: 60 + Math.random() * (W - 120),
                y: 60 + Math.random() * (H - 120),
                r: 14, type: types[Math.floor(Math.random() * 3)], life: 600
            });
        }
        for (let i = room.state.pickups.length - 1; i >= 0; i--) {
            const pu = room.state.pickups[i];
            pu.life--;
            if (pu.life <= 0) { room.state.pickups.splice(i, 1); continue; }
            for (const p of room.state.players) {
                if (!p.alive) continue;
                if (Math.hypot(p.x - pu.x, p.y - pu.y) < 20) {
                    if (pu.type === 'hp') p.hp = Math.min(p.maxHp, p.hp + 30);
                    else if (pu.type === 'dmg') p.dmgBonus += 8;
                    else if (pu.type === 'spd') p.speedBonus += 0.4;
                    room.state.pickups.splice(i, 1);
                    break;
                }
            }
        }
        const alive = room.state.players.filter(p => p.alive);
        if (alive.length <= 1) { endRoomGame(room, alive[0] ? alive[0].fullName : 'Ничья'); return; }
    }

    // ====== CYBER ARENA ======
    else if (room.gameType === 'cyber-arena') {
        const sp = 3.2;
        room.state.players.forEach(p => {
            if (!p.alive) return;
            const w = CYBER_WEAPONS.find(x => x.id === p.weaponId);
            if (p.input) {
                var len = Math.hypot(p.input.dx, p.input.dy);
                if (len > 1) { p.input.dx /= len; p.input.dy /= len; }
                let nx = p.x + p.input.dx * sp;
                let ny = p.y + p.input.dy * sp;
                let collided = false;
                for (const wall of room.state.walls) {
                    if (nx + 14 > wall.x && nx - 14 < wall.x + wall.w && ny + 14 > wall.y && ny - 14 < wall.y + wall.h) { collided = true; break; }
                }
                if (!collided) { p.x = nx; p.y = ny; }
                p.x = Math.max(20, Math.min(W - 20, p.x));
                p.y = Math.max(20, Math.min(H - 20, p.y));
            }
            if (p.cd > 0) p.cd--;
            if (p.aim && p.aim.power > 0.5 && p.cd <= 0) {
                const ang = Math.atan2(p.aim.dy, p.aim.dx);
                p.angle = ang;
                p.cd = w.cd;
                for (let k = 0; k < w.bullets; k++) {
                    const a2 = ang + (Math.random() - 0.5) * w.spread * 2;
                    room.state.bullets.push({
                        x: p.x + Math.cos(a2) * 18, y: p.y + Math.sin(a2) * 18,
                        vx: Math.cos(a2) * w.speed, vy: Math.sin(a2) * w.speed,
                        owner: p.id, team: p.team, dmg: w.dmg, range: 700, traveled: 0
                    });
                }
            }
        });
        for (let i = room.state.bullets.length - 1; i >= 0; i--) {
            const b = room.state.bullets[i];
            b.x += b.vx; b.y += b.vy; b.traveled += Math.hypot(b.vx, b.vy);
            if (b.traveled > b.range || b.x < 0 || b.x > W || b.y < 0 || b.y > H) { room.state.bullets.splice(i, 1); continue; }
            let blocked = false;
            for (const wall of room.state.walls) {
                if (b.x > wall.x && b.x < wall.x + wall.w && b.y > wall.y && b.y < wall.y + wall.h) { blocked = true; break; }
            }
            if (blocked) { room.state.bullets.splice(i, 1); continue; }
            for (const p of room.state.players) {
                if (!p.alive || p.id === b.owner || p.team === b.team) continue;
                if (Math.hypot(p.x - b.x, p.y - b.y) < 16) {
                    p.hp -= b.dmg;
                    room.state.bullets.splice(i, 1);
                    if (p.hp <= 0) { p.hp = 0; p.alive = false; }
                    break;
                }
            }
        }
        const redAlive = room.state.players.filter(p => p.alive && p.team === 'red').length;
        const blueAlive = room.state.players.filter(p => p.alive && p.team === 'blue').length;
        if (redAlive === 0 || blueAlive === 0) {
            endRound(room, redAlive > 0 ? 'red' : 'blue');
            return;
        }
    }

    io.to('game:' + room.id).emit('game:state', room.state);
}

function endRound(room, winner) {
    room.teamScore[winner]++;
    clearInterval(room.tickTimer);
    io.to('game:' + room.id).emit('game:round_end', {
        winner: winner, score: room.teamScore, round: room.round,
        maxRounds: room.maxRounds,
        matchWinner: room.teamScore[winner] > room.maxRounds / 2 ? winner : null
    });
    const matchOver = room.teamScore[winner] > room.maxRounds / 2 || room.round >= room.maxRounds;
    if (matchOver) {
        setTimeout(() => {
            const finalWinner = room.teamScore.red > room.teamScore.blue ? '🔴 Красные' : '🔵 Синие';
            endRoomGame(room, finalWinner);
        }, 2500);
    } else {
        setTimeout(() => {
            room.round++;
            // сохраняем команды, сбрасываем HP
            room.state.players.forEach(p => { p.hp = p.maxHp; p.alive = true; });
            const W = 800;
            room.state.players.forEach((p, i) => {
                p.x = p.team === 'red' ? 100 : W - 100;
                p.y = 80 + (i % 3) * 100;
            });
            room.state.bullets = [];
            room.status = 'playing';
            room.tickTimer = setInterval(() => tickRoomGame(room), 1000 / 30);
            io.to('game:' + room.id).emit('game:state', room.state);
            io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
        }, 3000);
    }
}

function endRoomGame(room, winner) {
    room.status = 'ended';
    if (room.tickTimer) clearInterval(room.tickTimer);
    io.to('game:' + room.id).emit('game:ended', { winner: winner, state: room.state });
    setTimeout(() => {
        room.status = 'waiting';
        room.round = 1;
        room.teamScore = { red: 0, blue: 0 };
        room.players.forEach(p => p.ready = false);
        room.state = null;
        io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    }, 6000);
}

// ================= SOCKET.IO =================
io.on('connection', async (socket) => {
    // Определяем пользователя
    try {
        const token = socket.handshake.query && socket.handshake.query.token;
        if (token && token !== 'null' && token !== '') {
            const { userId } = jwt.verify(token, JWT_SECRET);
            const user = await getUserById(userId);
            if (user) { socket.userId = user.id; socket.gameUser = user; }
        }
    } catch (e) { }

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

    // ====== ИГРЫ ======
    socket.on('game:join_room', async ({ gameType }) => {
        if (!socket.gameUser) { socket.emit('game:error', { error: 'Не авторизован' }); return; }
        if (!ROOM_CONFIG[gameType]) { socket.emit('game:error', { error: 'Игра не найдена' }); return; }
        let room = findOrCreateRoom(gameType);
        if (room.players.find(p => p.id === socket.gameUser.id)) {
            socket.gameRoomId = room.id;
            socket.join('game:' + room.id);
            socket.emit('game:room_update', publicRoom(room));
            return;
        }
        if (room.players.length >= room.maxPlayers) { socket.emit('game:error', { error: 'Комната заполнена' }); return; }
        room.players.push({
            id: socket.gameUser.id,
            fullName: socket.gameUser.full_name,
            avatarEmoji: socket.gameUser.avatar_emoji || '👤',
            ready: false
        });
        socket.join('game:' + room.id);
        socket.gameRoomId = room.id;
        io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    });

    socket.on('game:toggle_ready', () => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || !socket.gameUser) return;
        const p = room.players.find(pl => pl.id === socket.gameUser.id);
        if (!p) return;
        p.ready = !p.ready;
        io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
        checkRoomStart(room);
    });

    socket.on('game:leave_room', () => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || !socket.gameUser) return;
        room.players = room.players.filter(p => p.id !== socket.gameUser.id);
        socket.leave('game:' + room.id);
        socket.gameRoomId = null;
        if (room.players.length === 0) { delete gameRooms[room.id]; }
        else io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    });

    socket.on('game:input', (data) => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || room.status !== 'playing' || !socket.gameUser) return;
        const p = room.state && room.state.players.find(pl => pl.id === socket.gameUser.id);
        if (!p || !p.alive) return;
        if (data.joystick1) p.input = data.joystick1;
        if (data.joystick2 && (room.gameType === 'brawl-royale' || room.gameType === 'cyber-arena')) p.aim = data.joystick2;
    });

    socket.on('game:fire', () => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || room.status !== 'playing' || !socket.gameUser) return;
        const p = room.state && room.state.players.find(pl => pl.id === socket.gameUser.id);
        if (!p || !p.alive) return;
        if (room.gameType === 'battle-tanks') p.fire = true;
    });

    socket.on('game:super', () => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || room.status !== 'playing' || !socket.gameUser) return;
        if (room.gameType !== 'brawl-royale') return;
        const p = room.state.players.find(pl => pl.id === socket.gameUser.id);
        if (!p || !p.alive || p.superCharge < 100) return;
        p.superActive = 60;
        p.superCharge = 0;
    });

    socket.on('disconnect', () => {
        const room = gameRooms[socket.gameRoomId];
        if (!room || !socket.gameUser) return;
        room.players = room.players.filter(p => p.id !== socket.gameUser.id);
        if (room.players.length === 0) delete gameRooms[room.id];
        else io.to('game:' + room.id).emit('game:room_update', publicRoom(room));
    });
});

// ================= СЛУЖЕБНЫЕ =================
app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));
async function cleanupOldMessages() {
    try { const r = await pool.query("DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'"); if (r.rowCount) console.log(`🧹 Удалено: ${r.rowCount}`); }
    catch (e) { console.error('Очистка:', e.message); }
}
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

async function ensureSchema() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    const migrations = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji VARCHAR(50) DEFAULT '👤'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL`,
        `ALTER TABLE space_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP WITH TIME ZONE`,
        `CREATE TABLE IF NOT EXISTS space_blocked (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
            reason TEXT,
            blocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(space_id, user_id)
        )`
    ];
    for (const sql of migrations) {
        try { await pool.query(sql); } catch (e) { console.warn('Миграция:', e.message); }
    }
    console.log('✅ Схема БД инициализирована');
}

async function ensureRootTeacher() {
    const existing = await pool.query("SELECT * FROM users WHERE username = 'root_teacher'");
    if (existing.rows.length) return;
    const hash = await bcrypt.hash(process.env.ROOT_TEACHER_PASSWORD, 12);
    await pool.query(`INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code) VALUES ('root_teacher', 'Главный Администратор Колледжа', $1, $2, true, true, 'ROOT')`, [process.env.ROOT_TEACHER_EMAIL || 'root@college.local', hash]);
    console.log('👑 Аккаунт root_teacher создан');
}

const PORT = process.env.PORT || 3000;
(async () => {
    try { await ensureSchema(); await ensureRootTeacher(); await cleanupOldMessages(); }
    catch (e) { console.error('Ошибка init:', e.message); }
    server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
})();
