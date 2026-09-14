/* ============================================================================
   Игры — одиночные. Canvas-игры ждут layout.
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

// Ждём, пока элемент получит реальные размеры
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
    { id: 'rpg-clicker',  name: 'RPG-кликер',  desc: 'Убивай монстров, прокачивай меч' },
    { id: 'snake-arena',  name: 'Змейка',      desc: 'Классика: собирай яблоки' },
    { id: '2048',         name: '2048',        desc: 'Собери плитку 2048' },
    { id: 'memory',       name: 'Найди пару',  desc: 'Открывай карточки, находи пары' },
    { id: 'reaction',     name: 'Реакция',     desc: 'Успей тапнуть по мишеням' }
];

function renderGamesMenu(container) {
    stopActiveGame();
    let html = '<h1 class="page-title">Игровой центр</h1><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">';
    for (const g of GAMES) {
        html += `
            <div class="game-card" onclick="startGame('${g.id}')" style="background:var(--bg-card);border-radius:16px;padding:18px;border:1px solid var(--card-border);cursor:pointer;text-align:center;">
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
        'snake-arena': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c0-3 2-5 5-5h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/></svg>',
        '2048': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
        'memory': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="10" rx="1.5"/><rect x="14" y="3" width="7" height="10" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>',
        'reaction': '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>'
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
    waitForLayout(area, () => {
        if (gameId === 'rpg-clicker') activeGameCleanup = startRpgClicker(area);
        else if (gameId === 'snake-arena') activeGameCleanup = startSnake(area);
        else if (gameId === '2048') activeGameCleanup = start2048(area);
        else if (gameId === 'memory') activeGameCleanup = startMemory(area);
        else if (gameId === 'reaction') activeGameCleanup = startReaction(area);
    });
}

/* ============================================================================
   RPG-КЛИКЕР (оставлен без изменений)
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
        if (Math.random() < 0.1 + state.artifacts * 0.02) dmg *= 3;

        monsterHp -= dmg;
        monsterEl.style.transform = 'scale(0.92)';
        setTimeout(() => monsterEl.style.transform = 'scale(1)', 80);

        const particle = document.createElement('div');
        particle.textContent = '-' + Math.floor(dmg);
        particle.style.cssText = 'position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);color:#ff453a;font-weight:800;font-size:1.4rem;pointer-events:none;animation:rpgFloat 0.6s ease-out forwards;';
        area.querySelector('#rpgMonster')?.parentElement?.appendChild(particle);
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
        state.coins += (state.guilds * 0.5 + state.warriors * 0.2) / 10;
        updateUI();
    }, 100);

    const now = Date.now();
    if (state.lastOnline) {
        const elapsed = Math.min((now - state.lastOnline) / 1000, 4 * 3600);
        const offlineIncome = (state.guilds * 0.5 + state.warriors * 0.2) * elapsed;
        if (offlineIncome > 1) {
            state.coins += offlineIncome;
            setTimeout(() => {
                if (confirm(`Пока вас не было, гильдии заработали ${fmt(Math.floor(offlineIncome))} монет.`)) {
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

    // Анимация частиц
    if (!document.getElementById('rpgStyles')) {
        const s = document.createElement('style');
        s.id = 'rpgStyles';
        s.textContent = '@keyframes rpgFloat { from { opacity:1; transform:translate(-50%,-50%); } to { opacity:0; transform:translate(-50%,-120%); } }';
        document.head.appendChild(s);
    }

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
   ЗМЕЙКА
   ============================================================================ */
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
   НАЙДИ ПАРУ (Memory)
   ============================================================================ */
