require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/teach', express.static(path.join(__dirname, 'public/teach')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Необходима авторизация' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Сессия истекла' });
        req.user = user;
        next();
    });
};

// --- SELF-PING (Сервер никогда не засыпает) ---
app.get('/api/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

setInterval(() => {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    http.get(`${serverUrl}/api/ping`, () => {}).on('error', () => {});
}, 10 * 60 * 1000);

// --- АВТООЧИСТКА ЧАТА (Раз в сутки) ---
cron.schedule('0 0 * * *', async () => {
    try {
        await pool.query("DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'");
    } catch (err) {
        console.error('[Cleanup Error]:', err);
    }
});

// --- ЦЕНЗУРА И ФИЛЬТР НИКНЕЙМОВ ---
const FORBIDDEN_NAMES = ['гитлер', 'hitler', 'адольф', 'adolf', 'сталин', 'stalin', 'нацист', 'админ', 'administrator', 'root'];
function isForbiddenUsername(username) {
    if (!username) return true;
    const lower = username.toLowerCase().replace(/[\s_.-]/g, '');
    for (const forbidden of FORBIDDEN_NAMES) {
        if (lower.includes(forbidden)) return true;
    }
    const profanityRegex = /(хуй|пизд|ебат|бля|сук|мудак|чмо|cock|fuck|bitch|cunt|nigger|nigga)/i;
    return profanityRegex.test(lower);
}

// --- API НАСТРОЕК ---
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_settings WHERE id = 1');
        res.json(result.rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения настроек' });
    }
});

app.post('/api/settings/update', authenticateToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId]);
        if (!userRes.rows.length || userRes.rows[0].username !== 'root_teacher') {
            return res.status(403).json({ error: 'Только Root Teacher имеет доступ' });
        }

        const { remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement } = req.body;
        await pool.query(`
            UPDATE system_settings 
            SET remote_mode = $1, maintenance_mode = $2, exams_mode = $3, private_chat_mode = $4, global_announcement = $5
            WHERE id = 1
        `, [remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement]);

        io.emit('settings_updated', req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

// --- РЕГИСТРАЦИЯ СТУДЕНТОВ ---
app.post('/api/auth/register-student', async (req, res) => {
    const { username, fullName, email, password } = req.body;
    if (isForbiddenUsername(username) || isForbiddenUsername(fullName)) {
        return res.status(400).json({ error: 'Недопустимое имя или никнейм' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            'INSERT INTO users (username, full_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, email',
            [username, fullName, email, hashedPassword]
        );
        const token = jwt.sign({ userId: newUser.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: newUser.rows[0] });
    } catch (err) {
        res.status(400).json({ error: 'Пользователь уже существует' });
    }
});

// --- РЕГИСТРАЦИЯ ПРЕПОДАВАТЕЛЕЙ ---
app.post('/api/auth/register-teacher', async (req, res) => {
    const { username, fullName, email, password } = req.body;
    if (isForbiddenUsername(username) || isForbiddenUsername(fullName)) {
        return res.status(400).json({ error: 'Недопустимое имя или никнейм' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const code = 'T-' + Math.floor(1000 + Math.random() * 9000);
        const newUser = await pool.query(
            `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code)
             VALUES ($1, $2, $3, $4, TRUE, FALSE, $5) RETURNING id, username, full_name, verification_code`,
            [username, fullName, email, hashedPassword, code]
        );
        const token = jwt.sign({ userId: newUser.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: newUser.rows[0] });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка регистрации преподавателя' });
    }
});

// --- АВТОРИЗАЦИЯ ---
app.post('/api/auth/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        if (!userRes.rows.length) return res.status(400).json({ error: 'Неверный логин или пароль' });

        const user = userRes.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Неверный логин или пароль' });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ 
            token, 
            user: { 
                id: user.id, 
                username: user.username, 
                fullName: user.full_name, 
                isTeacher: user.is_teacher, 
                isTeacherVerified: user.is_teacher_verified,
                verificationCode: user.verification_code 
            } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- ВЕРИФИКАЦИЯ УЧИТЕЛЕЙ ---
app.get('/api/teach/pending-verifications', authenticateToken, async (req, res) => {
    try {
        const list = await pool.query(
            'SELECT id, username, full_name, email, verification_code, created_at FROM users WHERE is_teacher = TRUE AND is_teacher_verified = FALSE'
        );
        res.json(list.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения списка' });
    }
});

app.post('/api/teach/verify', authenticateToken, async (req, res) => {
    const { teacherId } = req.body;
    try {
        await pool.query('UPDATE users SET is_teacher_verified = TRUE, verified_by = $1 WHERE id = $2', [req.user.userId, teacherId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка верификации' });
    }
});

// --- SOCKET.IO ЛОББИ И ИГРЫ ---
const gameRooms = {};
io.on('connection', (socket) => {
    socket.on('join_game_lobby', ({ gameId, spaceId, userId, username }) => {
        const roomId = `${spaceId}_${gameId}`;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.userId = userId;

        if (!gameRooms[roomId]) {
            gameRooms[roomId] = { gameId, spaceId, status: 'lobby', players: {} };
        }

        gameRooms[roomId].players[userId] = {
            id: userId, username, ready: false, isGhost: false, x: 100, y: 100
        };

        io.to(roomId).emit('lobby_state_update', gameRooms[roomId]);
    });

    socket.on('player_toggle_ready', () => {
        const room = gameRooms[socket.roomId];
        if (room && room.players[socket.userId]) {
            room.players[socket.userId].ready = !room.players[socket.userId].ready;
            const allPlayers = Object.values(room.players);
            const allReady = allPlayers.length >= 2 && allPlayers.every(p => p.ready);

            if (allReady && room.status === 'lobby') {
                room.status = 'playing';
                io.to(socket.roomId).emit('game_start_countdown', { duration: 3 });
            } else {
                io.to(socket.roomId).emit('lobby_state_update', room);
            }
        }
    });

    socket.on('player_died', () => {
        const room = gameRooms[socket.roomId];
        if (room && room.players[socket.userId]) {
            room.players[socket.userId].isGhost = true;
            io.to(socket.roomId).emit('player_became_ghost', { userId: socket.userId });
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && gameRooms[socket.roomId]) {
            delete gameRooms[socket.roomId].players[socket.userId];
            io.to(socket.roomId).emit('lobby_state_update', gameRooms[socket.roomId]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер Workspaces запущен на порту ${PORT}`));



