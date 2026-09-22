/* ============================================================================
   Игры — одиночные. Canvas-игры ждут layout.
   Лидерборд + синхронизация кликера + таймер памяти + ускорение реакции с бомбами.
   ============================================================================ */

let activeGame = null;
let activeGameCleanup = null;

function stopActiveGame() {
    if (activeGameCleanup) {
        try { activeGameCleanup(); } catch (e) {}
        activeGameCleanup = null;
    }
    activeGame = null;
    document.querySelectorAll('.game-fullscreen').forEach(el => el.remove());
}

function waitForLayout(area, callback, attempts = 0) {
    if (attempts > 60) { console.warn('game layout timeout'); return; }
    requestAnimationFrame(() => {
        if (area.clientWidth > 0 && area.clientHeight > 0) {
            callback();
        } else {
            setTimeout(() => waitForLayout(area, callback, attempts + 1), 50);
        }
    });
}

const GAMES = [
    { id: 'rpg-clicker',  name: 'RPG-кликер',  desc: 'Проходи этапы, бей боссов, качай магазин' },
    { id: 'snake-arena',  name: 'Змейка',      desc: 'Классика: собирай яблоки' },
    { id: '2048',         name: '2048',        desc: 'Собери плитку 2048' },
    { id: 'memory',       name: 'Найди пару',  desc: 'Открывай карточки, находи пары' },
    { id: 'reaction',     name: 'Реакция',     desc: 'Лови цели, не попадай по бомбам' }
];

