// ============================================================================
//  push.js — Web Push (VAPID) + напоминания о парах + API мутов чата
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

async function sendPushToUsers(pool, userIds, payload) {
    if (!userIds || !userIds.length) return;
    if (!process.env.VAPID_PUBLIC_KEY) return;
    try {
        const { rows } = await pool.query(
            `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
            [userIds]
        );
        await Promise.all(rows.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify(payload)
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

async function getSpaceStudentIds(pool, spaceId) {
    const { rows } = await pool.query(
        `SELECT u.id
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.space_id = $1 AND u.is_teacher = FALSE`,
        [spaceId]
    );
    return rows.map(r => r.id);
}

async function getUnmutedStudents(pool, spaceId, exceptUserId) {
    const { rows } = await pool.query(
        `SELECT u.id
         FROM space_members sm
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN chat_mutes cm ON cm.user_id = u.id AND cm.space_id = sm.space_id
         WHERE sm.space_id = $1
           AND u.is_teacher = FALSE
           AND ($2::uuid IS NULL OR u.id != $2)
           AND NOT (
             cm.user_id IS NOT NULL AND (
               cm.muted_forever = TRUE
               OR (cm.muted_until IS NOT NULL AND cm.muted_until > NOW())
             )
           )`,
        [spaceId, exceptUserId || null]
    );
    return rows.map(r => r.id);
}

async function getAllUserIds(pool) {
    const { rows } = await pool.query('SELECT id FROM users');
    return rows.map(r => r.id);
}

async function notifyScheduleChange(pool, spaceId, body) {
    const ids = await getSpaceStudentIds(pool, spaceId);
    await sendPushToUsers(pool, ids, {
        title: '📅 Замена в расписании',
        body,
        url: '/',
        tag: `schedule-${spaceId}`
    });
}

async function notifyNewHomework(pool, spaceId, subject, title, dueDate) {
    const ids = await getSpaceStudentIds(pool, spaceId);
    await sendPushToUsers(pool, ids, {
        title: '📝 Новое ДЗ',
        body: `${subject}: ${title} (до ${dueDate})`,
        url: '/',
        tag: `hw-${spaceId}-${Date.now()}`
    });
}

async function notifyChatMessage(pool, spaceId, sender, text) {
    const ids = await getUnmutedStudents(pool, spaceId, sender.id);
    if (!ids.length) return;
    await sendPushToUsers(pool, ids, {
        title: `💬 ${sender.full_name || sender.username}`,
        body: String(text).slice(0, 140),
        url: '/',
        tag: `chat-${spaceId}`
    });
}

async function notifyCollegeAnnouncement(pool, text) {
    const ids = await getAllUserIds(pool);
    await sendPushToUsers(pool, ids, {
        title: '📢 Объявление колледжа',
        body: String(text).slice(0, 150),
        url: '/',
        tag: `announcement-${Date.now()}`
    });
}

// --- Напоминания за 10 минут до пары ---
const REMINDER_MIN = 10;
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
        const target = new Date(now.getTime() + REMINDER_MIN * 60 * 1000);
        const t = partsInTZ(target, TZ);

        const { rows: lessons } = await pool.query(
            `SELECT id, space_id, subject_name, classroom
             FROM schedules
             WHERE day_of_week = $1
               AND EXTRACT(HOUR FROM start_time) = $2
               AND EXTRACT(MINUTE FROM start_time) = $3`,
            [t.day, t.hour, t.minute]
        );

        for (const lesson of lessons) {
            const key = `${lesson.id}-${t.dateKey}`;
            if (sentReminders.has(key)) continue;

            const { rows: ovs } = await pool.query(
                `SELECT is_canceled, replacement_subject, replacement_classroom
                 FROM schedule_overrides
                 WHERE schedule_id = $1 AND override_date = $2`,
                [lesson.id, t.dateKey]
            );
            if (ovs.length && ovs[0].is_canceled) continue;

            sentReminders.add(key);
            const subject = (ovs[0] && ovs[0].replacement_subject) || lesson.subject_name;
            const room = (ovs[0] && ovs[0].replacement_classroom) || lesson.classroom;
            const ids = await getSpaceStudentIds(pool, lesson.space_id);
            await sendPushToUsers(pool, ids, {
                title: '⏰ Скоро урок',
                body: `${subject}${room ? ' · каб. ' + room : ''} — через 10 минут`,
                url: '/',
                tag: `lesson-${lesson.id}-${t.dateKey}`
            });
        }
        if (sentReminders.size > 2000) sentReminders.clear();
    } catch (e) {
        console.error('reminders error:', e.message);
    }
}

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
                 ON CONFLICT (endpoint) DO UPDATE
                 SET user_id = EXCLUDED.user_id,
                     p256dh = EXCLUDED.p256dh,
                     auth = EXCLUDED.auth`,
                [req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('subscribe:', e.message);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.post('/api/push/unsubscribe', verifyJWT, async (req, res) => {
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ error: 'Не указан endpoint' });
        await pool.query(
            'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
            [req.userId, endpoint]
        );
        res.json({ ok: true });
    });

    app.get('/api/spaces/:spaceId/chat-mute', verifyJWT, requireSpaceAccess, async (req, res) => {
        const r = await pool.query(
            'SELECT muted_until, muted_forever FROM chat_mutes WHERE user_id = $1 AND space_id = $2',
            [req.userId, req.params.spaceId]
        );
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
             ON CONFLICT (user_id, space_id) DO UPDATE
             SET muted_until = EXCLUDED.muted_until,
                 muted_forever = EXCLUDED.muted_forever`,
            [req.userId, req.params.spaceId, until, forever]
        );
        res.json({ ok: true, muted_until: until, muted_forever: forever });
    });

    app.delete('/api/spaces/:spaceId/chat-mute', verifyJWT, requireSpaceAccess, async (req, res) => {
        await pool.query(
            'DELETE FROM chat_mutes WHERE user_id = $1 AND space_id = $2',
            [req.userId, req.params.spaceId]
        );
        res.json({ ok: true });
    });

    // Внешний триггер для напоминаний (на случай сна Render)
    app.get('/api/cron/lesson-reminders', async (req, res) => {
        await checkLessonReminders(pool);
        res.json({ ok: true });
    });
}

module.exports = {
    initWebPush,
    sendPushToUsers,
    getSpaceStudentIds,
    getUnmutedStudents,
    getAllUserIds,
    notifyScheduleChange,
    notifyNewHomework,
    notifyChatMessage,
    notifyCollegeAnnouncement,
    checkLessonReminders,
    registerPushRoutes
};