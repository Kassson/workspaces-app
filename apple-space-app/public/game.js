/* ===================== ИГРОВОЙ ЦЕНТР ===================== */

window.GAMES_META = {
    '2048': { name: '2048 (Apple Edition)', icon: '🔢' },
    'snake-arena': { name: 'Snake Arena IO', icon: '🐍' },
    'cyber-runner': { name: 'Cyber Runner', icon: '🏃' },
    'battle-tanks': { name: 'Battle Tanks 2D', icon: '🎯' },
    'brawl-royale': { name: 'Brawl Battle Royale', icon: '🥊' },
    'cyber-arena': { name: 'Cyber Arena', icon: '⚔️' },
};

window.activeGame = null;
window.gameKeys = {};

window.addEventListener('keydown', function (e) {
    if (e && e.key) window.gameKeys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', function (e) {
    if (e && e.key) window.gameKeys[e.key.toLowerCase()] = false;
});

function stopActiveGame() {
    if (window.activeGame && typeof window.activeGame.stop === 'function') {
        try { window.activeGame.stop(); } catch (e) { }
    }
    window.activeGame = null;
    window.gameKeys = {};
}

function renderGamesMenu(container) {
    if (!container) return;
    try {
        var html = '<div class="games-grid">';
        for (var id in window.GAMES_META) {
            var g = window.GAMES_META[id];
            html += '<div class="game-tile" onclick="openGame(\'' + id + '\')">' +
                '<div class="g-icon">' + g.icon + '</div>' +
                '<div class="g-name">' + g.name + '</div>' +
                '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p class="empty-state">Ошибка загрузки игр: ' + e.message + '</p>';
    }
}

function openGame(gameId) {
    var meta = window.GAMES_META[gameId];
    if (!meta) return;
    var container = document.getElementById('tab-games');
    if (!container) return;

    container.innerHTML = '' +
        '<button class="btn-small" onclick="closeGame()">← Назад к играм</button>' +
        '<div class="game-view" style="margin-top:14px;">' +
        '<div class="game-hud">' +
        '<span>' + meta.icon + ' ' + meta.name + '</span>' +
        '<span>Счёт: <b id="gameScoreDisplay">0</b></span>' +
        '</div>' +
        '<canvas id="gameCanvas" width="480" height="480"></canvas>' +
        '<div class="game-controls-touch">' +
        '<div class="dpad">' +
        '<span></span><button id="dp-up">▲</button><span></span>' +
        '<button id="dp-left">◀</button><span id="dp-fire">●</span><button id="dp-right">▶</button>' +
        '<span></span><button id="dp-down">▼</button><span></span>' +
        '</div>' +
        '</div>' +
        '<div class="leaderboard-list" id="gameLeaderboard">Загрузка таблицы лидеров…</div>' +
        '</div>';

    try { wireDpad(); } catch (e) { }
    try { loadLeaderboard(gameId); } catch (e) { }
    try { startGameEngine(gameId); } catch (e) {
        var canvas = document.getElementById('gameCanvas');
        if (canvas) {
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Ошибка запуска: ' + e.message, canvas.width / 2, canvas.height / 2);
        }
    }
}

function closeGame() {
    stopActiveGame();
    renderGamesMenu(document.getElementById('tab-games'));
}

function wireDpad() {
    var map = { 'dp-up': 'arrowup', 'dp-down': 'arrowdown', 'dp-left': 'arrowleft', 'dp-right': 'arrowright', 'dp-fire': ' ' };
    Object.keys(map).forEach(function (btnId) {
        var el = document.getElementById(btnId);
        if (!el) return;
        var key = map[btnId];
        var on = function (e) { e.preventDefault(); window.gameKeys[key] = true; };
        var off = function (e) { e.preventDefault(); window.gameKeys[key] = false; };
        el.addEventListener('touchstart', on);
        el.addEventListener('touchend', off);
        el.addEventListener('mousedown', on);
        el.addEventListener('mouseup', off);
        el.addEventListener('mouseleave', off);
    });
}

async function loadLeaderboard(gameId) {
    var box = document.getElementById('gameLeaderboard');
    if (!box) return;
    if (!window.currentSpace) { box.innerHTML = 'Выберите группу, чтобы сохранять рекорды.'; return; }
    try {
        var rows = await apiGet('/api/games/' + window.currentSpace.id + '/' + gameId + '/leaderboard');
        box.innerHTML = '<b>🏆 Таблица лидеров</b>' + (rows.length
            ? rows.map(function (r) { return '<div><span>' + r.full_name + '</span><span>' + r.score + '</span></div>'; }).join('')
            : '<div>Пока нет рекордов — станьте первым!</div>');
    } catch (e) { box.innerHTML = 'Не удалось загрузить таблицу лидеров.'; }
}

async function submitScore(gameId, score) {
    var el = document.getElementById('gameScoreDisplay');
    if (el) el.textContent = score;
    if (!window.currentSpace) return;
    try { await apiPost('/api/games/' + window.currentSpace.id + '/' + gameId + '/score', { score: score }); }
    catch (e) { }
}

function setScore(score) {
    var el = document.getElementById('gameScoreDisplay');
    if (el) el.textContent = score;
}

function startGameEngine(gameId) {
    stopActiveGame();
    var canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (gameId === '2048') window.activeGame = run2048(canvas, ctx, gameId);
    else if (gameId === 'snake-arena') window.activeGame = runSnake(canvas, ctx, gameId);
    else if (gameId === 'cyber-runner') window.activeGame = runRunner(canvas, ctx, gameId);
    else window.activeGame = runArenaSurvival(canvas, ctx, gameId);
}

/* ================= 2048 ================= */
function run2048(canvas, ctx, gameId) {
    var SIZE = 4, CELL = canvas.width / SIZE;
    var grid = [];
    for (var r = 0; r < SIZE; r++) { grid.push([]); for (var c = 0; c < SIZE; c++) grid[r].push(0); }
    var score = 0, over = false;

    function addRandom() {
        var empty = [];
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!grid[r][c]) empty.push([r, c]);
        if (!empty.length) return;
        var p = empty[Math.floor(Math.random() * empty.length)];
        grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }
    function slideRow(row) {
        var arr = row.filter(function (v) { return v; });
        for (var i = 0; i < arr.length - 1; i++) {
            if (arr[i] === arr[i + 1]) { arr[i] *= 2; score += arr[i]; arr.splice(i + 1, 1); }
        }
        while (arr.length < SIZE) arr.push(0);
        return arr;
    }
    function rotate(g) {
        var n = [];
        for (var r = 0; r < g.length; r++) { n.push([]); for (var c = 0; c < g.length; c++) n[r].push(g[g.length - 1 - c][r]); }
        return n;
    }
    function move(dir) {
        var moved = false;
        var times = dir === 'up' ? 1 : dir === 'right' ? 2 : dir === 'down' ? 3 : 0;
        for (var k = 0; k < times; k++) grid = rotate(grid);
        for (var r = 0; r < SIZE; r++) {
            var before = grid[r].join(',');
            grid[r] = slideRow(grid[r]);
            if (grid[r].join(',') !== before) moved = true;
        }
        var back = dir === 'up' ? 3 : dir === 'right' ? 2 : dir === 'down' ? 1 : 0;
        for (var k2 = 0; k2 < back; k2++) grid = rotate(grid);
        if (moved) { addRandom(); setScore(score); }
        if (isGameOver()) { over = true; submitScore(gameId, score); }
    }
    function isGameOver() {
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
            if (!grid[r][c]) return false;
            if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return false;
            if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return false;
        }
        return true;
    }
    var colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
    function draw() {
        ctx.fillStyle = '#bbada0'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
            var v = grid[r][c];
            ctx.fillStyle = v ? (colors[v] || '#3c3a32') : 'rgba(238,228,218,0.35)';
            ctx.fillRect(c * CELL + 6, r * CELL + 6, CELL - 12, CELL - 12);
            if (v) {
                ctx.fillStyle = v <= 4 ? '#776e65' : '#f9f6f2';
                ctx.font = 'bold 32px sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(v, c * CELL + CELL / 2, r * CELL + CELL / 2);
            }
        }
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    var lastKeys = {};
    var loop = setInterval(function () {
        if (over) { draw(); return; }
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].forEach(function (k) {
            if (window.gameKeys[k] && !lastKeys[k]) move(k.replace('arrow', ''));
            lastKeys[k] = window.gameKeys[k];
        });
        draw();
    }, 80);
    addRandom(); addRandom(); draw();
    return { stop: function () { clearInterval(loop); } };
}