function fmtScore(n) {
    if (!isFinite(n)) return '0';
    return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fmtGameTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ============================================================================
//  МЕНЮ ИГР
// ============================================================================
function renderGamesMenu(container) {
    stopActiveGame();
    let html = '<h1 class="page-title">Игровой центр</h1><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">';
    for (const g of GAMES) {
        html += `
            <div style="background:var(--bg-card);border-radius:16px;padding:18px;border:1px solid var(--card-border);text-align:center;position:relative;">
                <div style="font-size:2.2rem;margin-bottom:10px;">${gameIcon(g.id)}</div>
                <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">${g.name}</div>
                <div style="color:var(--text-secondary);font-size:0.8rem;margin-bottom:12px;">${g.desc}</div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-small" onclick="startGame('${g.id}')" style="flex:1;">Играть</button>
                    <button class="btn-small" onclick="openLeaderboard('${g.id}')" title="Таблица лидеров" style="padding:7px 12px;">🏆</button>
                </div>
            </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function gameIcon(id) {
    const icons = {
        'rpg-clicker': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5l6 6-11 11-6-6 11-11z"/><path d="M3 21l3-3M14 7l3 3"/></svg>',
        'snake-arena': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c0-3 2-5 5-5h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/></svg>',
        '2048': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
        'memory': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="10" rx="1.5"/><rect x="14" y="3" width="7" height="10" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>',
        'reaction': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>'
    };
    return icons[id] || '🎮';
}

function startGame(gameId) {
    stopActiveGame();
    const gameInfo = GAMES.find(g => g.id === gameId);
    const overlay = document.createElement('div');
    overlay.className = 'game-fullscreen';
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:9000;display:flex;flex-direction:column;';
    overlay.innerHTML = `
        <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--card-border);background:var(--bg-card);">
            <div style="font-weight:700;font-size:1.05rem;">${gameInfo ? gameInfo.name : gameId}</div>
            <div style="display:flex; gap:8px;">
                ${gameId === 'rpg-clicker' ? '<button onclick="resetRpgGame()" style="background:linear-gradient(90deg,#ff453a,#ff9f0a);color:#fff;border:none;padding:8px 14px;border-radius:10px;font-weight:600;cursor:pointer;" title="Сбросить прогресс">🔄</button>' : ''}
                <button onclick="openLeaderboard('${gameId}')" style="background:var(--input-bg);border:none;padding:8px 14px;border-radius:10px;font-weight:600;cursor:pointer;color:var(--text);">🏆 Рейтинг</button>
                <button onclick="stopActiveGame()" style="background:var(--input-bg);border:none;padding:8px 14px;border-radius:10px;font-weight:600;cursor:pointer;color:var(--text);">Закрыть</button>
            </div>
        </div>
        <div id="gameArea" style="flex:1;position:relative;overflow:hidden;"></div>
    `;
    document.body.appendChild(overlay);
    activeGame = gameId;

    const area = document.getElementById('gameArea');
    waitForLayout(area, () => {
        if (gameId === 'rpg-clicker') activeGameCleanup = startRpgClicker(area);
        else if (gameId === 'snake-arena') activeGameCleanup = startSnake(area);
        else if (gameId === '2048') activeGameCleanup = start2048(area);
        else if (gameId === 'memory') activeGameCleanup = startMemory(area);
        else if (gameId === 'reaction') activeGameCleanup = startReaction(area);
    });
}

// ============================================================================
//  ТАБЛИЦА ЛИДЕРОВ
// ============================================================================
async function openLeaderboard(gameId) {
    const gameInfo = GAMES.find(g => g.id === gameId);
    const gameName = gameInfo ? gameInfo.name : gameId;

    const overlay = document.createElement('div');
    overlay.id = 'leaderboardOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: 9500;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: fadeIn 0.15s ease;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: var(--bg-card);
        border-radius: 16px;
        width: 100%;
        max-width: 480px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    `;

    modal.innerHTML = `
        <div style="padding:16px 18px;border-bottom:1px solid var(--divider);display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:700;font-size:1.1rem;">🏆 ${gameName}</div>
            <button class="lb-close-btn" style="background:var(--input-bg);border:none;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer;color:var(--text);">✕</button>
        </div>
        <div style="display:flex;gap:4px;padding:10px 14px 0;">
            <button class="lb-tab lb-tab-active" data-tab="local" style="flex:1;padding:9px;border-radius:9px;border:none;background:var(--accent-blue);color:#fff;font-weight:600;cursor:pointer;font-size:0.9rem;">Моя группа</button>
            <button class="lb-tab" data-tab="global" style="flex:1;padding:9px;border-radius:9px;border:none;background:var(--input-bg);color:var(--text);font-weight:600;cursor:pointer;font-size:0.9rem;">Глобальный</button>
        </div>
        <div id="lbBody" style="padding:8px 14px 14px;overflow-y:auto;flex:1;">
            <p style="text-align:center;padding:40px 0;color:var(--text-secondary);">Загрузка…</p>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    modal.querySelector('.lb-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    let localData = [];
    let globalData = [];
    const hasSpace = (typeof currentSpace !== 'undefined' && currentSpace && currentSpace.id);

    const [localRes, globalRes] = await Promise.all([
        hasSpace ? apiGet(`/api/games/${currentSpace.id}/${gameId}/leaderboard`).catch(() => []) : Promise.resolve([]),
        apiGet(`/api/games-global/${gameId}/leaderboard`).catch(() => [])
    ]);
    localData = localRes || [];
    globalData = globalRes || [];

    const tabs = modal.querySelectorAll('.lb-tab');
    const body = document.getElementById('lbBody');

    function renderTab(tabId) {
        tabs.forEach(t => {
            const active = t.dataset.tab === tabId;
            t.classList.toggle('lb-tab-active', active);
            t.style.background = active ? 'var(--accent-blue)' : 'var(--input-bg)';
            t.style.color = active ? '#fff' : 'var(--text)';
        });
        const rows = tabId === 'local' ? localData : globalData;
        if (!rows || !rows.length) {
            const msg = tabId === 'local'
                ? (hasSpace ? 'Пока никто из группы не играл' : 'Нет активной группы')
                : 'Пока никто не играл';
            body.innerHTML = `<p style="text-align:center;padding:40px 0;color:var(--text-secondary);">${msg}</p>`;
            return;
        }
        body.innerHTML = rows.map((r, i) => renderLeaderboardRow(r, i, gameId)).join('');
    }

    tabs.forEach(t => t.addEventListener('click', () => renderTab(t.dataset.tab)));
    renderTab('local');
}

function renderLeaderboardRow(row, idx, gameId) {
    const place = idx + 1;
    let medal = '';
    let medalColor = 'var(--text-secondary)';
    if (place === 1) { medal = '🥇'; medalColor = '#ffcc00'; }
    else if (place === 2) { medal = '🥈'; medalColor = '#c0c0c0'; }
    else if (place === 3) { medal = '🥉'; medalColor = '#cd7f32'; }
    else { medal = `#${place}`; }

    const name = escapeHtml(row.full_name || row.username || 'Аноним');
    const username = escapeHtml(row.username || '');
    const emoji = row.avatar_emoji || '👤';
    const score = row.score || 0;

    let detailsHtml = '';
    if (gameId === 'rpg-clicker') {
        const lvl = row.level || 1;
        const kills = row.kills_total || 0;
        const coins = Number(row.coins) || 0;
        detailsHtml = `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">
            Ур. ${lvl} · Убито ${fmtScore(kills)} · 🪙 ${fmtScore(coins)}
        </div>`;
    }

    return `
        <div style="display:flex; gap:12px; padding:10px 4px; border-bottom:1px solid var(--divider); align-items:center;">
            <div style="font-size:1.4rem; min-width:38px; text-align:center; color:${medalColor}; font-weight:800;">${medal}</div>
            <div style="width:36px; height:36px; border-radius:50%; background:var(--input-bg); display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">${emoji}</div>
            <div style="flex:1; min-width:0;">
                <div style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary);">@${username}</div>
                ${detailsHtml}
            </div>
            <div style="text-align:right; flex-shrink:0;">
                <div style="font-weight:800; color:var(--accent-blue); font-size:1.05rem;">${fmtScore(score)}</div>
                <div style="font-size:0.7rem; color:var(--text-secondary);">очков</div>
            </div>
        </div>`;
}

// ============================================================================
//  ОТПРАВКА СЧЁТА
// ============================================================================
async function submitGameScore(gameId, score) {
    if (typeof currentSpace === 'undefined' || !currentSpace || !currentSpace.id) return;
    if (typeof score !== 'number' || !isFinite(score) || score < 0) return;
    try {
        await apiPost(`/api/games/${currentSpace.id}/${gameId}/score`, { score: Math.floor(score) });
    } catch (e) { /* тихо */ }
}

// ============================================================================
//  RPG-КЛИКЕР — приключение по этапам с боссами и магазином, открывающимся по уровням
// ============================================================================

// Обычные монстры — пул расширяется по мере роста этапа (state.level)
const RPG_MONSTER_POOL = [
    { name: 'Слизень',      emoji: '🟢', hpMul: 1,    rewardMul: 1 },
    { name: 'Крыса',        emoji: '🐀', hpMul: 1.7,  rewardMul: 1.3 },
    { name: 'Летучая мышь', emoji: '🦇', hpMul: 2.5,  rewardMul: 1.6 },
    { name: 'Гоблин',       emoji: '👺', hpMul: 3.6,  rewardMul: 2 },
    { name: 'Скелет',       emoji: '💀', hpMul: 5.2,  rewardMul: 2.6 },
    { name: 'Орк',          emoji: '👹', hpMul: 7.2,  rewardMul: 3.4 },
    { name: 'Призрак',      emoji: '👻', hpMul: 9.8,  rewardMul: 4.4 },
    { name: 'Демон',        emoji: '😈', hpMul: 13.5, rewardMul: 5.8 }
];

// Боссы этапов — по одному на этап (циклически), сила считается формулой rpgBossHp/rpgBossResistance
const RPG_BOSS_POOL = [
    { name: 'Король слизней',     emoji: '🐸' },
    { name: 'Крысиный барон',     emoji: '🐭' },
    { name: 'Вожак гоблинов',     emoji: '👺' },
    { name: 'Костяной страж',     emoji: '☠️' },
    { name: 'Вождь орков',        emoji: '🪓' },
    { name: 'Древний призрак',    emoji: '🌫️' },
    { name: 'Повелитель демонов', emoji: '👿' },
    { name: 'Дракон бездны',      emoji: '🐉' }
];

// Магазин: предметы открываются по уровням игрока (тиеры 1-5)
const RPG_SHOP_ITEMS = [
    { key: 'sword',    name: 'Меч',               icon: '⚔️', tier: 1, unlockLevel: 1,  currency: 'coins', baseCost: 10,   costMul: 1.15,
      desc: up => `Урон за тап: +1 (сейчас ${1 + up.sword})` },
    { key: 'armor',    name: 'Доспехи',           icon: '🛡️', tier: 1, unlockLevel: 1,  currency: 'coins', baseCost: 15,   costMul: 1.2,
      desc: up => `Монет за убийство: +15% (сейчас +${up.armor * 15}%)` },
    { key: 'guild',    name: 'Гильдия',           icon: '🏰', tier: 2, unlockLevel: 3,  currency: 'coins', baseCost: 120,  costMul: 1.45,
      desc: up => `Пассивный урон: +2/сек (сейчас +${up.guild * 2}/сек)` },
    { key: 'warrior',  name: 'Наёмник',           icon: '🗡️', tier: 2, unlockLevel: 3,  currency: 'coins', baseCost: 60,   costMul: 1.28,
      desc: up => `Пассивный урон: +1/сек (сейчас +${up.warrior}/сек)` },
    { key: 'artifact', name: 'Артефакт',          icon: '🔮', tier: 3, unlockLevel: 6,  currency: 'coins', baseCost: 600,  costMul: 1.9,
      desc: up => `Скорость тапа +15%, крит +2% (ур. ${up.artifact})` },
    { key: 'forge',    name: 'Кузница',           icon: '🔥', tier: 3, unlockLevel: 6,  currency: 'coins', baseCost: 800,  costMul: 1.75,
      desc: up => `Пробивает защиту боссов: +4% (сейчас +${up.forge * 4}%)` },
    { key: 'potion',   name: 'Зелье силы',        icon: '🧪', tier: 4, unlockLevel: 10, currency: 'coins', baseCost: 2500, costMul: 1.6,
      desc: up => `Весь урон: +8% (сейчас +${up.potion * 8}%)` },
    { key: 'tower',    name: 'Башня',             icon: '🗼', tier: 4, unlockLevel: 10, currency: 'coins', baseCost: 4000, costMul: 1.55,
      desc: up => `Пассивный урон: +6/сек (сейчас +${up.tower * 6}/сек)` },
    { key: 'crystal',  name: 'Кристалл вечности', icon: '💎', tier: 5, unlockLevel: 15, currency: 'gems',  baseCost: 5,    costMul: 1.5,
      desc: up => `Весь урон ×${(1 + up.crystal * 0.1).toFixed(1)} (сейчас ур. ${up.crystal})` }
];

const RPG_TIER_NAMES = { 1: 'Начало пути', 2: 'Отряд', 3: 'Магия', 4: 'Алхимия', 5: 'Легенда' };

function rpgDefaultUpgrades() {
    return { sword: 0, armor: 0, guild: 0, warrior: 0, artifact: 0, forge: 0, potion: 0, tower: 0, crystal: 0 };
}
function rpgShopItemCost(item, up) {
    return Math.floor(item.baseCost * Math.pow(item.costMul, up[item.key] || 0));
}
// Сколько обычных монстров нужно убить на этапе, прежде чем выйдет босс
function rpgKillsRequired(stage) {
    return 6 + Math.min(18, Math.floor(stage / 2) * 2);
}
function rpgAvailablePoolSize(stage) {
    return Math.min(RPG_MONSTER_POOL.length, 2 + Math.floor(stage / 2));
}
function rpgPickMonsterIdx(stage) {
    return Math.floor(Math.random() * rpgAvailablePoolSize(stage));
}
function rpgRegularHp(stage, poolIdx) {
    const base = 9 * Math.pow(1.33, stage - 1);
    return Math.max(3, Math.ceil(base * RPG_MONSTER_POOL[poolIdx].hpMul));
}
function rpgRegularReward(stage, poolIdx) {
    const base = 3 * Math.pow(1.27, stage - 1);
    return Math.max(1, Math.ceil(base * RPG_MONSTER_POOL[poolIdx].rewardMul));
}
// Боссы заметно крепче обычных монстров того же этапа — тапами "в лоб" их не унести
function rpgBossHp(stage) {
    return Math.ceil(280 * Math.pow(1.5, stage - 1));
}
function rpgBossReward(stage) {
    return Math.ceil(140 * Math.pow(1.38, stage - 1));
}
function rpgBossGems(stage) {
    return 3 + Math.floor(stage / 2);
}
// Сопротивление урону босса растёт с этапами; снижается прокачкой "Кузница" (penetration)
function rpgBossResistance(stage) {
    return Math.min(0.6, 0.04 + stage * 0.02);
}
function rpgComputeStats(up) {
    const dmgMul = (1 + up.potion * 0.08) * (1 + up.crystal * 0.1);
    return {
        tapDamage: (1 + up.sword) * dmgMul,
        dps: (up.guild * 2 + up.warrior * 1 + up.tower * 6) * dmgMul,
        coinMul: 1 + up.armor * 0.15,
        speedMul: 1 + up.artifact * 0.15,
        critChance: Math.min(0.6, up.artifact * 0.02),
        penetration: Math.min(0.75, up.forge * 0.04),
        dmgMul
    };
}

async function startRpgClicker(area, forcedState = null, skipServerLoad = false) {
    area.innerHTML = '<p style="text-align:center;padding:60px 20px;color:#8d99a5;">Загрузка прогресса…</p>';

    let state;
    if (forcedState) {
        // Используем принудительно переданное состояние (например, после сброса)
        state = forcedState;
        console.log('Используется принудительное состояние:', skipServerLoad ? '(сброс)' : '(внешнее)');
    } else if (skipServerLoad) {
        // Только локальное состояние, без загрузки с сервера
        state = loadRpgState();
    } else {
        try { state = await loadRpgStateAsync(); }
        catch (e) { state = loadRpgState(); }
    }
    state = rpgMigrateState(state);

    area.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:linear-gradient(180deg,#1a1f2e,#0f1419);color:#fff;">
            <div style="padding:12px 14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <div><div style="font-size:0.7rem;opacity:0.7;">Монеты</div><div style="font-size:1.3rem;font-weight:800;" id="rpgCoins">${fmtScore(state.coins)}</div></div>
                <div><div style="font-size:0.7rem;opacity:0.7;">💎 Кристаллы</div><div style="font-size:1.3rem;font-weight:800;color:#7dd3fc;" id="rpgGems">${fmtScore(state.extra.gems)}</div></div>
                <div style="text-align:right;"><div style="font-size:0.7rem;opacity:0.7;">Уровень</div><div style="font-size:1.3rem;font-weight:800;" id="rpgLevel">${state.level}</div></div>
            </div>
            <div style="padding:0 14px;">
                <div style="display:flex;justify-content:space-between;font-size:0.7rem;opacity:0.75;margin-bottom:3px;"><span id="rpgStageLabel">Этап ${state.level}</span><span id="rpgStageProgressLabel"></span></div>
                <div style="height:8px;background:rgba(255,255,255,0.12);border-radius:4px;overflow:hidden;"><div id="rpgStageProgress" style="height:100%;background:linear-gradient(90deg,#30d158,#0088cc);width:0%;transition:width 0.2s;"></div></div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;">
                <div id="rpgBossTag" style="display:none;font-size:0.75rem;font-weight:800;letter-spacing:0.05em;color:#ff9f0a;margin-bottom:6px;">⚠️ БОСС ЭТАПА</div>
                <div id="rpgMonster" style="font-size:5rem;cursor:pointer;user-select:none;transition:transform 0.08s;filter:drop-shadow(0 0 20px rgba(255,80,80,0.5));">👹</div>
                <div style="width:80%;max-width:300px;margin-top:16px;height:14px;background:rgba(255,255,255,0.15);border-radius:7px;overflow:hidden;">
                    <div id="rpgMonsterHp" style="height:100%;background:linear-gradient(90deg,#ff453a,#ff9f0a);width:100%;transition:width 0.15s;"></div>
                </div>
                <div style="margin-top:8px;font-size:0.9rem;" id="rpgMonsterName">Слизень</div>
                <div style="margin-top:4px;font-size:0.8rem;opacity:0.7;" id="rpgMonsterInfo"></div>
                <div style="margin-top:6px;font-size:0.75rem;opacity:0.6;" id="rpgKillsInfo">Убито всего: 0</div>
            </div>
            <div style="padding:12px;background:rgba(0,0,0,0.3);">
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;font-size:0.72rem;">
                    <div style="text-align:center;"><div style="opacity:0.7;">Урон</div><div style="font-weight:700;" id="rpgDmg">1</div></div>
                    <div style="text-align:center;"><div style="opacity:0.7;">DPS</div><div style="font-weight:700;" id="rpgDps">0</div></div>
                    <div style="text-align:center;"><div style="opacity:0.7;">Крит</div><div style="font-weight:700;" id="rpgCrit">0%</div></div>
                    <div style="text-align:center;"><div style="opacity:0.7;">Пробитие</div><div style="font-weight:700;" id="rpgPen">0%</div></div>
                </div>
                <button onclick="rpgToggleShop()" style="width:100%;padding:12px;border-radius:12px;background:linear-gradient(90deg,#0088cc,#00b4ff);color:#fff;font-weight:700;border:none;cursor:pointer;">🛒 Магазин</button>
            </div>
            <div id="rpgShop" style="display:none;position:absolute;inset:0;background:rgba(10,12,20,0.97);z-index:10;overflow-y:auto;padding:20px;"></div>
        </div>
    `;

    const monsterEl = document.getElementById('rpgMonster');
    const hpBar = document.getElementById('rpgMonsterHp');
    const nameEl = document.getElementById('rpgMonsterName');
    const infoEl = document.getElementById('rpgMonsterInfo');
    const killsEl = document.getElementById('rpgKillsInfo');
    const bossTag = document.getElementById('rpgBossTag');
    const stageProgressBar = document.getElementById('rpgStageProgress');
    const stageProgressLabel = document.getElementById('rpgStageProgressLabel');

    let lastAttackTime = 0;

    function spawnRegularMonster() {
        const ex = state.extra;
        ex.monsterPoolIdx = rpgPickMonsterIdx(state.level);
        ex.monsterMaxHp = rpgRegularHp(state.level, ex.monsterPoolIdx);
        ex.monsterHp = ex.monsterMaxHp;
        ex.bossActive = false;
    }
    function spawnBoss() {
        const ex = state.extra;
        ex.bossActive = true;
        ex.bossMaxHp = rpgBossHp(state.level);
        ex.bossHp = ex.bossMaxHp;
    }
    // Восстанавливаем цель после перезагрузки страницы, если она ещё не жива
    if (!state.extra.bossActive && (!state.extra.monsterHp || state.extra.monsterHp <= 0)) {
        spawnRegularMonster();
    }

    function currentTargetInfo() {
        const ex = state.extra;
        if (ex.bossActive) {
            const boss = RPG_BOSS_POOL[(state.level - 1) % RPG_BOSS_POOL.length];
            return { emoji: boss.emoji, name: boss.name, hp: ex.bossHp, maxHp: ex.bossMaxHp, isBoss: true };
        }
        const m = RPG_MONSTER_POOL[ex.monsterPoolIdx] || RPG_MONSTER_POOL[0];
        return { emoji: m.emoji, name: m.name, hp: ex.monsterHp, maxHp: ex.monsterMaxHp, isBoss: false };
    }

    function updateUI() {
        const stats = rpgComputeStats(state.extra.upgrades);
        
        // Защита от вызова до загрузки DOM
        const rpgCoins = document.getElementById('rpgCoins');
        const rpgGems = document.getElementById('rpgGems');
        const rpgLevel = document.getElementById('rpgLevel');
        const rpgDmg = document.getElementById('rpgDmg');
        const rpgDps = document.getElementById('rpgDps');
        const rpgCrit = document.getElementById('rpgCrit');
        const rpgPen = document.getElementById('rpgPen');
        const rpgStageLabel = document.getElementById('rpgStageLabel');
        
        if (!rpgCoins || !rpgGems || !rpgLevel || !rpgDmg || !rpgDps || !rpgCrit || !rpgPen || !rpgStageLabel) {
            console.warn('RPG UI элементы ещё не загружены');
            return;
        }
        
        rpgCoins.textContent = fmtScore(state.coins);
        rpgGems.textContent = fmtScore(state.extra.gems);
        rpgLevel.textContent = state.level;
        rpgDmg.textContent = fmtScore(stats.tapDamage);
        rpgDps.textContent = fmtScore(stats.dps);
        rpgCrit.textContent = Math.round(stats.critChance * 100) + '%';
        rpgPen.textContent = Math.round(stats.penetration * 100) + '%';

        const t = currentTargetInfo();
        if (monsterEl) monsterEl.textContent = t.emoji;
        if (nameEl) nameEl.textContent = t.name;
        if (hpBar) {
            hpBar.style.width = Math.max(0, (t.hp / t.maxHp) * 100) + '%';
            hpBar.style.background = t.isBoss ? 'linear-gradient(90deg,#ff453a,#af52de)' : 'linear-gradient(90deg,#ff453a,#ff9f0a)';
        }
        if (infoEl) infoEl.textContent = `HP: ${fmtScore(Math.max(0, t.hp))} / ${fmtScore(t.maxHp)}`;
        if (bossTag) bossTag.style.display = t.isBoss ? 'block' : 'none';
        if (monsterEl) monsterEl.style.filter = t.isBoss ? 'drop-shadow(0 0 26px rgba(175,82,222,0.75))' : 'drop-shadow(0 0 20px rgba(255,80,80,0.5))';
        if (killsEl) killsEl.textContent = `Убито всего: ${fmtScore(state.killsTotal)}`;

        const required = rpgKillsRequired(state.level);
        if (stageProgressLabel) stageProgressLabel.textContent = t.isBoss ? 'Бой с боссом!' : `${state.killsOnLevel} / ${required}`;
        if (stageProgressBar) stageProgressBar.style.width = (t.isBoss ? 100 : Math.min(100, (state.killsOnLevel / required) * 100)) + '%';
        rpgStageLabel.textContent = `Этап ${state.level}`;
    }

    function persistLocal() { saveRpgState(state); }

    function rpgCheckNewUnlocks(newLevel) {
        const justUnlocked = RPG_SHOP_ITEMS.filter(it => it.unlockLevel === newLevel);
        if (justUnlocked.length) showToast(`Магазин: новые товары — ${justUnlocked.map(i => i.name).join(', ')}`, 'info', 4500);
    }

    function onTargetKilled() {
        const ex = state.extra;
        const stats = rpgComputeStats(ex.upgrades);
        state.killsTotal++;

        if (ex.bossActive) {
            const reward = Math.ceil(rpgBossReward(state.level) * stats.coinMul);
            const gems = rpgBossGems(state.level);
            state.coins += reward;
            ex.gems += gems;
            state.level++;
            state.killsOnLevel = 0;
            showToast(`Босс повержен! +${fmtScore(reward)} 🪙, +${gems} 💎, уровень ${state.level}!`, 'success');
            rpgCheckNewUnlocks(state.level);
            spawnRegularMonster();
        } else {
            const reward = Math.ceil(rpgRegularReward(state.level, ex.monsterPoolIdx) * stats.coinMul);
            state.coins += reward;
            state.killsOnLevel++;
            if (state.killsOnLevel >= rpgKillsRequired(state.level)) spawnBoss();
            else spawnRegularMonster();
        }
        persistLocal();
    }

    function tapTarget(e) {
        e.preventDefault();
        const stats = rpgComputeStats(state.extra.upgrades);
        const now = Date.now();
        if (now - lastAttackTime < 100 / stats.speedMul) return;
        lastAttackTime = now;

        let dmg = stats.tapDamage;
        let isCrit = false;
        if (Math.random() < stats.critChance) { dmg *= 2.5; isCrit = true; }

        const ex = state.extra;
        if (ex.bossActive) {
            const resistance = Math.max(0, rpgBossResistance(state.level) - stats.penetration);
            dmg *= (1 - resistance);
            ex.bossHp -= dmg;
        } else {
            ex.monsterHp -= dmg;
        }

        monsterEl.style.transform = 'scale(0.92)';
        setTimeout(() => monsterEl.style.transform = 'scale(1)', 80);

        const particle = document.createElement('div');
        particle.textContent = (isCrit ? '💥-' : '-') + fmtScore(dmg);
        particle.style.cssText = `position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);color:${isCrit ? '#ff9f0a' : '#ff453a'};font-weight:800;font-size:${isCrit ? '1.7rem' : '1.4rem'};pointer-events:none;animation:rpgFloat 0.6s ease-out forwards;`;
        area.querySelector('#rpgMonster')?.parentElement?.appendChild(particle);
        setTimeout(() => particle.remove(), 600);

        const curHp = ex.bossActive ? ex.bossHp : ex.monsterHp;
        if (curHp <= 0) onTargetKilled();
        updateUI();
    }

    monsterEl.addEventListener('touchstart', tapTarget, { passive: false });
    monsterEl.addEventListener('click', tapTarget);

    window.rpgToggleShop = () => {
        const shop = document.getElementById('rpgShop');
        if (!shop) return;
        if (shop.style.display === 'none') { shop.style.display = 'block'; renderShop(); }
        else shop.style.display = 'none';
    };

    function rpgShopRowHtml(item, up, st) {
        const locked = item.unlockLevel > st.level;
        if (locked) {
            return `<div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;opacity:0.45;">
                <div><div style="font-weight:700;">🔒 ${item.icon} ${item.name}</div><div style="font-size:0.8rem;opacity:0.7;">Откроется на уровне ${item.unlockLevel}</div></div>
            </div>`;
        }
        const cost = rpgShopItemCost(item, up);
        const balance = item.currency === 'gems' ? st.extra.gems : st.coins;
        const canAfford = balance >= cost;
        const currencyIcon = item.currency === 'gems' ? '💎' : '🪙';
        return `<div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;${!canAfford ? 'opacity:0.5;' : ''}">
            <div><div style="font-weight:700;">${item.icon} ${item.name}</div><div style="font-size:0.8rem;opacity:0.7;">${item.desc(up)}</div></div>
            <button onclick="rpgBuy('${item.key}')" ${!canAfford ? 'disabled' : ''} style="background:linear-gradient(90deg,#0088cc,#00b4ff);color:#fff;border:none;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer;white-space:nowrap;">${currencyIcon} ${fmtScore(cost)}</button>
        </div>`;
    }

    function renderShop() {
        const shop = document.getElementById('rpgShop');
        const up = state.extra.upgrades;
        let body = '';
        for (const tier of [1, 2, 3, 4, 5]) {
            const items = RPG_SHOP_ITEMS.filter(it => it.tier === tier);
            const tierLocked = items.every(it => it.unlockLevel > state.level);
            body += `<div style="margin-bottom:16px;">
                <div style="font-size:0.8rem;font-weight:800;opacity:0.7;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">${RPG_TIER_NAMES[tier]}${tierLocked ? ` · открывается на ур. ${items[0].unlockLevel}` : ''}</div>
                <div style="display:grid;gap:10px;">${items.map(it => rpgShopRowHtml(it, up, state)).join('')}</div>
            </div>`;
        }
        shop.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <div style="font-size:1.3rem;font-weight:700;">🛒 Магазин</div>
                <button onclick="rpgToggleShop()" style="background:rgba(255,255,255,0.15);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;">Закрыть</button>
            </div>
            ${body}
        `;
    }

    // Синхронизирует старые поля (sword/armor/guilds/warriors/artifacts/monsterIdx) для совместимости
    // с таблицей лидеров и БД — сама формула рейтинга их не использует, но пусть остаются валидными.
    function rpgSyncLegacyFields() {
        const up = state.extra.upgrades;
        state.sword = 1 + up.sword;
        state.armor = up.armor;
        state.guilds = up.guild;
        state.warriors = up.warrior;
        state.artifacts = up.artifact;
        state.monsterIdx = state.extra.monsterPoolIdx || 0;
    }
    rpgSyncLegacyFields();

    window.rpgBuy = (key) => {
        const item = RPG_SHOP_ITEMS.find(it => it.key === key);
        if (!item || item.unlockLevel > state.level) return;
        const up = state.extra.upgrades;
        const cost = rpgShopItemCost(item, up);
        const balance = item.currency === 'gems' ? state.extra.gems : state.coins;
        if (balance < cost) return;
        if (item.currency === 'gems') state.extra.gems -= cost; else state.coins -= cost;
        up[key] = (up[key] || 0) + 1;
        rpgSyncLegacyFields();
        persistLocal();
        updateUI();
        renderShop();
    };

    const passiveTimer = setInterval(() => {
        const stats = rpgComputeStats(state.extra.upgrades);
        if (stats.dps > 0) {
            const ex = state.extra;
            if (ex.bossActive) {
                const resistance = Math.max(0, rpgBossResistance(state.level) - stats.penetration);
                ex.bossHp -= (stats.dps * (1 - resistance)) / 10;
                if (ex.bossHp <= 0) onTargetKilled();
            } else {
                ex.monsterHp -= stats.dps / 10;
                if (ex.monsterHp <= 0) onTargetKilled();
            }
        }
        updateUI();
    }, 100);

    const now = Date.now();
    if (state.lastOnline && state.lastOnline > 0) {
        const stats = rpgComputeStats(state.extra.upgrades);
        const elapsed = Math.min((now - state.lastOnline) / 1000, 4 * 3600);
        const offlineIncome = Math.floor(stats.dps * 0.4 * elapsed);
        if (offlineIncome > 1) {
            setTimeout(() => {
                showToast(`Пока вас не было, отряд заработал ${fmtScore(offlineIncome)} 🪙`, 'info', 5000);
                state.coins += offlineIncome;
                persistLocal();
                updateUI();
            }, 300);
        }
    }
    state.lastOnline = now;
    persistLocal();

    const serverSyncTimer = setInterval(() => { saveRpgStateToServer(state); }, 15000);

    updateUI();

    if (!document.getElementById('rpgStyles')) {
        const s = document.createElement('style');
        s.id = 'rpgStyles';
        s.textContent = '@keyframes rpgFloat { from { opacity:1; transform:translate(-50%,-50%); } to { opacity:0; transform:translate(-50%,-120%); } }';
        document.head.appendChild(s);
    }

    return () => {
        clearInterval(passiveTimer);
        clearInterval(serverSyncTimer);
        state.lastOnline = Date.now();
        persistLocal();
        saveRpgStateToServer(state);
        window.rpgToggleShop = null;
        window.rpgBuy = null;
    };
}

