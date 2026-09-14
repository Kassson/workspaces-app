/* ============================================================================
   Игры — одиночные. Онлайн-режимы удалены.
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

const GAMES = [
    { id: 'rpg-clicker',  name: 'RPG-кликер',   desc: 'Убивай монстров, прокачивай меч и гильдии' },
    { id: 'neon-runner',  name: 'Neon Runner',  desc: 'Бесконечный бег по неоновой трассе' },
    { id: 'neon-rider',   name: 'Neon Rider',   desc: 'Мотоцикл по процедурной трассе' },
    { id: 'snake-arena',  name: 'Змейка',       desc: 'Классика: собирай яблоки' },
    { id: '2048',         name: '2048',         desc: 'Собери плитку 2048' },
    { id: 'cyber-runner', name: 'Cyber Runner', desc: 'Реакция и ловкость' }
];

function renderGamesMenu(container) {
    stopActiveGame();
    let html = '<h1 class="page-title">Игровой центр</h1><div class="games-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">';
    for (const g of GAMES) {
        html += `
            <div class="game-card" onclick="startGame('${g.id}')" style="background:var(--bg-card);border-radius:16px;padding:18px;border:1px solid var(--card-border);cursor:pointer;transition:transform 0.18s;text-align:center;">
                <div style="font-size:2.2rem;margin-bottom:10px;">${gameIcon(g.id)}</div>
                <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">${g.name}</div>
                <div style="color:var(--text-secondary);font-size:0.8rem;">${g.desc}</div>
            </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function gameIcon(id) {
    const icons = {
        'rpg-clicker': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5l6 6-11 11-6-6 11-11z"/><path d="M3 21l3-3M14 7l3 3"/></svg>',
        'neon-runner': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="6" r="2"/><path d="M13 10l-3 4 4 3 2 5M10 14l-4 4M14 10h5"/></svg>',
        'neon-rider': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="M5 18l4-10h6l4 10M9 8l2-3h4"/></svg>',
        'snake-arena': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c0-3 2-5 5-5h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/></svg>',
        '2048': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
        'cyber-runner': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
    };
    return icons[id] || '🎮';
}

function startGame(gameId) {
    stopActiveGame();
    const overlay = document.createElement('div');
    overlay.className = 'game-fullscreen';
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:9000;display:flex;flex-direction:column;';
    overlay.innerHTML = `
        <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--card-border);background:var(--bg-card);">
            <div style="font-weight:700;font-size:1.05rem;">${GAMES.find(g=>g.id===gameId).name}</div>
            <button onclick="stopActiveGame()" style="background:var(--input-bg);border:none;padding:8px 14px;border-radius:10px;font-weight:600;cursor:pointer;color:var(--text);">Закрыть</button>
        </div>
        <div id="gameArea" style="flex:1;position:relative;overflow:hidden;"></div>
    `;
    document.body.appendChild(overlay);
    activeGame = gameId;

    const area = document.getElementById('gameArea');
    if (gameId === 'rpg-clicker') activeGameCleanup = startRpgClicker(area);
    else if (gameId === 'neon-runner') activeGameCleanup = startNeonRunner(area);
    else if (gameId === 'neon-rider') activeGameCleanup = startNeonRider(area);
    else if (gameId === 'snake-arena') activeGameCleanup = startSnake(area);
    else if (gameId === '2048') activeGameCleanup = start2048(area);
    else if (gameId === 'cyber-runner') activeGameCleanup = startCyberRunner(area);

    // Регистрируем score в БД при выходе
    const oldCleanup = activeGameCleanup;
    activeGameCleanup = () => { if (oldCleanup) oldCleanup(); };
}

/* ============================================================================
   RPG-КЛИКЕР
   ============================================================================ */
