require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const push = require('./push');
const storage = require('./storage');
const { registerFileRoutes } = require('./routes/files');
const { registerExcelRoutes } = require('./routes/excel');
const { registerJournalRoutes } = require('./routes/journal');
const { registerHiddenRoutes } = require('./routes/hidden');

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
const io = new Server(server, {
    cors: { origin: process.env.ALLOWED_ORIGIN || '*', credentials: true }
});

app.set('io', io);
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/teach', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teach', 'index.html')));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20,
    message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
    standardHeaders: true, legacyHeaders: false
});
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, max: 300,
    message: { error: 'Слишком много запросов. Подождите немного.' }
});
app.use('/api/', generalLimiter);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
const JWT_SECRET = process.env.JWT_SECRET;

storage.initStorage();
push.initWebPush();
setInterval(() => push.checkLessonReminders(pool), 60 * 1000);

const LESSON_TIMES = {
    1: { start: '09:00', end: '09:45' }, 2: { start: '10:00', end: '10:45' },
    3: { start: '11:00', end: '11:45' }, 4: { start: '12:00', end: '12:45' },
    5: { start: '13:05', end: '13:50' }, 6: { start: '14:10', end: '14:55' },
    7: { start: '15:05', end: '15:50' }, 8: { start: '15:55', end: '16:40' }
};
const DAY_MAP = {
    'ПОНЕДЕЛЬНИК': 1, 'ПН': 1, 'ВТОРНИК': 2, 'ВТ': 2, 'СРЕДА': 3, 'СР': 3,
    'ЧЕТВЕРГ': 4, 'ЧТ': 4, 'ПЯТНИЦА': 5, 'ПТ': 5, 'СУББОТА': 6, 'СБ': 6,
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
function isValidPassword(password) {
    if (typeof password !== 'string') return false;
    if (password.length < 8) return false;
    if (!/[a-zA-Zа-яА-Я]/.test(password)) return false;
    if (!/[0-9]/.test(password)) return false;
    return true;
}

const BANNED_SUBSTRINGS = ['admin','administrator','root','moderator','support','system','null','undefined','админ','администратор','модератор','рут','систем','бля','хуй','хуе','хер','пизд','ебан','еба','сук','мраз','гандон','долбоеб','долбоёб','fuck','shit','bitch','asshole','nigger','faggot','гитлер','hitler','сталин','stalin','ленин','lenin','путин','putin','зеленский','zelensky','трамп','trump','байден','biden'];
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
function isRoot(user) { return !!(user && user.username === 'root_teacher'); }
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
        theme: u.theme || 'auto',
        emailVerified: true,
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
app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { firstName, lastName, nickName, email: userEmail, password } = req.body;
    if (!firstName || !lastName || !nickName || !userEmail || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(userEmail)) return res.status(400).json({ error: 'Введите реальный адрес почты' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Пароль: минимум 8 символов, буква и цифра' });
    if (violatesProfanityFilter(firstName, lastName, nickName)) return res.status(400).json({ error: 'Запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, email_verified)
             VALUES ($1, $2, $3, $4, false, false, true)`,
            [nickName, `${firstName} ${lastName}`, userEmail, hash]
        );
        res.json({ message: 'Успех' });
    } catch (err) { res.status(400).json({ error: 'Почта или логин уже заняты' }); }
});

app.post('/api/teach/register', authLimiter, async (req, res) => {
    const { fullName, email: userEmail, password } = req.body;
    if (!fullName || !userEmail || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidEmailDomain(userEmail)) return res.status(400).json({ error: 'Введите реальный адрес почты' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Пароль: минимум 8 символов, буква и цифра' });
    if (violatesProfanityFilter(fullName)) return res.status(400).json({ error: 'Запрещённые слова' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const code = 'T-' + generateCode(4);
        const username = userEmail.split('@')[0] + '_' + generateCode(3);
        await pool.query(
            `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code, email_verified)
             VALUES ($1, $2, $3, $4, true, false, $5, true)`,
            [username, fullName, userEmail, hash, code]
        );
        res.json({ code });
    } catch (err) { res.status(400).json({ error: 'Email уже используется' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { login, password, isTeacher } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userRes.rows.length) return res.status(400).json({ error: 'Неверный логин или пароль' });
        const user = userRes.rows[0];
        if (user.locked_until && new Date(user.locked_until) > new Date()) return res.status(403).json({ error: 'Аккаунт заблокирован. Попробуйте позже.' });
        if (isTeacher && !user.is_teacher) return res.status(403).json({ error: 'Это аккаунт студента' });
        if (!isTeacher && user.is_teacher) return res.status(403).json({ error: 'Это аккаунт преподавателя' });
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            const attempts = (user.failed_login_attempts || 0) + 1;
            const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
            await pool.query('UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockUntil, user.id]);
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }
        await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
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
    const { firstName, lastName, nickname, avatarEmoji, theme } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'Имя и фамилия обязательны' });
    if (violatesProfanityFilter(firstName, lastName, nickname)) return res.status(400).json({ error: 'Запрещённые слова' });
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    const newNickname = user.is_teacher ? user.username : (nickname || user.username);
    const newTheme = ['auto', 'light', 'dark'].includes(theme) ? theme : (user.theme || 'auto');
    try {
        await pool.query('UPDATE users SET full_name = $1, username = $2, avatar_emoji = $3, theme = $4 WHERE id = $5',
            [`${firstName} ${lastName}`, newNickname, avatarEmoji || '👤', newTheme, user.id]);
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
    let { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });
    code = String(code).trim().toUpperCase();
    if (/^\d{4}$/.test(code)) code = 'T-' + code;
    const target = await pool.query('SELECT * FROM users WHERE verification_code = $1 AND is_teacher = true', [code]);
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
    const prevQ = await pool.query('SELECT global_announcement FROM system_settings WHERE id = 1');
    const prevAnnouncement = (prevQ.rows[0] && prevQ.rows[0].global_announcement) || '';
    const r = await pool.query(
        `UPDATE system_settings SET remote_mode=$1, maintenance_mode=$2, exams_mode=$3, private_chat_mode=$4, global_announcement=$5 WHERE id = 1 RETURNING *`,
        [!!remote_mode, !!maintenance_mode, !!exams_mode, !!private_chat_mode, global_announcement || '']
    );
    io.emit('settings_updated', r.rows[0]);
    const newAnnouncement = (global_announcement || '').trim();
    if (newAnnouncement && newAnnouncement !== prevAnnouncement) {
        push.notifyCollegeAnnouncement(pool, newAnnouncement).catch(e => console.error('push announcement:', e.message));
    }
    res.json(r.rows[0]);
});

// ================= ВОССТАНОВЛЕНИЕ ПАРОЛЯ =================
app.post('/api/auth/request-password-reset', authLimiter, async (req, res) => {
    const { login } = req.body;
    if (!login) return res.status(400).json({ error: 'Введите логин или email' });
    try {
        const userQ = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userQ.rows.length) return res.json({ ok: true, message: 'Запрос отправлен.' });
        const user = userQ.rows[0];
        const existing = await pool.query(
            `SELECT * FROM password_reset_requests WHERE user_id = $1 AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1`, [user.id]
        );
        let request;
        if (existing.rows.length && (Date.now() - new Date(existing.rows[0].created_at).getTime()) < 60 * 60 * 1000) {
            request = existing.rows[0];
        } else {
            const code = user.is_teacher ? null : generateCode(4);
            const token = user.is_teacher ? crypto.randomBytes(32).toString('hex') : null;
            const displayName = user.is_teacher ? `Преподаватель: ${user.full_name}` : user.full_name;
            const r = await pool.query(
                `INSERT INTO password_reset_requests (user_id, user_type, display_name, username, code, token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [user.id, user.is_teacher ? 'teacher' : 'student', displayName, user.username, code, token]
            );
            request = r.rows[0];
            io.to('teachers').emit('password_reset_request', {
                id: request.id, displayName: request.display_name, username: request.username,
                userType: request.user_type, code: request.code, createdAt: request.created_at
            });
        }
        res.json({ ok: true, message: 'Запрос отправлен. Обратитесь к преподавателю.' });
    } catch (e) { console.error('request-password-reset:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/auth/password-reset-status/:login', authLimiter, async (req, res) => {
    try {
        const userQ = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $1', [req.params.login]);
        if (!userQ.rows.length) return res.json({ status: 'none' });
        const r = await pool.query(`SELECT id, status, code, token FROM password_reset_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userQ.rows[0].id]);
        if (!r.rows.length) return res.json({ status: 'none' });
        res.json(r.rows[0]);
    } catch (e) { res.json({ status: 'none' }); }
});

app.get('/api/password-reset-requests', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Только для учителей' });
    const r = await pool.query(
        `SELECT prr.*, u.full_name AS teacher_full_name FROM password_reset_requests prr LEFT JOIN users u ON u.id = prr.user_id WHERE prr.status IN ('pending','approved') AND prr.created_at > NOW() - INTERVAL '24 hours' ORDER BY prr.created_at DESC`
    );
    res.json(r.rows);
});

app.post('/api/password-reset-requests/:id/approve', verifyJWT, async (req, res) => {
    const approver = await getUserById(req.userId);
    if (!isSuperAdmin(approver)) return res.status(403).json({ error: 'Только для учителей' });
    const r = await pool.query('SELECT * FROM password_reset_requests WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Запрос не найден' });
    const request = r.rows[0];
    if (request.status === 'resolved') return res.status(400).json({ error: 'Запрос уже выполнен' });
    if (request.user_id === approver.id) return res.status(400).json({ error: 'Нельзя подтвердить свой запрос' });
    await pool.query(`UPDATE password_reset_requests SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`, [approver.id, req.params.id]);
    io.to('teachers').emit('password_reset_updated', { id: req.params.id, status: 'approved' });
    res.json({ ok: true, token: request.token, link: request.token ? `/?reset=${request.token}` : null });
});

app.delete('/api/password-reset-requests/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Только для учителей' });
    await pool.query('DELETE FROM password_reset_requests WHERE id = $1', [req.params.id]);
    io.to('teachers').emit('password_reset_updated', { id: req.params.id, status: 'deleted' });
    res.json({ ok: true });
});

app.post('/api/auth/reset-password-with-code', authLimiter, async (req, res) => {
    const { login, code, newPassword } = req.body;
    if (!login || !code || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
    if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'Пароль: минимум 8 символов, буква и цифра' });
    try {
        const userQ = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userQ.rows.length) return res.status(400).json({ error: 'Неверный код' });
        const user = userQ.rows[0];
        const r = await pool.query(`SELECT * FROM password_reset_requests WHERE user_id = $1 AND code = $2 AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1`, [user.id, String(code).trim()]);
        if (!r.rows.length) return res.status(400).json({ error: 'Неверный или устаревший код' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2', [hash, user.id]);
        await pool.query(`UPDATE password_reset_requests SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [r.rows[0].id]);
        io.to('teachers').emit('password_reset_updated', { id: r.rows[0].id, status: 'resolved' });
        res.json({ ok: true });
    } catch (e) { console.error('reset-with-code:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/auth/reset-password-with-token', authLimiter, async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Заполните поля' });
    if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'Пароль: минимум 8 символов, буква и цифра' });
    try {
        const r = await pool.query(`SELECT * FROM password_reset_requests WHERE token = $1 AND status = 'approved' AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`, [token]);
        if (!r.rows.length) return res.status(400).json({ error: 'Ссылка недействительна или устарела' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2', [hash, r.rows[0].user_id]);
        await pool.query(`UPDATE password_reset_requests SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [r.rows[0].id]);
        io.to('teachers').emit('password_reset_updated', { id: r.rows[0].id, status: 'resolved' });
        res.json({ ok: true });
    } catch (e) { console.error('reset-with-token:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/auth/check-reset-token/:token', authLimiter, async (req, res) => {
    const r = await pool.query(`SELECT id, status FROM password_reset_requests WHERE token = $1 AND status = 'approved' AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`, [req.params.token]);
    res.json({ valid: r.rows.length > 0 });
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

app.delete('/api/spaces/:spaceId', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!isRoot(user)) return res.status(403).json({ error: 'Только Root может удалять пространства' });
    const spaceId = req.params.spaceId;
    const exists = await pool.query('SELECT id, name FROM spaces WHERE id = $1', [spaceId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Пространство не найдено' });

    let fileKeys = [];
    try {
        const files = await pool.query('SELECT key FROM files WHERE space_id = $1', [spaceId]);
        fileKeys = files.rows.map(r => r.key);
    } catch (e) { /* тихо */ }

    io.to(`space:${spaceId}`).emit('space_deleted', { spaceId, name: exists.rows[0].name });

    try {
        await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]);
    } catch (e) {
        console.error('delete space:', e.message);
        return res.status(500).json({ error: 'Ошибка удаления: ' + e.message });
    }

    if (fileKeys.length) {
        Promise.all(fileKeys.map(k => storage.deleteFile(k).catch(() => {}))).catch(() => {});
    }

    res.json({ ok: true });
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

// ================= УЧАСТНИКИ =================
app.get('/api/spaces/:spaceId/members', verifyJWT, requireSpaceAccess, async (req, res) => {
    const user = req.currentUser;
    const root = isRoot(user);
    const r = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.is_teacher, u.avatar_emoji, sm.role, sm.custom_status, sm.joined_at, sm.muted_until,
                COALESCE(sm.hidden_from_journal, FALSE) AS hidden_from_journal
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.space_id = $1 AND u.is_teacher = FALSE
           AND (
               $2::boolean = TRUE
               OR sm.user_id = $3
               OR COALESCE(sm.hidden_from_journal, FALSE) = FALSE
           )
         ORDER BY CASE sm.role WHEN 'admin' THEN 0 WHEN 'starosta' THEN 1 ELSE 2 END, u.full_name`,
        [req.params.spaceId, root, user.id]
    );
    res.json(r.rows);
});

app.post('/api/spaces/:spaceId/members/:userId/role', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Роль: admin или member' });
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });
    const target = await pool.query('SELECT is_teacher FROM users WHERE id = $1', [req.params.userId]);
    if (target.rows[0]?.is_teacher) return res.status(403).json({ error: 'Нельзя менять роль преподавателя' });
    const r = await pool.query('UPDATE space_members SET role = $1 WHERE space_id = $2 AND user_id = $3 RETURNING *', [role, req.params.spaceId, req.params.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Не найден' });
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json(r.rows[0]);
});

app.post('/api/spaces/:spaceId/members/:userId/custom-status', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { customStatus } = req.body;
    if (typeof customStatus !== 'string') return res.status(400).json({ error: 'Неверный формат' });
    const trimmed = customStatus.trim().slice(0, 50);
    if (trimmed && violatesProfanityFilter(trimmed)) return res.status(400).json({ error: 'Запрещённые слова' });
    const target = await pool.query('SELECT is_teacher FROM users WHERE id = $1', [req.params.userId]);
    if (target.rows[0]?.is_teacher) return res.status(403).json({ error: 'Нельзя менять статус преподавателя' });
    await pool.query('UPDATE space_members SET custom_status = $1 WHERE space_id = $2 AND user_id = $3', [trimmed || null, req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ success: true });
});

app.delete('/api/spaces/:spaceId/members/:userId', verifyJWT, requireSpaceAdmin, async (req, res) => {
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя исключить себя' });
    const target = await pool.query('SELECT is_teacher FROM users WHERE id = $1', [req.params.userId]);
    if (target.rows[0]?.is_teacher) return res.status(403).json({ error: 'Нельзя исключить преподавателя' });
    await pool.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [req.params.spaceId, req.params.userId]);
    io.to(`space:${req.params.spaceId}`).emit('members_updated');
    res.json({ message: 'Исключён' });
});

app.post('/api/spaces/:spaceId/members/:userId/mute', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { minutes } = req.body;
    if (req.params.userId === req.currentUser.id) return res.status(400).json({ error: 'Нельзя замутить себя' });
    const target = await pool.query('SELECT is_teacher FROM users WHERE id = $1', [req.params.userId]);
    if (target.rows[0]?.is_teacher) return res.status(403).json({ error: 'Нельзя замутить преподавателя' });
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
    const target = await pool.query('SELECT sm.role, u.is_teacher FROM space_members sm JOIN users u ON u.id = sm.user_id WHERE sm.space_id = $1 AND sm.user_id = $2', [req.params.spaceId, req.params.userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Не найден' });
    if (target.rows[0].is_teacher) return res.status(403).json({ error: 'Нельзя забанить преподавателя' });
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
    const overrides = await pool.query(`SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE - INTERVAL '1 day' AND override_date <= CURRENT_DATE + INTERVAL '60 days'`, [req.params.spaceId]);
    res.json({ lessons: lessons.rows, overrides: overrides.rows });
});

app.post('/api/schedule', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { id, spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime } = req.body;
    if (!spaceId || !dayOfWeek || !subjectName || !startTime || !endTime) return res.status(400).json({ error: 'Заполните поля' });
    if (id) {
        const r = await pool.query(`UPDATE schedules SET subject_name=$1, classroom=$2, teacher_name=$3, start_time=$4, end_time=$5, day_of_week=$6 WHERE id = $7 AND space_id = $8 RETURNING *`, [subjectName, classroom, teacherName, startTime, endTime, dayOfWeek, id, spaceId]);
        push.notifyScheduleChange(pool, spaceId, `${subjectName} — изменено`).catch(() => {});
        return res.json(r.rows[0]);
    }
    const r = await pool.query(`INSERT INTO schedules (space_id, day_of_week, subject_name, classroom, teacher_name, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [spaceId, dayOfWeek, subjectName, classroom, teacherName, startTime, endTime]);
    push.notifyScheduleChange(pool, spaceId, `Новая пара: ${subjectName}`).catch(() => {});
    res.json(r.rows[0]);
});

app.delete('/api/schedule/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const lesson = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (!lesson.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!(await isSpaceAdmin(user, lesson.rows[0].space_id))) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
    push.notifyScheduleChange(pool, lesson.rows[0].space_id, `Пара удалена: ${lesson.rows[0].subject_name}`).catch(() => {});
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
        push.notifyScheduleChange(pool, spaceId, `Импортировано ${lessons.length} пар`).catch(() => {});
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
    try {
        const lessonQ = await pool.query('SELECT subject_name, classroom FROM schedules WHERE id = $1', [scheduleId]);
        const lesson = lessonQ.rows[0] || {};
        let body;
        if (isCanceled) body = `${date}: ${lesson.subject_name || 'пара'} — отменено`;
        else if (replacementSubject) body = `${date}: замена на «${replacementSubject}»`;
        else body = `${date}: изменение в расписании — ${lesson.subject_name || ''}`;
        push.notifyScheduleChange(pool, spaceId, body).catch(() => {});
    } catch (e) { console.error('push schedule:', e.message); }
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
    const overrides = (await pool.query(`SELECT * FROM schedule_overrides WHERE space_id = $1 AND override_date >= CURRENT_DATE AND override_date <= CURRENT_DATE + INTERVAL '90 days'`, [req.params.spaceId])).rows;
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Workspaces//RU\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Расписание\r\n';
    const toICSDate = (d, t) => `${d.replace(/-/g, '')}T${t.replace(/:/g, '').slice(0, 6)}`;
    for (let offset = 0; offset < 90; offset++) {
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
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="schedule.ics"');
    res.send(ics);
});

// ================= ДОМАШНИЕ ЗАДАНИЯ =================
app.get('/api/homework/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const hw = await pool.query(
        `SELECT h.*, hc.attachment_url, hc.attachment_urls, hc.completed_at,
                (hc.id IS NOT NULL) AS is_done, g.grade_value
         FROM homeworks h
         LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.user_id = $2
         LEFT JOIN grades g ON g.homework_id = h.id AND g.student_user_id = $2
         WHERE h.space_id = $1 ORDER BY h.due_date ASC`,
        [req.params.spaceId, req.currentUser.id]
    );
    res.json(hw.rows);
});

app.get('/api/homework/:id/stats', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const hw = await pool.query('SELECT * FROM homeworks WHERE id = $1', [req.params.id]);
    if (!hw.rows.length) return res.status(404).json({ error: 'Не найдено' });
    const spaceId = hw.rows[0].space_id;
    if (!(await isSpaceMember(user, spaceId))) return res.status(403).json({ error: 'Нет доступа' });
    const isAdmin = await isSpaceAdmin(user, spaceId);
    if (!isAdmin) return res.status(403).json({ error: 'Только преподаватель/админ' });
    const root = isRoot(user);
    const dueDate = hw.rows[0].due_date;
    const now = new Date();
    const dueDateObj = new Date(dueDate);
    dueDateObj.setHours(23, 59, 59, 999);
    const isOverdue = dueDateObj < now;
    const r = await pool.query(
        `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                hc.completed_at, hc.attachment_url, hc.attachment_urls,
                (hc.id IS NOT NULL) AS is_done,
                g.grade_value
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN homework_completions hc ON hc.homework_id = $1 AND hc.user_id = u.id
         LEFT JOIN grades g ON g.homework_id = $1 AND g.student_user_id = u.id
         WHERE sm.space_id = $2 AND u.is_teacher = FALSE
           AND ($3::boolean = TRUE OR COALESCE(sm.hidden_from_journal, FALSE) = FALSE)
         ORDER BY (hc.id IS NULL) ASC, u.full_name ASC`,
        [req.params.id, spaceId, root]
    );
    const students = r.rows.map(s => ({
        id: s.id, fullName: s.full_name, username: s.username,
        avatarEmoji: s.avatar_emoji || '👤',
        isDone: !!s.is_done, completedAt: s.completed_at,
        attachmentUrl: s.attachment_url,
        attachmentUrls: s.attachment_urls || [],
        gradeValue: s.grade_value,
        status: s.is_done ? 'done' : (isOverdue ? 'overdue' : 'pending')
    }));
    const totalCount = students.length;
    const completedCount = students.filter(s => s.isDone).length;
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    res.json({ percentage, completed: completedCount, total: totalCount, students, dueDate, isOverdue, subjectName: hw.rows[0].subject_name });
});

app.post('/api/homework', verifyJWT, requireSpaceAdmin, async (req, res) => {
    const { spaceId, subjectName, title, dueDate, attachmentUrl } = req.body;
    if (!subjectName || !title || !dueDate) return res.status(400).json({ error: 'Заполните поля' });
    const cleanAttachmentUrl = typeof attachmentUrl === 'string' && attachmentUrl.length > 0 ? attachmentUrl : null;
    const r = await pool.query('INSERT INTO homeworks (space_id, subject_name, title, due_date, attachment_url) VALUES ($1,$2,$3,$4,$5) RETURNING *', [spaceId, subjectName, title, dueDate, cleanAttachmentUrl]);
    push.notifyNewHomework(pool, spaceId, subjectName, title, dueDate).catch(() => {});
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
    const { attachment, attachments } = req.body;

    let urls = [];
    if (Array.isArray(attachments)) {
        urls = attachments.filter(u => typeof u === 'string' && u.length > 0);
    } else if (typeof attachment === 'string' && attachment.length > 0) {
        urls = [attachment];
    }
    const firstUrl = urls.length > 0 ? urls[0] : null;

    const r = await pool.query(
        `INSERT INTO homework_completions (homework_id, user_id, attachment_url, attachment_urls)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (homework_id, user_id)
         DO UPDATE SET attachment_url = EXCLUDED.attachment_url,
                       attachment_urls = EXCLUDED.attachment_urls,
                       completed_at = NOW()
         RETURNING *`,
        [req.params.id, user.id, firstUrl, urls]
    );
    res.json(r.rows[0]);
});

app.delete('/api/homework/:id/complete', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    await pool.query('DELETE FROM homework_completions WHERE homework_id = $1 AND user_id = $2', [req.params.id, user.id]);
    res.json({ message: 'Снято' });
});

// ================= ЖУРНАЛ ОЦЕНОК =================
app.get('/api/grades/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const user = req.currentUser;
    const spaceId = req.params.spaceId;
    const subject = req.query.subject;
    const ownerUserId = req.query.ownerUserId;

    if (!user.is_teacher) {
        if (ownerUserId && ownerUserId !== user.id) {
            const share = await pool.query(
                'SELECT 1 FROM grade_shares WHERE space_id = $1 AND owner_user_id = $2 AND shared_with_user_id = $3',
                [spaceId, ownerUserId, user.id]
            );
            if (!share.rows.length) return res.status(403).json({ error: 'Нет доступа к оценкам' });
            const r = await pool.query(
                `SELECT g.*, u.full_name AS teacher_name FROM grades g LEFT JOIN users u ON u.id = g.teacher_id WHERE g.space_id = $1 AND g.student_user_id = $2 ORDER BY g.lesson_date DESC`,
                [spaceId, ownerUserId]
            );
            return res.json(r.rows);
        }

        const member = await pool.query('SELECT hidden_from_journal FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, user.id]);
        const isHidden = member.rows[0]?.hidden_from_journal;
        if (isHidden) {
            const hasShare = await pool.query('SELECT 1 FROM grade_shares WHERE space_id = $1 AND owner_user_id = $2 LIMIT 1', [spaceId, user.id]);
            if (!hasShare.rows.length) return res.status(403).json({ error: 'hidden', message: 'Вы скрыты. Нажмите «Начать делиться», чтобы восстановить доступ к своим оценкам.' });
        }

        try {
            await pool.query(
                `UPDATE grades SET student_user_id = $1, updated_at = NOW()
                 WHERE space_id = $2 AND student_user_id IS NULL
                   AND name_key(student_name) = name_key($3)`,
                [user.id, spaceId, user.full_name]
            );
        } catch (e) { console.warn('auto-link grades:', e.message); }

        const r = await pool.query(
            `SELECT g.*, u.full_name AS teacher_name
             FROM grades g LEFT JOIN users u ON u.id = g.teacher_id
             WHERE g.space_id = $1
               AND (
                   g.student_user_id = $2
                   OR (
                       g.student_user_id IS NULL
                       AND name_key(g.student_name) = name_key($3)
                   )
               )
             ORDER BY g.lesson_date DESC`,
            [spaceId, user.id, user.full_name]
        );
        return res.json(r.rows);
    }

    const root = isRoot(user);
    const hiddenFilter = root ? '' : `AND (sm.hidden_from_journal = FALSE OR sm.hidden_from_journal IS NULL)`;

    let query, params;
    if (isSuperAdmin(user)) {
        if (subject) {
            query = `SELECT g.*, u.full_name AS teacher_name FROM grades g
                     LEFT JOIN users u ON u.id = g.teacher_id
                     LEFT JOIN space_members sm ON sm.space_id = g.space_id AND sm.user_id = g.student_user_id
                     WHERE g.space_id = $1 AND g.subject_name = $2 ${hiddenFilter}
                     ORDER BY g.lesson_date DESC`;
            params = [spaceId, subject];
        } else {
            query = `SELECT g.*, u.full_name AS teacher_name FROM grades g
                     LEFT JOIN users u ON u.id = g.teacher_id
                     LEFT JOIN space_members sm ON sm.space_id = g.space_id AND sm.user_id = g.student_user_id
                     WHERE g.space_id = $1 ${hiddenFilter}
                     ORDER BY g.lesson_date DESC`;
            params = [spaceId];
        }
    } else if (user.is_teacher) {
        if (subject) {
            query = `SELECT g.*, u.full_name AS teacher_name FROM grades g
                     LEFT JOIN users u ON u.id = g.teacher_id
                     LEFT JOIN space_members sm ON sm.space_id = g.space_id AND sm.user_id = g.student_user_id
                     WHERE g.space_id = $1 AND g.teacher_id = $2 AND g.subject_name = $3 ${hiddenFilter}
                     ORDER BY g.lesson_date DESC`;
            params = [spaceId, user.id, subject];
        } else {
            query = `SELECT g.*, u.full_name AS teacher_name FROM grades g
                     LEFT JOIN users u ON u.id = g.teacher_id
                     LEFT JOIN space_members sm ON sm.space_id = g.space_id AND sm.user_id = g.student_user_id
                     WHERE g.space_id = $1 AND g.teacher_id = $2 ${hiddenFilter}
                     ORDER BY g.lesson_date DESC`;
            params = [spaceId, user.id];
        }
    }
    const r = await pool.query(query, params);
    res.json(r.rows);
});

app.post('/api/grades', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user.is_teacher) return res.status(403).json({ error: 'Только для учителей' });

    const { spaceId, studentName, studentUserId, subjectName, gradeValue, attendance, lessonDate, homeworkId, comment } = req.body;
    if (!spaceId || !studentName || !subjectName || !lessonDate) return res.status(400).json({ error: 'Заполните поля' });

    if (!isRoot(user)) {
        let checkUserId = studentUserId;
        if (!checkUserId) {
            const m = await pool.query(
                `SELECT u.id FROM users u
                 JOIN space_members sm ON sm.user_id = u.id AND sm.space_id = $1
                 WHERE u.is_teacher = FALSE AND name_key(u.full_name) = name_key($2)
                 LIMIT 1`,
                [spaceId, studentName]
            );
            checkUserId = m.rows[0]?.id;
        }
        if (checkUserId) {
            const hiddenCheck = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2 AND hidden_from_journal = TRUE',
                [spaceId, checkUserId]
            );
            if (hiddenCheck.rows.length) {
                return res.status(400).json({ error: 'Ученик скрыт из журнала — оценку выставить нельзя' });
            }
        }
    }

    let finalStudentUserId = studentUserId || null;
    if (!finalStudentUserId) {
        try {
            const match = await pool.query(
                `SELECT u.id FROM users u
                 WHERE u.is_teacher = FALSE
                   AND EXISTS (
                       SELECT 1 FROM space_members sm
                       WHERE sm.space_id = $1 AND sm.user_id = u.id
                         AND name_key(u.full_name) = name_key($2)
                   )
                 LIMIT 1`,
                [spaceId, studentName]
            );
            if (match.rows.length) finalStudentUserId = match.rows[0].id;
        } catch (e) {}
    }

    try {
        const r = await pool.query(
            `INSERT INTO grades (space_id, student_user_id, student_name, subject_name, teacher_id, grade_value, attendance, lesson_date, homework_id, comment)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (space_id, student_name, subject_name, lesson_date, teacher_id)
             DO UPDATE SET grade_value = EXCLUDED.grade_value, attendance = EXCLUDED.attendance, homework_id = EXCLUDED.homework_id, comment = EXCLUDED.comment, updated_at = NOW()
             RETURNING *`,
            [spaceId, finalStudentUserId, studentName, subjectName, user.id, gradeValue || null, attendance || 'present', lessonDate, homeworkId || null, comment || null]
        );
        if (gradeValue && finalStudentUserId) {
            push.notifyGrade(pool, finalStudentUserId, subjectName, gradeValue).catch(() => {});
        }
        res.json(r.rows[0]);
    } catch (e) {
        console.error('Ошибка сохранения оценки:', e.message);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.patch('/api/grades/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user.is_teacher) return res.status(403).json({ error: 'Только для учителей' });
    const grade = await pool.query('SELECT * FROM grades WHERE id = $1', [req.params.id]);
    if (!grade.rows.length) return res.status(404).json({ error: 'Оценка не найдена' });
    const g = grade.rows[0];
    if (g.teacher_id !== user.id && !isSuperAdmin(user)) return res.status(403).json({ error: 'Нет прав' });
    const { gradeValue, attendance, comment } = req.body;
    const r = await pool.query('UPDATE grades SET grade_value = COALESCE($1, grade_value), attendance = COALESCE($2, attendance), comment = COALESCE($3, comment), updated_at = NOW() WHERE id = $4 RETURNING *', [gradeValue, attendance, comment, req.params.id]);
    if (gradeValue && g.student_user_id) push.notifyGrade(pool, g.student_user_id, g.subject_name, gradeValue).catch(() => {});
    res.json(r.rows[0]);
});

app.delete('/api/grades/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user.is_teacher) return res.status(403).json({ error: 'Только для учителей' });
    const grade = await pool.query('SELECT * FROM grades WHERE id = $1', [req.params.id]);
    if (!grade.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (grade.rows[0].teacher_id !== user.id && !isSuperAdmin(user)) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM grades WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
});

app.get('/api/teacher-subjects/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
    const user = req.currentUser;
    const r = await pool.query('SELECT * FROM teacher_subjects WHERE space_id = $1 AND teacher_id = $2 ORDER BY subject_name', [req.params.spaceId, user.id]);
    res.json(r.rows);
});

app.post('/api/teacher-subjects', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user.is_teacher) return res.status(403).json({ error: 'Только для учителей' });
    const { spaceId, subjectName } = req.body;
    if (!spaceId || !subjectName) return res.status(400).json({ error: 'Заполните поля' });
    try {
        const r = await pool.query('INSERT INTO teacher_subjects (space_id, teacher_id, subject_name) VALUES ($1, $2, $3) ON CONFLICT (space_id, teacher_id, subject_name) DO NOTHING RETURNING *', [spaceId, user.id, subjectName]);
        res.json(r.rows[0] || { ok: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/teacher-subjects/:id', verifyJWT, async (req, res) => {
    const user = await getUserById(req.userId);
    const s = await pool.query('SELECT * FROM teacher_subjects WHERE id = $1', [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ error: 'Не найдено' });
    if (s.rows[0].teacher_id !== user.id && !isSuperAdmin(user)) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('DELETE FROM teacher_subjects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
});

// ================= ЧАТ =================
app.get('/api/chat/:spaceId/messages', verifyJWT, requireSpaceAccess, async (req, res) => {
    const search = req.query.q;
    let query, params;
    if (search) {
        query = `SELECT cm.*, u.full_name, u.username, u.is_teacher, u.avatar_emoji FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.space_id = $1 AND cm.message ILIKE $2 ORDER BY cm.created_at DESC LIMIT 100`;
        params = [req.params.spaceId, '%' + search + '%'];
    } else {
        query = `SELECT cm.*, u.full_name, u.username, u.is_teacher, u.avatar_emoji FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.space_id = $1 ORDER BY cm.created_at DESC LIMIT 50`;
        params = [req.params.spaceId];
    }
    const r = await pool.query(query, params);
    const messages = r.rows.reverse();
    const ids = messages.map(m => m.id);
    if (ids.length) {
        const [reactions, files] = await Promise.all([
            pool.query(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id = ANY($1::uuid[])`, [ids]),
            pool.query(`SELECT id, message_id, original_name, mime, size, key FROM files WHERE message_id = ANY($1::uuid[])`, [ids])
        ]);

        const fileUrls = await Promise.all(files.rows.map(f => storage.getSignedFileUrl(f.key)));

        const filesMap = {};
        files.rows.forEach((f, i) => {
            if (!filesMap[f.message_id]) filesMap[f.message_id] = [];
            filesMap[f.message_id].push({ id: f.id, name: f.original_name, mime: f.mime, size: f.size, url: fileUrls[i] });
        });

        for (const m of messages) {
            m.reactions = reactions.rows.filter(r => r.message_id === m.id);
            m.files = filesMap[m.id] || [];
            if (m.reply_to_id) {
                const parent = messages.find(x => x.id === m.reply_to_id);
                if (parent) m.reply_to = { id: parent.id, full_name: parent.full_name, message: parent.message };
            }
        }
    }
    res.json(messages);
});

