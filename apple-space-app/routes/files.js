// ============================================================================
//  routes/files.js — загрузка, получение и удаление файлов
//  Файлы хранятся в Yandex Object Storage
// ============================================================================
const express = require('express');
const multer = require('multer');
const storage = require('../storage');

// Храним файлы в памяти — стримим напрямую в Object Storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20 МБ — жёсткий лимит multer (далее проверяет storage)
        files: 10                    // максимум 10 файлов за раз
    }
});

// Ошибки multer нужно отдавать в формате JSON, иначе клиент получает HTML
function uploadMiddleware(handler) {
    return (req, res, next) => {
        handler(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком большой (максимум 20 МБ)' });
                if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Слишком много файлов (максимум 10)' });
                if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Неожиданное поле с файлом' });
                return res.status(400).json({ error: 'Ошибка загрузки файла: ' + err.message });
            }
            console.error('multer:', err.message);
            return res.status(500).json({ error: 'Ошибка загрузки файла' });
        });
    };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) { return typeof value === 'string' && UUID_RE.test(value); }

function registerFileRoutes(app, pool, verifyJWT, requireSpaceAccess) {

    // ========================================================================
    //  POST /api/files/upload
    //  Загрузка одного файла в чат пространства
    //  Требует авторизации и членства в пространстве
    // ========================================================================
    app.post('/api/files/upload',
        verifyJWT,
        uploadMiddleware(upload.single('file')),
        async (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

                const { spaceId } = req.body;
                if (!spaceId) return res.status(400).json({ error: 'Не указано пространство' });

                // Проверяем, что пользователь — участник пространства
                const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
                if (!user.rows.length) return res.status(403).json({ error: 'Пользователь не найден' });

                const memberCheck = await pool.query(
                    'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                    [spaceId, req.userId]
                );
                const isTeacher = user.rows[0].is_teacher && user.rows[0].is_teacher_verified;
                if (!memberCheck.rows.length && !isTeacher) {
                    return res.status(403).json({ error: 'Нет доступа к пространству' });
                }

                // Загружаем в Object Storage
                const result = await storage.uploadFile(
                    req.file.buffer,
                    req.file.originalname,
                    req.file.mimetype,
                    `chat/${spaceId}`
                );

                // Сохраняем метаданные в БД
                const dbResult = await pool.query(
                    `INSERT INTO files (space_id, user_id, key, original_name, mime, size)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id, original_name, mime, size, created_at`,
                    [spaceId, req.userId, result.key, result.originalName, result.mime, result.size]
                );

                const fileRecord = dbResult.rows[0];
                const signedUrl = await storage.getSignedFileUrl(result.key);

                res.json({
                    id: fileRecord.id,
                    key: result.key,
                    name: fileRecord.original_name,
                    mime: fileRecord.mime,
                    size: fileRecord.size,
                    url: signedUrl
                });
            } catch (e) {
                console.error('Ошибка загрузки файла:', e.message);
                // Ошибки валидации (тип/размер) — вина клиента, остальное — сервер
                const isValidation = /Недопустимый тип|слишком большой|Недопустимый ключ/.test(e.message || '');
                res.status(isValidation ? 400 : 500).json({
                    error: isValidation ? e.message : 'Не удалось сохранить файл. Попробуйте позже.'
                });
            }
        }
    );

    // ========================================================================
    //  POST /api/files/upload-many
    //  Загрузка нескольких файлов сразу (до 10)
    // ========================================================================
    app.post('/api/files/upload-many',
        verifyJWT,
        uploadMiddleware(upload.array('files', 10)),
        async (req, res) => {
            try {
                if (!req.files || !req.files.length) {
                    return res.status(400).json({ error: 'Файлы не получены' });
                }
                const { spaceId } = req.body;
                if (!spaceId) return res.status(400).json({ error: 'Не указано пространство' });

                const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
                if (!user.rows.length) return res.status(403).json({ error: 'Пользователь не найден' });

                const memberCheck = await pool.query(
                    'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                    [spaceId, req.userId]
                );
                const isTeacher = user.rows[0].is_teacher && user.rows[0].is_teacher_verified;
                if (!memberCheck.rows.length && !isTeacher) {
                    return res.status(403).json({ error: 'Нет доступа к пространству' });
                }

                const results = [];
                for (const file of req.files) {
                    try {
                        const uploaded = await storage.uploadFile(
                            file.buffer,
                            file.originalname,
                            file.mimetype,
                            `chat/${spaceId}`
                        );
                        const dbResult = await pool.query(
                            `INSERT INTO files (space_id, user_id, key, original_name, mime, size)
                             VALUES ($1, $2, $3, $4, $5, $6)
                             RETURNING id, original_name, mime, size`,
                            [spaceId, req.userId, uploaded.key, uploaded.originalName, uploaded.mime, uploaded.size]
                        );
                        const record = dbResult.rows[0];
                        const url = await storage.getSignedFileUrl(uploaded.key);
                        results.push({
                            id: record.id,
                            key: uploaded.key,
                            name: record.original_name,
                            mime: record.mime,
                            size: record.size,
                            url
                        });
                    } catch (fileErr) {
                        console.error('Ошибка загрузки одного файла:', fileErr.message);
                        results.push({ error: fileErr.message, name: file.originalname });
                    }
                }

                res.json({ files: results });
            } catch (e) {
                console.error('Ошибка пакетной загрузки:', e.message);
                res.status(500).json({ error: 'Ошибка загрузки' });
            }
        }
    );

    // ========================================================================
    //  GET /api/files/:id
    //  Получить подписанную ссылку на файл (проверка доступа)
    // ========================================================================
    app.get('/api/files/:id', verifyJWT, async (req, res) => {
        try {
            if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Файл не найден' });
            const fileQ = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
            if (!fileQ.rows.length) return res.status(404).json({ error: 'Файл не найден' });

            const file = fileQ.rows[0];

            // Проверяем, что пользователь имеет доступ к пространству файла
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            const isTeacher = user.rows[0]?.is_teacher && user.rows[0]?.is_teacher_verified;
            const memberCheck = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [file.space_id, req.userId]
            );

            if (!memberCheck.rows.length && !isTeacher && file.user_id !== req.userId) {
                return res.status(403).json({ error: 'Нет доступа к файлу' });
            }

            const signedUrl = await storage.getSignedFileUrl(file.key);
            if (!signedUrl) return res.status(500).json({ error: 'Не удалось создать ссылку' });

            res.json({
                id: file.id,
                name: file.original_name,
                mime: file.mime,
                size: file.size,
                url: signedUrl,
                created_at: file.created_at
            });
        } catch (e) {
            console.error('Ошибка получения файла:', e.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ========================================================================
    //  GET /api/files/:id/url
    //  Просто ссылка (без метаданных) — для быстрого получения
    // ========================================================================
    app.get('/api/files/:id/url', verifyJWT, async (req, res) => {
        try {
            const fileQ = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
            if (!fileQ.rows.length) return res.status(404).json({ error: 'Файл не найден' });

            const file = fileQ.rows[0];
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            const isTeacher = user.rows[0]?.is_teacher && user.rows[0]?.is_teacher_verified;
            const memberCheck = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [file.space_id, req.userId]
            );

            if (!memberCheck.rows.length && !isTeacher && file.user_id !== req.userId) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            const signedUrl = await storage.getSignedFileUrl(file.key);
            res.json({ url: signedUrl });
        } catch (e) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ========================================================================
    //  DELETE /api/files/:id
    //  Удалить файл (только автор или учитель)
    // ========================================================================
    app.delete('/api/files/:id', verifyJWT, async (req, res) => {
        try {
            const fileQ = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
            if (!fileQ.rows.length) return res.status(404).json({ error: 'Файл не найден' });

            const file = fileQ.rows[0];
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            const isTeacher = user.rows[0]?.is_teacher && user.rows[0]?.is_teacher_verified;

            if (file.user_id !== req.userId && !isTeacher) {
                return res.status(403).json({ error: 'Нет прав на удаление' });
            }

            await storage.deleteFile(file.key);
            await pool.query('DELETE FROM files WHERE id = $1', [req.params.id]);

            res.json({ ok: true });
        } catch (e) {
            console.error('Ошибка удаления:', e.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    // ========================================================================
    //  POST /api/files/attachments
    //  Привязать уже загруженные файлы к сообщению чата.
    //  Проверяем: сообщение существует, пользователь — участник ЕГО группы,
    //  а файлы принадлежат ему и загружены в ту же группу.
    // ========================================================================
    app.post('/api/files/attachments', verifyJWT, async (req, res) => {
        try {
            const { fileIds, messageId } = req.body || {};
            if (!Array.isArray(fileIds) || !fileIds.length) {
                return res.status(400).json({ error: 'Не переданы файлы' });
            }
            if (fileIds.length > 10) return res.status(400).json({ error: 'Слишком много файлов (максимум 10)' });
            if (!isUuid(messageId)) return res.status(400).json({ error: 'Неверный идентификатор сообщения' });

            const msg = await pool.query('SELECT id, space_id FROM chat_messages WHERE id = $1', [messageId]);
            if (!msg.rows.length) return res.status(404).json({ error: 'Сообщение не найдено' });
            const spaceId = msg.rows[0].space_id;

            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length) return res.status(403).json({ error: 'Пользователь не найден' });
            const isTeacher = user.rows[0].is_teacher && user.rows[0].is_teacher_verified;
            const memberCheck = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            if (!memberCheck.rows.length && !isTeacher) {
                return res.status(403).json({ error: 'Нет доступа к сообщению' });
            }

            const validIds = fileIds.filter(isUuid);
            if (!validIds.length) return res.status(400).json({ error: 'Неверные идентификаторы файлов' });

            const r = await pool.query(
                'UPDATE files SET message_id = $1 WHERE id = ANY($2::uuid[]) AND user_id = $3 AND space_id = $4',
                [messageId, validIds, req.userId, spaceId]
            );
            res.json({ ok: true, attached: r.rowCount });
        } catch (e) {
            console.error('files/attachments:', e.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });
}

module.exports = { registerFileRoutes };