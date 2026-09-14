// ============================================================================
//  routes/journal.js — эндпоинты для работы с виртуальными учениками журнала
// ============================================================================

function registerJournalRoutes(app, pool, verifyJWT, requireSpaceAccess) {

    // GET /api/journal-students/:spaceId?subject=X — список виртуальных учеников
    app.get('/api/journal-students/:spaceId', verifyJWT, requireSpaceAccess, async (req, res) => {
        try {
            const { spaceId } = req.params;
            const { subject } = req.query;
            let query, params;
            if (subject) {
                query = 'SELECT * FROM journal_students WHERE space_id = $1 AND subject_name = $2 ORDER BY student_name';
                params = [spaceId, subject];
            } else {
                query = 'SELECT * FROM journal_students WHERE space_id = $1 ORDER BY student_name';
                params = [spaceId];
            }
            const r = await pool.query(query, params);
            res.json(r.rows);
        } catch (e) {
            console.error('journal-students GET:', e.message);
            res.status(500).json({ error: 'Ошибка' });
        }
    });

    // POST /api/journal-students — добавить виртуального ученика
    app.post('/api/journal-students', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }

            const { spaceId, subjectName, studentName } = req.body;
            if (!spaceId || !subjectName || !studentName) {
                return res.status(400).json({ error: 'Заполните поля' });
            }

            // Проверка, что учитель состоит в пространстве или verified
            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            if (!isMember.rows.length && !user.rows[0].is_teacher_verified) {
                return res.status(403).json({ error: 'Нет доступа к пространству' });
            }

            const r = await pool.query(
                `INSERT INTO journal_students (space_id, subject_name, student_name)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (space_id, subject_name, student_name) DO NOTHING
                 RETURNING *`,
                [spaceId, subjectName.trim(), studentName.trim()]
            );
            res.json(r.rows[0] || { ok: true });
        } catch (e) {
            console.error('journal-students POST:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });

    // DELETE /api/journal-students/:id
    app.delete('/api/journal-students/:id', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }
            await pool.query('DELETE FROM journal_students WHERE id = $1', [req.params.id]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'Ошибка' });
        }
    });
}

module.exports = { registerJournalRoutes };