// ============================================================================
//  test-mock-pg.js — минимальная замена драйвера `pg` для автотестов.
//  Нужен, чтобы прогонять API без реального PostgreSQL. SQL «исполняется»
//  маршрутизатором по шаблонам над таблицами в памяти.
// ============================================================================
const crypto = require('crypto');

const db = {
    users: [],
    spaces: [],
    space_members: [],
    space_settings: [],
    space_blocked: [],
    schedules: [],
    schedule_overrides: [],
    homeworks: [],
    homework_completions: [],
    chat_messages: [],
    files: [],
    grades: [],
    teacher_subjects: [],
    journal_students: [],
    grade_shares: [],
    game_scores: [],
    rpg_state: [],
    push_subscriptions: [],
    chat_mutes: [],
    push_mutes: [],
    message_reactions: [],
    message_mentions: [],
    chat_read_state: [],
    user_presence: [],
    user_notification_prefs: [],
    system_settings: [{ id: 1, remote_mode: false, maintenance_mode: false, exams_mode: false, private_chat_mode: true, global_announcement: '' }],
    space_announcements: [],
    pending_notifications: [],
    password_reset_requests: []
};

const uuid = () => crypto.randomUUID();
const now = () => new Date();

// ---------------------------------------------------------------- name_key
function nameKey(fullName) {
    if (fullName == null) return '';
    const cleaned = String(fullName).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    const parts = cleaned.split(' ').filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    const [a, b] = parts;
    return a > b ? `${b} ${a}` : `${a} ${b}`;
}

// ------------------------------------------------------------------ выборка
function tableOf(sql) {
    const m = sql.match(/\bFROM\s+([a-z_]+)/i) || sql.match(/\bINTO\s+([a-z_]+)/i) || sql.match(/\bUPDATE\s+([a-z_]+)/i);
    if (!m) return null;
    if (!db[m[1]]) return null;
    return m[1];
}

// Обрезает текст до конца WHERE-секции (учитывая вложенные скобки)
function whereClauseOf(sql) {
    const m = sql.match(/\bWHERE\b/i);
    if (!m) return null;
    const rest = sql.slice(m.index + m[0].length);
    // WHERE может заканчиваться ключевым словом верхнего уровня
    const stop = rest.search(/(ORDER\s+BY|GROUP\s+BY|LIMIT\b|RETURNING\b|HAVING\b)/i);
    if (stop !== -1) return rest.slice(0, stop);
    // …либо закрытием внешней группы: убираем только НЕпарные ')' в конце,
    // иначе срезается закрывающая скобка у IN (...) / ANY (...)
    let out = rest.replace(/\s+$/, '');
    while (out.endsWith(')')) {
        let open = 0, close = 0;
        for (const ch of out) {
            if (ch === '(') open++;
            else if (ch === ')') close++;
        }
        if (close <= open) break;
        out = out.slice(0, -1).replace(/\s+$/, '');
    }
    return out;
}

