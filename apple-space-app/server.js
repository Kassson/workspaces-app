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

// Правильная раздача статических файлов (чтобы работал CSS везде)
app.use(express.static(path.join(__dirname, 'public')));

// Явные маршруты для страниц
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/teach', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'teach', 'index.html'));
});

// База данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Инициализация Root-админа
async function initRootTeacher() {
    const rootUser = process.env.ROOT_TEACHER_USER;
    const rootPass = process.env.ROOT_TEACHER_PASS;
    if (!rootUser || !rootPass) return;

    try {
        const hashedPassword = await bcrypt.hash(rootPass, 10);
        await pool.query(`
            INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified)
            VALUES ($1, 'Главный Администратор', 'root@workspaces.edu', $2, TRUE, TRUE)
            ON CONFLICT (username) DO UPDATE SET password_hash = $2, is_teacher = TRUE, is_teacher_verified = TRUE;
        `, [rootUser, hashedPassword]);
    } catch (err) { console.error('Ошибка инициализации Root:', err.message); }
}
initRootTeacher();

// Авторизация
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
        res.json({ token, user: { id: user.id, username: user.username, fullName: user.full_name } });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
