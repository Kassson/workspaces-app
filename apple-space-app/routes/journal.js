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
                query = `SELECT * FROM journal_students
                         WHERE space_id = $1 AND subject_name = $2
                         ORDER BY sort_order ASC, student_name ASC`;
                params = [spaceId, subject];
            } else {
                query = `SELECT * FROM journal_students
                         WHERE space_id = $1
                         ORDER BY sort_order ASC, student_name ASC`;
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

            // Если ученик с таким же ключом уже есть — не создаём дубликат
            const existing = await pool.query(
                `SELECT * FROM journal_students
                 WHERE space_id = $1 AND subject_name = $2
                   AND name_key(student_name) = name_key($3)
                 LIMIT 1`,
                [spaceId, subjectName.trim(), studentName.trim()]
            );
            if (existing.rows.length) {
                return res.json(existing.rows[0]);
            }

            const maxQ = await pool.query(
                'SELECT COALESCE(MAX(sort_order), 0) AS m FROM journal_students WHERE space_id = $1 AND subject_name = $2',
                [spaceId, subjectName.trim()]
            );
            const nextOrder = (maxQ.rows[0].m || 0) + 1;

            const r = await pool.query(
                `INSERT INTO journal_students (space_id, subject_name, student_name, sort_order)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [spaceId, subjectName.trim(), studentName.trim(), nextOrder]
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
    //  Переименование всех вариантов написания с тем же ключом (ФИ + ё→е + сорт)
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

            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            if (!isMember.rows.length && !user.rows[0].is_teacher_verified) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            // Находим все имена с тем же ключом через SQL-функцию name_key
            const allNamesQ = await pool.query(
                `SELECT DISTINCT student_name FROM grades
                 WHERE space_id = $1 AND name_key(student_name) = name_key($2)`,
                [spaceId, oldName]
            );
            const matchingNames = allNamesQ.rows.map(r => r.student_name);
            if (!matchingNames.length) matchingNames.push(oldName);

            const r1 = await pool.query(
                `UPDATE grades SET student_name = $1, updated_at = NOW()
                 WHERE space_id = $2 AND student_name = ANY($3::text[])`,
                [trimmed, spaceId, matchingNames]
            );

            const r2 = await pool.query(
                `UPDATE journal_students SET student_name = $1
                 WHERE space_id = $2 AND student_name = ANY($3::text[])`,
                [trimmed, spaceId, matchingNames]
            );

            res.json({
                ok: true,
                newName: trimmed,
                gradesUpdated: r1.rowCount,
                studentsUpdated: r2.rowCount,
                renamedVariants: matchingNames
            });
        } catch (e) {
            console.error('journal-students rename:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });

    // ========================================================================
    //  POST /api/journal-students/delete
    //  Удаляет все варианты написания с тем же ключом
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

            // Находим все имена с тем же ключом
            let namesQ;
            if (subjectName) {
                namesQ = await pool.query(
                    `SELECT DISTINCT student_name FROM grades
                     WHERE space_id = $1 AND subject_name = $2
                       AND name_key(student_name) = name_key($3)`,
                    [spaceId, subjectName, studentName]
                );
            } else {
                namesQ = await pool.query(
                    `SELECT DISTINCT student_name FROM grades
                     WHERE space_id = $1 AND name_key(student_name) = name_key($2)`,
                    [spaceId, studentName]
                );
            }
            const matchingNames = namesQ.rows.map(r => r.student_name);
            if (!matchingNames.length) matchingNames.push(studentName);

            let r1, r2;
            if (subjectName) {
                r1 = await pool.query(
                    `DELETE FROM grades WHERE space_id = $1 AND student_name = ANY($2::text[]) AND subject_name = $3`,
                    [spaceId, matchingNames, subjectName]
                );
                r2 = await pool.query(
                    `DELETE FROM journal_students WHERE space_id = $1 AND student_name = ANY($2::text[]) AND subject_name = $3`,
                    [spaceId, matchingNames, subjectName]
                );
            } else {
                r1 = await pool.query(
                    `DELETE FROM grades WHERE space_id = $1 AND student_name = ANY($2::text[])`,
                    [spaceId, matchingNames]
                );
                r2 = await pool.query(
                    `DELETE FROM journal_students WHERE space_id = $1 AND student_name = ANY($2::text[])`,
                    [spaceId, matchingNames]
                );
            }

            res.json({
                ok: true,
                gradesDeleted: r1.rowCount,
                studentsDeleted: r2.rowCount,
                deletedVariants: matchingNames
            });
        } catch (e) {
            console.error('journal-students delete:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });
}

module.exports = { registerJournalRoutes };
