// ============================================================================
//  routes/hidden.js — скрытие участников + шаринг оценок
// ============================================================================

function registerHiddenRoutes(app, pool, verifyJWT, requireSpaceAccess, requireSpaceAdmin) {

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // ========================================================================
    //  POST /api/spaces/:spaceId/members/:userId/hide
    //  Скрыть/показать ученика в журнале. Только root_teacher.
    //  Body: { hidden: true|false }
    // ========================================================================
    app.post('/api/spaces/:spaceId/members/:userId/hide', verifyJWT, async (req, res) => {
        try {
            const rootUser = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!rootUser.rows.length) return res.status(403).json({ error: 'Нет доступа' });
            if (rootUser.rows[0].username !== 'root_teacher') {
                return res.status(403).json({ error: 'Только Root может скрывать участников' });
            }

            const { spaceId, userId } = req.params;
            if (!UUID_RE.test(String(spaceId)) || !UUID_RE.test(String(userId))) {
                return res.status(404).json({ error: 'Участник не найден' });
            }

            // Принимаем только настоящий boolean: строка "false" раньше означала TRUE,
            // а отсутствие поля молча «показывало» ученика обратно.
            const body = req.body || {};
            if (typeof body.hidden !== 'boolean') {
                return res.status(400).json({ error: 'Поле hidden должно быть true или false' });
            }
            const hidden = body.hidden;

            if (userId === rootUser.rows[0].id) {
                return res.status(400).json({ error: 'Нельзя скрыть себя' });
            }

            const target = await pool.query('SELECT is_teacher FROM users WHERE id = $1', [userId]);
            if (!target.rows.length) return res.status(404).json({ error: 'Участник не найден' });
            if (target.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Нельзя скрыть преподавателя' });
            }

            const r = await pool.query(
                'UPDATE space_members SET hidden_from_journal = $1 WHERE space_id = $2 AND user_id = $3 RETURNING *',
                [hidden, spaceId, userId]
            );
            if (!r.rows.length) return res.status(404).json({ error: 'Участник не найден' });

            res.json({ ok: true, hidden });
        } catch (e) {
            console.error('hide member:', e.message);
            res.status(500).json({ error: 'Ошибка' });
        }
    });

    // ========================================================================
    //  GET /api/grade-shares/:spaceId
    //  Список моих шейров (как owner и как recipient)
    // ========================================================================
    app.get('/api/grade-shares/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
        try {
            // verifyJWT выставляет req.userId; requireSpaceAccess — ещё и req.currentUser.
            // Читаем оба, чтобы не зависеть от порядка middleware.
            const userId = req.userId || (req.currentUser && req.currentUser.id);
            const spaceId = req.params.spaceId;
            if (!userId) return res.status(403).json({ error: 'Нет доступа' });

            const asOwner = (await pool.query(
                `SELECT gs.*, u.full_name AS shared_with_name, u.username AS shared_with_username
                 FROM grade_shares gs
                 JOIN users u ON u.id = gs.shared_with_user_id
                 WHERE gs.space_id = $1 AND gs.owner_user_id = $2
                 ORDER BY gs.created_at DESC`,
                [spaceId, userId]
            )).rows;

            const asRecipient = (await pool.query(
                `SELECT gs.*, u.full_name AS owner_name, u.username AS owner_username
                 FROM grade_shares gs
                 JOIN users u ON u.id = gs.owner_user_id
                 WHERE gs.space_id = $1 AND gs.shared_with_user_id = $2
                 ORDER BY gs.created_at DESC`,
                [spaceId, userId]
            )).rows;

            res.json({ asOwner, asRecipient });
        } catch (e) {
            console.error('grade-shares GET:', e.message);
            res.status(500).json({ error: 'Ошибка' });
        }
    });

    // ========================================================================
    //  POST /api/grade-shares
    //  Создать шейр: owner = я, recipient = выбранный участник
    //  Body: { spaceId, sharedWithUserId }
    // ========================================================================
    app.post('/api/grade-shares', verifyJWT, requireSpaceAccess, async (req, res) => {
        try {
            const userId = req.userId || (req.currentUser && req.currentUser.id);
            const { spaceId, sharedWithUserId } = req.body || {};
            if (!userId) return res.status(403).json({ error: 'Нет доступа' });
            if (!spaceId || !sharedWithUserId) return res.status(400).json({ error: 'Не указан получатель' });
            if (!UUID_RE.test(String(sharedWithUserId))) return res.status(400).json({ error: 'Неверный получатель' });
            if (sharedWithUserId === userId) return res.status(400).json({ error: 'Нельзя делиться с собой' });

            const me = await pool.query(
                'SELECT hidden_from_journal FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, userId]
            );
            if (!me.rows.length) return res.status(403).json({ error: 'Нет доступа' });

            // Группа может запретить обмен оценками
            try {
                const st = await pool.query('SELECT members_can_share_grades FROM space_settings WHERE space_id = $1', [spaceId]);
                if (st.rows.length && st.rows[0].members_can_share_grades === false) {
                    const u = await pool.query('SELECT is_teacher, is_teacher_verified FROM users WHERE id = $1', [userId]);
                    const isTeacher = u.rows[0] && u.rows[0].is_teacher && u.rows[0].is_teacher_verified;
                    if (!isTeacher) return res.status(403).json({ error: 'Обмен оценками отключён в настройках группы' });
                }
            } catch (e) { /* настройки недоступны — не блокируем */ }

            const target = await pool.query(
                'SELECT hidden_from_journal FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, sharedWithUserId]
            );
            if (!target.rows.length) return res.status(404).json({ error: 'Участник не найден' });
            if (target.rows[0].hidden_from_journal) {
                return res.status(400).json({ error: 'Нельзя делиться со скрытым участником' });
            }

            const r = await pool.query(
                `INSERT INTO grade_shares (space_id, owner_user_id, shared_with_user_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (space_id, owner_user_id, shared_with_user_id) DO NOTHING
                 RETURNING *`,
                [spaceId, userId, sharedWithUserId]
            );

            // Уведомление получателю в чате (если он онлайн)
            try {
                const io = req.app.get('io');
                if (io) {
                    io.to(`space:${spaceId}`).emit('share_created', { ownerUserId: userId });
                }
            } catch (e) {}

            res.json(r.rows[0] || { ok: true });
        } catch (e) {
            console.error('grade-shares POST:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ========================================================================
    //  DELETE /api/grade-shares/:id
    //  Удалить шейр (может owner или recipient)
    // ========================================================================
    app.delete('/api/grade-shares/:id', verifyJWT, async (req, res) => {
        try {
            const userId = req.userId || (req.currentUser && req.currentUser.id);
            if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Не найдено' });
            const r = await pool.query('SELECT * FROM grade_shares WHERE id = $1', [req.params.id]);
            if (!r.rows.length) return res.status(404).json({ error: 'Не найдено' });
            const s = r.rows[0];
            if (s.owner_user_id !== userId && s.shared_with_user_id !== userId) {
                return res.status(403).json({ error: 'Нет прав' });
            }
            await pool.query('DELETE FROM grade_shares WHERE id = $1', [req.params.id]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'Ошибка' });
        }
    });
}

module.exports = { registerHiddenRoutes };