function loadRpgState() {
    try { return JSON.parse(localStorage.getItem('rpgClickerState')) || defaultRpgState(); }
    catch (e) { return defaultRpgState(); }
}

function defaultRpgState() {
    return {
        coins: 0, level: 1, sword: 1, armor: 0, guilds: 0, warriors: 0, artifacts: 0,
        monsterIdx: 0, lastOnline: 0, killsTotal: 0, killsOnLevel: 0,
        extra: { gems: 0, bossActive: false, monsterHp: 0, monsterMaxHp: 0, monsterPoolIdx: 0, bossHp: 0, bossMaxHp: 0, upgrades: rpgDefaultUpgrades() }
    };
}

// Приводит любое сохранённое состояние (старый формат/новый/битое) к актуальной структуре,
// не теряя накопленный прогресс: уровень, монеты, общее число убийств и уже купленные прокачки.
function rpgMigrateState(state) {
    state = state || {};
    if (typeof state.coins !== 'number' || !isFinite(state.coins)) state.coins = 0;
    if (typeof state.level !== 'number' || state.level < 1) state.level = 1;
    if (typeof state.killsTotal !== 'number') state.killsTotal = 0;
    if (typeof state.killsOnLevel !== 'number') state.killsOnLevel = 0;
    if (typeof state.lastOnline !== 'number') state.lastOnline = 0;

    if (!state.extra || typeof state.extra !== 'object') state.extra = {};
    const ex = state.extra;
    if (typeof ex.gems !== 'number') ex.gems = 0;
    if (!ex.upgrades || typeof ex.upgrades !== 'object') {
        // Старое состояние (до переработки) — переносим прежние прокачки в новую структуру
        ex.upgrades = rpgDefaultUpgrades();
        ex.upgrades.sword = Math.max(0, (state.sword || 1) - 1);
        ex.upgrades.armor = state.armor || 0;
        ex.upgrades.guild = state.guilds || 0;
        ex.upgrades.warrior = state.warriors || 0;
        ex.upgrades.artifact = state.artifacts || 0;
    }
    for (const k of Object.keys(rpgDefaultUpgrades())) {
        if (typeof ex.upgrades[k] !== 'number') ex.upgrades[k] = 0;
    }

    const required = rpgKillsRequired(state.level);
    if (state.killsOnLevel > required) state.killsOnLevel = required;

    if (typeof ex.bossActive !== 'boolean') ex.bossActive = false;
    if (ex.bossActive && (typeof ex.bossHp !== 'number' || typeof ex.bossMaxHp !== 'number' || ex.bossHp <= 0)) {
        ex.bossActive = false;
    }
    if (!ex.bossActive && (typeof ex.monsterHp !== 'number' || typeof ex.monsterMaxHp !== 'number' || ex.monsterHp <= 0 || typeof ex.monsterPoolIdx !== 'number')) {
        ex.monsterHp = 0; // будет создан заново перед стартом боя
    }
    return state;
}