function startMemory(area) {
    const emojis = ['🍎', '🍌', '🍇', '🍓', '🍉', '🥝', '🍒', '🍑'];
    const cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);

    let flipped = [];
    let matched = 0;
    let moves = 0;
    let lock = false;

    area.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;height:100%;padding:20px;">
            <div style="display:flex;gap:20px;margin-bottom:20px;font-weight:700;color:var(--text);">
                <div>Пары: <span id="memPairs">0/8</span></div>
                <div>Ходы: <span id="memMoves">0</span></div>
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

    function flipCard(card) {
        if (lock) return;
        if (card.classList.contains('flipped') || card.classList.contains('matched')) return;

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
                    setTimeout(() => {
                        alert(`Победа! Ходов: ${moves}`);
                        startMemory(area);
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

    return () => {};
}

/* ============================================================================
   РЕАКЦИЯ (замена Cyber Runner)
   ============================================================================ */
function startReaction(area) {
    area.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:#0f1419;color:#fff;padding:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                <div>Счёт: <span id="rctScore" style="font-weight:800;">0</span></div>
                <div>Промахи: <span id="rctMiss" style="font-weight:800;color:#ff453a;">0/3</span></div>
            </div>
            <div id="rctField" style="flex:1;position:relative;background:#1a1f2e;border-radius:14px;overflow:hidden;touch-action:manipulation;"></div>
            <button id="rctStart" style="margin-top:12px;padding:14px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Начать</button>
        </div>
    `;

    const field = document.getElementById('rctField');
    let score = 0;
    let misses = 0;
    let running = false;
    let spawnTimer = null;

    function spawnTarget() {
        if (!running) return;
        const fw = field.clientWidth;
        const fh = field.clientHeight;
        if (fw < 50 || fh < 50) return;

        const size = 56;
        const x = Math.random() * (fw - size);
        const y = Math.random() * (fh - size);

        const t = document.createElement('div');
        t.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle,#30d158,#0088cc);box-shadow:0 0 20px rgba(48,209,88,0.6);cursor:pointer;animation:rctPop 0.2s ease;display:flex;align-items:center;justify-content:center;font-size:24px;user-select:none;`;
        t.textContent = '🎯';

        const timeout = setTimeout(() => {
            if (t.parentNode) {
                t.remove();
                misses++;
                document.getElementById('rctMiss').textContent = misses + '/3';
                if (misses >= 3) endGame();
            }
        }, 1200);

        t.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(timeout);
            score++;
            document.getElementById('rctScore').textContent = score;
            t.style.transform = 'scale(1.4)';
            t.style.opacity = '0';
            setTimeout(() => t.remove(), 200);
        });

        t.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(timeout);
            score++;
            document.getElementById('rctScore').textContent = score;
            t.remove();
        }, { passive: false });

        field.appendChild(t);
    }

    function endGame() {
        running = false;
        clearInterval(spawnTimer);
        field.innerHTML = `
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:1.6rem;font-weight:800;margin-bottom:8px;">Игра окончена</div>
                <div style="font-size:1.2rem;margin-bottom:20px;">Счёт: ${score}</div>
                <button id="rctRestart" style="padding:12px 30px;border-radius:12px;background:#30d158;color:#fff;font-weight:700;border:none;cursor:pointer;">Ещё раз</button>
            </div>
        `;
        document.getElementById('rctRestart').addEventListener('click', () => {
            field.innerHTML = '';
            score = 0; misses = 0;
            document.getElementById('rctScore').textContent = 0;
            document.getElementById('rctMiss').textContent = '0/3';
            startGameLoop();
        });
    }

    function startGameLoop() {
        running = true;
        spawnTimer = setInterval(() => {
            if (!running) return;
            if (Math.random() < 0.8) spawnTarget();
        }, 700 - Math.min(400, score * 15));
    }

    document.getElementById('rctStart').addEventListener('click', () => {
        document.getElementById('rctStart').style.display = 'none';
        startGameLoop();
    });

    // Анимация
    if (!document.getElementById('rctStyles')) {
        const s = document.createElement('style');
        s.id = 'rctStyles';
        s.textContent = '@keyframes rctPop { from { transform:scale(0); } to { transform:scale(1); } }';
        document.head.appendChild(s);
    }

    return () => { running = false; clearInterval(spawnTimer); };
}