function startRpgClicker(area) {
    const state = loadRpgState();

    area.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:linear-gradient(180deg,#1a1f2e,#0f1419);color:#fff;">
            <div style="padding:14px;display:flex;justify-content:space-between;">
                <div>
                    <div style="font-size:0.75rem;opacity:0.7;">Монеты</div>
                    <div style="font-size:1.5rem;font-weight:800;" id="rpgCoins">${fmt(state.coins)}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.75rem;opacity:0.7;">Уровень</div>
                    <div style="font-size:1.5rem;font-weight:800;" id="rpgLevel">${state.level}</div>
                </div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;">
                <div id="rpgMonster" style="font-size:5rem;cursor:pointer;user-select:none;transition:transform 0.08s;filter:drop-shadow(0 0 20px rgba(255,80,80,0.5));">👹</div>
                <div style="width:80%;max-width:300px;margin-top:16px;height:14px;background:rgba(255,255,255,0.15);border-radius:7px;overflow:hidden;">
                    <div id="rpgMonsterHp" style="height:100%;background:linear-gradient(90deg,#ff453a,#ff9f0a);width:100%;transition:width 0.15s;"></div>
                </div>
                <div style="margin-top:8px;font-size:0.9rem;" id="rpgMonsterName">Слизень</div>
                <div style="margin-top:4px;font-size:0.8rem;opacity:0.7;" id="rpgMonsterInfo"></div>
            </div>
            <div style="padding:12px;background:rgba(0,0,0,0.3);">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;font-size:0.8rem;">
                    <div style="text-align:center;"><div style="opacity:0.7;">Урон</div><div style="font-weight:700;" id="rpgDmg">1</div></div>
                    <div style="text-align:center;"><div style="opacity:0.7;">DPS</div><div style="font-weight:700;" id="rpgDps">0</div></div>
                    <div style="text-align:center;"><div style="opacity:0.7;">Скорость</div><div style="font-weight:700;" id="rpgSpeed">1x</div></div>
                </div>
                <button onclick="rpgToggleShop()" style="width:100%;padding:12px;border-radius:12px;background:linear-gradient(90deg,#0088cc,#00b4ff);color:#fff;font-weight:700;border:none;cursor:pointer;">Прокачка</button>
            </div>
            <div id="rpgShop" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.9);z-index:10;overflow-y:auto;padding:20px;"></div>
        </div>
    `;

    const monsterTypes = [
        { name: 'Слизень', emoji: '🟢', hp: 10, reward: 5 },
        { name: 'Крыса', emoji: '🐀', hp: 25, reward: 12 },
        { name: 'Гоблин', emoji: '👺', hp: 60, reward: 30 },
        { name: 'Скелет', emoji: '💀', hp: 150, reward: 75 },
        { name: 'Орк', emoji: '👹', hp: 400, reward: 180 },
        { name: 'Демон', emoji: '😈', hp: 1000, reward: 450 },
        { name: 'Дракон', emoji: '🐉', hp: 3000, reward: 1200 }
    ];

    let monsterIdx = Math.min(state.monsterIdx || 0, monsterTypes.length - 1);
    let monsterHp = monsterTypes[monsterIdx].hp * (1 + state.level * 0.5);
    let maxMonsterHp = monsterHp;
    let lastAttackTime = 0;

    const monsterEl = document.getElementById('rpgMonster');
    const hpBar = document.getElementById('rpgMonsterHp');
    const nameEl = document.getElementById('rpgMonsterName');
    const infoEl = document.getElementById('rpgMonsterInfo');

    function updateUI() {
        document.getElementById('rpgCoins').textContent = fmt(Math.floor(state.coins));
        document.getElementById('rpgLevel').textContent = state.level;
        document.getElementById('rpgDmg').textContent = state.sword;
        document.getElementById('rpgDps').textContent = Math.floor((state.guilds * 2 + state.warriors * 1) * state.level);
        document.getElementById('rpgSpeed').textContent = (1 + state.artifacts * 0.2).toFixed(1) + 'x';
        hpBar.style.width = Math.max(0, (monsterHp / maxMonsterHp) * 100) + '%';
        nameEl.textContent = monsterTypes[monsterIdx].name;
        infoEl.textContent = `HP: ${Math.max(0, Math.floor(monsterHp))} / ${Math.floor(maxMonsterHp)}`;
        monsterEl.textContent = monsterTypes[monsterIdx].emoji;
    }

    function tapMonster(e) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastAttackTime < 100 / (1 + state.artifacts * 0.2)) return;
        lastAttackTime = now;

        let dmg = state.sword;
        // Крит
        if (Math.random() < 0.1 + state.artifacts * 0.02) dmg *= 3;

        monsterHp -= dmg;
        monsterEl.style.transform = 'scale(0.92)';
        setTimeout(() => monsterEl.style.transform = 'scale(1)', 80);

        // Эффект частиц
        const particle = document.createElement('div');
        particle.textContent = '-' + Math.floor(dmg);
        particle.style.cssText = 'position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);color:#ff453a;font-weight:800;font-size:1.4rem;pointer-events:none;animation:rpgFloat 0.6s ease-out forwards;';
        area.querySelector('#gameArea, [id="rpgMonster"]')?.parentElement?.appendChild(particle);
        setTimeout(() => particle.remove(), 600);

        if (monsterHp <= 0) {
            state.coins += monsterTypes[monsterIdx].reward * (1 + state.level * 0.3);
            monsterIdx = Math.min(monsterIdx + 1, monsterTypes.length - 1);
            state.monsterIdx = monsterIdx;
            maxMonsterHp = monsterTypes[monsterIdx].hp * (1 + state.level * 0.5);
            monsterHp = maxMonsterHp;
            saveRpgState(state);
        }
        updateUI();
    }

    monsterEl.addEventListener('touchstart', tapMonster, { passive: false });
    monsterEl.addEventListener('click', tapMonster);

    window.rpgToggleShop = () => {
        const shop = document.getElementById('rpgShop');
        if (shop.style.display === 'none') {
            shop.style.display = 'block';
            renderShop();
        } else shop.style.display = 'none';
    };

    function renderShop() {
        const shop = document.getElementById('rpgShop');
        const swordCost = Math.floor(10 * Math.pow(1.15, state.sword));
        const armorCost = Math.floor(15 * Math.pow(1.2, state.armor));
        const guildCost = Math.floor(100 * Math.pow(1.5, state.guilds));
        const warriorCost = Math.floor(50 * Math.pow(1.3, state.warriors));
        const artifactCost = Math.floor(500 * Math.pow(2, state.artifacts));

        shop.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <div style="font-size:1.3rem;font-weight:700;">Прокачка</div>
                <button onclick="rpgToggleShop()" style="background:rgba(255,255,255,0.15);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;">Закрыть</button>
            </div>
            <div style="display:grid;gap:10px;">
                ${upgradeRow('Меч', `Урон: ${state.sword} → ${state.sword + 1}`, swordCost, state.coins >= swordCost, 'rpgBuySword')}
                ${upgradeRow('Доспехи', `Броня: ${state.armor} → ${state.armor + 1}`, armorCost, state.coins >= armorCost, 'rpgBuyArmor')}
                ${upgradeRow('Гильдия', `+2 DPS за уровень (${state.guilds})`, guildCost, state.coins >= guildCost, 'rpgBuyGuild')}
                ${upgradeRow('Воин', `+1 DPS за уровень (${state.warriors})`, warriorCost, state.coins >= warriorCost, 'rpgBuyWarrior')}
                ${upgradeRow('Артефакт', `+20% скорость, +2% крит (${state.artifacts})`, artifactCost, state.coins >= artifactCost, 'rpgBuyArtifact')}
            </div>
        `;
    }

    function upgradeRow(name, desc, cost, canAfford, action) {
        return `
            <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;${!canAfford ? 'opacity:0.5;' : ''}">
                <div>
                    <div style="font-weight:700;">${name}</div>
                    <div style="font-size:0.8rem;opacity:0.7;">${desc}</div>
                </div>
                <button onclick="${action}()" ${!canAfford ? 'disabled' : ''} style="background:linear-gradient(90deg,#0088cc,#00b4ff);color:#fff;border:none;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer;">${fmt(cost)}</button>
            </div>`;
    }

    window.rpgBuySword = () => {
        const c = Math.floor(10 * Math.pow(1.15, state.sword));
        if (state.coins < c) return;
        state.coins -= c; state.sword++; saveRpgState(state); updateUI(); renderShop();
    };
    window.rpgBuyArmor = () => {
        const c = Math.floor(15 * Math.pow(1.2, state.armor));
        if (state.coins < c) return;
        state.coins -= c; state.armor++; saveRpgState(state); updateUI(); renderShop();
    };
    window.rpgBuyGuild = () => {
        const c = Math.floor(100 * Math.pow(1.5, state.guilds));
        if (state.coins < c) return;
        state.coins -= c; state.guilds++; saveRpgState(state); updateUI(); renderShop();
    };
    window.rpgBuyWarrior = () => {
        const c = Math.floor(50 * Math.pow(1.3, state.warriors));
        if (state.coins < c) return;
        state.coins -= c; state.warriors++; saveRpgState(state); updateUI(); renderShop();
    };
    window.rpgBuyArtifact = () => {
        const c = Math.floor(500 * Math.pow(2, state.artifacts));
        if (state.coins < c) return;
        state.coins -= c; state.artifacts++; saveRpgState(state); updateUI(); renderShop();
    };

    // Автоурон + пассивный доход
    const passiveTimer = setInterval(() => {
        const dps = (state.guilds * 2 + state.warriors * 1) * state.level;
        if (dps > 0) {
            monsterHp -= dps / 10;
            if (monsterHp <= 0) {
                state.coins += monsterTypes[monsterIdx].reward * (1 + state.level * 0.3);
                monsterIdx = Math.min(monsterIdx + 1, monsterTypes.length - 1);
                state.monsterIdx = monsterIdx;
                maxMonsterHp = monsterTypes[monsterIdx].hp * (1 + state.level * 0.5);
                monsterHp = maxMonsterHp;
                saveRpgState(state);
            }
        }
        // Пассивный доход
        state.coins += (state.guilds * 0.5 + state.warriors * 0.2) / 10;
        updateUI();
    }, 100);

    // Оффлайн-доход
    const now = Date.now();
    if (state.lastOnline) {
        const elapsed = Math.min((now - state.lastOnline) / 1000, 4 * 3600);
        const offlineIncome = (state.guilds * 0.5 + state.warriors * 0.2) * elapsed;
        if (offlineIncome > 1) {
            state.coins += offlineIncome;
            setTimeout(() => {
                if (confirm(`Пока вас не было, гильдии заработали ${fmt(Math.floor(offlineIncome))} монет. Забрать?`)) {
                    saveRpgState(state); updateUI();
                } else {
                    state.coins -= offlineIncome; saveRpgState(state); updateUI();
                }
            }, 300);
        }
    }
    state.lastOnline = now;
    saveRpgState(state);

    updateUI();

    return () => {
        clearInterval(passiveTimer);
        state.lastOnline = Date.now();
        saveRpgState(state);
        window.rpgToggleShop = null;
        window.rpgBuySword = null;
        window.rpgBuyArmor = null;
        window.rpgBuyGuild = null;
        window.rpgBuyWarrior = null;
        window.rpgBuyArtifact = null;
    };
}

