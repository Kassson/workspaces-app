// ================= ИГРЫ =================
const VALID_GAMES = ['2048', 'snake-arena', 'rpg-clicker', 'memory', 'reaction'];

// SQL-выражение для расчёта очков в RPG-кликере
// Рейтинг = level * 10000 + kills_total * 100 + coins / 10
const RPG_SCORE_SQL = `LEAST(
    rs.level::bigint * 10000 + rs.kills_total::bigint * 100 + (rs.coins / 10),
    2100000000
)::int`;

// ============================================================================
//  Глобальный рейтинг
// ============================================================================
app.get('/api/games-global/:gameId/leaderboard', verifyJWT, async (req, res) => {
    const gameId = req.params.gameId;
    if (!VALID_GAMES.includes(gameId)) return res.json([]);
    try {
        if (gameId === 'rpg-clicker') {
            const r = await pool.query(
                `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                        ${RPG_SCORE_SQL} AS score,
                        rs.level, rs.kills_total, rs.coins
                 FROM rpg_state rs
                 JOIN users u ON u.id = rs.user_id
                 ORDER BY score DESC
                 LIMIT 20`
            );
            return res.json(r.rows);
        }
        const r = await pool.query(
            `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                    MAX(gs.score)::int AS score
             FROM game_scores gs
             JOIN users u ON u.id = gs.user_id
             WHERE gs.game_id = $1
             GROUP BY u.id, u.full_name, u.username, u.avatar_emoji
             ORDER BY score DESC
             LIMIT 20`,
            [gameId]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('global leaderboard:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ============================================================================
//  Локальный рейтинг (по текущей группе)
// ============================================================================
app.get('/api/games/:spaceId/:gameId/leaderboard', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { spaceId, gameId } = req.params;
    if (!VALID_GAMES.includes(gameId)) return res.json([]);
    try {
        if (gameId === 'rpg-clicker') {
            const r = await pool.query(
                `SELECT u.id, u.full_name, u.username, u.avatar_emoji,
                        ${RPG_SCORE_SQL} AS score,
                        rs.level, rs.kills_total, rs.coins
                 FROM rpg_state rs
                 JOIN users u ON u.id = rs.user_id
                 JOIN space_members sm ON sm.user_id = u.id AND sm.space_id = $1
                 WHERE u.is_teacher = FALSE
                 ORDER BY score DESC
                 LIMIT 20`,
                [spaceId]
            );
            return res.json(r.rows);
        }
        const r = await pool.query(
            `SELECT gs.score::int AS score, gs.updated_at,
                    u.id, u.full_name, u.username, u.avatar_emoji
             FROM game_scores gs
             JOIN users u ON u.id = gs.user_id
             WHERE gs.space_id = $1 AND gs.game_id = $2
             ORDER BY gs.score DESC
             LIMIT 20`,
            [spaceId, gameId]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('local leaderboard:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ============================================================================
//  Отправка счёта (snake / 2048 / memory / reaction)
// ============================================================================
app.post('/api/games/:spaceId/:gameId/score', verifyJWT, requireSpaceAccess, async (req, res) => {
    const { score } = req.body;
    const { spaceId, gameId } = req.params;
    if (!VALID_GAMES.includes(gameId)) return res.status(400).json({ error: 'Неизвестная игра' });
    if (gameId === 'rpg-clicker') return res.status(400).json({ error: 'Для кликера используйте /api/games/rpg-state' });
    if (typeof score !== 'number' || score < 0 || !isFinite(score)) return res.status(400).json({ error: 'Неверный счёт' });
    try {
        await pool.query(
            `INSERT INTO game_scores (space_id, user_id, game_id, score)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (space_id, user_id, game_id)
             DO UPDATE SET score = GREATEST(game_scores.score, EXCLUDED.score),
                           updated_at = NOW()`,
            [spaceId, req.userId, gameId, Math.floor(score)]
        );
        res.json({ message: 'Сохранено' });
    } catch (e) {
        console.error('submit score:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ============================================================================
//  RPG-кликер: загрузка и сохранение состояния
// ============================================================================
app.get('/api/games/rpg-state', verifyJWT, async (req, res) => {
    try {
        let r = await pool.query('SELECT * FROM rpg_state WHERE user_id = $1', [req.userId]);
        if (!r.rows.length) {
            r = await pool.query(
                `INSERT INTO rpg_state (user_id) VALUES ($1)
                 ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
                 RETURNING *`,
                [req.userId]
            );
        }
        const s = r.rows[0];
        res.json({
            coins: Number(s.coins) || 0,
            level: s.level || 1,
            sword: s.sword || 1,
            armor: s.armor || 0,
            guilds: s.guilds || 0,
            warriors: s.warriors || 0,
            artifacts: s.artifacts || 0,
            monsterIdx: s.monster_idx || 0,
            killsTotal: s.kills_total || 0,
            killsOnLevel: s.kills_on_level || 0,
            lastOnline: s.last_online ? new Date(s.last_online).getTime() : 0
        });
    } catch (e) {
        console.error('rpg-state GET:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/games/rpg-state', verifyJWT, async (req, res) => {
    const {
        coins, level, sword, armor, guilds, warriors, artifacts,
        monsterIdx, killsTotal, killsOnLevel
    } = req.body || {};

    // Санити-чек: всё приводим к целым неотрицательным числам
    const toInt = (v, def = 0) => {
        const n = Number(v);
        return (isFinite(n) && n >= 0) ? Math.floor(n) : def;
    };

    const safe = {
        coins: toInt(coins),
        level: Math.max(1, toInt(level, 1)),
        sword: Math.max(1, toInt(sword, 1)),
        armor: toInt(armor),
        guilds: toInt(guilds),
        warriors: toInt(warriors),
        artifacts: toInt(artifacts),
        monsterIdx: toInt(monsterIdx),
        killsTotal: toInt(killsTotal),
        killsOnLevel: toInt(killsOnLevel)
    };

    try {
        await pool.query(
            `INSERT INTO rpg_state
                (user_id, coins, level, sword, armor, guilds, warriors, artifacts,
                 monster_idx, kills_total, kills_on_level, last_online, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                coins = EXCLUDED.coins,
                level = EXCLUDED.level,
                sword = EXCLUDED.sword,
                armor = EXCLUDED.armor,
                guilds = EXCLUDED.guilds,
                warriors = EXCLUDED.warriors,
                artifacts = EXCLUDED.artifacts,
                monster_idx = EXCLUDED.monster_idx,
                kills_total = EXCLUDED.kills_total,
                kills_on_level = EXCLUDED.kills_on_level,
                last_online = NOW(),
                updated_at = NOW()`,
            [
                req.userId,
                safe.coins, safe.level, safe.sword, safe.armor,
                safe.guilds, safe.warriors, safe.artifacts,
                safe.monsterIdx, safe.killsTotal, safe.killsOnLevel
            ]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('rpg-state POST:', e.message);
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ============================================================================
//  Сброс рекордов группы (только админ/учитель)
// ============================================================================
app.post('/api/games/:spaceId/:gameId/reset', verifyJWT, requireSpaceAdmin, async (req, res) => {
    await pool.query('DELETE FROM game_scores WHERE space_id = $1 AND game_id = $2', [req.params.spaceId, req.params.gameId]);
    res.json({ message: 'Рекорды сброшены' });
});
