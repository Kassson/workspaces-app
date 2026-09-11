Require('dotenv').config();
Const express = require('express');
Const http = require('http');
Const { Server } = require('socket.io');
Const { Pool } = require('pg');
Const jwt = require('jsonwebtoken');
Const bcrypt = require('bcryptjs');
Const cron = require('node-cron');
Const path = require('path');

Const app = express();
Const server = http.createServer(app);
Const io = new Server(server, { cors: { origin: «*» } });

App.use(express.json({ limit: '10mb' }));

App.use(express.static(path.join(__dirname, 'public')));
App.use('/teach', express.static(path.join(__dirname, 'public/teach')));

Const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

Const JWT_SECRET = process.env.JWT_SECRET || 'secret';

Const authenticateToken = (req, res, next) => {
    Const authHeader = req.headers['authorization'];
    Const token = authHeader && authHeader.split(' ')[1];
    If (!token) return res.status(401).json({ error: 'Необходима авторизация' });

    Jwt.verify(token, JWT_SECRET, (err, user) => {
        If (err) return res.status(403).json({ error: 'Сессия истекла' });
        Req.user = user;
        Next();
    });
};

// --- SELF-PING (Сервер никогда не засыпает) ---
App.get('/api/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

setInterval(() => {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    http.get(`${serverUrl}/api/ping`, () => {}).on('error', () => {});
}, 10 * 60 * 1000);

// --- АВТООЧИСТКА ЧАТА (Раз в сутки) ---
Cron.schedule('0 0 * * *', async () => {
    Try {
        Await pool.query(«DELETE FROM chat_messages WHERE created_at < NOW() – INTERVAL ’30 days'»);
    } catch (err) {
        Console.error('[Cleanup Error]:', err);
    }
});

// --- ЦЕНЗУРА И ФИЛЬТР НИКНЕЙМОВ ---
Const FORBIDDEN_NAMES = ['гитлер', 'hitler', 'адольф', 'adolf', 'сталин', 'stalin', 'нацист', 'админ', 'administrator', 'root'];
Function isForbiddenUsername(username) {
    If (!username) return true;
    Const lower = username.toLowerCase().replace(/[\s_.-]/g, '');
    For (const forbidden of FORBIDDEN_NAMES) {
        If (lower.includes(forbidden)) return true;
    }
    Const profanityRegex = /(хуй|пизд|ебат|бля|сук|мудак|чмо|cock|fuck|bitch|cunt|nigger|nigga)/i;
    Return profanityRegex.test(lower);
}

// --- API НАСТРОЕК ---
App.get('/api/settings', async (req, res) => {
    Try {
        Const result = await pool.query('SELECT * FROM system_settings WHERE id = 1');
        Res.json(result.rows[0] || {});
    } catch (err) {
        Res.status(500).json({ error: 'Ошибка получения настроек' });
    }
});

App.post('/api/settings/update', authenticateToken, async (req, res) => {
    Try {
        Const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId]);
        If (!userRes.rows.length || userRes.rows[0].username !== 'root_teacher') {
            Return res.status(403).json({ error: 'Только Root Teacher имеет доступ' });
        }

        Const { remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement } = req.body;
        Await pool.query(`
            UPDATE system_settings 
            SET remote_mode = $1, maintenance_mode = $2, exams_mode = $3, private_chat_mode = $4, global_announcement = $5
            WHERE id = 1
        `, [remote_mode, maintenance_mode, exams_mode, private_chat_mode, global_announcement]);

        Io.emit('settings_updated', req.body);
        Res.json({ success: true });
    } catch (err) {
        Res.status(500).json({ error: 'Ошибка обновления' });
    }
});