function saveRpgState(s) {
    try { localStorage.setItem('rpgClickerState', JSON.stringify(s)); } catch (e) {}
}

async function loadRpgStateAsync() {
    const local = rpgMigrateState(loadRpgState());
    let server = null;
    try { server = await apiGet('/api/games/rpg-state'); } catch (e) { /* тихо */ }
    if (!server) return local;
    server = rpgMigrateState(server);

    const scoreOf = st => (st.level || 1) * 10000 + (st.killsTotal || 0) * 100 + Math.floor((st.coins || 0) / 10);
    return scoreOf(server) > scoreOf(local) ? server : local;
}

async function saveRpgStateToServer(s) {
    try {
        await apiPost('/api/games/rpg-state', {
            coins: s.coins,
            level: s.level,
            sword: s.sword,
            armor: s.armor,
            guilds: s.guilds,
            warriors: s.warriors,
            artifacts: s.artifacts,
            monsterIdx: s.monsterIdx,
            killsTotal: s.killsTotal,
            killsOnLevel: s.killsOnLevel,
            extra: s.extra
        });
    } catch (e) { /* тихо */ }
}

// Сброс прогресса игры RPG-кликер
async function resetRpgGame() {
    if (!confirm('Вы уверены? Весь прогресс будет потерян!')) return;

    const newState = defaultRpgState();
    
    // Сначала сохраняем локально
    saveRpgState(newState);
    
    // Потом отправляем на сервер
    try {
        await apiPost('/api/games/rpg-state', newState);
        console.log('Прогресс сброшен на сервере');
    } catch (e) { 
        console.error('Ошибка сброса на сервере:', e);
    }

    showToast('Прогресс сброшен', 'info');
    
    // Перезагружаем игру с принудительным использованием нового состояния
    // Передаём флаг, что это сброс, чтобы не загружать с сервера
    await startRpgClicker(document.getElementById('gameArea'), newState, true);
}

