// ============================================================================
//  push.js — Web Push + напоминания + приоритетные пуши + настройки уведомлений
// ============================================================================
const webpush = require('web-push');

function initWebPush() {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        console.warn('⚠️ VAPID ключи не заданы — пуши отключены');
        return false;
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push инициализирован');
    return true;
}

// ============================================================================
//  Проверка настроек уведомлений пользователя
// ============================================================================
async function checkUserPrefs(pool, userId, type) {
    try {
        const r = await pool.query('SELECT * FROM user_notification_prefs WHERE user_id = $1', [userId]);
        if (!r.rows.length) return true;
        const prefs = r.rows[0];

        // Reply/@/объявления — всегда
        if (type === 'chat_reply' || type === 'chat_mention' || type === 'announcement') return true;

        // Главный тумблер выключен — всё остальное не приходит
        if (!prefs.all_enabled) return false;

        switch (type) {
            case 'chat':
                return prefs.chat_enabled !== false;
            case 'schedule':
                return prefs.schedule_enabled !== false;
            case 'lesson_reminder':
                return prefs.lesson_reminder_enabled !== false;
            case 'homework_new':
                return prefs.new_homework_enabled !== false;
            case 'homework_deadline':
                return prefs.homework_deadline_enabled !== false;
            case 'grade':
                return prefs.grades_enabled !== false;
            default:
                return true;
        }
    } catch (e) { return true; }
}