app.post('/api/chat/:spaceId/mark-read', verifyJWT, requireSpaceAccess, async (req, res) => {
    await pool.query(`INSERT INTO chat_read_state (user_id, space_id, last_read_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id, space_id) DO UPDATE SET last_read_at = NOW()`, [req.userId, req.params.spaceId]);
    res.json({ ok: true });
});

app.get('/api/chat/unread', verifyJWT, async (req, res) => {
    const userId = req.userId;
    const user = await getUserById(userId);
    let spaces;
    if (isSuperAdmin(user)) spaces = (await pool.query('SELECT id FROM spaces')).rows;
    else spaces = (await pool.query('SELECT space_id AS id FROM space_members WHERE user_id = $1', [userId])).rows;

    const result = {};
    if (spaces.length) {
        const spaceIds = spaces.map(s => s.id);
        const [states, counts] = await Promise.all([
            pool.query('SELECT space_id, last_read_at FROM chat_read_state WHERE user_id = $1 AND space_id = ANY($2::uuid[])', [userId, spaceIds]),
            pool.query(
                `SELECT cm.space_id, COUNT(*)::int AS c
                 FROM chat_messages cm
                 LEFT JOIN chat_read_state crs ON crs.user_id = $1 AND crs.space_id = cm.space_id
                 WHERE cm.space_id = ANY($2::uuid[])
                   AND cm.user_id != $1
                   AND (crs.last_read_at IS NULL OR cm.created_at > crs.last_read_at)
                 GROUP BY cm.space_id`,
                [userId, spaceIds]
            )
        ]);
        const countMap = {};
        counts.rows.forEach(r => { countMap[r.space_id] = r.c; });
        for (const s of spaces) {
            result[s.id] = countMap[s.id] || 0;
        }
    }
    res.json(result);
});