// Простой разбор WHERE: поддерживаются AND-условия вида col = $n,
// col = ANY($n::type[]), col IN (...), IS NULL / IS NOT NULL, col = 'literal'.
function matchRows(rows, sql, params) {
    const clause = whereClauseOf(sql);
    if (clause === null) return rows.slice();
    // Разбиваем по AND на верхнем уровне (вне строк и вложенных скобок)
    const conds = [];
    {
        let depth = 0, inStr = false, cur = '';
        for (let i = 0; i < clause.length; i++) {
            const ch = clause[i];
            if (ch === "'") inStr = !inStr;
            if (!inStr) {
                if (ch === '(') depth++;
                if (ch === ')') depth--;
                if (depth === 0 && clause.slice(i, i + 4).toUpperCase() === 'AND ') {
                    conds.push(cur);
                    cur = '';
                    i += 3;
                    continue;
                }
            }
            cur += ch;
        }
        conds.push(cur);
    }

    return rows.filter(row => conds.every(raw => {
        let cond = raw.trim().replace(/\s+/g, ' ');
        if (!cond) return true;
        if (/^\s*NOT\s+/i.test(cond)) return true; // не поддерживаем — не фильтруем
        const isNot = /IS\s+NOT\s+NULL/i.test(cond);
        if (/IS\s+(NOT\s+)?NULL/i.test(cond)) {
            const col = cond.split(/\s+IS/i)[0].trim().replace(/^.*\./, '');
            const val = row[col];
            const isNull = val === null || val === undefined;
            return isNot ? !isNull : isNull;
        }
        // col = ANY($n::type[])
        const any = cond.match(/^([a-z_]+)\s*=\s*ANY\(\$(\d+)/i);
        if (any) {
            const arr = params[Number(any[2]) - 1];
            return Array.isArray(arr) && arr.includes(row[any[1]]);
        }
        // col = $n
        const eq = cond.match(/^([a-z_]+)\s*=\s*\$(\d+)/i);
        if (eq) return looseEq(row[eq[1]], params[Number(eq[2]) - 1]);
        // col IN ('a','b')
        const inList = cond.match(/^([a-z_]+)\s+IN\s*\(([^)]*)\)/i);
        if (inList) {
            const values = inList[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
            return values.includes(String(row[inList[1]]));
        }
        // col = 'literal'
        const lit = cond.match(/^([a-z_]+)\s*=\s*'([^']*)'/i);
        if (lit) return looseEq(row[lit[1]], lit[2]);
        // col >= $n / > / <=
        const cmp = cond.match(/^([a-z_]+)\s*(>=|<=|>|<)\s*\$(\d+)/i);
        if (cmp) {
            const a = Number(row[cmp[1]]);
            const b = Number(params[Number(cmp[3]) - 1]);
            if (cmp[2] === '>=') return a >= b;
            if (cmp[2] === '<=') return a <= b;
            if (cmp[2] === '>') return a > b;
            return a < b;
        }
        // alias.col = $n
        const alias = cond.match(/^[a-z_]+\.([a-z_]+)\s*=\s*\$(\d+)/i);
        if (alias) return looseEq(row[alias[1]], params[Number(alias[2]) - 1]);
        // col = TRUE / FALSE (без параметра)
        const bool = cond.match(/^([a-z_]+)\s*=\s*(TRUE|FALSE)\s*$/i);
        if (bool) return row[bool[1]] === (bool[2].toUpperCase() === 'TRUE');
        // неизвестное условие игнорируем (тесты проверяют явные пути)
        return true;
    }));
}

function looseEq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    // Даты сравниваем по значению
    if (a instanceof Date || b instanceof Date) return String(a) === String(b);
    return String(a) === String(b);
}

function orderRows(rows, sql) {
    const m = sql.match(/ORDER BY([\s\S]*?)(?:LIMIT|$)/i);
    if (!m) return rows;
    const spec = m[1].trim();
    const col = spec.split(/[,\s]+/)[0].replace(/^[a-z_]+\./i, '');
    const desc = /DESC/i.test(spec);
    const out = rows.slice().sort((x, y) => {
        const a = x[col], b = y[col];
        if (a === b) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return a > b ? 1 : -1;
    });
    return desc ? out.reverse() : out;
}

function shapeRow(table, sql, params) {
    // Поддержка алиасов вида "u.full_name, u.username" и COUNT(*)::int AS c
    const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM/i);
    if (!selectMatch) return null;
    const list = selectMatch[1];
    if (/COUNT\(\*\)/i.test(list)) {
        return { c: 0 };
    }
    const out = {};
    for (const rawPart of list.split(',')) {
        const part = rawPart.trim();
        if (!part) continue;
        if (part === '*') return null; // отдаём строку целиком
        const alias = part.match(/\s+AS\s+([a-z_]+)\s*$/i);
        let col = alias ? alias[1] : part.replace(/^[a-z_]+\./i, '').trim();
        if (/^[a-z_]+$/i.test(col) && table) out[col] = undefined;
    }
    return out;
}

// ------------------------------------------------------------------- Pool
class MockPool {
    constructor() { this._connected = true; }

    async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        const p = Array.isArray(params) ? params : [];
        if (process.env.MOCK_DEBUG_SQL) console.log('[mock-sql]', text.slice(0, 120), JSON.stringify(p));
        try {
            const res = route(text, p);
            return res;
        } catch (e) {
            console.error('[mock-pg] query failed:', text.slice(0, 160), '|', e.message);
            throw e;
        }
    }

    async connect() { return { query: (s, pr) => this.query(s, pr), release() {} }; }
    async end() {}
    on() {}
}

