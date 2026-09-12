/* ===================== ИГРОВОЙ ЦЕНТР ===================== */
/* Примечание по объёму: «Brawl Battle Royale», «Battle Tanks 2D» и «Cyber Arena»
   реализованы как одиночные режимы «против ботов» (survival), а не как
   полноценные realtime-мультиплеер-комнаты с лобби/spectator — это отдельная,
   гораздо более объёмная задача (сетевой код, синхронизация состояния боя).
   2048, Snake Arena и Cyber Runner — полностью рабочие одиночные игры. */

const GAMES_META = {
    '2048':          { name: '2048 (Apple Edition)', icon: '🔢' },
    'snake-arena':   { name: 'Snake Arena IO', icon: '🐍' },
    'cyber-runner':  { name: 'Cyber Runner', icon: '🏃' },
    'battle-tanks':  { name: 'Battle Tanks 2D', icon: '🎯' },
    'brawl-royale':  { name: 'Brawl Battle Royale', icon: '🥊' },
    'cyber-arena':   { name: 'Cyber Arena', icon: '⚔️' },
};

let activeGame = null; // { id, stop() }
let gameKeys = {};

window.addEventListener('keydown', e => { gameKeys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { gameKeys[e.key.toLowerCase()] = false; });

function stopActiveGame() {
    if (activeGame && activeGame.stop) activeGame.stop();
    activeGame = null;
    gameKeys = {};
}

function renderGamesMenu(container) {
    container.innerHTML = `<div class="games-grid">` +
        Object.entries(GAMES_META).map(([id, g]) => `
            <div class="game-tile" onclick="openGame('${id}')">
                <div class="g-icon">${g.icon}</div>
                <div class="g-name">${g.name}</div>
            </div>`).join('') +
        `</div>`;
}

async function openGame(gameId) {
    const meta = GAMES_META[gameId];
    const container = document.getElementById('tab-games');
    container.innerHTML = `
        <button class="btn-small" onclick="closeGame()">← Назад к играм</button>
        <div class="game-view" style="margin-top:14px;">
            <div class="game-hud">
                <span>${meta.icon} ${meta.name}</span>
                <span>Счёт: <b id="gameScoreDisplay">0</b></span>
            </div>
            <canvas id="gameCanvas" width="480" height="480"></canvas>
            <div class="game-controls-touch">
                <div class="dpad">
                    <span></span><button id="dp-up">▲</button><span></span>
                    <button id="dp-left">◀</button><span id="dp-fire">●</span><button id="dp-right">▶</button>
                    <span></span><button id="dp-down">▼</button><span></span>
                </div>
            </div>
            <div class="leaderboard-list" id="gameLeaderboard">Загрузка таблицы лидеров…</div>
        </div>
    `;
    wireDpad();
    loadLeaderboard(gameId);
    startGameEngine(gameId);
}

function closeGame() {
    stopActiveGame();
    renderGamesMenu(document.getElementById('tab-games'));
}

function wireDpad() {
    const map = { 'dp-up': 'arrowup', 'dp-down': 'arrowdown', 'dp-left': 'arrowleft', 'dp-right': 'arrowright', 'dp-fire': ' ' };
    Object.entries(map).forEach(([btnId, key]) => {
        const el = document.getElementById(btnId);
        if (!el) return;
        const on = (e) => { e.preventDefault(); gameKeys[key] = true; };
        const off = (e) => { e.preventDefault(); gameKeys[key] = false; };
        el.addEventListener('touchstart', on); el.addEventListener('touchend', off);
        el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    });
}

async function loadLeaderboard(gameId) {
    const box = document.getElementById('gameLeaderboard');
    if (!currentSpace) { box.innerHTML = 'Выберите группу, чтобы сохранять рекорды.'; return; }
    try {
        const rows = await apiGet(`/api/games/${currentSpace.id}/${gameId}/leaderboard`);
        box.innerHTML = '<b>🏆 Таблица лидеров</b>' + (rows.length
            ? rows.map(r => `<div><span>${r.full_name}</span><span>${r.score}</span></div>`).join('')
            : '<div>Пока нет рекордов — станьте первым!</div>');
    } catch (e) { box.innerHTML = 'Не удалось загрузить таблицу лидеров.'; }
}

async function submitScore(gameId, score) {
    document.getElementById('gameScoreDisplay').textContent = score;
    if (!currentSpace) return;
    try {
        await apiPost(`/api/games/${currentSpace.id}/${gameId}/score`, { score });
    } catch (e) { /* тихо игнорируем */ }
}

function setScore(score) { const el = document.getElementById('gameScoreDisplay'); if (el) el.textContent = score; }

function startGameEngine(gameId) {
    stopActiveGame();
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    if (gameId === '2048') activeGame = run2048(canvas, ctx, gameId);
    else if (gameId === 'snake-arena') activeGame = runSnake(canvas, ctx, gameId);
    else if (gameId === 'cyber-runner') activeGame = runRunner(canvas, ctx, gameId);
    else activeGame = runArenaSurvival(canvas, ctx, gameId);
}

/* ================= 2048 ================= */
function run2048(canvas, ctx, gameId) {
    const SIZE = 4, CELL = canvas.width / SIZE;
    let grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    let score = 0, over = false;
    function addRandom() {
        const empty = [];
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) empty.push([r, c]);
        if (!empty.length) return;
        const [r, c] = empty[Math.floor(Math.random() * empty.length)];
        grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }
    function slideRow(row) {
        let arr = row.filter(v => v);
        for (let i = 0; i < arr.length - 1; i++) {
            if (arr[i] === arr[i + 1]) { arr[i] *= 2; score += arr[i]; arr.splice(i + 1, 1); }
        }
        while (arr.length < SIZE) arr.push(0);
        return arr;
    }
    function rotate(g) { const n = g.map((row, r) => g.map(col => col[r]).reverse()); return n; }
    function move(dir) {
        let moved = false;
        for (let k = 0; k < (dir === 'up' ? 1 : dir === 'right' ? 2 : dir === 'down' ? 3 : 0); k++) grid = rotate(grid);
        for (let r = 0; r < SIZE; r++) {
            const before = grid[r].join(',');
            grid[r] = slideRow(grid[r]);
            if (grid[r].join(',') !== before) moved = true;
        }
        for (let k = 0; k < (dir === 'up' ? 3 : dir === 'right' ? 2 : dir === 'down' ? 1 : 0); k++) grid = rotate(grid);
        if (moved) { addRandom(); setScore(score); }
        if (isGameOver()) { over = true; submitScore(gameId, score); }
    }
    function isGameOver() {
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
            if (!grid[r][c]) return false;
            if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return false;
            if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return false;
        }
        return true;
    }
    const colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
    function draw() {
        ctx.fillStyle = '#bbada0'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
            const v = grid[r][c];
            ctx.fillStyle = v ? (colors[v] || '#3c3a32') : 'rgba(238,228,218,0.35)';
            ctx.fillRect(c * CELL + 6, r * CELL + 6, CELL - 12, CELL - 12);
            if (v) {
                ctx.fillStyle = v <= 4 ? '#776e65' : '#f9f6f2';
                ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(v, c * CELL + CELL / 2, r * CELL + CELL / 2);
            }
        }
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    function key(e) {
        if (over) return;
        const map = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
        if (map[e.key?.toLowerCase()]) move(map[e.key.toLowerCase()]);
    }
    let lastKeys = {};
    const loop = setInterval(() => {
        if (over) { draw(); return; }
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].forEach(k => {
            if (gameKeys[k] && !lastKeys[k]) move(k.replace('arrow', ''));
            lastKeys[k] = gameKeys[k];
        });
        draw();
    }, 80);
    window.addEventListener('keydown', key);
    addRandom(); addRandom(); draw();
    return { stop() { clearInterval(loop); window.removeEventListener('keydown', key); } };
}

