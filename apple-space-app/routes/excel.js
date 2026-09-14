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

function registerExcelRoutes(app, pool, verifyJWT, requireSpaceAdmin) {

    // ========================================================================
    //  GET /api/grades/:spaceId/export?subject=...
    //  Выгрузка журнала в Excel. Только учитель.
    // ========================================================================
    app.get('/api/grades/:spaceId/export', verifyJWT, async (req, res) => {
        try {
            const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
            if (!user.rows.length || !user.rows[0].is_teacher) {
                return res.status(403).json({ error: 'Только для учителей' });
            }

            const { spaceId } = req.params;
            const { subject } = req.query;

            const isMember = await pool.query(
                'SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2',
                [spaceId, req.userId]
            );
            const isVerifiedTeacher = user.rows[0].is_teacher_verified;
            if (!isMember.rows.length && !isVerifiedTeacher) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            let gradesQuery = 'SELECT * FROM grades WHERE space_id = $1';
            const params = [spaceId];
            if (subject) {
                gradesQuery += ' AND subject_name = $2';
                params.push(subject);
            }
            gradesQuery += ' ORDER BY student_name, lesson_date';
            const grades = (await pool.query(gradesQuery, params)).rows;

            if (!grades.length) {
                return res.status(400).json({ error: 'Нет данных для выгрузки' });
            }

            const students = [...new Set(grades.map(g => g.student_name))].sort();
            const dates = [...new Set(grades.map(g => new Date(g.lesson_date).toISOString().slice(0, 10)))].sort();
            const subjectName = subject || (grades[0] && grades[0].subject_name) || 'Все предметы';

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Workspaces';
            const ws = wb.addWorksheet(subjectName.slice(0, 31));

            ws.columns = [
                { header: 'Ученик', key: 'student', width: 30 },
                ...dates.map(d => ({ header: d, key: d, width: 12 })),
                { header: 'Средний балл', key: 'avg', width: 14 }
            ];

            ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0088CC' } };
            ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getRow(1).height = 28;

            for (const student of students) {
                const rowData = { student };
                const studentGrades = grades.filter(g => g.student_name === student);

                for (const d of dates) {
                    const cell = studentGrades.filter(g => new Date(g.lesson_date).toISOString().slice(0, 10) === d);
                    if (!cell.length) { rowData[d] = ''; continue; }
                    const g = cell[0];
                    const parts = [];
                    if (g.grade_value) parts.push(String(g.grade_value));
                    if (g.attendance === 'absent') parts.push('Н');
                    else if (g.attendance === 'late') parts.push('О');
                    rowData[d] = parts.join(' ');
                }

                const numericGrades = studentGrades.filter(g => g.grade_value).map(g => g.grade_value);
                rowData.avg = numericGrades.length
                    ? Number((numericGrades.reduce((s, v) => s + v, 0) / numericGrades.length).toFixed(2))
                    : '';

                const row = ws.addRow(rowData);
                row.alignment = { horizontal: 'center', vertical: 'middle' };
                row.height = 22;
            }

            ws.eachRow((row) => {
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
                    };
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="journal-${encodeURIComponent(subjectName)}.xlsx"`);
            await wb.xlsx.write(res);
            res.end();
        } catch (e) {
            console.error('excel export:', e.message);
            res.status(500).json({ error: 'Ошибка выгрузки' });
        }
    });

    // ========================================================================
    //  POST /api/grades/:spaceId/import
    //  Импорт журнала из Excel. Только учитель.
    //  Формат: строки — ученики, столбцы — даты (YYYY-MM-DD), в ячейке "5 О" или "4" или "Н"
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
                const { subject } = req.body;
                if (!subject) return res.status(400).json({ error: 'Укажите предмет' });

                const subjCheck = await pool.query(
                    'SELECT 1 FROM teacher_subjects WHERE space_id = $1 AND teacher_id = $2 AND subject_name = $3',
                    [spaceId, req.userId, subject]
                );
                const isSuperAdmin = user.rows[0].is_teacher_verified;
                if (!subjCheck.rows.length && !isSuperAdmin) {
                    return res.status(403).json({ error: 'Вы не ведёте этот предмет' });
                }

                const wb = new ExcelJS.Workbook();
                await wb.xlsx.load(req.file.buffer);
                const ws = wb.worksheets[0];
                if (!ws) return res.status(400).json({ error: 'Пустой файл' });

                const headerRow = ws.getRow(1);
                const dateColumns = [];
                headerRow.eachCell((cell, colNumber) => {
                    if (colNumber === 1) return;
                    const val = String(cell.value || '').trim();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                        dateColumns.push({ col: colNumber, date: val });
                    }
                });

                if (!dateColumns.length) {
                    return res.status(400).json({ error: 'Не найдены даты в шапке (формат YYYY-MM-DD)' });
                }

                let inserted = 0, updated = 0, skipped = 0;
                const errors = [];

                for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
                    const row = ws.getRow(rowNum);
                    const studentName = String(row.getCell(1).value || '').trim();
                    if (!studentName) continue;

                    const userMatch = await pool.query(
                        `SELECT id FROM users WHERE LOWER(full_name) = LOWER($1) AND is_teacher = FALSE LIMIT 1`,
                        [studentName]
                    );
                    const studentUserId = userMatch.rows[0]?.id || null;

                    for (const dc of dateColumns) {
                        const raw = String(row.getCell(dc.col).value || '').trim();
                        if (!raw) continue;

                        const match = raw.match(/^(\d)?\s*([НО])?$/i);
                        if (!match) { skipped++; continue; }

                        const gradeValue = match[1] ? parseInt(match[1]) : null;
                        let attendance = 'present';
                        if (match[2] === 'Н') attendance = 'absent';
                        else if (match[2] === 'О') attendance = 'late';

                        if (!gradeValue && attendance === 'present') { skipped++; continue; }

                        try {
                            const existing = await pool.query(
                                `SELECT id FROM grades WHERE space_id = $1 AND student_name = $2 AND subject_name = $3 AND lesson_date = $4 AND teacher_id = $5`,
                                [spaceId, studentName, subject, dc.date, req.userId]
                            );

                            if (existing.rows.length) {
                                await pool.query(
                                    `UPDATE grades SET grade_value = $1, attendance = $2, updated_at = NOW() WHERE id = $3`,
                                    [gradeValue, attendance, existing.rows[0].id]
                                );
                                updated++;
                            } else {
                                await pool.query(
                                    `INSERT INTO grades (space_id, student_user_id, student_name, subject_name, teacher_id, grade_value, attendance, lesson_date)
                                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                                    [spaceId, studentUserId, studentName, subject, req.userId, gradeValue, attendance, dc.date]
                                );
                                inserted++;
                            }

                            if (gradeValue && studentUserId) {
                                try {
                                    const push = require('../push');
                                    push.notifyGrade(pool, studentUserId, subject, gradeValue).catch(() => {});
                                } catch (e) {}
                            }
                        } catch (e) {
                            errors.push(`Строка ${rowNum}, ${dc.date}: ${e.message}`);
                        }
                    }
                }

                res.json({
                    ok: true,
                    inserted,
                    updated,
                    skipped,
                    errors: errors.slice(0, 20)
                });
            } catch (e) {
                console.error('excel import:', e.message);
                res.status(500).json({ error: 'Ошибка импорта: ' + e.message });
            }
        }
    );
}

module.exports = { registerExcelRoutes };