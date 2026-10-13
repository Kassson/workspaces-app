// ============================================================================
//  routes/journal.js — эндпоинты для работы с виртуальными учениками журнала
// ============================================================================

function registerJournalRoutes(app, pool, verifyJWT, requireSpaceAccess) {

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Загружает пользователя и проверяет, что он учитель и имеет доступ к группе
    async function loadTeacherForSpace(req, res, spaceId) {
        const userQ = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
        const user = userQ.rows[0];
        if (!user || !user.is_teacher) {
            res.status(403).json({ error: 'Только для учителей' });
            return null;
        }
        if (!spaceId || !UUID_RE.test(String(spaceId))) {
            res.status(400).json({ error: 'Неверная группа' });
            return null;
        }
        const isMember = await pool.query(
            'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
            [spaceId, req.userId]
        );
        if (!isMember.rows.length && !user.is_teacher_verified) {
            res.status(403).json({ error: 'Нет доступа к пространству' });
            return null;
        }
        return user;
    }

    // Собирает все варианты написания имени (по name_key) из ОБЕИХ таблиц
    async function collectNameVariants(spaceId, name, subjectName) {
        const params = [spaceId, name];
        let subjectClause = '';
        if (subjectName) {
            params.push(subjectName);
            subjectClause = ` AND subject_name = $3`;
        }
        const q = await pool.query(
            `SELECT DISTINCT student_name FROM (
                 SELECT student_name FROM grades
                  WHERE space_id = $1 AND name_key(student_name) = name_key($2)${subjectClause}
                 UNION
                 SELECT student_name FROM journal_students
                  WHERE space_id = $1 AND name_key(student_name) = name_key($2)${subjectClause}
             ) t`,
            params
        );
        const variants = q.rows.map(r => r.student_name).filter(Boolean);
        if (!variants.length) variants.push(name);
        return variants;
    }

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
    // После вставки пересчитываем sort_order по фамилии (COLLATE "C"),
    // чтобы новый ученик встал в правильное место, а не в конец.
    app.post('/api/journal-students', verifyJWT, async (req, res) => {
        try {
            const { spaceId, subjectName, studentName } = req.body || {};
            const sSubj = String(subjectName == null ? '' : subjectName).trim();
            const sName = String(studentName == null ? '' : studentName).trim();
            if (!spaceId || !sSubj || !sName) {
                return res.status(400).json({ error: 'Заполните поля' });
            }
            if (sName.length > 150) return res.status(400).json({ error: 'Имя слишком длинное (макс. 150)' });
            if (sSubj.length > 100) return res.status(400).json({ error: 'Название предмета слишком длинное (макс. 100)' });

            const user = await loadTeacherForSpace(req, res, spaceId);
            if (!user) return;

            // Если ученик с таким же ключом уже есть — не создаём дубликат
            const existing = await pool.query(
                `SELECT * FROM journal_students
                 WHERE space_id = $1 AND subject_name = $2
                   AND name_key(student_name) = name_key($3)
                 LIMIT 1`,
                [spaceId, sSubj, sName]
            );
            if (existing.rows.length) {
                return res.json(existing.rows[0]);
            }

            // Вставляем со sort_order = 0 (пересчитаем ниже)
            const r = await pool.query(
                `INSERT INTO journal_students (space_id, subject_name, student_name, sort_order)
                 VALUES ($1, $2, $3, 0)
                 RETURNING *`,
                [spaceId, sSubj, sName]
            );

            // Пересчёт sort_order по фамилии — как в excel.js
            try {
                await pool.query(
                    `WITH ordered AS (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   ORDER BY LOWER(REPLACE(student_name, 'ё', 'е')) COLLATE "C" ASC,
                                            student_name COLLATE "C" ASC
                               ) AS rn
                        FROM journal_students
                        WHERE space_id = $1 AND subject_name = $2
                    )
                    UPDATE journal_students js
                    SET sort_order = o.rn
                    FROM ordered o
                    WHERE js.id = o.id`,
                    [spaceId, sSubj]
                );
            } catch (e) {
                console.warn('reorder journal_students failed:', e.message);
            }

            res.json(r.rows[0] || { ok: true });
        } catch (e) {
            console.error('journal-students POST:', e.message);
            res.status(500).json({ error: 'Ошибка: ' + e.message });
        }
    });

    // DELETE /api/journal-students/:id
    // Раньше удалял запись по одному id без проверки группы (IDOR).
    // Теперь сначала находим строку и требуем доступ именно к её группе.
    app.delete('/api/journal-students/:id', verifyJWT, async (req, res) => {
        try {
            if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Не найдено' });
            const row = await pool.query('SELECT space_id FROM journal_students WHERE id = $1', [req.params.id]);
            if (!row.rows.length) return res.status(404).json({ error: 'Не найдено' });
            const user = await loadTeacherForSpace(req, res, row.rows[0].space_id);
            if (!user) return;
            await pool.query('DELETE FROM journal_students WHERE id = $1', [req.params.id]);
            res.json({ ok: true });
        } catch (e) {
            console.error('journal-students DELETE:', e.message);
            res.status(500).json({ error: 'Ошибка' });
        }
    });

    // ========================================================================
    //  POST /api/journal-students/rename
    //  Переименование всех вариантов написания с тем же ключом (ФИ + ё→е + сорт)
    // ========================================================================
    app.post('/api/journal-students/rename', verifyJWT, async (req, res) => {
        try {
            const { spaceId, oldName, newName } = req.body || {};
            if (!spaceId || !oldName || !newName) return res.status(400).json({ error: 'Заполните поля' });
            const trimmed = String(newName).trim();
            if (!trimmed) return res.status(400).json({ error: 'Имя не может быть пустым' });
            if (trimmed.length > 150) return res.status(400).json({ error: 'Имя слишком длинное (макс. 150)' });

            const user = await loadTeacherForSpace(req, res, spaceId);
            if (!user) return;

            if (trimmed === String(oldName).trim()) {
                return res.json({ ok: true, gradesUpdated: 0, studentsUpdated: 0 });
            }

            // Все варианты написания — из grades И journal_students
            const matchingNames = await collectNameVariants(spaceId, oldName, null);

            const r1 = await pool.query(
                `UPDATE grades SET student_name = $1, updated_at = NOW()
                 WHERE space_id = $2 AND student_name = ANY($3::text[])
                   AND ($4::boolean = TRUE OR teacher_id = $5)`,
                [trimmed, spaceId, matchingNames, !!user.is_teacher_verified, user.id]
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
            const { spaceId, studentName, subjectName } = req.body || {};
            if (!spaceId || !studentName) return res.status(400).json({ error: 'Заполните поля' });

            const user = await loadTeacherForSpace(req, res, spaceId);
            if (!user) return;

            // Все варианты написания — из grades И journal_students
            const matchingNames = await collectNameVariants(spaceId, studentName, subjectName || null);

            let r1, r2;
            if (subjectName) {
                r1 = await pool.query(
                    `DELETE FROM grades WHERE space_id = $1 AND student_name = ANY($2::text[]) AND subject_name = $3
                       AND ($4::boolean = TRUE OR teacher_id = $5)`,
                    [spaceId, matchingNames, subjectName, !!user.is_teacher_verified, user.id]
                );
                r2 = await pool.query(
                    `DELETE FROM journal_students WHERE space_id = $1 AND student_name = ANY($2::text[]) AND subject_name = $3`,
                    [spaceId, matchingNames, subjectName]
                );
            } else {
                r1 = await pool.query(
                    `DELETE FROM grades WHERE space_id = $1 AND student_name = ANY($2::text[])
                       AND ($3::boolean = TRUE OR teacher_id = $4)`,
                    [spaceId, matchingNames, !!user.is_teacher_verified, user.id]
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
