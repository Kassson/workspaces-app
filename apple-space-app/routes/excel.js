// ============================================================================
//  routes/excel.js — импорт и экспорт журнала оценок в Excel
// ============================================================================
const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const MONTH_NAMES_RU = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function parseMonthKey(mk) {
    const parts = String(mk).split('-');
    return { year: parseInt(parts[0]), month: parseInt(parts[1]) };
}

function formatMonthLabel(mk) {
    const { year, month } = parseMonthKey(mk);
    return `${MONTH_NAMES_RU[month]} ${year}`;
}

function parseCellValue(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const s = String(raw).trim().toUpperCase();
    if (!s || s === '·') return null;
    const m = s.match(/^(\d)?([НО])?$/);
    if (!m) return null;
    const grade = m[1] ? parseInt(m[1], 10) : null;
    const att = m[2] === 'Н' ? 'absent' : m[2] === 'О' ? 'late' : 'present';
    if (!grade && att === 'present') return null;
    return { grade, attendance: att };
}

function registerExcelRoutes(app, pool, verifyJWT, requireSpaceAdmin) {

    // ========================================================================
    //  GET /api/grades/:spaceId/export?subject=X&month=YYYY-MM
    // ========================================================================
    app.get('/api/grades/:spaceId/export', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }

            const isRoot = user.rows[0].username === 'root_teacher';

            const { spaceId } = req.params;
            const { subject, month } = req.query;
            if (!subject || !month) return res.status(400).json({ error: 'Нужны subject и month' });

            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            const isVerifiedTeacher = user.rows[0].is_teacher_verified;
            if (!isMember.rows.length && !isVerifiedTeacher) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            const { year, month: m } = parseMonthKey(month);
            const daysInMonth = getDaysInMonth(year, m);
            const monthStart = `${year}-${String(m).padStart(2, '0')}-01`;
            const monthEnd = `${year}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

            // ВАЖНО: TO_CHAR → дата приходит строкой "YYYY-MM-DD" без сдвигов
            const grades = (await pool.query(
                `SELECT id, space_id, student_user_id, student_name, subject_name, teacher_id,
                        grade_value, attendance,
                        TO_CHAR(lesson_date, 'YYYY-MM-DD') AS lesson_date_str
                 FROM grades
                 WHERE space_id = $1 AND subject_name = $2
                   AND lesson_date >= $3::date AND lesson_date <= $4::date
                 ORDER BY student_name, lesson_date`,
                [spaceId, subject, monthStart, monthEnd]
            )).rows;

            // Ученики: активные + виртуальные. Скрытые — только для Root.
            const membersQuery = isRoot
                ? `SELECT u.full_name FROM space_members sm
                   JOIN users u ON u.id = sm.user_id
                   WHERE sm.space_id = $1 AND u.is_teacher = FALSE`
                : `SELECT u.full_name FROM space_members sm
                   JOIN users u ON u.id = sm.user_id
                   WHERE sm.space_id = $1 AND u.is_teacher = FALSE
                     AND COALESCE(sm.hidden_from_journal, FALSE) = FALSE`;
            const members = (await pool.query(membersQuery, [spaceId])).rows.map(r => r.full_name);

            const virtualStudents = (await pool.query(
                `SELECT student_name FROM journal_students
                 WHERE space_id = $1 AND subject_name = $2`,
                [spaceId, subject]
            )).rows.map(r => r.student_name);

            // Фильтр оценок скрытых учеников (для не-root)
            let filteredGrades = grades;
            if (!isRoot) {
                const hiddenNames = (await pool.query(
                    `SELECT u.full_name FROM space_members sm
                     JOIN users u ON u.id = sm.user_id
                     WHERE sm.space_id = $1 AND u.is_teacher = FALSE AND sm.hidden_from_journal = TRUE`,
                    [spaceId]
                )).rows.map(r => r.full_name);
                const hiddenSet = new Set(hiddenNames.map(n => n.toLowerCase().trim()));
                filteredGrades = grades.filter(g => !hiddenSet.has(g.student_name.toLowerCase().trim()));
            }

            const gradesStudents = [...new Set(filteredGrades.map(g => g.student_name))];
            const allStudents = [...new Set([...members, ...virtualStudents, ...gradesStudents])].sort();

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Workspaces';
            const ws = wb.addWorksheet('Журнал');

            ws.getCell('A1').value = 'Предмет';
            ws.getCell('B1').value = subject;
            ws.getCell('A1').font = { bold: true };
            ws.getCell('B1').font = { bold: true, color: { argb: 'FF0088CC' } };

            ws.getCell('A2').value = 'Месяц';
            ws.getCell('B2').value = month;
            ws.getCell('A2').font = { bold: true };
            ws.getCell('B2').font = { bold: true, color: { argb: 'FF0088CC' } };
            ws.getCell('C2').value = formatMonthLabel(month);
            ws.getCell('C2').font = { italic: true, color: { argb: 'FF707579' } };

            const headerRow = 3;
            ws.getCell(headerRow, 1).value = 'ФИО';
            ws.getCell(headerRow, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            ws.getCell(headerRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0088CC' } };
            ws.getCell(headerRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };

            for (let d = 1; d <= daysInMonth; d++) {
                const cell = ws.getCell(headerRow, 1 + d);
                cell.value = d;
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0088CC' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            const avgCellCol = 2 + daysInMonth;
            ws.getCell(headerRow, avgCellCol).value = 'Ср.';
            ws.getCell(headerRow, avgCellCol).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            ws.getCell(headerRow, avgCellCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0088CC' } };
            ws.getCell(headerRow, avgCellCol).alignment = { horizontal: 'center', vertical: 'middle' };

            ws.getRow(headerRow).height = 26;
            ws.getColumn(1).width = 28;
            for (let d = 1; d <= daysInMonth + 1; d++) {
                ws.getColumn(1 + d).width = 5;
            }

            let row = headerRow + 1;
            for (const st of allStudents) {
                ws.getCell(row, 1).value = st;
                ws.getCell(row, 1).font = { bold: true };

                const studentGrades = filteredGrades.filter(g => g.student_name === st);

                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const g = studentGrades.find(x => x.lesson_date_str === dateStr);
                    const cell = ws.getCell(row, 1 + d);

                    if (g) {
                        if (g.attendance === 'absent') {
                            cell.value = g.grade_value ? String(g.grade_value) : 'Н';
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF453A' } };
                            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                        } else if (g.attendance === 'late') {
                            cell.value = g.grade_value ? String(g.grade_value) : 'О';
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF9F0A' } };
                            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                        } else if (g.grade_value) {
                            cell.value = String(g.grade_value);
                            cell.font = { bold: true };
                        }
                    }
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }

                const numeric = studentGrades.filter(g => g.grade_value);
                const avg = numeric.length
                    ? Number((numeric.reduce((s, g) => s + g.grade_value, 0) / numeric.length).toFixed(2))
                    : '';
                const avgC = ws.getCell(row, avgCellCol);
                avgC.value = avg;
                avgC.font = { bold: true, color: { argb: 'FF0088CC' } };
                avgC.alignment = { horizontal: 'center' };
                row++;
            }

            for (let r = headerRow; r < row; r++) {
                for (let c = 1; c <= avgCellCol; c++) {
                    ws.getCell(r, c).border = {
                        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
                    };
                }
            }

            const fileName = `journal-${subject}-${month}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
            await wb.xlsx.write(res);
            res.end();
        } catch (e) {
            console.error('excel export:', e.message);
            res.status(500).json({ error: 'Ошибка выгрузки: ' + e.message });
        }
    });

    // ========================================================================
    //  POST /api/grades/:spaceId/import — без изменений
    // ========================================================================
    app.post('/api/grades/:spaceId/import',
        verifyJWT,
        upload.single('file'),
        async (req, res) => {
            try {
                const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
                if (!user.rows.length || !user.rows[0].is_teacher) {
                    return res.status(403).json({ error: 'Только для учителей' });
                }
                if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

                const { spaceId } = req.params;

                const wb = new ExcelJS.Workbook();
                await wb.xlsx.load(req.file.buffer);
                const ws = wb.worksheets[0];
                if (!ws) return res.status(400).json({ error: 'Пустой файл' });

                const subject = String(ws.getCell('B1').value || '').trim();
                const month = String(ws.getCell('B2').value || '').trim();
                if (!subject) return res.status(400).json({ error: 'Не указан предмет (B1)' });
                if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Неверный месяц (B2), ожидается YYYY-MM' });

                const { year, month: m } = parseMonthKey(month);

                const headerRow = 3;
                const dayColumns = [];
                for (let c = 2; c <= 40; c++) {
                    const v = ws.getCell(headerRow, c).value;
                    if (typeof v === 'number' && v >= 1 && v <= 31) {
                        dayColumns.push({ col: c, day: v });
                    }
                }
                if (!dayColumns.length) return res.status(400).json({ error: 'Не найдены дни месяца в строке 3' });

                const isSuperAdmin = user.rows[0].is_teacher_verified;
                if (!isSuperAdmin) {
                    const subjCheck = await pool.query(
                        'SELECT 1 FROM teacher_subjects WHERE space_id = $1 AND teacher_id = $2 AND subject_name = $3',
                        [spaceId, req.userId, subject]
                    );
                    if (!subjCheck.rows.length) {
                        await pool.query(
                            'INSERT INTO teacher_subjects (space_id, teacher_id, subject_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                            [spaceId, req.userId, subject]
                        );
                    }
                }

                let inserted = 0, updated = 0, skipped = 0, studentsAdded = 0;
                const errors = [];

                for (let r = headerRow + 1; r <= ws.rowCount; r++) {
                    const studentName = String(ws.getCell(r, 1).value || '').trim();
                    if (!studentName) continue;

                    const userMatch = await pool.query(
                        `SELECT id FROM users WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND is_teacher = FALSE LIMIT 1`,
                        [studentName]
                    );
                    const studentUserId = userMatch.rows[0]?.id || null;

                    const exists = await pool.query(
                        'SELECT 1 FROM journal_students WHERE space_id = $1 AND subject_name = $2 AND student_name = $3',
                        [spaceId, subject, studentName]
                    );
                    if (!exists.rows.length) {
                        try {
                            await pool.query(
                                'INSERT INTO journal_students (space_id, subject_name, student_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                                [spaceId, subject, studentName]
                            );
                            studentsAdded++;
                        } catch (e) {}
                    }

                    for (const dc of dayColumns) {
                        const raw = ws.getCell(r, dc.col).value;
                        const parsed = parseCellValue(raw);
                        if (!parsed) { continue; }

                        const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(dc.day).padStart(2, '0')}`;

                        try {
                            const existing = await pool.query(
                                `SELECT id FROM grades
                                 WHERE space_id = $1 AND student_name = $2 AND subject_name = $3
                                   AND lesson_date = $4::date AND teacher_id = $5`,
                                [spaceId, studentName, subject, dateStr, req.userId]
                            );

                            if (existing.rows.length) {
                                await pool.query(
                                    `UPDATE grades SET grade_value = $1, attendance = $2, updated_at = NOW() WHERE id = $3`,
                                    [parsed.grade, parsed.attendance, existing.rows[0].id]
                                );
                                updated++;
                            } else {
                                await pool.query(
                                    `INSERT INTO grades (space_id, student_user_id, student_name, subject_name, teacher_id, grade_value, attendance, lesson_date)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)`,
                                    [spaceId, studentUserId, studentName, subject, req.userId, parsed.grade, parsed.attendance, dateStr]
                                );
                                inserted++;
                            }

                            if (parsed.grade && studentUserId) {
                                try {
                                    const push = require('../push');
                                    push.notifyGrade(pool, studentUserId, subject, parsed.grade).catch(() => {});
                                } catch (e) {}
                            }
                        } catch (e) {
                            errors.push(`Строка ${r}, день ${dc.day}: ${e.message}`);
                        }
                    }
                }

                res.json({ ok: true, subject, month, inserted, updated, skipped, studentsAdded, errors: errors.slice(0, 20) });
            } catch (e) {
                console.error('excel import:', e.message);
                res.status(500).json({ error: 'Ошибка импорта: ' + e.message });
            }
        }
    );
}

module.exports = { registerExcelRoutes };
