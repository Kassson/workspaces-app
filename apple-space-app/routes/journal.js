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

    // ========================================================================
    //  POST /api/journal-students/rename
    //  Переименовать ученика (обновляет и оценки, и записи в journal_students)
    //  Body: { spaceId, oldName, newName }
    // ========================================================================
    app.post('/api/journal-students/rename', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }
            const { spaceId, oldName, newName } = req.body || {};
            if (!spaceId || !oldName || !newName) return res.status(400).json({ error: 'Заполните поля' });
            const trimmed = String(newName).trim();
            if (!trimmed) return res.status(400).json({ error: 'Имя не может быть пустым' });
            if (trimmed === String(oldName).trim()) {
                return res.json({ ok: true, gradesUpdated: 0, studentsUpdated: 0 });
            }

            // Проверка доступа к пространству
            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            if (!isMember.rows.length && !user.rows[0].is_teacher_verified) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            // Обновляем все оценки этого ученика в этом пространстве
            const r1 = await pool.query(
                `UPDATE grades SET student_name = $1, updated_at = NOW()
                 WHERE space_id = $2 AND student_name = $3`,
                [trimmed, spaceId, oldName]
            );
            // Обновляем записи в journal_students
            const r2 = await pool.query(
                `UPDATE journal_students SET student_name = $1
                 WHERE space_id = $2 AND student_name = $3`,
                [trimmed, spaceId, oldName]
            );

            res.json({
                ok: true,
                newName: trimmed,
                gradesUpdated: r1.rowCount,
                studentsUpdated: r2.rowCount
            });
        } catch (e) {
            console.error('journal-students rename:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });

    // ========================================================================
    //  POST /api/journal-students/delete
    //  Удалить ученика из журнала (по предмету либо полностью)
    //  Body: { spaceId, studentName, subjectName? }
    // ========================================================================
    app.post('/api/journal-students/delete', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }
            const { spaceId, studentName, subjectName } = req.body || {};
            if (!spaceId || !studentName) return res.status(400).json({ error: 'Заполните поля' });

            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            if (!isMember.rows.length && !user.rows[0].is_teacher_verified) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            // Удаляем оценки (в текущем предмете или во всех)
            let q1, p1;
            if (subjectName) {
                q1 = 'DELETE FROM grades WHERE space_id = $1 AND student_name = $2 AND subject_name = $3';
                p1 = [spaceId, studentName, subjectName];
            } else {
                q1 = 'DELETE FROM grades WHERE space_id = $1 AND student_name = $2';
                p1 = [spaceId, studentName];
            }
            const r1 = await pool.query(q1, p1);

            // Удаляем записи в journal_students
            let q2, p2;
            if (subjectName) {
                q2 = 'DELETE FROM journal_students WHERE space_id = $1 AND student_name = $2 AND subject_name = $3';
                p2 = [spaceId, studentName, subjectName];
            } else {
                q2 = 'DELETE FROM journal_students WHERE space_id = $1 AND student_name = $2';
                p2 = [spaceId, studentName];
            }
            const r2 = await pool.query(q2, p2);

            res.json({
                ok: true,
                gradesDeleted: r1.rowCount,
                studentsDeleted: r2.rowCount
            });
        } catch (e) {
            console.error('journal-students delete:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });
}

module.exports = { registerJournalRoutes };