// ============================================================================
//  ЗМЕЙКА
// ============================================================================
function startSnake(area) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;background:#0e1621;';
    area.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    canvas.width = area.clientWidth;
    canvas.height = area.clientHeight;

    const CELL = 22;
    let cols = Math.floor(canvas.width / CELL);
    let rows = Math.floor(canvas.height / CELL);

    function resize() {
        canvas.width = area.clientWidth;
        canvas.height = area.clientHeight;
        cols = Math.floor(canvas.width / CELL);
        rows = Math.floor(canvas.height / CELL);
    }
    window.addEventListener('resize', resize);

    let snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = { x: 10, y: 5 };
    let score = 0;
    let running = true;
    let lastTick = 0;
    let speed = 120;

    function spawnFood() {
        food = {
            x: Math.floor(Math.random() * cols),
            y: Math.floor(Math.random() * rows)
        };
        if (snake.some(s => s.x === food.x && s.y === food.y)) spawnFood();
    }

    function setDir(newDir) {
        if (newDir.x === -dir.x && newDir.y === -dir.y) return;
        if (newDir.x === dir.x && newDir.y === dir.y) return;
        nextDir = newDir;
    }

    const onKey = (e) => {
        switch (e.key) {
            case 'ArrowUp': case 'w': case 'W': e.preventDefault(); setDir({ x: 0, y: -1 }); break;
            case 'ArrowDown': case 's': case 'S': e.preventDefault(); setDir({ x: 0, y: 1 }); break;
            case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); setDir({ x: -1, y: 0 }); break;
            case 'ArrowRight': case 'd': case 'D': e.preventDefault(); setDir({ x: 1, y: 0 }); break;
        }
    };
    document.addEventListener('keydown', onKey);

    let tX = 0, tY = 0;
    canvas.addEventListener('touchstart', (e) => {
        tX = e.touches[0].clientX;
        tY = e.touches[0].clientY;
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - tX;
        const dy = e.changedTouches[0].clientY - tY;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 30) setDir({ x: 1, y: 0 });
            else if (dx < -30) setDir({ x: -1, y: 0 });
        } else {
            if (dy > 30) setDir({ x: 0, y: 1 });
            else if (dy < -30) setDir({ x: 0, y: -1 });
        }
    });

    function tick() {
        if (!running) return;
        const now = performance.now();
        if (now - lastTick < speed) { requestAnimationFrame(tick); return; }
        lastTick = now;

        dir = { ...nextDir };
        const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

        if (head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows) { gameOver(); return; }
        if (snake.some(s => s.x === head.x && s.y === head.y)) { gameOver(); return; }

        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
            score += 10;
            spawnFood();
            if (speed > 60) speed -= 2;
        } else {
            snake.pop();
        }

        ctx.fillStyle = '#0e1621';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ff453a';
        ctx.shadowColor = '#ff453a';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        snake.forEach((s, i) => {
            ctx.fillStyle = i === 0 ? '#30d158' : `rgba(48,209,88,${1 - i * 0.02})`;
            ctx.shadowColor = '#30d158';
            ctx.shadowBlur = i === 0 ? 15 : 5;
            ctx.beginPath();
            ctx.arc(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('Счёт: ' + score, 14, 30);

        requestAnimationFrame(tick);
    }

    function gameOver() {
        running = false;
        document.removeEventListener('keydown', onKey);
        submitGameScore('snake-arena', score);

        const ov = document.createElement('div');
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:10;';
        ov.innerHTML = `
            <div style="font-size:2rem;font-weight:800;margin-bottom:10px;">Игра окончена</div>
            <div style="font-size:1.3rem;margin-bottom:24px;">Счёт: ${score}</div>
            <div style="display:flex;gap:10px;">
                <button id="snRating" style="padding:12px 24px;border-radius:12px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;border:none;cursor:pointer;">🏆 Рейтинг</button>
                <button id="snRetry" style="padding:12px 30px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Играть заново</button>
            </div>
        `;
        area.appendChild(ov);
        ov.querySelector('#snRetry').addEventListener('click', () => { ov.remove(); startSnake(area); });
        ov.querySelector('#snRating').addEventListener('click', () => openLeaderboard('snake-arena'));
    }

    spawnFood();
    requestAnimationFrame(tick);
    return () => { running = false; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize); };
}