/* ================= SNAKE ARENA ================= */
function runSnake(canvas, ctx, gameId) {
    const CELL = 20, COLS = canvas.width / CELL, ROWS = canvas.height / CELL;
    let snake = [{ x: 10, y: 10 }], dir = { x: 1, y: 0 }, nextDir = dir, food = spawnFood(), score = 0, over = false;
    function spawnFood() { return { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }
    function tick() {
        if (over) return;
        if (gameKeys['arrowup'] && dir.y === 0) nextDir = { x: 0, y: -1 };
        if (gameKeys['arrowdown'] && dir.y === 0) nextDir = { x: 0, y: 1 };
        if (gameKeys['arrowleft'] && dir.x === 0) nextDir = { x: -1, y: 0 };
        if (gameKeys['arrowright'] && dir.x === 0) nextDir = { x: 1, y: 0 };
        dir = nextDir;
        const head = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
        if (snake.some(s => s.x === head.x && s.y === head.y)) { over = true; submitScore(gameId, score); return; }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) { score += 10; setScore(score); food = spawnFood(); }
        else snake.pop();
    }
    function draw() {
        ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff453a'; ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 2, CELL - 2);
        snake.forEach((s, i) => { ctx.fillStyle = i === 0 ? '#30d158' : '#0a84ff'; ctx.fillRect(s.x * CELL, s.y * CELL, CELL - 2, CELL - 2); });
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    const loop = setInterval(() => { tick(); draw(); }, 110);
    return { stop() { clearInterval(loop); } };
}

/* ================= CYBER RUNNER ================= */
function runRunner(canvas, ctx, gameId) {
    let player = { x: 60, y: canvas.height - 60, w: 30, h: 30, vy: 0, onGround: true };
    let obstacles = [], speed = 5, frame = 0, score = 0, over = false;
    const GROUND = canvas.height - 30;
    function jump() { if (player.onGround) { player.vy = -13; player.onGround = false; } }
    function tick() {
        if (over) return;
        frame++;
        if ((gameKeys[' '] || gameKeys['arrowup'] || gameKeys['w']) && player.onGround) jump();
        player.vy += 0.6; player.y += player.vy;
        if (player.y >= GROUND - player.h) { player.y = GROUND - player.h; player.vy = 0; player.onGround = true; }
        if (frame % 60 === 0) obstacles.push({ x: canvas.width, w: 24, h: 30 + Math.random() * 30 });
        obstacles.forEach(o => o.x -= speed);
        obstacles = obstacles.filter(o => o.x > -30);
        speed += 0.002;
        score = Math.floor(frame / 5); setScore(score);
        for (const o of obstacles) {
            if (player.x < o.x + o.w && player.x + player.w > o.x && player.y + player.h > GROUND - o.h) {
                over = true; submitScore(gameId, score);
            }
        }
    }
    function draw() {
        ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#333'; ctx.fillRect(0, GROUND, canvas.width, 4);
        ctx.fillStyle = '#0a84ff'; ctx.fillRect(player.x, player.y, player.w, player.h);
        ctx.fillStyle = '#ff453a'; obstacles.forEach(o => ctx.fillRect(o.x, GROUND - o.h, o.w, o.h));
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    const loop = setInterval(() => { tick(); draw(); }, 1000 / 60);
    return { stop() { clearInterval(loop); } };
}

/* ================= АРЕНА (Battle Tanks / Brawl Royale / Cyber Arena) — режим против ботов ================= */
function runArenaSurvival(canvas, ctx, gameId) {
    const themes = {
        'battle-tanks': { bg: '#1a1f16', player: '#30d158', bot: '#ff453a', label: 'Уничтожай вражеские танки!' },
        'brawl-royale': { bg: '#1a1620', player: '#ffd60a', bot: '#ff453a', label: 'Выживи дольше всех в зоне!' },
        'cyber-arena': { bg: '#10141f', player: '#0a84ff', bot: '#bf5af2', label: 'Уклоняйся и атакуй ботов!' },
    };
    const theme = themes[gameId] || themes['cyber-arena'];
    let player = { x: canvas.width / 2, y: canvas.height / 2, r: 14, angle: 0 };
    let bullets = [], botBullets = [];
    let bots = Array.from({ length: 4 }, (_, i) => ({
        x: 40 + (i % 2) * (canvas.width - 80), y: 40 + Math.floor(i / 2) * (canvas.height - 80),
        r: 14, hp: 3, cd: Math.random() * 60
    }));
    let frame = 0, score = 0, over = false, zoneR = Math.max(canvas.width, canvas.height);

    function tick() {
        if (over) return;
        frame++;
        const speed = 3.2;
        if (gameKeys['arrowup'] || gameKeys['w']) player.y -= speed;
        if (gameKeys['arrowdown'] || gameKeys['s']) player.y += speed;
        if (gameKeys['arrowleft'] || gameKeys['a']) player.x -= speed;
        if (gameKeys['arrowright'] || gameKeys['d']) player.x += speed;
        player.x = Math.max(player.r, Math.min(canvas.width - player.r, player.x));
        player.y = Math.max(player.r, Math.min(canvas.height - player.r, player.y));

        if (gameId === 'brawl-royale') { zoneR -= 0.15; if (zoneR < 40) zoneR = 40; }
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const distFromCenter = Math.hypot(player.x - cx, player.y - cy);
        if (gameId === 'brawl-royale' && distFromCenter > zoneR) score -= 0.1;

        // Автоприцел: игрок стреляет по ближайшему боту раз в 18 кадров при зажатом fire (пробел) или каждые 30 кадров автоматически
        const nearestBot = bots.filter(b => b.hp > 0).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
        const wantsFire = gameKeys[' '];
        if ((wantsFire && frame % 10 === 0) || frame % 45 === 0) {
            if (nearestBot) {
                const ang = Math.atan2(nearestBot.y - player.y, nearestBot.x - player.x);
                bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * 7, vy: Math.sin(ang) * 7 });
            }
        }
        bullets.forEach(b => { b.x += b.vx; b.y += b.vy; });
        bullets = bullets.filter(b => b.x > 0 && b.x < canvas.width && b.y > 0 && b.y < canvas.height);

        bots.forEach(bot => {
            if (bot.hp <= 0) return;
            const ang = Math.atan2(player.y - bot.y, player.x - bot.x);
            bot.x += Math.cos(ang) * 1.1; bot.y += Math.sin(ang) * 1.1;
            bot.cd--;
            if (bot.cd <= 0) { bot.cd = 70 + Math.random() * 40; botBullets.push({ x: bot.x, y: bot.y, vx: Math.cos(ang) * 4.5, vy: Math.sin(ang) * 4.5 }); }
        });
        botBullets.forEach(b => { b.x += b.vx; b.y += b.vy; });
        botBullets = botBullets.filter(b => b.x > 0 && b.x < canvas.width && b.y > 0 && b.y < canvas.height);

        bullets.forEach(b => bots.forEach(bot => {
            if (bot.hp > 0 && Math.hypot(b.x - bot.x, b.y - bot.y) < bot.r) { bot.hp--; b.hit = true; if (bot.hp <= 0) score += 100; }
        }));
        bullets = bullets.filter(b => !b.hit);

        botBullets.forEach(b => {
            if (Math.hypot(b.x - player.x, b.y - player.y) < player.r) { over = true; submitScore(gameId, Math.floor(score)); }
        });
        if (bots.every(b => b.hp <= 0)) bots.forEach(b => { b.hp = 3; b.x = Math.random() * canvas.width; b.y = Math.random() * canvas.height; });

        score += 0.15; setScore(Math.floor(score));
    }
    function draw() {
        ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (gameId === 'brawl-royale') {
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, zoneR, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = theme.bot;
        bots.forEach(b => { if (b.hp > 0) { ctx.globalAlpha = 0.4 + b.hp * 0.2; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } });
        ctx.fillStyle = '#fff';
        bullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = theme.bot;
        botBullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = theme.player; ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(theme.label, canvas.width / 2, 16);
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif';
            ctx.fillText('Вы выбыли 👻', canvas.width / 2, canvas.height / 2);
            ctx.font = '13px sans-serif'; ctx.fillText('(режим-призрак: наблюдение недоступно в одиночном режиме)', canvas.width / 2, canvas.height / 2 + 26);
        }
    }
    const loop = setInterval(() => { tick(); draw(); }, 1000 / 60);
    return { stop() { clearInterval(loop); } };
}