function route(text, p) {
    // ---------- служебные ----------
    if (/^SELECT 1$/i.test(text)) return { rows: [{ '?column?': 1 }], rowCount: 1 };

    // ---------- статистика ДЗ (разбирается первым: запрос начинается с
    // "SELECT u.id ... FROM space_members sm ... LEFT JOIN homework_completions")
    if (/FROM space_members sm/i.test(text) && /LEFT JOIN homework_completions/i.test(text)) {
        const sidx = text.match(/sm\.space_id = \$(\d+)/i);
        const spaceId = sidx ? p[Number(sidx[1]) - 1] : null;
        const hwId = p[0];
        const memberRows = db.space_members.filter(m => !spaceId || m.space_id === spaceId);
        const rows = memberRows.map(m => {
            const u = db.users.find(x => x.id === m.user_id) || {};
            const hc = db.homework_completions.find(c => c.homework_id === hwId && c.user_id === m.user_id);
            const g = db.grades.find(x => x.homework_id === hwId && x.student_user_id === m.user_id);
            return {
                id: u.id, full_name: u.full_name, username: u.username, avatar_emoji: u.avatar_emoji,
                is_teacher: u.is_teacher, hidden_from_journal: m.hidden_from_journal,
                completed_at: hc ? hc.completed_at : null,
                attachment_url: hc ? (hc.attachment_url || null) : null,
                attachment_urls: hc ? (hc.attachment_urls || []) : [],
                attachment_keys: hc ? (hc.attachment_keys || []) : [],
                is_done: !!hc,
                grade_value: g ? g.grade_value : null
            };
        }).filter(r => !r.is_teacher);
        const rootFlag = p[2];
        const visible = rootFlag === true ? rows : rows.filter(r => !r.hidden_from_journal);
        return { rows: visible, rowCount: visible.length };
    }

    // ---------- system_settings ----------
    if (/FROM system_settings/i.test(text)) return { rows: db.system_settings.slice(0, 1), rowCount: 1 };
    if (/UPDATE system_settings/i.test(text)) {
        Object.assign(db.system_settings[0], {
            remote_mode: p[0], maintenance_mode: p[1], exams_mode: p[2],
            private_chat_mode: p[3], global_announcement: p[4]
        });
        return { rows: [db.system_settings[0]], rowCount: 1 };
    }

    // ---------- users ----------
    if (/FROM users/i.test(text)) {
        let rows = db.users;
        const base = tableOf(text);
        rows = matchRows(rows, text, p);
        if (/verification_code = \$1/i.test(text)) rows = rows.filter(r => r.verification_code === p[0]);
        if (/username = 'root_teacher'/i.test(text)) rows = rows.filter(r => r.username === 'root_teacher');
        if (/email = \$1 OR username = \$1/i.test(text)) rows = db.users.filter(r => r.email === p[0] || r.username === p[0]);
        return { rows: rows.slice(0, /LIMIT 1/i.test(text) ? 1 : undefined), rowCount: rows.length };
    }
    if (/UPDATE users SET full_name/i.test(text)) {
        const u = db.users.find(x => x.id === p[4]);
        if (u) Object.assign(u, { full_name: p[0], username: p[1], avatar_emoji: p[2], theme: p[3] });
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (/UPDATE users SET is_teacher_verified/i.test(text)) {
        const u = db.users.find(x => x.id === p[1]);
        if (u) { u.is_teacher_verified = true; u.verified_by = p[0]; }
        return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (/INSERT INTO users/i.test(text)) {
        const u = {
            id: uuid(), username: p[0], full_name: p[1], email: p[2], password_hash: p[3],
            is_teacher: p[4] ?? false, is_teacher_verified: p[5] ?? false,
            verification_code: p[6] ?? null, email_verified: true,
            avatar_emoji: '👤', theme: 'auto', failed_login_attempts: 0, locked_until: null,
            created_at: now()
        };
        db.users.push(u);
        return { rows: [u], rowCount: 1 };
    }

    // ---------- spaces ----------
    if (/INSERT INTO spaces/i.test(text)) {
        const s = { id: uuid(), name: p[0], invite_code: p[1], created_by: p[2], created_at: now() };
        db.spaces.push(s);
        return { rows: [s], rowCount: 1 };
    }
    if (/UPDATE spaces SET invite_code/i.test(text)) {
        const s = db.spaces.find(x => x.id === p[1]);
        if (s) s.invite_code = p[0];
        return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
    }
    if (/UPDATE spaces SET name/i.test(text)) {
        const s = db.spaces.find(x => x.id === p[1]);
        if (s) s.name = p[0];
        return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
    }
    if (/DELETE FROM spaces WHERE id = \$1/i.test(text)) {
        const before = db.spaces.length;
        db.spaces = db.spaces.filter(s => s.id !== p[0]);
        return { rows: [], rowCount: before - db.spaces.length };
    }
    if (/FROM spaces\b/i.test(text)) {
        // Для JOIN-запроса WHERE относится к space_members, а не к spaces,
        // поэтому берём таблицу целиком и фильтруем по участию.
        if (/JOIN space_members sm/i.test(text)) {
            const uidMatch = text.match(/sm\.user_id = \$(\d+)/i);
            const uid = uidMatch ? p[Number(uidMatch[1]) - 1] : null;
            const rows = db.spaces.map(s => {
                const m = db.space_members.find(x => x.space_id === s.id && (!uid || x.user_id === uid));
                return m ? { ...s, is_admin: m.role === 'admin' || m.role === 'starosta' } : null;
            }).filter(Boolean);
            return { rows: orderRows(rows, text), rowCount: rows.length };
        }
        let rows = matchRows(db.spaces, text, p);
        if (/invite_code = \$(\d+)/i.test(text)) {
            const idx = Number(text.match(/invite_code = \$(\d+)/i)[1]) - 1;
            rows = db.spaces.filter(s => s.invite_code === p[idx]);
        }
        if (/SELECT \*, true AS is_admin/i.test(text)) {
            rows = rows.map(s => ({ ...s, is_admin: true }));
        }
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- space_settings ----------
    if (/INSERT INTO space_settings/i.test(text)) {
        const spaceId = p[0];
        let row = db.space_settings.find(r => r.space_id === spaceId);
        if (!row) { row = { space_id: spaceId, ...defaultsForSettings(), updated_at: now() }; db.space_settings.push(row); }
        // Обновляем ТОЛЬКО те колонки, которые реально перечислены в SQL
        // (запрос всегда содержит полный список колонок, но safest — по тексту).
        const insertColsMatch = text.match(/INSERT INTO space_settings \(([^)]*)\)/i);
        const cols = insertColsMatch
            ? insertColsMatch[1].split(',').map(c => c.trim()).filter(c => c && c !== 'space_id' && c !== 'updated_at' && c !== 'updated_by')
            : colsForSettings();
        cols.forEach((c, i) => {
            if (c === 'updated_at' || c === 'updated_by') return;
            if (p[i + 1] !== undefined) row[c] = p[i + 1];
        });
        row.updated_at = now();
        row.updated_by = p[p.length - 1];
        return { rows: [row], rowCount: 1 };
    }
    if (/SELECT \* FROM space_settings WHERE space_id = \$1/i.test(text)) {
        const row = db.space_settings.find(r => r.space_id === p[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/SELECT members_can_share_grades FROM space_settings/i.test(text)) {
        const row = db.space_settings.find(r => r.space_id === p[0]);
        return { rows: row ? [{ members_can_share_grades: row.members_can_share_grades }] : [], rowCount: row ? 1 : 0 };
    }
    if (/FROM space_settings/i.test(text)) {
        let rows = matchRows(db.space_settings, text, p);
        // Любой SELECT по space_settings должен возвращать полную строку настроек
        rows = rows.map(r => ({ ...r }));
        return { rows, rowCount: rows.length };
    }

    // ---------- space_members ----------
    if (/INSERT INTO space_members/i.test(text)) {
        const exists = db.space_members.find(m => m.space_id === p[0] && m.user_id === p[1]);
        if (exists) return { rows: [], rowCount: 0 };
        const m = { id: uuid(), space_id: p[0], user_id: p[1], role: p[2] || 'member', muted_until: null, custom_status: null, hidden_from_journal: false, joined_at: now() };
        db.space_members.push(m);
        return { rows: [m], rowCount: 1 };
    }
    if (/UPDATE space_members SET role/i.test(text)) {
        const m = db.space_members.find(x => x.space_id === p[1] && x.user_id === p[2]);
        if (m) m.role = p[0];
        return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
    }
    if (/UPDATE space_members SET hidden_from_journal/i.test(text)) {
        const m = db.space_members.find(x => x.space_id === p[1] && x.user_id === p[2]);
        if (m) m.hidden_from_journal = p[0];
        return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
    }
    if (/DELETE FROM space_members/i.test(text)) {
        const before = db.space_members.length;
        db.space_members = db.space_members.filter(m => !(m.space_id === p[0] && m.user_id === p[1]));
        return { rows: [], rowCount: before - db.space_members.length };
    }
    if (/FROM space_members/i.test(text)) {
        let rows = matchRows(db.space_members, text, p);
        if (/JOIN users u ON u\.id = sm\.user_id/i.test(text)) {
            rows = rows.map(m => {
                const u = db.users.find(x => x.id === m.user_id);
                return u ? { ...m, ...u, id: u.id, role: m.role, custom_status: m.custom_status, muted_until: m.muted_until, hidden_from_journal: m.hidden_from_journal, joined_at: m.joined_at } : null;
            }).filter(Boolean);
            if (/u\.is_teacher = FALSE/i.test(text)) rows = rows.filter(r => !r.is_teacher);
            if (/COUNT\(\*\)/i.test(text)) return { rows: [{ c: rows.length }], rowCount: 1 };
        } else if (/COUNT\(\*\)/i.test(text)) {
            return { rows: [{ c: rows.length }], rowCount: 1 };
        }
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- homeworks ----------
    // ВАЖНО: запрос статистики начинается с "FROM space_members sm JOIN users",
    // поэтому его нужно разбирать ДО обработчика space_members.
    if (/FROM space_members sm/i.test(text) && /LEFT JOIN homework_completions/i.test(text)) {
        const sidx = text.match(/sm\.space_id = \$(\d+)/i);
        const spaceId = sidx ? p[Number(sidx[1]) - 1] : null;
        const hwId = p[0];
        const memberRows = db.space_members.filter(m => !spaceId || m.space_id === spaceId);
        const rows = memberRows.map(m => {
            const u = db.users.find(x => x.id === m.user_id) || {};
            const hc = db.homework_completions.find(c => c.homework_id === hwId && c.user_id === m.user_id);
            const g = db.grades.find(x => x.homework_id === hwId && x.student_user_id === m.user_id);
            return {
                id: u.id, full_name: u.full_name, username: u.username, avatar_emoji: u.avatar_emoji,
                is_teacher: u.is_teacher, hidden_from_journal: m.hidden_from_journal,
                completed_at: hc ? hc.completed_at : null,
                attachment_url: hc ? (hc.attachment_url || null) : null,
                attachment_urls: hc ? (hc.attachment_urls || []) : [],
                attachment_keys: hc ? (hc.attachment_keys || []) : [],
                is_done: !!hc,
                grade_value: g ? g.grade_value : null
            };
        }).filter(r => !r.is_teacher);
        const rootFlag = p[2];
        const visible = rootFlag === true ? rows : rows.filter(r => !r.hidden_from_journal);
        return { rows: visible, rowCount: visible.length };
    }
    if (/INSERT INTO homeworks/i.test(text)) {
        const h = {
            id: uuid(), space_id: p[0], subject_name: p[1], title: p[2], due_date: p[3],
            attachment_url: p[4], attachment_keys: p[5] || [], created_by: p[6], created_at: now()
        };
        db.homeworks.push(h);
        return { rows: [h], rowCount: 1 };
    }
    if (/DELETE FROM homeworks WHERE id = \$1/i.test(text)) {
        const before = db.homeworks.length;
        db.homeworks = db.homeworks.filter(h => h.id !== p[0]);
        return { rows: [], rowCount: before - db.homeworks.length };
    }
    if (/FROM homeworks/i.test(text)) {
        let rows = matchRows(db.homeworks, text, p);
        if (/LEFT JOIN homework_completions hc/i.test(text)) {
            const viewerId = p[1];
            rows = rows.map(h => {
                const hc = db.homework_completions.find(c => c.homework_id === h.id && c.user_id === viewerId);
                const g = db.grades.find(x => x.homework_id === h.id && x.student_user_id === viewerId);
                return {
                    ...h,
                    attachment_url: hc ? (hc.attachment_url || null) : null,
                    attachment_urls: hc ? (hc.attachment_urls || []) : [],
                    attachment_keys_hc: hc ? (hc.attachment_keys || []) : [],
                    attachment_url_hc: hc ? (hc.attachment_url || null) : null,
                    attachment_urls_hc: hc ? (hc.attachment_urls || []) : [],
                    completed_at: hc ? hc.completed_at : null,
                    is_done: !!hc,
                    grade_value: g ? g.grade_value : null
                };
            });
        }
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- homework_completions ----------
    if (/INSERT INTO homework_completions/i.test(text)) {
        let c = db.homework_completions.find(x => x.homework_id === p[0] && x.user_id === p[1]);
        if (!c) { c = { id: uuid(), homework_id: p[0], user_id: p[1] }; db.homework_completions.push(c); }
        Object.assign(c, { attachment_url: p[2], attachment_urls: p[3], attachment_keys: p[4], completed_at: now() });
        return { rows: [c], rowCount: 1 };
    }
    if (/DELETE FROM homework_completions/i.test(text)) {
        const before = db.homework_completions.length;
        db.homework_completions = db.homework_completions.filter(c => !(c.homework_id === p[0] && c.user_id === p[1]));
        return { rows: [], rowCount: before - db.homework_completions.length };
    }
    if (/FROM homework_completions/i.test(text)) {
        const rows = matchRows(db.homework_completions, text, p);
        return { rows, rowCount: rows.length };
    }

    // ---------- files ----------
    if (/INSERT INTO files/i.test(text)) {
        const f = { id: uuid(), space_id: p[0], user_id: p[1], key: p[2], original_name: p[3], mime: p[4], size: p[5], message_id: null, created_at: now() };
        db.files.push(f);
        return { rows: [f], rowCount: 1 };
    }
    if (/UPDATE files SET message_id/i.test(text)) {
        const ids = /ANY\(\$2::uuid\[\]\)/i.test(text) ? p[1] : [p[1]];
        let n = 0;
        for (const f of db.files) {
            if (!ids.includes(f.id)) continue;
            if (text.includes('user_id = $3') && f.user_id !== p[2]) continue;
            f.message_id = p[0];
            n++;
        }
        return { rows: [], rowCount: n };
    }
    if (/DELETE FROM files WHERE id = \$1/i.test(text)) {
        const before = db.files.length;
        db.files = db.files.filter(f => f.id !== p[0]);
        return { rows: [], rowCount: before - db.files.length };
    }
    if (/FROM files/i.test(text)) {
        const rows = matchRows(db.files, text, p);
        return { rows: rows.slice(0, /LIMIT\b/i.test(text) ? undefined : undefined), rowCount: rows.length };
    }

    // ---------- chat_messages ----------
    if (/INSERT INTO chat_messages/i.test(text)) {
        const m = { id: uuid(), space_id: p[0], user_id: p[1], message: p[2], reply_to_id: p[3] || null, created_at: now() };
        db.chat_messages.push(m);
        return { rows: [m], rowCount: 1 };
    }
    if (/DELETE FROM chat_messages WHERE id = \$1/i.test(text)) {
        const before = db.chat_messages.length;
        db.chat_messages = db.chat_messages.filter(m => !(m.id === p[0] && m.space_id === p[1]));
        return { rows: [], rowCount: before - db.chat_messages.length };
    }
    if (/FROM chat_messages/i.test(text)) {
        let rows = matchRows(db.chat_messages, text, p);
        if (/JOIN users u ON u\.id = cm\.user_id/i.test(text)) {
            rows = rows.map(m => {
                const u = db.users.find(x => x.id === m.user_id) || {};
                return { ...m, full_name: u.full_name, username: u.username, is_teacher: u.is_teacher, avatar_emoji: u.avatar_emoji };
            });
        }
        if (/message ILIKE \$2/i.test(text)) rows = rows.filter(m => String(m.message || '').toLowerCase().includes(String(p[1] || '').replace(/%/g, '').toLowerCase()));
        if (/COUNT\(\*\)/i.test(text)) return { rows: [{ c: rows.length }], rowCount: 1 };
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- chat_read_state / user_presence ----------
    if (/INSERT INTO chat_read_state/i.test(text)) {
        const r = db.chat_read_state.find(x => x.user_id === p[0] && x.space_id === p[1]);
        if (r) r.last_read_at = now(); else db.chat_read_state.push({ user_id: p[0], space_id: p[1], last_read_at: now() });
        return { rows: [], rowCount: 1 };
    }
    if (/FROM chat_read_state/i.test(text)) {
        const rows = matchRows(db.chat_read_state, text, p);
        return { rows, rowCount: rows.length };
    }
    if (/user_presence/i.test(text)) return { rows: [], rowCount: 1 };

    // ---------- grades ----------
    if (/INSERT INTO grades/i.test(text)) {
        let g = db.grades.find(x => x.space_id === p[0] && x.student_name === p[2] && x.subject_name === p[3] && x.lesson_date === p[7] && x.teacher_id === p[4]);
        if (!g) { g = { id: uuid(), created_at: now() }; db.grades.push(g); }
        Object.assign(g, {
            space_id: p[0], student_user_id: p[1], student_name: p[2], subject_name: p[3],
            teacher_id: p[4], grade_value: p[5], attendance: p[6], lesson_date: p[7],
            homework_id: p[8], comment: p[9], updated_at: now()
        });
        return { rows: [g], rowCount: 1 };
    }
    if (/FROM grades/i.test(text)) {
        let rows = matchRows(db.grades, text, p);
        if (/name_key\(student_name\) = name_key\(\$2\)/i.test(text)) rows = rows.filter(r => nameKey(r.student_name) === nameKey(p[1]));
        if (/name_key\(student_name\) = name_key\(\$3\)/i.test(text)) rows = rows.filter(r => nameKey(r.student_name) === nameKey(p[2]));
        if (/JOIN homework/i.test(text) || /g\.homework_id = \$1/i.test(text)) rows = rows.filter(r => r.homework_id === p[0]);
        if (/COUNT\(\*\)/i.test(text)) return { rows: [{ c: rows.length }], rowCount: 1 };
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- journal_students ----------
    if (/INSERT INTO journal_students/i.test(text)) {
        const j = { id: uuid(), space_id: p[0], subject_name: p[1], student_name: p[2], sort_order: p[3] ?? 0, created_at: now() };
        db.journal_students.push(j);
        return { rows: [j], rowCount: 1 };
    }
    if (/FROM journal_students/i.test(text)) {
        let rows = matchRows(db.journal_students, text, p);
        if (/name_key\(student_name\) = name_key\(\$3\)/i.test(text)) rows = rows.filter(r => nameKey(r.student_name) === nameKey(p[2]));
        if (/name_key\(student_name\) = name_key\(\$2\)/i.test(text)) rows = rows.filter(r => nameKey(r.student_name) === nameKey(p[1]));
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }

    // ---------- teacher_subjects ----------
    if (/INSERT INTO teacher_subjects/i.test(text)) {
        const t = { id: uuid(), space_id: p[0], teacher_id: p[1], subject_name: p[2] };
        db.teacher_subjects.push(t);
        return { rows: [t], rowCount: 1 };
    }
    if (/FROM teacher_subjects/i.test(text)) {
        const rows = matchRows(db.teacher_subjects, text, p);
        return { rows, rowCount: rows.length };
    }

    // ---------- rpg_state ----------
    if (/FROM rpg_state/i.test(text)) {
        let rows = matchRows(db.rpg_state, text, p);
        if (/JOIN users u/i.test(text)) {
            rows = rows.map(r => {
                const u = db.users.find(x => x.id === r.user_id) || {};
                return { ...r, full_name: u.full_name, username: u.username, avatar_emoji: u.avatar_emoji };
            });
        }
        return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO rpg_state/i.test(text)) {
        let s = db.rpg_state.find(x => x.user_id === p[0]);
        if (!s) { s = { user_id: p[0] }; db.rpg_state.push(s); }
        Object.assign(s, {
            coins: p[1], level: p[2], sword: p[3], armor: p[4], guilds: p[5],
            warriors: p[6], artifacts: p[7], monster_idx: p[8], kills_total: p[9],
            kills_on_level: p[10], extra: JSON.parse(p[11] || '{}'), last_online: now()
        });
        return { rows: [s], rowCount: 1 };
    }

    // ---------- game_scores / reactions / mentions / прочее ----------
    if (/INSERT INTO game_scores/i.test(text)) return { rows: [], rowCount: 1 };
    if (/FROM game_scores/i.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO message_reactions/i.test(text)) {
        let r = db.message_reactions.find(x => x.message_id === p[0] && x.user_id === p[1]);
        if (!r) { r = { id: uuid(), message_id: p[0], user_id: p[1] }; db.message_reactions.push(r); }
        r.emoji = p[2];
        return { rows: [r], rowCount: 1 };
    }
    if (/FROM message_reactions/i.test(text)) {
        const rows = matchRows(db.message_reactions, text, p);
        return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO message_mentions/i.test(text)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO user_notification_prefs/i.test(text)) {
        let r = db.user_notification_prefs.find(x => x.user_id === p[0]);
        if (!r) { r = { user_id: p[0], all_enabled: true, chat_enabled: true, schedule_enabled: true, lesson_reminder_enabled: true, new_homework_enabled: true, homework_deadline_enabled: true, grades_enabled: true }; db.user_notification_prefs.push(r); }
        return { rows: [r], rowCount: 1 };
    }
    if (/FROM user_notification_prefs/i.test(text)) {
        const rows = matchRows(db.user_notification_prefs, text, p);
        return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO push_subscriptions/i.test(text)) return { rows: [], rowCount: 1 };
    if (/FROM push_subscriptions/i.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO grade_shares/i.test(text)) {
        const exists = db.grade_shares.find(x => x.space_id === p[0] && x.owner_user_id === p[1] && x.shared_with_user_id === p[2]);
        if (exists) return { rows: [], rowCount: 0 };
        const g = { id: uuid(), space_id: p[0], owner_user_id: p[1], shared_with_user_id: p[2], created_at: now() };
        db.grade_shares.push(g);
        return { rows: [g], rowCount: 1 };
    }
    if (/FROM grade_shares/i.test(text)) {
        let rows = matchRows(db.grade_shares, text, p);
        if (/JOIN users u ON u\.id = gs\.shared_with_user_id/i.test(text)) {
            rows = rows.map(g => {
                const u = db.users.find(x => x.id === g.shared_with_user_id) || {};
                return { ...g, shared_with_name: u.full_name, shared_with_username: u.username };
            });
        }
        if (/JOIN users u ON u\.id = gs\.owner_user_id/i.test(text)) {
            rows = rows.map(g => {
                const u = db.users.find(x => x.id === g.owner_user_id) || {};
                return { ...g, owner_name: u.full_name, owner_username: u.username };
            });
        }
        return { rows: orderRows(rows, text), rowCount: rows.length };
    }
    if (/DELETE FROM grade_shares/i.test(text)) {
        const before = db.grade_shares.length;
        db.grade_shares = db.grade_shares.filter(x => x.id !== p[0]);
        return { rows: [], rowCount: before - db.grade_shares.length };
    }
    if (/INSERT INTO space_blocked/i.test(text)) {
        let b = db.space_blocked.find(x => x.space_id === p[0] && x.user_id === p[1]);
        if (!b) { b = { id: uuid(), space_id: p[0], user_id: p[1] }; db.space_blocked.push(b); }
        Object.assign(b, { blocked_by: p[2], reason: p[3], blocked_at: now() });
        return { rows: [b], rowCount: 1 };
    }
    if (/FROM space_blocked/i.test(text)) {
        let rows = matchRows(db.space_blocked, text, p);
        if (/JOIN users u/i.test(text)) {
            rows = rows.map(b => {
                const u = db.users.find(x => x.id === b.user_id) || {};
                return { ...b, full_name: u.full_name, username: u.username, avatar_emoji: u.avatar_emoji, type: 'blocked' };
            });
        }
        return { rows, rowCount: rows.length };
    }
    if (/DELETE FROM space_blocked/i.test(text)) {
        const before = db.space_blocked.length;
        db.space_blocked = db.space_blocked.filter(x => !(x.space_id === p[0] && x.user_id === p[1]));
        return { rows: [], rowCount: before - db.space_blocked.length };
    }
    if (/INSERT INTO schedules/i.test(text)) return { rows: [], rowCount: 1 };
    if (/FROM schedules/i.test(text)) return { rows: [], rowCount: 0 };
    if (/DELETE FROM schedules/i.test(text)) return { rows: [], rowCount: 0 };
    if (/FROM schedule_overrides/i.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO schedule_overrides/i.test(text)) return { rows: [{ id: uuid() }], rowCount: 1 };
    if (/FROM password_reset_requests/i.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO password_reset_requests/i.test(text)) return { rows: [{ id: uuid(), code: p[4], token: p[5], display_name: p[2], username: p[3], user_type: p[1], status: 'pending', created_at: now() }], rowCount: 1 };
    if (/FROM pending_notifications/i.test(text)) return { rows: [], rowCount: 0 };
    if (/FROM push_mutes|FROM chat_mutes/i.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO push_mutes|INSERT INTO chat_mutes/i.test(text)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO user_presence/i.test(text)) return { rows: [], rowCount: 1 };
    if (/ALTER TABLE|CREATE TABLE|CREATE INDEX|CREATE EXTENSION|CREATE OR REPLACE FUNCTION/i.test(text)) return { rows: [], rowCount: 0 };
    if (/DELETE FROM chat_messages WHERE created_at/i.test(text)) return { rows: [], rowCount: 0 };

    // Неизвестный запрос: не падаем, но сообщаем — это поможет заметить пробел в моке
    console.warn('[mock-pg] unmatched SQL:', text.slice(0, 200));
    return { rows: [], rowCount: 0 };
}

function defaultsForSettings() {
    return {
        homework_post_policy: 'admins', homework_complete_policy: 'all',
        feature_schedule: true, feature_homework: true, feature_grades: true,
        feature_chat: true, feature_games: true, feature_files: true,
        members_can_see_members: true, members_can_chat: true, members_can_react: true,
        members_can_view_others_grades: false, members_can_share_grades: true,
        members_can_delete_own_homework: true, only_teachers_grade: true, members_can_manage: true
    };
}
function colsForSettings() {
    return ['homework_post_policy', 'homework_complete_policy',
        'feature_schedule', 'feature_homework', 'feature_grades', 'feature_chat',
        'feature_games', 'feature_files', 'members_can_see_members', 'members_can_chat',
        'members_can_react', 'members_can_view_others_grades', 'members_can_share_grades',
        'members_can_delete_own_homework', 'only_teachers_grade', 'members_can_manage'];
}

module.exports = { Pool: MockPool, db, nameKey };