// ============================================================================
//  2048
// ============================================================================
function start2048(area) {
    area.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;">
            <div id="g2048score" style="font-size:1.5rem;font-weight:800;margin-bottom:16px;color:var(--text);">Счёт: 0</div>
            <div id="g2048board" style="display:grid;grid-template-columns:repeat(4,70px);grid-template-rows:repeat(4,70px);gap:8px;background:var(--input-bg);padding:8px;border-radius:14px;"></div>
        </div>
    `;
    let board = Array(4).fill().map(() => Array(4).fill(0));
    let score = 0;
    let gameEnded = false;

    function colors(v) {
        const map = { 0: 'rgba(0,0,0,0.05)', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
        return map[v] || '#3c3a32';
    }

    function render() {
        const b = document.getElementById('g2048board');
        b.innerHTML = board.flat().map(v => `<div style="background:${colors(v)};border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${v > 999 ? '18px' : v > 99 ? '22px' : '26px'};color:${v > 4 ? '#fff' : '#776e65'};">${v || ''}</div>`).join('');
        document.getElementById('g2048score').textContent = 'Счёт: ' + score;
    }

    function spawn() {
        const empty = [];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (!board[i][j]) empty.push([i, j]);
        if (!empty.length) return;
        const [i, j] = empty[Math.floor(Math.random() * empty.length)];
        board[i][j] = Math.random() < 0.9 ? 2 : 4;
    }

    function slide(row) {
        let arr = row.filter(v => v);
        for (let i = 0; i < arr.length - 1; i++) {
            if (arr[i] === arr[i + 1]) { arr[i] *= 2; score += arr[i]; arr[i + 1] = 0; }
        }
        arr = arr.filter(v => v);
        while (arr.length < 4) arr.push(0);
        return arr;
    }

    function canMove() {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (!board[i][j]) return true;
                if (i < 3 && board[i][j] === board[i + 1][j]) return true;
                if (j < 3 && board[i][j] === board[i][j + 1]) return true;
            }
        }
        return false;
    }

    function move(dir) {
        if (gameEnded) return;
        const oldBoard = JSON.stringify(board);
        if (dir === 'left') for (let i = 0; i < 4; i++) { board[i] = slide(board[i]); }
        else if (dir === 'right') for (let i = 0; i < 4; i++) { board[i] = slide(board[i].reverse()).reverse(); }
        else if (dir === 'up') for (let j = 0; j < 4; j++) { const col = board.map(r => r[j]); const newCol = slide(col); for (let i = 0; i < 4; i++) board[i][j] = newCol[i]; }
        else if (dir === 'down') for (let j = 0; j < 4; j++) { const col = board.map(r => r[j]).reverse(); const newCol = slide(col).reverse(); for (let i = 0; i < 4; i++) board[i][j] = newCol[i]; }
        if (JSON.stringify(board) !== oldBoard) {
            spawn();
            render();
            if (!canMove()) gameOver();
        }
    }

    function gameOver() {
        gameEnded = true;
        submitGameScore('2048', score);
        const ov = document.createElement('div');
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:10;';
        ov.innerHTML = `
            <div style="font-size:1.8rem;font-weight:800;margin-bottom:10px;">Ходов больше нет</div>
            <div style="font-size:1.2rem;margin-bottom:20px;">Счёт: ${score}</div>
            <div style="display:flex;gap:10px;">
                <button id="g2048Rating" style="padding:10px 20px;border-radius:10px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;border:none;cursor:pointer;">🏆 Рейтинг</button>
                <button id="g2048Retry" style="padding:10px 24px;border-radius:10px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Заново</button>
            </div>
        `;
        area.appendChild(ov);
        ov.querySelector('#g2048Retry').addEventListener('click', () => { ov.remove(); start2048(area); });
        ov.querySelector('#g2048Rating').addEventListener('click', () => openLeaderboard('2048'));
    }

    const onKey = (e) => {
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) { e.preventDefault(); move('left'); }
        else if (['ArrowRight', 'd', 'D'].includes(e.key)) { e.preventDefault(); move('right'); }
        else if (['ArrowUp', 'w', 'W'].includes(e.key)) { e.preventDefault(); move('up'); }
        else if (['ArrowDown', 's', 'S'].includes(e.key)) { e.preventDefault(); move('down'); }
    };
    document.addEventListener('keydown', onKey);

    let tX = 0, tY = 0;
    area.addEventListener('touchstart', (e) => { tX = e.touches[0].clientX; tY = e.touches[0].clientY; }, { passive: true });
    area.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - tX;
        const dy = e.changedTouches[0].clientY - tY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
        else move(dy > 0 ? 'down' : 'up');
    });

    board[1][1] = 2; board[2][2] = 2;
    render();

    return () => {
        document.removeEventListener('keydown', onKey);
        if (!gameEnded && score > 0) submitGameScore('2048', score);
    };
}

// ============================================================================
//  НАЙДИ ПАРУ (Memory) — с таймером
// ============================================================================
function startMemory(area) {
    const emojis = ['🍎', '🍌', '🍇', '🍓', '🍉', '🥝', '🍒', '🍑'];
    const cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);

    let flipped = [];
    let matched = 0;
    let moves = 0;
    let lock = false;
    let startedAt = 0;
    let timerInterval = null;
    let elapsed = 0;
    let finished = false;

    area.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;height:100%;padding:20px;">
            <div style="display:flex;gap:20px;margin-bottom:20px;font-weight:700;color:var(--text);">
                <div>Пары: <span id="memPairs">0/8</span></div>
                <div>Ходы: <span id="memMoves">0</span></div>
                <div>⏱ <span id="memTime">00:00</span></div>
            </div>
            <div id="memGrid" style="display:grid;grid-template-columns:repeat(4,72px);grid-template-rows:repeat(4,72px);gap:8px;"></div>
        </div>
    `;

    const grid = document.getElementById('memGrid');
    cards.forEach((emoji, i) => {
        const card = document.createElement('div');
        card.dataset.emoji = emoji;
        card.dataset.index = i;
        card.style.cssText = 'background:var(--accent-blue);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:2rem;cursor:pointer;transition:transform 0.15s, background 0.15s;user-select:none;';
        card.textContent = '?';
        card.addEventListener('click', () => flipCard(card));
        card.addEventListener('touchstart', (e) => { e.preventDefault(); flipCard(card); }, { passive: false });
        grid.appendChild(card);
    });

    // Таймер запускается при первом клике
    function startTimer() {
        if (timerInterval) return;
        startedAt = Date.now();
        timerInterval = setInterval(() => {
            elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const el = document.getElementById('memTime');
            if (el) el.textContent = fmtGameTime(elapsed);
        }, 200);
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    // Очки для рейтинга: чем быстрее и меньше ходов, тем больше.
    // Формула: max(0, 10000 - seconds*30 - moves*50)
    function computeScore() {
        const s = Math.max(0, 10000 - elapsed * 30 - moves * 50);
        return s;
    }

    function flipCard(card) {
        if (lock || finished) return;
        if (card.classList.contains('flipped') || card.classList.contains('matched')) return;

        startTimer();

        card.classList.add('flipped');
        card.style.background = 'var(--bg-card)';
        card.style.color = 'var(--text)';
        card.textContent = card.dataset.emoji;
        flipped.push(card);

        if (flipped.length === 2) {
            moves++;
            document.getElementById('memMoves').textContent = moves;
            lock = true;

            if (flipped[0].dataset.emoji === flipped[1].dataset.emoji) {
                flipped.forEach(c => {
                    c.style.background = '#30d158';
                    c.style.color = '#fff';
                    c.classList.add('matched');
                });
                matched++;
                document.getElementById('memPairs').textContent = matched + '/8';
                flipped = [];
                lock = false;

                if (matched === 8) {
                    finished = true;
                    stopTimer();
                    const finalScore = computeScore();
                    submitGameScore('memory', finalScore);
                    setTimeout(() => {
                        const ov = document.createElement('div');
                        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:10;';
                        ov.innerHTML = `
                            <div style="font-size:2rem;font-weight:800;margin-bottom:10px;">Победа!</div>
                            <div style="font-size:1.1rem;margin-bottom:6px;">Время: ${fmtGameTime(elapsed)}</div>
                            <div style="font-size:1.1rem;margin-bottom:6px;">Ходов: ${moves}</div>
                            <div style="font-size:1.3rem;margin-bottom:24px;color:#30d158;font-weight:800;">Очки: ${fmtScore(finalScore)}</div>
                            <div style="display:flex;gap:10px;">
                                <button id="memRating" style="padding:12px 24px;border-radius:12px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;border:none;cursor:pointer;">🏆 Рейтинг</button>
                                <button id="memRetry" style="padding:12px 30px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Ещё раз</button>
                            </div>
                        `;
                        area.appendChild(ov);
                        ov.querySelector('#memRetry').addEventListener('click', () => { ov.remove(); startMemory(area); });
                        ov.querySelector('#memRating').addEventListener('click', () => openLeaderboard('memory'));
                    }, 400);
                }
            } else {
                setTimeout(() => {
                    flipped.forEach(c => {
                        c.classList.remove('flipped');
                        c.style.background = 'var(--accent-blue)';
                        c.style.color = '#fff';
                        c.textContent = '?';
                    });
                    flipped = [];
                    lock = false;
                }, 700);
            }
        }
    }

    return () => { stopTimer(); };
}

// ============================================================================
//  РЕАКЦИЯ — ускорение со временем + бомбы
// ============================================================================
function startReaction(area) {
    area.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:#0f1419;color:#fff;padding:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                <div>Счёт: <span id="rctScore" style="font-weight:800;">0</span></div>
                <div>Жизни: <span id="rctLives" style="font-weight:800;color:#ff453a;">❤❤❤</span></div>
                <div>Уровень: <span id="rctLevel" style="font-weight:800;">1</span></div>
            </div>
            <div id="rctField" style="flex:1;position:relative;background:#1a1f2e;border-radius:14px;overflow:hidden;touch-action:manipulation;"></div>
            <button id="rctStart" style="margin-top:12px;padding:14px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Начать</button>
        </div>
    `;

    const field = document.getElementById('rctField');
    const scoreEl = document.getElementById('rctScore');
    const livesEl = document.getElementById('rctLives');
    const levelEl = document.getElementById('rctLevel');

    let score = 0;
    let lives = 3;
    let level = 1;
    let running = false;
    let spawnTimer = null;
    let startTime = 0;
    let levelTimer = null;

    function renderLives() {
        livesEl.textContent = '❤'.repeat(Math.max(0, lives)) || '—';
    }

    function computeScore() {
        // Очки за игру + бонус за уровень
        return score + level * 50;
    }

    // Время жизни цели (мс) — уменьшается с уровнем
    function currentTargetLifetime() {
        const base = 1400;
        return Math.max(400, base - (level - 1) * 100);
    }

    // Интервал между спавнами (мс) — уменьшается с уровнем
    function currentSpawnInterval() {
        const base = 750;
        return Math.max(220, base - (level - 1) * 50);
    }

    // Шанс появления бомбы (от 0 до 0.35)
    function currentBombChance() {
        return Math.min(0.35, 0.05 + (level - 1) * 0.03);
    }

    function spawnTarget() {
        if (!running) return;
        const fw = field.clientWidth;
        const fh = field.clientHeight;
        if (fw < 50 || fh < 50) return;

        const isBomb = Math.random() < currentBombChance();
        const size = isBomb ? 60 : 56;
        const x = Math.random() * (fw - size);
        const y = Math.random() * (fh - size);

        const t = document.createElement('div');
        t.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;
            background:${isBomb ? 'radial-gradient(circle,#ff453a,#8b0000)' : 'radial-gradient(circle,#30d158,#0088cc)'};
            box-shadow:0 0 20px ${isBomb ? 'rgba(255,69,58,0.7)' : 'rgba(48,209,88,0.6)'};
            cursor:pointer;animation:rctPop 0.2s ease;display:flex;align-items:center;justify-content:center;
            font-size:${isBomb ? '26px' : '24px'};user-select:none;`;
        t.textContent = isBomb ? '💣' : '🎯';

        const timeout = setTimeout(() => {
            if (t.parentNode) {
                t.remove();
                if (!isBomb) {
                    // Пропустили цель — теряем жизнь
                    loseLife();
                }
            }
        }, currentTargetLifetime());

        const handleHit = (e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
            clearTimeout(timeout);
            if (isBomb) {
                // Попали по бомбе — теряем жизнь
                t.style.transform = 'scale(1.6)';
                t.style.opacity = '0';
                setTimeout(() => t.remove(), 200);
                loseLife();
            } else {
                // Обычная цель — +1 очко
                score++;
                scoreEl.textContent = score;
                t.style.transform = 'scale(1.4)';
                t.style.opacity = '0';
                setTimeout(() => t.remove(), 200);
            }
        };

        t.addEventListener('click', handleHit);
        t.addEventListener('touchstart', handleHit, { passive: false });

        field.appendChild(t);
    }

    function loseLife() {
        if (!running) return;
        lives--;
        renderLives();
        // Красная вспышка поля
        field.style.transition = 'box-shadow 0.15s';
        field.style.boxShadow = 'inset 0 0 60px rgba(255,69,58,0.8)';
        setTimeout(() => { field.style.boxShadow = ''; }, 150);
        if (lives <= 0) endGame();
    }

    function endGame() {
        running = false;
        clearInterval(spawnTimer);
        clearInterval(levelTimer);
        const finalScore = computeScore();
        submitGameScore('reaction', finalScore);

        field.innerHTML = `
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;">
                <div style="font-size:1.6rem;font-weight:800;margin-bottom:8px;">Игра окончена</div>
                <div style="font-size:1rem;margin-bottom:6px;">Целей поймано: ${score}</div>
                <div style="font-size:1rem;margin-bottom:6px;">Достигнут уровень: ${level}</div>
                <div style="font-size:1.3rem;margin-bottom:20px;color:#30d158;font-weight:800;">Очки: ${fmtScore(finalScore)}</div>
                <div style="display:flex;gap:10px;">
                    <button id="rctRating" style="padding:12px 24px;border-radius:12px;background:rgba(255,255,255,0.15);color:#fff;font-weight:700;border:none;cursor:pointer;">🏆 Рейтинг</button>
                    <button id="rctRestart" style="padding:12px 30px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Ещё раз</button>
                </div>
            </div>
        `;
        document.getElementById('rctRestart').addEventListener('click', () => {
            field.innerHTML = '';
            score = 0; lives = 3; level = 1;
            scoreEl.textContent = 0;
            levelEl.textContent = 1;
            renderLives();
            startGameLoop();
        });
        document.getElementById('rctRating').addEventListener('click', () => openLeaderboard('reaction'));
    }

    function startGameLoop() {
        running = true;
        startTime = Date.now();

        // Спавн целей/бомб
        const spawnTick = () => {
            if (!running) return;
            if (Math.random() < 0.85) spawnTarget();
            spawnTimer = setTimeout(spawnTick, currentSpawnInterval());
        };
        spawnTick();

        // Каждые 10 секунд — новый уровень (ускорение + больше бомб)
        levelTimer = setInterval(() => {
            if (!running) return;
            level++;
            levelEl.textContent = level;
        }, 10000);
    }

    document.getElementById('rctStart').addEventListener('click', () => {
        document.getElementById('rctStart').style.display = 'none';
        renderLives();
        startGameLoop();
    });

    if (!document.getElementById('rctStyles')) {
        const s = document.createElement('style');
        s.id = 'rctStyles';
        s.textContent = '@keyframes rctPop { from { transform:scale(0); } to { transform:scale(1); } }';
        document.head.appendChild(s);
    }

    return () => {
        running = false;
        clearTimeout(spawnTimer);
        clearInterval(levelTimer);
    };
}
