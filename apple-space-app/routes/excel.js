// ============================================================================
//  routes/excel.js — импорт и экспорт журнала оценок в Excel
//  Формат: Предмет + Месяц + строки учеников × дни 1–31
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
    const y = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    return { year: y, month: m };
}

function formatMonthLabel(mk) {
    const { year, month } = parseMonthKey(mk);
    return `${MONTH_NAMES_RU[month]} ${year}`;
}

// Парсит содержимое ячейки: "5", "Н", "О", "5Н", "5О", пусто
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

// Формат ячейки для экспорта: "5", "Н", "О", "5Н", "5О", ""
function formatCellValue(grade, attendance) {
    const parts = [];
    if (grade) parts.push(String(grade));
    if (attendance === 'absent') parts.push('Н');
    else if (attendance === 'late') parts.push('О');
    return parts.join('');
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

            // Оценки за месяц
            const grades = (await pool.query(
                `SELECT * FROM grades
                 WHERE space_id = $1 AND subject_name = $2
                   AND lesson_date >= $3 AND lesson_date <= $4
                 ORDER BY student_name, lesson_date`,
                [spaceId, subject, monthStart, monthEnd]
            )).rows;

            // Ученики: из пространства + из виртуальных + из оценок
            const members = (await pool.query(
                `SELECT u.full_name FROM space_members sm
                 JOIN users u ON u.id = sm.user_id
                 WHERE sm.space_id = $1 AND u.is_teacher = FALSE`,
                [spaceId]
            )).rows.map(r => r.full_name);

            const virtualStudents = (await pool.query(
                `SELECT student_name FROM journal_students
                 WHERE space_id = $1 AND subject_name = $2`,
                [spaceId, subject]
            )).rows.map(r => r.student_name);

            const gradesStudents = [...new Set(grades.map(g => g.student_name))];
            const allStudents = [...new Set([...members, ...virtualStudents, ...gradesStudents])].sort();

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Workspaces';
            const ws = wb.addWorksheet('Журнал');

            // Строка 1: Предмет
            ws.getCell('A1').value = 'Предмет';
            ws.getCell('B1').value = subject;
            ws.getCell('A1').font = { bold: true };
            ws.getCell('B1').font = { bold: true, color: { argb: 'FF0088CC' } };

            // Строка 2: Месяц
            ws.getCell('A2').value = 'Месяц';
            ws.getCell('B2').value = month; // YYYY-MM
            ws.getCell('A2').font = { bold: true };
            ws.getCell('B2').font = { bold: true, color: { argb: 'FF0088CC' } };

            // Строка 2: подпись месяца (для читаемости)
            ws.getCell('C2').value = formatMonthLabel(month);
            ws.getCell('C2').font = { italic: true, color: { argb: 'FF707579' } };

            // Строка 3: заголовки
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

            // Ширина колонок
            ws.getColumn(1).width = 28;
            for (let d = 1; d <= daysInMonth + 1; d++) {
                ws.getColumn(1 + d).width = 5;
            }

            // Строки учеников
            let row = headerRow + 1;
            for (const st of allStudents) {
                ws.getCell(row, 1).value = st;
                ws.getCell(row, 1).font = { bold: true };

                const studentGrades = grades.filter(g => g.student_name === st);

                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const g = studentGrades.find(x => String(x.lesson_date).slice(0, 10) === dateStr);
                    const cell = ws.getCell(row, 1 + d);
                    if (g) {
                        cell.value = formatCellValue(g.grade_value, g.attendance);
                        if (g.attendance === 'absent') cell.font = { color: { argb: 'FFFF453A' }, bold: true };
                        else if (g.attendance === 'late') cell.font = { color: { argb: 'FFFF9F0A' }, bold: true };
                        else if (g.grade_value) cell.font = { bold: true };
                    }
                    cell.alignment = { horizontal: 'center' };
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

            // Границы
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
    //  POST /api/grades/:spaceId/import
    //  Формат: A1="Предмет", B1=название; A2="Месяц", B2=YYYY-MM;
    //  Строка 3: "ФИО", 1, 2, ... N (дни месяца);
    //  Строки 4+: ФИО + оценки
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
                const daysInMonth = getDaysInMonth(year, m);

                // Читаем заголовки дней начиная со столбца 2 строки 3
                const headerRow = 3;
                const dayColumns = [];
                for (let c = 2; c <= 40; c++) {
                    const v = ws.getCell(headerRow, c).value;
                    if (typeof v === 'number' && v >= 1 && v <= 31) {
                        dayColumns.push({ col: c, day: v });
                    }
                }
                if (!dayColumns.length) return res.status(400).json({ error: 'Не найдены дни месяца в строке 3' });

                // Учитель: проверяем, что он ведёт этот предмет (или verified)
                const isSuperAdmin = user.rows[0].is_teacher_verified;
                if (!isSuperAdmin) {
                    const subjCheck = await pool.query(
                        'SELECT 1 FROM teacher_subjects WHERE space_id = $1 AND teacher_id = $2 AND subject_name = $3',
                        [spaceId, req.userId, subject]
                    );
                    if (!subjCheck.rows.length) {
                        // Создаём привязку — считаем, что учитель хочет вести этот предмет
                        await pool.query(
                            'INSERT INTO teacher_subjects (space_id, teacher_id, subject_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                            [spaceId, req.userId, subject]
                        );
                    }
                }

                let inserted = 0, updated = 0, skipped = 0, studentsAdded = 0;
                const errors = [];

                // Строки с учениками начинаются с headerRow + 1
                for (let r = headerRow + 1; r <= ws.rowCount; r++) {
                    const studentName = String(ws.getCell(r, 1).value || '').trim();
                    if (!studentName) continue;

                    // Ищем user_id по ФИ
                    const userMatch = await pool.query(
                        `SELECT id FROM users WHERE LOWER(full_name) = LOWER($1) AND is_teacher = FALSE LIMIT 1`,
                        [studentName]
                    );
                    const studentUserId = userMatch.rows[0]?.id || null;

                    // Если ученика нет в пространстве — добавляем в journal_students
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
                                   AND lesson_date = $4 AND teacher_id = $5`,
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
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

                res.json({
                    ok: true,
                    subject,
                    month,
                    inserted,
                    updated,
                    skipped,
                    studentsAdded,
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