// ============================================================================
//  Отправка пуша
//  opts:
//    - skipMuteFilter: true — игнорировать глобальные муты (для объявлений и reply)
//    - priority: true — пометить как важное
//    - notifyType: тип для проверки настроек
// ============================================================================
async function sendPushToUsers(pool, userIds, payload, opts = {}) {
    if (!userIds || !userIds.length) return;
    if (!process.env.VAPID_PUBLIC_KEY) return;

    try {
        let ids = userIds;

        // Фильтр глобальных мутов
        if (!opts.skipMuteFilter) {
            const { rows: muted } = await pool.query(
                `SELECT user_id FROM push_mutes
                 WHERE user_id = ANY($1::uuid[])
                   AND (muted_forever = TRUE OR (muted_until IS NOT NULL AND muted_until > NOW()))`,
                [userIds]
            );
            if (muted.length) {
                const mutedSet = new Set(muted.map(r => r.user_id));
                ids = ids.filter(id => !mutedSet.has(id));
            }
        }

        // Фильтр настроек уведомлений — батчинг: один запрос на всех
        if (opts.notifyType && ids.length) {
            const { rows: prefs } = await pool.query(
                `SELECT user_id, all_enabled, chat_enabled, schedule_enabled,
                        lesson_reminder_enabled, new_homework_enabled,
                        homework_deadline_enabled, grades_enabled
                 FROM user_notification_prefs WHERE user_id = ANY($1::uuid[])`,
                [ids]
            );
            const prefsMap = {};
            prefs.forEach(p => { prefsMap[p.user_id] = p; });

            const type = opts.notifyType;
            ids = ids.filter(uid => {
                const p = prefsMap[uid];
                if (!p) return true; // нет настроек — по умолчанию разрешено
                if (!p.all_enabled) return false;
                switch (type) {
                    case 'chat': return p.chat_enabled !== false;
                    case 'schedule': return p.schedule_enabled !== false;
                    case 'lesson_reminder': return p.lesson_reminder_enabled !== false;
                    case 'homework_new': return p.new_homework_enabled !== false;
                    case 'homework_deadline': return p.homework_deadline_enabled !== false;
                    case 'grade': return p.grades_enabled !== false;
                    default: return true;
                }
            });
        }

        if (!ids.length) return;

        const { rows } = await pool.query(
            `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
            [ids]
        );

        const finalPayload = { ...payload, priority: !!opts.priority };

        await Promise.all(rows.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify(finalPayload)
                );
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
                } else {
                    console.error('PUSH ERROR:', err.message);
                }
            }
        }));
    } catch (e) {
        console.error('sendPushToUsers error:', e.message);
    }
}

// ============================================================================
//  Глобальные муты пушей
// ============================================================================
async function getPushMute(pool, userId) {
    const { rows } = await pool.query('SELECT muted_until, muted_forever FROM push_mutes WHERE user_id = $1', [userId]);
    return rows[0] || { muted_until: null, muted_forever: false };
}

async function setPushMute(pool, userId, duration) {
    let until = null, forever = false;
    if (duration === 'forever') forever = true;
    else if (duration === '1h')  until = new Date(Date.now() + 1  * 3600 * 1000);
    else if (duration === '8h')  until = new Date(Date.now() + 8  * 3600 * 1000);
    else if (duration === '24h') until = new Date(Date.now() + 24 * 3600 * 1000);
    else throw new Error('Неверная длительность');

    await pool.query(
        `INSERT INTO push_mutes (user_id, muted_until, muted_forever, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET muted_until = EXCLUDED.muted_until, muted_forever = EXCLUDED.muted_forever, updated_at = NOW()`,
        [userId, until, forever]
    );
    return { muted_until: until, muted_forever: forever };
}

async function clearPushMute(pool, userId) {
    await pool.query('DELETE FROM push_mutes WHERE user_id = $1', [userId]);
}

// ============================================================================
//  Получатели
// ============================================================================
async function getSpaceStudentIds(pool, spaceId) {
    const { rows } = await pool.query(
        `SELECT u.id FROM space_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.space_id = $1 AND u.is_teacher = FALSE`,
        [spaceId]
    );
    return rows.map(r => r.id);
}

async function getAllUserIds(pool) {
    const { rows } = await pool.query('SELECT id FROM users');
    return rows.map(r => r.id);
}

// ============================================================================
//  События
// ============================================================================
async function notifyScheduleChange(pool, spaceId, body) {
    const ids = await getSpaceStudentIds(pool, spaceId);
    await sendPushToUsers(pool, ids, {
        title: 'Изменения в расписании',
        body,
        url: '/',
        tag: `schedule-${spaceId}`
    }, { notifyType: 'schedule' });
}

async function notifyNewHomework(pool, spaceId, subject, title, dueDate) {
    const ids = await getSpaceStudentIds(pool, spaceId);
    await sendPushToUsers(pool, ids, {
        title: 'Новое домашнее задание',
        body: `${subject}: ${title} (до ${dueDate})`,
        url: '/',
        tag: `hw-${spaceId}-${Date.now()}`
    }, { notifyType: 'homework_new' });
}

async function notifyGrade(pool, studentUserId, subject, gradeValue) {
    await sendPushToUsers(pool, [studentUserId], {
        title: 'Новая оценка',
        body: `${subject}: ${gradeValue}`,
        url: '/',
        tag: `grade-${studentUserId}-${Date.now()}`
    }, { notifyType: 'grade' });
}

// Пуш о сообщении в чате с учётом reply/@
async function notifyChatMessage(pool, spaceId, sender, text, opts = {}) {
    const { replyToId, mentionedIds = [], messageId } = opts;

    // 1. Reply — приоритетный пуш автору оригинального сообщения
    if (replyToId) {
        const parent = await pool.query('SELECT user_id FROM chat_messages WHERE id = $1', [replyToId]);
        if (parent.rows.length && parent.rows[0].user_id !== sender.id) {
            const targetId = parent.rows[0].user_id;
            const mute = await getPushMute(pool, targetId);
            const muted = mute.muted_forever || (mute.muted_until && new Date(mute.muted_until) > new Date());
            if (!muted) {
                await sendPushToUsers(pool, [targetId], {
                    title: `Ответ от ${sender.full_name || sender.username}`,
                    body: String(text).slice(0, 140),
                    url: '/',
                    tag: `priority-reply-${messageId}`
                }, { skipMuteFilter: true, priority: true });
            }
        }
    }

    // 2. Упоминания (@nickname) — приоритетные
    const validMentions = mentionedIds.filter(uid => uid !== sender.id);
    for (const uid of validMentions) {
        const mute = await getPushMute(pool, uid);
        const muted = mute.muted_forever || (mute.muted_until && new Date(mute.muted_until) > new Date());
        if (!muted) {
            await sendPushToUsers(pool, [uid], {
                title: `${sender.full_name || sender.username} упомянул вас`,
                body: String(text).slice(0, 140),
                url: '/',
                tag: `priority-mention-${messageId}-${uid}`
            }, { skipMuteFilter: true, priority: true });
        }
    }

    // 3. Обычные пуши всем остальным студентам без мутов
    const excludeIds = [sender.id, ...validMentions];
    if (replyToId) {
        const parent = await pool.query('SELECT user_id FROM chat_messages WHERE id = $1', [replyToId]);
        if (parent.rows.length) excludeIds.push(parent.rows[0].user_id);
    }

    const { rows } = await pool.query(
        `SELECT u.id FROM space_members sm JOIN users u ON u.id = sm.user_id
         LEFT JOIN chat_mutes cm ON cm.user_id = u.id AND cm.space_id = sm.space_id
         WHERE sm.space_id = $1 AND u.is_teacher = FALSE
           AND NOT (u.id = ANY($2::uuid[]))
           AND NOT (cm.user_id IS NOT NULL AND (cm.muted_forever = TRUE OR (cm.muted_until IS NOT NULL AND cm.muted_until > NOW())))`,
        [spaceId, excludeIds]
    );

    const ids = rows.map(r => r.id);
    if (ids.length) {
        await sendPushToUsers(pool, ids, {
            title: `💬 ${sender.full_name || sender.username}`,
            body: String(text).slice(0, 140),
            url: '/',
            tag: `chat-${spaceId}`
        }, { notifyType: 'chat' });
    }
}

async function notifyCollegeAnnouncement(pool, text) {
    const ids = await getAllUserIds(pool);
    await sendPushToUsers(pool, ids, {
        title: 'Объявление колледжа',
        body: String(text).slice(0, 150),
        url: '/',
        tag: `announcement-${Date.now()}`
    }, { skipMuteFilter: true, notifyType: 'announcement' });
}

// ============================================================================
//  Напоминания о парах (±1 минута)
// ============================================================================
const TZ = process.env.SCHEDULE_TIMEZONE || 'Europe/Moscow';
const sentReminders = new Set();

function partsInTZ(date, tz) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit', minute: '2-digit',
        weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour12: false
    });
    const o = {};
    for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
    const wd = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        day: wd[o.weekday],
        hour: parseInt(o.hour, 10),
        minute: parseInt(o.minute, 10),
        dateKey: `${o.year}-${o.month}-${o.day}`
    };
}

async function checkLessonReminders(pool) {
    try {
        const now = new Date();
        const targetFrom = new Date(now.getTime() + 9  * 60 * 1000);
        const targetTo   = new Date(now.getTime() + 11 * 60 * 1000);
        const tFrom = partsInTZ(targetFrom, TZ);
        const tTo   = partsInTZ(targetTo, TZ);

        if (tFrom.day !== tTo.day) return;

        const { rows: lessons } = await pool.query(
            `SELECT id, space_id, subject_name, classroom
             FROM schedules
             WHERE day_of_week = $1
               AND (EXTRACT(HOUR FROM start_time) * 60 + EXTRACT(MINUTE FROM start_time))
                   BETWEEN ($2::int * 60 + $3::int) AND ($4::int * 60 + $5::int)`,
            [tFrom.day, tFrom.hour, tFrom.minute, tTo.hour, tTo.minute]
        );

        for (const lesson of lessons) {
            const key = `${lesson.id}-${tFrom.dateKey}`;
            if (sentReminders.has(key)) continue;

            const { rows: ovs } = await pool.query(
                `SELECT is_canceled, replacement_subject, replacement_classroom
                 FROM schedule_overrides WHERE schedule_id = $1 AND override_date = $2`,
                [lesson.id, tFrom.dateKey]
            );
            if (ovs.length && ovs[0].is_canceled) continue;

            sentReminders.add(key);
            const subject = (ovs[0] && ovs[0].replacement_subject) || lesson.subject_name;
            const room = (ovs[0] && ovs[0].replacement_classroom) || lesson.classroom;
            const ids = await getSpaceStudentIds(pool, lesson.space_id);
            await sendPushToUsers(pool, ids, {
                title: 'Скоро урок',
                body: `${subject}${room ? ' · каб. ' + room : ''} — через 10 минут`,
                url: '/',
                tag: `lesson-${lesson.id}-${tFrom.dateKey}`
            }, { notifyType: 'lesson_reminder' });
        }
        if (sentReminders.size > 2000) sentReminders.clear();
    } catch (e) {
        console.error('reminders error:', e.message);
    }
}

// ============================================================================
//  REST-роуты пушей и мутов
// ============================================================================
function registerPushRoutes(app, pool, verifyJWT, requireSpaceAccess) {
    app.get('/api/push/public-key', (req, res) => {
        res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
    });

    app.post('/api/push/subscribe', verifyJWT, async (req, res) => {
        try {
            const sub = req.body;
            if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
                return res.status(400).json({ error: 'Неверная подписка' });
            }
            await pool.query(
                `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
                [req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
            );
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
    });

    app.post('/api/push/unsubscribe', verifyJWT, async (req, res) => {
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ error: 'Не указан endpoint' });
        await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.userId, endpoint]);
        res.json({ ok: true });
    });

    app.get('/api/push/mute', verifyJWT, async (req, res) => {
        res.json(await getPushMute(pool, req.userId));
    });

    app.post('/api/push/mute', verifyJWT, async (req, res) => {
        try {
            const { duration } = req.body || {};
            const result = await setPushMute(pool, req.userId, duration);
            res.json({ ok: true, ...result });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app.delete('/api/push/mute', verifyJWT, async (req, res) => {
        await clearPushMute(pool, req.userId);
        res.json({ ok: true });
    });

    app.get('/api/spaces/:spaceId/chat-mute', verifyJWT, requireSpaceAccess, async (req, res) => {
        const r = await pool.query('SELECT muted_until, muted_forever FROM chat_mutes WHERE user_id = $1 AND space_id = $2', [req.userId, req.params.spaceId]);
        res.json(r.rows[0] || { muted_until: null, muted_forever: false });
    });

    app.post('/api/spaces/:spaceId/chat-mute', verifyJWT, requireSpaceAccess, async (req, res) => {
        const { duration } = req.body || {};
        let until = null, forever = false;
        if (duration === 'forever') forever = true;
        else if (duration === '1h')  until = new Date(Date.now() + 1  * 3600 * 1000);
        else if (duration === '8h')  until = new Date(Date.now() + 8  * 3600 * 1000);
        else if (duration === '24h') until = new Date(Date.now() + 24 * 3600 * 1000);
        else return res.status(400).json({ error: 'Неверная длительность' });

        await pool.query(
            `INSERT INTO chat_mutes (user_id, space_id, muted_until, muted_forever)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, space_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, muted_forever = EXCLUDED.muted_forever`,
            [req.userId, req.params.spaceId, until, forever]
        );
        res.json({ ok: true, muted_until: until, muted_forever: forever });
    });

    app.delete('/api/spaces/:spaceId/chat-mute', verifyJWT, requireSpaceAccess, async (req, res) => {
        await pool.query('DELETE FROM chat_mutes WHERE user_id = $1 AND space_id = $2', [req.userId, req.params.spaceId]);
        res.json({ ok: true });
    });

    app.get('/api/cron/lesson-reminders', async (req, res) => {
        await checkLessonReminders(pool);
        res.json({ ok: true });
    });
}

module.exports = {
    initWebPush,
    sendPushToUsers,
    getSpaceStudentIds,
    getAllUserIds,
    notifyScheduleChange,
    notifyNewHomework,
    notifyChatMessage,
    notifyCollegeAnnouncement,
    notifyGrade,
    checkLessonReminders,
    registerPushRoutes,
    getPushMute,
    setPushMute,
    clearPushMute
};