function loadRpgState() {
    try {
        return JSON.parse(localStorage.getItem('rpgClickerState')) || {
            coins: 0, level: 1, sword: 1, armor: 0, guilds: 0, warriors: 0, artifacts: 0, monsterIdx: 0, lastOnline: 0
        };
    } catch (e) {
        return { coins: 0, level: 1, sword: 1, armor: 0, guilds: 0, warriors: 0, artifacts: 0, monsterIdx: 0, lastOnline: 0 };
    }
}
function saveRpgState(s) { try { localStorage.setItem('rpgClickerState', JSON.stringify(s)); } catch (e) {} }
function fmt(n) {
    if (n < 1000) return Math.floor(n).toString();
    if (n < 1e6) return (n / 1000).toFixed(1) + 'K';
    if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
    return (n / 1e9).toFixed(1) + 'B';
}

/* ============================================================================
   NEON RUNNER
   ============================================================================ */
function startNeonRunner(area) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;background:#0a0e17;';
    area.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = area.clientWidth;
        canvas.height = area.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const lanes = 3;
    let speed = 8;
    let score = 0;
    let obstacles = [];
    let coins = [];
    let playerLane = 1;
    let running = true;
    let frame = 0;
    let touchStartX = 0, touchStartY = 0;

    canvas.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 40) playerLane = Math.min(lanes - 1, playerLane + 1);
            else if (dx < -40) playerLane = Math.max(0, playerLane - 1);
        }
    });

    // Клавиатура
    const onKey = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a') playerLane = Math.max(0, playerLane - 1);
        else if (e.key === 'ArrowRight' || e.key === 'd') playerLane = Math.min(lanes - 1, playerLane + 1);
    };
    document.addEventListener('keydown', onKey);

    function loop() {
        if (!running) return;
        frame++;

        const w = canvas.width;
        const h = canvas.height;
        const laneW = w / lanes;
        const horizon = h * 0.4;

        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);

        // Неоновая сетка
        ctx.strokeStyle = 'rgba(0,180,255,0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= lanes; i++) {
            ctx.beginPath();
            ctx.moveTo(i * laneW, horizon);
            ctx.lineTo(i * laneW, h);
            ctx.stroke();
        }
        for (let i = 0; i < 20; i++) {
            const y = horizon + ((i * 40 + frame * speed) % (h - horizon));
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Спавн
        if (frame % 40 === 0 && Math.random() < 0.7) {
            obstacles.push({ lane: Math.floor(Math.random() * lanes), y: horizon, size: 40 });
        }
        if (frame % 30 === 0 && Math.random() < 0.5) {
            coins.push({ lane: Math.floor(Math.random() * lanes), y: horizon, size: 20 });
        }

        const playerY = h - 80;
        const playerX = playerLane * laneW + laneW / 2;

        // Препятствия
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            o.y += speed;
            const scale = (o.y - horizon) / (h - horizon);
            const size = o.size * scale;
            const x = o.lane * laneW + laneW / 2;

            ctx.fillStyle = 'rgba(255,0,80,0.9)';
            ctx.shadowColor = '#ff0050';
            ctx.shadowBlur = 20;
            ctx.fillRect(x - size / 2, o.y - size / 2, size, size);
            ctx.shadowBlur = 0;

            if (Math.abs(o.y - playerY) < 40 && o.lane === playerLane) {
                endGame(score);
                return;
            }
            if (o.y > h + 50) obstacles.splice(i, 1);
        }

        // Монеты
        for (let i = coins.length - 1; i >= 0; i--) {
            const c = coins[i];
            c.y += speed;
            const scale = (c.y - horizon) / (h - horizon);
            const size = c.size * scale;
            const x = c.lane * laneW + laneW / 2;

            ctx.fillStyle = '#ffd60a';
            ctx.shadowColor = '#ffd60a';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(x, c.y, size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            if (Math.abs(c.y - playerY) < 30 && c.lane === playerLane) {
                score += 10;
                coins.splice(i, 1);
                continue;
            }
            if (c.y > h + 50) coins.splice(i, 1);
        }

        // Игрок
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.arc(playerX, playerY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Счёт
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('Счёт: ' + score, 20, 40);

        speed = 8 + Math.floor(score / 200);
        requestAnimationFrame(loop);
    }

    function endGame(finalScore) {
        running = false;
        canvas.removeEventListener('touchstart', () => {});
        document.removeEventListener('keydown', onKey);
        const ov = document.createElement('div');
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:10;';
        ov.innerHTML = `
            <div style="font-size:2rem;font-weight:800;margin-bottom:10px;">Игра окончена</div>
            <div style="font-size:1.3rem;margin-bottom:24px;">Счёт: ${finalScore}</div>
            <button id="nrRetry" style="padding:12px 30px;border-radius:12px;background:#00e5ff;color:#0a0e17;font-weight:700;border:none;cursor:pointer;">Играть заново</button>
        `;
        area.appendChild(ov);
        ov.querySelector('#nrRetry').addEventListener('click', () => { ov.remove(); startNeonRunner(area); });
    }

    requestAnimationFrame(loop);
    return () => { running = false; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize); };
}