/* ================= SNAKE ================= */
function runSnake(canvas, ctx, gameId) {
    var CELL = 20, COLS = canvas.width / CELL, ROWS = canvas.height / CELL;
    var snake = [{ x: 10, y: 10 }];
    var dir = { x: 1, y: 0 }, nextDir = dir;
    var food = spawnFood();
    var score = 0, over = false;
    function spawnFood() { return { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }
    function tick() {
        if (over) return;
        if (window.gameKeys['arrowup'] && dir.y === 0) nextDir = { x: 0, y: -1 };
        if (window.gameKeys['arrowdown'] && dir.y === 0) nextDir = { x: 0, y: 1 };
        if (window.gameKeys['arrowleft'] && dir.x === 0) nextDir = { x: -1, y: 0 };
        if (window.gameKeys['arrowright'] && dir.x === 0) nextDir = { x: 1, y: 0 };
        dir = nextDir;
        var head = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
        for (var i = 0; i < snake.length; i++) {
            if (snake[i].x === head.x && snake[i].y === head.y) { over = true; submitScore(gameId, score); return; }
        }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) { score += 10; setScore(score); food = spawnFood(); }
        else snake.pop();
    }
    function draw() {
        ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff453a'; ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 2, CELL - 2);
        for (var i = 0; i < snake.length; i++) {
            ctx.fillStyle = i === 0 ? '#30d158' : '#0a84ff';
            ctx.fillRect(snake[i].x * CELL, snake[i].y * CELL, CELL - 2, CELL - 2);
        }
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    var loop = setInterval(function () { tick(); draw(); }, 110);
    return { stop: function () { clearInterval(loop); } };
}

/* ================= CYBER RUNNER ================= */
function runRunner(canvas, ctx, gameId) {
    var player = { x: 60, y: canvas.height - 60, w: 30, h: 30, vy: 0, onGround: true };
    var obstacles = [], speed = 5, frame = 0, score = 0, over = false;
    var GROUND = canvas.height - 30;
    function tick() {
        if (over) return;
        frame++;
        if ((window.gameKeys[' '] || window.gameKeys['arrowup'] || window.gameKeys['w']) && player.onGround) {
            player.vy = -13; player.onGround = false;
        }
        player.vy += 0.6; player.y += player.vy;
        if (player.y >= GROUND - player.h) { player.y = GROUND - player.h; player.vy = 0; player.onGround = true; }
        if (frame % 60 === 0) obstacles.push({ x: canvas.width, w: 24, h: 30 + Math.random() * 30 });
        for (var i = 0; i < obstacles.length; i++) obstacles[i].x -= speed;
        obstacles = obstacles.filter(function (o) { return o.x > -30; });
        speed += 0.002;
        score = Math.floor(frame / 5); setScore(score);
        for (var j = 0; j < obstacles.length; j++) {
            var o = obstacles[j];
            if (player.x < o.x + o.w && player.x + player.w > o.x && player.y + player.h > GROUND - o.h) {
                over = true; submitScore(gameId, score);
            }
        }
    }
    function draw() {
        ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#333'; ctx.fillRect(0, GROUND, canvas.width, 4);
        ctx.fillStyle = '#0a84ff'; ctx.fillRect(player.x, player.y, player.w, player.h);
        ctx.fillStyle = '#ff453a';
        for (var i = 0; i < obstacles.length; i++) ctx.fillRect(obstacles[i].x, GROUND - obstacles[i].h, obstacles[i].w, obstacles[i].h);
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }
    var loop = setInterval(function () { tick(); draw(); }, 1000 / 60);
    return { stop: function () { clearInterval(loop); } };
}

/* ================= АРЕНА ================= */
function runArenaSurvival(canvas, ctx, gameId) {
    var themes = {
        'battle-tanks': { bg: '#1a1f16', player: '#30d158', bot: '#ff453a', label: 'Уничтожай вражеские танки!' },
        'brawl-royale': { bg: '#1a1620', player: '#ffd60a', bot: '#ff453a', label: 'Выживи дольше всех в зоне!' },
        'cyber-arena': { bg: '#10141f', player: '#0a84ff', bot: '#bf5af2', label: 'Уклоняйся и атакуй ботов!' },
    };
    var theme = themes[gameId] || themes['cyber-arena'];
    var player = { x: canvas.width / 2, y: canvas.height / 2, r: 14 };
    var bullets = [], botBullets = [];
    var bots = [];
    for (var i = 0; i < 4; i++) {
        bots.push({
            x: 40 + (i % 2) * (canvas.width - 80),
            y: 40 + Math.floor(i / 2) * (canvas.height - 80),
            r: 14, hp: 3, cd: Math.random() * 60
        });
    }
    var frame = 0, score = 0, over = false, zoneR = Math.max(canvas.width, canvas.height);

    function tick() {
        if (over) return;
        frame++;
        var speed = 3.2;
        if (window.gameKeys['arrowup'] || window.gameKeys['w']) player.y -= speed;
        if (window.gameKeys['arrowdown'] || window.gameKeys['s']) player.y += speed;
        if (window.gameKeys['arrowleft'] || window.gameKeys['a']) player.x -= speed;
        if (window.gameKeys['arrowright'] || window.gameKeys['d']) player.x += speed;
        player.x = Math.max(player.r, Math.min(canvas.width - player.r, player.x));
        player.y = Math.max(player.r, Math.min(canvas.height - player.r, player.y));

        if (gameId === 'brawl-royale') { zoneR -= 0.15; if (zoneR < 40) zoneR = 40; }
        var cx = canvas.width / 2, cy = canvas.height / 2;
        var distFromCenter = Math.sqrt(Math.pow(player.x - cx, 2) + Math.pow(player.y - cy, 2));
        if (gameId === 'brawl-royale' && distFromCenter > zoneR) score -= 0.1;

        var alive = bots.filter(function (b) { return b.hp > 0; });
        var nearest = alive.sort(function (a, b) {
            return Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y);
        })[0];
        var wantsFire = window.gameKeys[' '];
        if ((wantsFire && frame % 10 === 0) || frame % 45 === 0) {
            if (nearest) {
                var ang = Math.atan2(nearest.y - player.y, nearest.x - player.x);
                bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * 7, vy: Math.sin(ang) * 7 });
            }
        }
        for (var bi = 0; bi < bullets.length; bi++) { bullets[bi].x += bullets[bi].vx; bullets[bi].y += bullets[bi].vy; }
        bullets = bullets.filter(function (b) { return b.x > 0 && b.x < canvas.width && b.y > 0 && b.y < canvas.height; });

        for (var k = 0; k < bots.length; k++) {
            var bot = bots[k];
            if (bot.hp <= 0) continue;
            var bAng = Math.atan2(player.y - bot.y, player.x - bot.x);
            bot.x += Math.cos(bAng) * 1.1;
            bot.y += Math.sin(bAng) * 1.1;
            bot.cd--;
            if (bot.cd <= 0) {
                bot.cd = 70 + Math.random() * 40;
                botBullets.push({ x: bot.x, y: bot.y, vx: Math.cos(bAng) * 4.5, vy: Math.sin(bAng) * 4.5 });
            }
        }
        for (var bj = 0; bj < botBullets.length; bj++) { botBullets[bj].x += botBullets[bj].vx; botBullets[bj].y += botBullets[bj].vy; }
        botBullets = botBullets.filter(function (b) { return b.x > 0 && b.x < canvas.width && b.y > 0 && b.y < canvas.height; });

        for (var m = 0; m < bullets.length; m++) {
            for (var n = 0; n < bots.length; n++) {
                if (bots[n].hp > 0 && Math.hypot(bullets[m].x - bots[n].x, bullets[m].y - bots[n].y) < bots[n].r) {
                    bots[n].hp--;
                    bullets[m].hit = true;
                    if (bots[n].hp <= 0) score += 100;
                }
            }
        }
        bullets = bullets.filter(function (b) { return !b.hit; });

        for (var q = 0; q < botBullets.length; q++) {
            if (Math.hypot(botBullets[q].x - player.x, botBullets[q].y - player.y) < player.r) {
                over = true; submitScore(gameId, Math.floor(score));
            }
        }
        var allDead = true;
        for (var z = 0; z < bots.length; z++) if (bots[z].hp > 0) { allDead = false; break; }
        if (allDead) {
            for (var w = 0; w < bots.length; w++) {
                bots[w].hp = 3;
                bots[w].x = Math.random() * canvas.width;
                bots[w].y = Math.random() * canvas.height;
            }
        }
        score += 0.15;
        setScore(Math.floor(score));
    }
    function draw() {
        ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (gameId === 'brawl-royale') {
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, zoneR, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = theme.bot;
        for (var i = 0; i < bots.length; i++) {
            if (bots[i].hp > 0) {
                ctx.globalAlpha = 0.4 + bots[i].hp * 0.2;
                ctx.beginPath(); ctx.arc(bots[i].x, bots[i].y, bots[i].r, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
        ctx.fillStyle = '#fff';
        for (var j = 0; j < bullets.length; j++) { ctx.beginPath(); ctx.arc(bullets[j].x, bullets[j].y, 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = theme.bot;
        for (var k = 0; k < botBullets.length; k++) { ctx.beginPath(); ctx.arc(botBullets[k].x, botBullets[k].y, 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = theme.player;
        ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(theme.label, canvas.width / 2, 16);
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif';
            ctx.fillText('Вы выбыли 👻', canvas.width / 2, canvas.height / 2);
        }
    }
    var loop = setInterval(function () { tick(); draw(); }, 1000 / 60);
    return { stop: function () { clearInterval(loop); } };
}