app.post('/api/messages/:messageId/react', verifyJWT, async (req, res) => {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'Не указан эмодзи' });
    try {
        await pool.query(`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`, [req.params.messageId, req.userId, emoji]);
        const msg = await pool.query('SELECT space_id FROM chat_messages WHERE id = $1', [req.params.messageId]);
        if (msg.rows.length) io.to(`space:${msg.rows[0].space_id}`).emit('reaction_updated', { messageId: req.params.messageId });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/messages/:messageId/react', verifyJWT, async (req, res) => {
    await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [req.params.messageId, req.userId]);
    const msg = await pool.query('SELECT space_id FROM chat_messages WHERE id = $1', [req.params.messageId]);
    if (msg.rows.length) io.to(`space:${msg.rows[0].space_id}`).emit('reaction_updated', { messageId: req.params.messageId });
    res.json({ ok: true });
});

app.get('/api/notification-prefs', verifyJWT, async (req, res) => {
    const r = await pool.query('SELECT * FROM user_notification_prefs WHERE user_id = $1', [req.userId]);
    if (!r.rows.length) {
        const defaults = await pool.query('INSERT INTO user_notification_prefs (user_id) VALUES ($1) RETURNING *', [req.userId]);
        return res.json(defaults.rows[0]);
    }
    res.json(r.rows[0]);
});