// --- РЕГИСТРАЦИЯ СТУДЕНТОВ ---
App.post('/api/auth/register-student', async (req, res) => {
    Const { username, fullName, email, password } = req.body;
    If (isForbiddenUsername(username) || isForbiddenUsername(fullName)) {
        Return res.status(400).json({ error: 'Недопустимое имя или никнейм' });
    }
    Try {
        Const hashedPassword = await bcrypt.hash(password, 10);
        Const newUser = await pool.query(
            'INSERT INTO users (username, full_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, email',
            [username, fullName, email, hashedPassword]
        );
        Const token = jwt.sign({ userId: newUser.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
        Res.json({ token, user: newUser.rows[0] });
    } catch (err) {
        Res.status(400).json({ error: 'Пользователь уже существует' });
    }
});

// --- РЕГИСТРАЦИЯ ПРЕПОДАВАТЕЛЕЙ ---
App.post('/api/auth/register-teacher', async (req, res) => {
    Const { username, fullName, email, password } = req.body;
    If (isForbiddenUsername(username) || isForbiddenUsername(fullName)) {
        Return res.status(400).json({ error: 'Недопустимое имя или никнейм' });
    }
    Try {
        Const hashedPassword = await bcrypt.hash(password, 10);
        Const code = 'T-' + Math.floor(1000 + Math.random() * 9000);
        Const newUser = await pool.query(
            `INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code)
             VALUES ($1, $2, $3, $4, TRUE, FALSE, $5) RETURNING id, username, full_name, verification_code`,
            [username, fullName, email, hashedPassword, code]
        );
        Const token = jwt.sign({ userId: newUser.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
        Res.json({ token, user: newUser.rows[0] });
    } catch (err) {
        Res.status(400).json({ error: 'Ошибка регистрации преподавателя' });
    }
});

// --- АВТОРИЗАЦИЯ ---
App.post('/api/auth/login', async (req, res) => {
    Const { login, password } = req.body;
    Try {
        Const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $1', [login]);
        If (!userRes.rows.length) return res.status(400).json({ error: 'Неверный логин или пароль' });

        Const user = userRes.rows[0];
        Const validPassword = await bcrypt.compare(password, user.password_hash);
        If (!validPassword) return res.status(400).json({ error: 'Неверный логин или пароль' });

        Const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        Res.json({ 
            Token, 
            User: { 
                Id: user.id, 
                Username: user.username, 
                fullName: user.full_name, 
                isTeacher: user.is_teacher, 
                isTeacherVerified: user.is_teacher_verified,
                verificationCode: user.verification_code 
            } 
        });
    } catch (err) {
        Res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- ВЕРИФИКАЦИЯ УЧИТЕЛЕЙ ---
App.get('/api/teach/pending-verifications', authenticateToken, async (req, res) => {
    Try {
        Const list = await pool.query(
            'SELECT id, username, full_name, email, verification_code, created_at FROM users WHERE is_teacher = TRUE AND is_teacher_verified = FALSE'
        );
        Res.json(list.rows);
    } catch (err) {
        Res.status(500).json({ error: 'Ошибка получения списка' });
    }
});

App.post('/api/teach/verify', authenticateToken, async (req, res) => {
    Const { teacherId } = req.body;
    Try {
        Await pool.query('UPDATE users SET is_teacher_verified = TRUE, verified_by = $1 WHERE id = $2', [req.user.userId, teacherId]);
        Res.json({ success: true });
    } catch (err) {
        Res.status(500).json({ error: 'Ошибка верификации' });
    }
});

// --- SOCKET.IO ЛОББИ И ИГРЫ ---
Const gameRooms = {};
Io.on('connection', (socket) => {
    Socket.on('join_game_lobby', ({ gameId, spaceId, userId, username }) => {
        Const roomId = `${spaceId}_${gameId}`;
        Socket.join(roomId);
        Socket.roomId = roomId;
        Socket.userId = userId;

        If (!gameRooms[roomId]) {
            gameRooms[roomId] = { gameId, spaceId, status: 'lobby', players: {} };
        }

        gameRooms[roomId].players[userId] = {
            id: userId, username, ready: false, isGhost: false, x: 100, y: 100
        };

        Io.to(roomId).emit('lobby_state_update', gameRooms[roomId]);
    });

    Socket.on('player_toggle_ready', () => {
        Const room = gameRooms[socket.roomId];
        If (room && room.players[socket.userId]) {
            Room.players[socket.userId].ready = !room.players[socket.userId].ready;
            Const allPlayers = Object.values(room.players);
            Const allReady = allPlayers.length >= 2 && allPlayers.every(p => p.ready);

            If (allReady && room.status === 'lobby') {
                Room.status = 'playing';
                Io.to(socket.roomId).emit('game_start_countdown', { duration: 3 });
            } else {
                Io.to(socket.roomId).emit('lobby_state_update', room);
            }
        }
    });

    Socket.on('player_died', () => {
        Const room = gameRooms[socket.roomId];
        If (room && room.players[socket.userId]) {
            Room.players[socket.userId].isGhost = true;
            Io.to(socket.roomId).emit('player_became_ghost', { userId: socket.userId });
        }
    });

    Socket.on('disconnect', () => {
        If (socket.roomId && gameRooms[socket.roomId]) {
            Delete gameRooms[socket.roomId].players[socket.userId];
            Io.to(socket.roomId).emit('lobby_state_update', gameRooms[socket.roomId]);
        }
    });
});

Const PORT = process.env.PORT || 3000;
Server.listen(PORT, () => console.log(`🚀 Сервер Workspaces запущен на порту ${PORT}`));



