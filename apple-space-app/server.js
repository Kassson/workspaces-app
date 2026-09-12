require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const nodemailer = require('nodemailer');

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

// Почта для студентов
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const otpStore = new Map(); // Студенты (код по почте)
const teacherRegCodes = new Map(); // Регистрация учителей (код -> email)
const teacherResetCodes = new Map(); // Сброс пароля учителей (email -> код)

function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function generateTeacherCode() { return Math.floor(10000 + Math.random() * 90000).toString(); }

// ================= СТУДЕНТЫ =================
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const otp = generateOTP();
    otpStore.set(email, { code: otp, expires: Date.now() + 10 * 60000 });
    try {
        await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject: 'Код Workspaces', text: `Ваш код: ${otp}` });
        res.json({ message: 'Код отправлен на почту' });
    } catch (err) {
        console.error("Ошибка почты, код для логов:", otp);
        res.json({ message: 'Код сгенерирован (см. логи)' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, nickName, email, password, code } = req.body;
    const record = otpStore.get(email);
    if (!record || record.code !== code || record.expires < Date.now()) return res.status(400).json({ error: 'Неверный код' });

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified) VALUES ($1, $2, $3, $4, false, false)', [nickName, `${firstName} ${lastName}`, email, hash]);
        otpStore.delete(email);
        res.json({ message: 'Успех' });
    } catch (err) { res.status(400).json({ error: 'Почта или логин уже заняты' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { email, password, code } = req.body;
    const record = otpStore.get(email);
    if (!record || record.code !== code) return res.status(400).json({ error: 'Неверный код' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 AND is_teacher = false', [hash, email]);
    otpStore.delete(email);
    res.json({ message: 'Пароль изменен' });
});

// ================= ПРЕПОДАВАТЕЛИ =================
app.post('/api/teach/register', async (req, res) => {
    const { fullName, email, password } = req.body;
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
