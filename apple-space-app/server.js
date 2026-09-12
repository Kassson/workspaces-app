require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/teach', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teach', 'index.html')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET || 'workspaces_secret_key';

const teacherRegCodes = new Map(); // Регистрация учителей (код -> email)
const teacherResetCodes = new Map(); // Сброс пароля учителей (email -> код)

function generateTeacherCode() { return Math.floor(10000 + Math.random() * 90000).toString(); }

// Список разрешенных почтовых доменов
const ALLOWED_DOMAINS = [
    'gmail.com',
    'mail.ru',
    'yandex.ru',
    'rambler.ru',
    'bk.ru',
    'list.ru',
    'inbox.ru',
    'ya.ru',
    'outlook.com',
    'yahoo.com'
];

function isValidEmailDomain(email) {
    if (!email) return false;
    const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
    if (!match) return false;
    const domain = match[1].toLowerCase();
    return ALLOWED_DOMAINS.includes(domain);
}

// ================= СТУДЕНТЫ =================
app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, nickName, email, password } = req.body;

    if (!isValidEmailDomain(email)) {
        return res.status(400).json({ error: 'Введите реальный адрес почты (gmail.com, mail.ru, yandex.ru и др.)' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified) VALUES ($1, $2, $3, $4, false, false)', 
            [nickName, `${firstName} ${lastName}`, email, hash]
        );
        res.json({ message: 'Успех' });
    } catch (err) { 
        res.status(400).json({ error: 'Почта или логин уже заняты' }); 
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { email, password } = req.body;
    
    if (!isValidEmailDomain(email)) {
        return res.status(400).json({ error: 'Введите корректный адрес почты' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 AND is_teacher = false', [hash, email]);
        
        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'Пользователь с такой почтой не найден' });
        }
        
        res.json({ message: 'Пароль изменен' });
    } catch (err) { 
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// ================= ПРЕПОДАВАТЕЛИ =================
app.post('/api/teach/register', async (req, res) => {
    const { fullName, email, password } = req.body;

    if (!isValidEmailDomain(email)) {
        return res.status(400).json({ error: 'Введите реальный адрес почты (gmail.com, mail.ru, yandex.ru и др.)' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified) VALUES ($1, $2, $3, $4, true, false)', [email.split('@')[0], fullName, email, hash]);
        const regCode = generateTeacherCode();
        teacherRegCodes.set(regCode, email); 
        res.json({ code: regCode });
    } catch (err) { res.status(400).json({ error: 'Email уже используется' }); }
});

app.post('/api/teach/request-reset', async (req, res) => {
    const { email } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE email = $1 AND is_teacher = true', [email]);
    if (!user.rows.length) return res.status(400).json({ error: 'Преподаватель не найден' });
    
    const resetCode = generateTeacherCode();
    teacherResetCodes.set(email, resetCode);
    res.json({ message: 'Код запрошен. Обратитесь к коллегам.' });
});

app.post('/api/teach/apply-reset', async (req, res) => {
    const { email, code, password } = req.body;
    if (teacherResetCodes.get(email) !== code) return res.status(400).json({ error: 'Неверный код от коллеги' });
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 AND is_teacher = true', [hash, email]);
    teacherResetCodes.delete(email);
    res.json({ message: 'Пароль успешно изменен' });
});

const verifyTeacherJWT = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'Нет доступа' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch(e) { res.status(403).json({ error: 'Неверный токен' }); }
};

app.get('/api/teach/pending', verifyTeacherJWT, (req, res) => {
    const resets = Array.from(teacherResetCodes.entries()).map(([email, code]) => ({ email, code }));
    res.json({ resets });
});

app.post('/api/teach/verify-colleague', verifyTeacherJWT, async (req, res) => {
    const { code } = req.body;
    const emailToVerify = teacherRegCodes.get(code);
    if (!emailToVerify) return res.status(400).json({ error: 'Код не найден или устарел' });

    await pool.query('UPDATE users SET is_teacher_verified = true WHERE email = $1', [emailToVerify]);
    teacherRegCodes.delete(code);
    res.json({ message: 'Коллега успешно авторизован!' });
});

// ================= ОБЩИЙ ВХОД =================
app.post('/api/auth/login', async (req, res) => {
    const { login, password, isTeacher } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userRes.rows.length) return res.status(400).json({ error: 'Пользователь не найден' });

        const user = userRes.rows[0];
        if (isTeacher && !user.is_teacher) return res.status(403).json({ error: 'Это аккаунт студента' });
        if (!isTeacher && user.is_teacher) return res.status(403).json({ error: 'Это аккаунт преподавателя' });
        if (isTeacher && !user.is_teacher_verified) return res.status(403).json({ error: 'Аккаунт еще не подтвержден коллегами' });

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Неверный пароль' });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: { id: user.id, username: user.username, fullName: user.full_name } });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