/* ============================================================================
   NEON RIDER
   ============================================================================ */
function startNeonRider(area) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;background:#050810;';
    area.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() { canvas.width = area.clientWidth; canvas.height = area.clientHeight; }
    resize();
    window.addEventListener('resize', resize);

    let offset = 0;
    let speed = 5;
    let score = 0;
    let gameOver = false;
    let bikeAngle = 0;
    let terrain = [];
    let coinOffsetY = 0;

    for (let i = 0; i < 200; i++) {
        terrain.push(Math.sin(i * 0.08) * 60 + Math.sin(i * 0.03) * 40 + 200);
    }

    let holding = false;
    canvas.addEventListener('touchstart', (e) => { holding = true; e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', () => { holding = false; });
    canvas.addEventListener('mousedown', () => holding = true);
    canvas.addEventListener('mouseup', () => holding = false);

    function loop() {
        if (gameOver) return;
        const w = canvas.width;
        const h = canvas.height;
        const baseline = h * 0.7;

        ctx.fillStyle = '#050810';
        ctx.fillRect(0, 0, w, h);

        // Звёзды
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let i = 0; i < 40; i++) {
            const sx = (i * 137 + offset * 0.5) % w;
            const sy = (i * 91) % baseline;
            ctx.fillRect(sx, sy, 1.5, 1.5);
        }

        offset += speed;

        // Трасса
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        for (let x = 0; x < w; x += 10) {
            const idx = Math.floor((x + offset) / 40);
            const y = baseline + (terrain[idx % terrain.length] || 200) - 200 + Math.sin((x + offset) * 0.02) * 10;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Мотоцикл
        const bikeY = baseline + 20 + bikeAngle * 40;
        const bikeX = w * 0.3;

        // Наклон
        bikeAngle = holding ? Math.min(bikeAngle + 0.05, 0.4) : Math.max(bikeAngle - 0.05, -0.2);

        ctx.save();
        ctx.translate(bikeX, bikeY);
        ctx.rotate(bikeAngle);

        // Корпус
        ctx.fillStyle = '#ff0050';
        ctx.shadowColor = '#ff0050';
        ctx.shadowBlur = 20;
        ctx.fillRect(-30, -8, 60, 16);

        // Колёса
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.beginPath(); ctx.arc(-20, 12, 10, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(20, 12, 10, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
        ctx.shadowBlur = 0;

        // Счёт
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('Дистанция: ' + Math.floor(score) + 'м', 20, 40);

        score += speed * 0.1;
        speed = Math.min(15, 5 + score / 200);

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
    return () => { gameOver = true; window.removeEventListener('resize', resize); };
}

/* ============================================================================
   ЗМЕЙКА (починено управление)
   ============================================================================ */
function startSnake(area) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;background:#0e1621;';
    area.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() { canvas.width = area.clientWidth; canvas.height = area.clientHeight; }
    resize();
    window.addEventListener('resize', resize);

    const CELL = 20;
    const cols = Math.floor(canvas.width / CELL);
    const rows = Math.floor(canvas.height / CELL);

    let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = { x: 15, y: 10 };
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
        // Нельзя развернуться на 180
        if (newDir.x === -dir.x && newDir.y === -dir.y) return;
        if (newDir.x === dir.x && newDir.y === dir.y) return;
        nextDir = newDir;
    }

    // Управление клавиатурой (исправлено: сразу с первого нажатия)
    const onKey = (e) => {
        switch (e.key) {
            case 'ArrowUp': case 'w': case 'W': e.preventDefault(); setDir({ x: 0, y: -1 }); break;
            case 'ArrowDown': case 's': case 'S': e.preventDefault(); setDir({ x: 0, y: 1 }); break;
            case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); setDir({ x: -1, y: 0 }); break;
            case 'ArrowRight': case 'd': case 'D': e.preventDefault(); setDir({ x: 1, y: 0 }); break;
        }
    };
    document.addEventListener('keydown', onKey);

    // Свайпы
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

        // Рендер
        ctx.fillStyle = '#0e1621';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Еда
        ctx.fillStyle = '#ff453a';
        ctx.shadowColor = '#ff453a';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Змейка
        snake.forEach((s, i) => {
            ctx.fillStyle = i === 0 ? '#30d158' : `rgba(48,209,88,${1 - i * 0.02})`;
            ctx.shadowColor = '#30d158';
            ctx.shadowBlur = i === 0 ? 15 : 5;
            ctx.beginPath();
            ctx.arc(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.shadowBlur = 0;

        // Счёт
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('Счёт: ' + score, 14, 30);

        requestAnimationFrame(tick);
    }

    function gameOver() {
        running = false;
        document.removeEventListener('keydown', onKey);
        const ov = document.createElement('div');
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:10;';
        ov.innerHTML = `
            <div style="font-size:2rem;font-weight:800;margin-bottom:10px;">Игра окончена</div>
            <div style="font-size:1.3rem;margin-bottom:24px;">Счёт: ${score}</div>
            <button id="snRetry" style="padding:12px 30px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Играть заново</button>
        `;
        area.appendChild(ov);
        ov.querySelector('#snRetry').addEventListener('click', () => { ov.remove(); startSnake(area); });
    }

    spawnFood();
    requestAnimationFrame(tick);
    return () => { running = false; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', resize); };
}

/* ============================================================================
   2048
   ============================================================================ */
function start2048(area) {
    area.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;">
            <div id="g2048score" style="font-size:1.5rem;font-weight:800;margin-bottom:16px;color:var(--text);">Счёт: 0</div>
            <div id="g2048board" style="display:grid;grid-template-columns:repeat(4,70px);grid-template-rows:repeat(4,70px);gap:8px;background:var(--input-bg);padding:8px;border-radius:14px;"></div>
        </div>
    `;
    let board = Array(4).fill().map(() => Array(4).fill(0));
    let score = 0;

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

    function move(dir) {
        let moved = false;
        const oldBoard = JSON.stringify(board);
        if (dir === 'left') for (let i = 0; i < 4; i++) { board[i] = slide(board[i]); }
        else if (dir === 'right') for (let i = 0; i < 4; i++) { board[i] = slide(board[i].reverse()).reverse(); }
        else if (dir === 'up') for (let j = 0; j < 4; j++) { const col = board.map(r => r[j]); const newCol = slide(col); for (let i = 0; i < 4; i++) board[i][j] = newCol[i]; }
        else if (dir === 'down') for (let j = 0; j < 4; j++) { const col = board.map(r => r[j]).reverse(); const newCol = slide(col).reverse(); for (let i = 0; i < 4; i++) board[i][j] = newCol[i]; }
        if (JSON.stringify(board) !== oldBoard) { spawn(); render(); }
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
    return () => { document.removeEventListener('keydown', onKey); };
}

/* ============================================================================
   CYBER RUNNER (починка)
   ============================================================================ */
function startCyberRunner(area) {
    area.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;">
            <div style="font-size:1.5rem;font-weight:800;margin-bottom:14px;color:var(--text);">Cyber Runner</div>
            <div style="color:var(--text-secondary);max-width:340px;margin-bottom:20px;">Нажимайте на экран в такт появляющимся мишеням. Пропустите 3 — игра окончена.</div>
            <button id="crStart" style="padding:14px 40px;border-radius:14px;background:#0088cc;color:#fff;font-weight:700;border:none;cursor:pointer;">Начать</button>
            <div id="crArea" style="margin-top:20px;width:100%;max-width:400px;height:400px;background:var(--input-bg);border-radius:16px;position:relative;overflow:hidden;display:none;"></div>
            <div id="crScore" style="margin-top:12px;font-weight:700;color:var(--text);"></div>
        </div>
    `;

    document.getElementById('crStart').addEventListener('click', () => {
        const crArea = document.getElementById('crArea');
        crArea.style.display = 'block';
        let score = 0, misses = 0;
        const targetTimer = setInterval(() => {
            const target = document.createElement('div');
            target.style.cssText = `position:absolute;width:60px;height:60px;border-radius:50%;background:radial-gradient(circle,#00e5ff,#0088cc);cursor:pointer;left:${Math.random() * 320}px;top:${Math.random() * 320}px;box-shadow:0 0 20px #00e5ff;animation:crPulse 0.8s ease-in-out infinite;`;
            target.addEventListener('click', () => {
                score += 10;
                document.getElementById('crScore').textContent = 'Счёт: ' + score;
                clearTimeout(target._timeout);
                target.remove();
            });
            target.addEventListener('touchstart', (e) => { e.preventDefault(); target.click(); });
            crArea.appendChild(target);
            target._timeout = setTimeout(() => {
                if (target.parentNode) { target.remove(); misses++; if (misses >= 3) endGame(); }
            }, 1500);
        }, 800);

        function endGame() {
            clearInterval(targetTimer);
            crArea.innerHTML = '';
            document.getElementById('crScore').textContent = 'Игра окончена. Счёт: ' + score;
        }
    });

    if (!document.getElementById('crStyles')) {
        const s = document.createElement('style');
        s.id = 'crStyles';
        s.textContent = '@keyframes crPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }';
        document.head.appendChild(s);
    }

    return () => {};
}