app.post('/api/notification-prefs', verifyJWT, async (req, res) => {
    const { all_enabled, chat_enabled, schedule_enabled, lesson_reminder_enabled, new_homework_enabled, homework_deadline_enabled, grades_enabled } = req.body;
    try {
        const r = await pool.query(
            `INSERT INTO user_notification_prefs (user_id, all_enabled, chat_enabled, schedule_enabled, lesson_reminder_enabled, new_homework_enabled, homework_deadline_enabled, grades_enabled, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
             ON CONFLICT (user_id) DO UPDATE SET all_enabled = EXCLUDED.all_enabled, chat_enabled = EXCLUDED.chat_enabled, schedule_enabled = EXCLUDED.schedule_enabled, lesson_reminder_enabled = EXCLUDED.lesson_reminder_enabled, new_homework_enabled = EXCLUDED.new_homework_enabled, homework_deadline_enabled = EXCLUDED.homework_deadline_enabled, grades_enabled = EXCLUDED.grades_enabled, updated_at = NOW()
             RETURNING *`,
            [req.userId, all_enabled !== false, chat_enabled !== false, schedule_enabled !== false, lesson_reminder_enabled !== false, new_homework_enabled !== false, homework_deadline_enabled !== false, grades_enabled !== false]
        );
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/presence/active', verifyJWT, async (req, res) => {
    await pool.query(`INSERT INTO user_presence (user_id, last_seen_at, is_active) VALUES ($1, NOW(), TRUE) ON CONFLICT (user_id) DO UPDATE SET last_seen_at = NOW(), is_active = TRUE`, [req.userId]);
    res.json({ ok: true });
});

app.post('/api/presence/inactive', verifyJWT, async (req, res) => {
    await pool.query(`INSERT INTO user_presence (user_id, last_seen_at, is_active) VALUES ($1, NOW(), FALSE) ON CONFLICT (user_id) DO UPDATE SET last_seen_at = NOW(), is_active = FALSE`, [req.userId]);
    res.json({ ok: true });
});

registerFileRoutes(app, pool, verifyJWT, requireSpaceAccess);
registerExcelRoutes(app, pool, verifyJWT, requireSpaceAdmin);
registerJournalRoutes(app, pool, verifyJWT, requireSpaceAccess);
registerHiddenRoutes(app, pool, verifyJWT, requireSpaceAccess, requireSpaceAdmin);
push.registerPushRoutes(app, pool, verifyJWT, requireSpaceAccess);

// ================= ИГРЫ =================
const VALID_GAMES = ['2048', 'snake-arena', 'rpg-clicker', 'memory', 'reaction'];

const RPG_SCORE_SQL = `LEAST(
    rs.level::bigint * 10000 + rs.kills_total::bigint * 100 + (rs.coins / 10),
    2100000000
)::int`;

// Глобальный рейтинг
app.get('/api/games-global/:gameId/leaderboard', verifyJWT, async (req, res) => {
    const gameId = req.params.gameId;
    if (!VALID_GAMES.includes(gameId)) return res.json([]);
    try {
        if (gameId === 'rpg-clicker') {
            const r = await pool.query(
                `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                        ${RPG_SCORE_SQL} AS score,
                        rs.level, rs.kills_total, rs.coins
                 FROM rpg_state rs
                 JOIN users u ON u.id = rs.user_id
                 ORDER BY score DESC
                 LIMIT 20`
            );
            return res.json(r.rows);
        }
        const r = await pool.query(
            `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                    MAX(gs.score)::int AS score
             FROM game_scores gs
             JOIN users u ON u.id = gs.user_id
             WHERE gs.game_id = $1
             GROUP BY u.id, u.full_name, u.username, u.avatar_emoji
             ORDER BY score DESC
             LIMIT 20`,
            [gameId]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('global leaderboard:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Локальный рейтинг (по текущей группе)
app.get('/api/games/:spaceId/:gameId/leaderboard', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { spaceId, gameId } = req.params;
    if (!VALID_GAMES.includes(gameId)) return res.json([]);
    try {
        if (gameId === 'rpg-clicker') {
            const r = await pool.query(
                `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                        ${RPG_SCORE_SQL} AS score,
                        rs.level, rs.kills_total, rs.coins
                 FROM rpg_state rs
                 JOIN users u ON u.id = rs.user_id
                 JOIN space_members sm ON sm.user_id = u.id AND sm.space_id = $1
                 WHERE u.is_teacher = FALSE
                 ORDER BY score DESC
                 LIMIT 20`,
                [spaceId]
            );
            return res.json(r.rows);
        }
        const r = await pool.query(
            `SELECT gs.score::int AS score, gs.updated_at,
                    u.id, u.full_name, u.username, u.avatar_emoji
             FROM game_scores gs
             JOIN users u ON u.id = gs.user_id
             WHERE gs.space_id = $1 AND gs.game_id = $2
             ORDER BY gs.score DESC
             LIMIT 20`,
            [spaceId, gameId]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('local leaderboard:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Отправка счёта для snake/2048/memory/reaction
app.post('/api/games/:spaceId/:gameId/score', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { score } = req.body;
    const { spaceId, gameId } = req.params;
    if (!VALID_GAMES.includes(gameId)) return res.status(400).json({ error: 'Неизвестная игра' });
    if (gameId === 'rpg-clicker') return res.status(400).json({ error: 'Для кликера используйте /api/games/rpg-state' });
    if (typeof score !== 'number' || score < 0 || !isFinite(score)) return res.status(400).json({ error: 'Неверный счёт' });
    try {
        await pool.query(
            `INSERT INTO game_scores (space_id, user_id, game_id, score)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (space_id, user_id, game_id)
             DO UPDATE SET score = GREATEST(game_scores.score, EXCLUDED.score),
                           updated_at = NOW()`,
            [spaceId, req.userId, gameId, Math.floor(score)]
        );
        res.json({ message: 'Сохранено' });
    } catch (e) {
        console.error('submit score:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// RPG-кликер: загрузка и сохранение состояния
app.get('/api/games/rpg-state', verifyJWT, async (req, res) => {
    try {
        let r = await pool.query('SELECT * FROM rpg_state WHERE user_id = $1', [req.userId]);
        if (!r.rows.length) {
            r = await pool.query(
                `INSERT INTO rpg_state (user_id) VALUES ($1)
                 ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
                 RETURNING *`,
                [req.userId]
            );
        }
        const s = r.rows[0];
        res.json({
            coins: Number(s.coins) || 0,
            level: s.level || 1,
            sword: s.sword || 1,
            armor: s.armor || 0,
            guilds: s.guilds || 0,
            warriors: s.warriors || 0,
            artifacts: s.artifacts || 0,
            monsterIdx: s.monster_idx || 0,
            killsTotal: s.kills_total || 0,
            killsOnLevel: s.kills_on_level || 0,
            lastOnline: s.last_online ? new Date(s.last_online).getTime() : 0,
            extra: (s.extra && typeof s.extra === 'object') ? s.extra : {}
        });
    } catch (e) {
        console.error('rpg-state GET:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/games/rpg-state', verifyJWT, async (req, res) => {
    const {
        coins, level, sword, armor, guilds, warriors, artifacts,
        monsterIdx, killsTotal, killsOnLevel, extra
    } = req.body || {};

    const toInt = (v, def = 0) => {
        const n = Number(v);
        return (isFinite(n) && n >= 0) ? Math.floor(n) : def;
    };

    const safe = {
        coins: toInt(coins),
        level: Math.max(1, toInt(level, 1)),
        sword: Math.max(1, toInt(sword, 1)),
        armor: toInt(armor),
        guilds: toInt(guilds),
        warriors: toInt(warriors),
        artifacts: toInt(artifacts),
        monsterIdx: toInt(monsterIdx),
        killsTotal: toInt(killsTotal),
        killsOnLevel: toInt(killsOnLevel)
    };

    // extra — произвольные доп.данные новой механики кликера (этапы/боссы/магазин).
    // Не участвует в формуле таблицы лидеров — валидируем только на "не мусор" и размер.
    let safeExtra = {};
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        try {
            const json = JSON.stringify(extra);
            if (json.length <= 20000) safeExtra = extra;
        } catch (e) { /* оставляем {} */ }
    }

    try {
        await pool.query(
            `INSERT INTO rpg_state
                (user_id, coins, level, sword, armor, guilds, warriors, artifacts,
                 monster_idx, kills_total, kills_on_level, extra, last_online, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                coins = EXCLUDED.coins,
                level = EXCLUDED.level,
                sword = EXCLUDED.sword,
                armor = EXCLUDED.armor,
                guilds = EXCLUDED.guilds,
                warriors = EXCLUDED.warriors,
                artifacts = EXCLUDED.artifacts,
                monster_idx = EXCLUDED.monster_idx,
                kills_total = EXCLUDED.kills_total,
                kills_on_level = EXCLUDED.kills_on_level,
                extra = EXCLUDED.extra,
                last_online = NOW(),
                updated_at = NOW()`,
            [
                req.userId,
                safe.coins, safe.level, safe.sword, safe.armor,
                safe.guilds, safe.warriors, safe.artifacts,
                safe.monsterIdx, safe.killsTotal, safe.killsOnLevel,
                JSON.stringify(safeExtra)
            ]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('rpg-state POST:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// Сброс рекордов группы
app.post('/api/games/:spaceId/:gameId/reset', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM game_scores WHERE space_id = $1 AND game_id = $2', [req.params.spaceId, req.params.gameId]);
    res.json({ message: 'Рекорды сброшены' });
});

// ================= SOCKET.IO =================
io.on('connection', async (socket) => {
    try {
        const token = socket.handshake.query && socket.handshake.query.token;
        if (token && token !== 'null' && token !== '') {
            const { userId } = jwt.verify(token, JWT_SECRET);
            const user = await getUserById(userId);
            if (user) {
                socket.userId = user.id;
                socket.gameUser = user;
                if (isSuperAdmin(user)) socket.join('teachers');
            }
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
            if (isSuperAdmin(user)) socket.join('teachers');
        } catch (e) {}
    });

    socket.on('typing_start', async () => {
        if (!socket.userId || !socket.spaceId) return;
        const user = await getUserById(socket.userId);
        if (!user) return;
        socket.to(`space:${socket.spaceId}`).emit('user_typing', { userId: user.id, nickname: user.username, fullName: user.full_name });
    });

    socket.on('typing_stop', () => {
        if (!socket.userId || !socket.spaceId) return;
        socket.to(`space:${socket.spaceId}`).emit('user_stopped_typing', { userId: socket.userId });
    });

    socket.on('send_message', async ({ message, replyToId, fileIds, mentions }) => {
        if (!socket.userId || !socket.spaceId || !message || !message.trim()) return;
        const user = await getUserById(socket.userId);
        const settings = (await pool.query('SELECT * FROM system_settings WHERE id = 1')).rows[0];
        if (settings.exams_mode && !user.is_teacher) return;
        const member = await pool.query('SELECT * FROM space_members WHERE space_id = $1 AND user_id = $2', [socket.spaceId, user.id]);
        if (member.rows[0]?.muted_until && new Date(member.rows[0].muted_until) > new Date()) return;
        const text = String(message).slice(0, 2000);
        const r = await pool.query('INSERT INTO chat_messages (space_id, user_id, message, reply_to_id) VALUES ($1,$2,$3,$4) RETURNING *', [socket.spaceId, user.id, text, replyToId || null]);
        const messageId = r.rows[0].id;
        if (Array.isArray(fileIds) && fileIds.length) {
            await pool.query('UPDATE files SET message_id = $1 WHERE id = ANY($2::uuid[]) AND user_id = $3', [messageId, fileIds, user.id]);
        }
        let mentionedIds = [];
        if (Array.isArray(mentions) && mentions.length) {
            for (const uid of mentions) {
                try {
                    await pool.query('INSERT INTO message_mentions (message_id, mentioned_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [messageId, uid]);
                    mentionedIds.push(uid);
                } catch (e) {}
            }
        }
        const files = fileIds && fileIds.length ? (await pool.query('SELECT id, original_name, mime, size, key FROM files WHERE message_id = $1', [messageId])).rows : [];
        const fileUrls = await Promise.all(files.map(f => storage.getSignedFileUrl(f.key)));
        const filesWithUrls = files.map((f, i) => ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size, url: fileUrls[i] }));

        let replyTo = null;
        if (replyToId) {
            const parent = await pool.query('SELECT id, message, user_id FROM chat_messages WHERE id = $1', [replyToId]);
            if (parent.rows.length) {
                const parentUser = await getUserById(parent.rows[0].user_id);
                replyTo = { id: parent.rows[0].id, full_name: parentUser?.full_name, message: parent.rows[0].message };
            }
        }
        const fullMessage = {
            ...r.rows[0], full_name: user.full_name, username: user.username,
            is_teacher: user.is_teacher, avatar_emoji: user.avatar_emoji,
            reactions: [], files: filesWithUrls, reply_to: replyTo
        };
        io.to(`space:${socket.spaceId}`).emit('new_message', fullMessage);
        push.notifyChatMessage(pool, socket.spaceId, user, text, { replyToId, mentionedIds, messageId }).catch(e => console.error('push chat:', e.message));
    });

    socket.on('delete_message', async ({ messageId }) => {
        if (!socket.userId || !socket.spaceId) return;
        const user = await getUserById(socket.userId);
        if (!(await isSpaceAdmin(user, socket.spaceId))) return;
        await pool.query('DELETE FROM chat_messages WHERE id = $1 AND space_id = $2', [messageId, socket.spaceId]);
        io.to(`space:${socket.spaceId}`).emit('message_deleted', { messageId });
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            pool.query('UPDATE user_presence SET is_active = FALSE WHERE user_id = $1', [socket.userId]).catch(() => {});
        }
    });
});

// ================= СЛУЖЕБНЫЕ =================
app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const mem = process.memoryUsage();
        res.json({ ok: true, db: 'ok', memory: { rss: Math.round(mem.rss / 1024 / 1024) + ' MB', heap: Math.round(mem.heapUsed / 1024 / 1024) + ' MB' }, uptime: Math.round(process.uptime()) + ' s' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

async function cleanupOldMessages() {
    try {
        const r = await pool.query("DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'");
        if (r.rowCount) console.log(`🧹 Удалено старых сообщений: ${r.rowCount}`);
    } catch (e) { console.error('Очистка:', e.message); }
}
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

async function cleanupOldResetRequests() {
    try { await pool.query("DELETE FROM password_reset_requests WHERE created_at < NOW() - INTERVAL '24 hours' AND status != 'resolved'"); } catch (e) {}
}
setInterval(cleanupOldResetRequests, 60 * 60 * 1000);

process.on('unhandledRejection', (err) => { console.error('❌ UNHANDLED REJECTION:', err?.message || err); });
process.on('uncaughtException', (err) => { console.error('❌ UNCAUGHT EXCEPTION:', err?.message || err); });

async function ensureSchema() {
    try {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);
    } catch (e) { console.warn('⚠️ schema.sql не применён целиком:', e.message); }

    const migrations = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(100)`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(100)`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'auto'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji VARCHAR(50) DEFAULT '👤'`,
        `ALTER TABLE space_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE space_members ADD COLUMN IF NOT EXISTS custom_status VARCHAR(50) DEFAULT NULL`,
        `ALTER TABLE space_members ADD COLUMN IF NOT EXISTS hidden_from_journal BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL`,
        `ALTER TABLE journal_students ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0`,
        `ALTER TABLE homework_completions ADD COLUMN IF NOT EXISTS attachment_urls TEXT[] DEFAULT '{}'`,
        `ALTER TABLE homeworks ADD COLUMN IF NOT EXISTS attachment_url TEXT`,
        `ALTER TABLE rpg_state ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}'::jsonb`,
        `CREATE INDEX IF NOT EXISTS idx_journal_students_order ON journal_students(space_id, subject_name, sort_order)`,
        `CREATE INDEX IF NOT EXISTS idx_grades_date_space ON grades(space_id, lesson_date DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_grades_space_subject ON grades(space_id, subject_name)`,
        `CREATE INDEX IF NOT EXISTS idx_journal_students_name ON journal_students(space_id, subject_name, student_name)`,
        `CREATE INDEX IF NOT EXISTS idx_hw_space_due ON homeworks(space_id, due_date)`,
        `CREATE INDEX IF NOT EXISTS idx_hw_completions_hw_user ON homework_completions(homework_id, user_id)`
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
    await pool.query(
        `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code, email_verified)
         VALUES ('root_teacher', 'Главный Администратор Колледжа', $1, $2, true, true, 'ROOT', true)`,
        [process.env.ROOT_TEACHER_EMAIL || 'root@college.local', hash]
    );
    console.log('👑 Аккаунт root_teacher создан');
}

const PORT = process.env.PORT || 3000;
(async () => {
    try { await ensureSchema(); await ensureRootTeacher(); await cleanupOldMessages(); }
    catch (e) { console.error('Ошибка init:', e.message); }
    server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
})();
