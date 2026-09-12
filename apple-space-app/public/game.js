/* ===================== ИГРОВОЙ ЦЕНТР v3 ===================== */
/* Все игры с красивой графикой, эффектами и полноценным управлением */

window.GAMES_META = {
    '2048':          { name: '2048',          icon: '🔢', type: 'solo', desc: 'Собери плитку 2048' },
    'snake-arena':   { name: 'Snake Arena',   icon: '🐍', type: 'solo', desc: 'Съешь яблоки, расти' },
    'cyber-runner':  { name: 'Cyber Runner',  icon: '🏃', type: 'solo', desc: 'Беги и прыгай' },
    'battle-tanks':  { name: 'Battle Tanks',  icon: '🎯', type: 'multi', minPlayers: 4, maxPlayers: 4, desc: 'Королевская битва танков' },
    'brawl-royale':  { name: 'Brawl Royale',  icon: '🥊', type: 'multi', minPlayers: 4, maxPlayers: 10, desc: '10 бойцов, выживи один' },
    'cyber-arena':   { name: 'Cyber Arena',   icon: '🚀', type: 'multi', minPlayers: 4, maxPlayers: 6, desc: 'Командные бои 3х3' },
};

window.activeGame = null;
window.gameKeys = {};
window.gameRoom = null;
window.mpInput = {
    joy1: { dx: 0, dy: 0 },
    joy2: { dx: 0, dy: 0, power: 0 }
};
window.mpParticles = [];

window.addEventListener('keydown', function (e) {
    if (e && e.key) window.gameKeys[e.key.toLowerCase()] = true;
    if (e && (e.key === ' ' || (e.key && e.key.indexOf('Arrow') === 0))) e.preventDefault();
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
    window.mpParticles = [];
}

/* ===================== КРАСИВОЕ МЕНЮ ===================== */
function renderGamesMenu(container) {
    if (!container) container = document.getElementById('tab-games');
    if (!container) return;
    var html = '';
    html += '<div class="games-section-title">🎮 Одиночные игры</div>';
    html += '<div class="games-grid">';
    for (var id in window.GAMES_META) {
        var g = window.GAMES_META[id];
        if (g.type !== 'solo') continue;
        html += renderGameTile(id, g);
    }
    html += '</div>';
    html += '<div class="games-section-title" style="margin-top:24px;">👥 Мультиплеер</div>';
    html += '<div class="games-grid">';
    for (var id2 in window.GAMES_META) {
        var g2 = window.GAMES_META[id2];
        if (g2.type !== 'multi') continue;
        html += renderGameTile(id2, g2);
    }
    html += '</div>';
    container.innerHTML = html;
}

function renderGameTile(id, g) {
    var badge = g.type === 'multi' ? '<div class="g-badge">' + g.minPlayers + (g.maxPlayers > g.minPlayers ? '-' + g.maxPlayers : '') + ' игроков</div>' : '';
    return '<div class="game-tile" onclick="openGame(\'' + id + '\')">' +
        '<div class="g-glow"></div>' +
        '<div class="g-icon">' + g.icon + '</div>' +
        '<div class="g-name">' + g.name + '</div>' +
        '<div class="g-desc">' + g.desc + '</div>' +
        badge + '</div>';
}

function openGame(gameId) {
    var meta = window.GAMES_META[gameId];
    if (!meta) return;
    if (meta.type === 'multi') openMultiplayerLobby(gameId);
    else openSoloGame(gameId);
}

function closeGame() {
    stopActiveGame();
    if (window.gameRoom) leaveGameRoom();
    window.gameRoom = null;
    renderGamesMenu(document.getElementById('tab-games'));
}

/* ===================== ОДИНОЧНЫЕ ИГРЫ ===================== */
function openSoloGame(gameId) {
    var meta = window.GAMES_META[gameId];
    var c = document.getElementById('tab-games');
    c.innerHTML = '<button class="btn-small" onclick="closeGame()">← Назад</button>' +
        '<div class="game-view" style="margin-top:14px;">' +
        '<div class="game-hud"><span>' + meta.icon + ' ' + meta.name + '</span>' +
        '<span>Счёт: <b id="gameScoreDisplay">0</b></span></div>' +
        '<canvas id="gameCanvas" width="480" height="480" style="max-width:100%;border-radius:14px;touch-action:none;box-shadow:0 10px 40px rgba(0,0,0,0.4);display:block;margin:0 auto;"></canvas>' +
        '<div class="game-controls-touch" id="gameControls"></div>' +
        '<div class="leaderboard-tabs">' +
        '<button class="btn-small lb-tab active" data-scope="group" onclick="switchLeaderboard(\'' + gameId + '\', \'group\', this)">👥 Группа</button>' +
        '<button class="btn-small lb-tab" data-scope="global" onclick="switchLeaderboard(\'' + gameId + '\', \'global\', this)">🌍 Все</button>' +
        '</div>' +
        '<div class="leaderboard-list" id="gameLeaderboard">Загрузка…</div></div>';
    loadLeaderboard(gameId, 'group');
    startSoloEngine(gameId);
}

function switchLeaderboard(gameId, scope, btn) {
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadLeaderboard(gameId, scope);
}

async function loadLeaderboard(gameId, scope) {
    var box = document.getElementById('gameLeaderboard');
    if (!box) return;
    box.innerHTML = '<div style="opacity:0.6;">Загрузка…</div>';
    try {
        var url = scope === 'global' ? '/api/games-global/' + gameId + '/leaderboard'
            : '/api/games/' + (window.currentSpace ? window.currentSpace.id : 0) + '/' + gameId + '/leaderboard';
        var rows = await apiGet(url);
        if (!rows.length) { box.innerHTML = '<div style="opacity:0.6;">Пока нет рекордов — стань первым! 🚀</div>'; return; }
        box.innerHTML = '<b>🏆 Топ — ' + (scope === 'global' ? 'мир' : 'группа') + '</b>' + rows.map(function (r, i) {
            var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
            return '<div><span>' + medal + ' ' + r.full_name + '</span><span style="color:var(--accent-blue);font-weight:700;">' + r.score + '</span></div>';
        }).join('');
    } catch (e) { box.innerHTML = 'Ошибка загрузки.'; }
}

async function submitScore(gameId, score) {
    var el = document.getElementById('gameScoreDisplay');
    if (el) el.textContent = score;
    if (!window.currentSpace) return;
    try { await apiPost('/api/games/' + window.currentSpace.id + '/' + gameId + '/score', { score: score }); } catch (e) { }
}
function setScore(s) { var el = document.getElementById('gameScoreDisplay'); if (el) el.textContent = s; }

function startSoloEngine(gameId) {
    stopActiveGame();
    var canvas = document.getElementById('gameCanvas'); if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (gameId === '2048') window.activeGame = run2048(canvas, ctx, gameId);
    else if (gameId === 'snake-arena') window.activeGame = runSnake(canvas, ctx, gameId);
    else if (gameId === 'cyber-runner') window.activeGame = runRunner(canvas, ctx, gameId);
}

/* ===================== 2048 (со свайпами) ===================== */
function run2048(canvas, ctx, gameId) {
    var SIZE = 4, CELL = canvas.width / SIZE;
    var grid = [];
    for (var r = 0; r < SIZE; r++) { grid.push([]); for (var c = 0; c < SIZE; c++) grid[r].push(0); }
    var score = 0, over = false;
    var animScale = {};

    function addRandom() {
        var e = [];
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!grid[r][c]) e.push([r, c]);
        if (!e.length) return;
        var p = e[Math.floor(Math.random() * e.length)];
        grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
        animScale[p[0] + '_' + p[1]] = 1;
    }
    function slide(row) {
        var a = row.filter(v => v);
        for (var i = 0; i < a.length - 1; i++) if (a[i] === a[i + 1]) { a[i] *= 2; score += a[i]; a.splice(i + 1, 1); }
        while (a.length < SIZE) a.push(0);
        return a;
    }
    function rot(g) { var n = []; for (var r = 0; r < g.length; r++) { n.push([]); for (var c = 0; c < g.length; c++) n[r].push(g[g.length - 1 - c][r]); } return n; }
    function move(dir) {
        if (over) return;
        var times = dir === 'up' ? 3 : dir === 'right' ? 2 : dir === 'down' ? 1 : 0;
        var back = (4 - times) % 4, moved = false;
        for (var k = 0; k < times; k++) grid = rot(grid);
        for (var r = 0; r < SIZE; r++) { var b = grid[r].join(','); grid[r] = slide(grid[r]); if (grid[r].join(',') !== b) moved = true; }
        for (var k2 = 0; k2 < back; k2++) grid = rot(grid);
        if (moved) { addRandom(); setScore(score); }
        if (isOver()) { over = true; submitScore(gameId, score); }
    }
    function isOver() {
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
            if (!grid[r][c]) return false;
            if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return false;
            if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return false;
        }
        return true;
    }
    var colors = {
        2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'],
        8: ['#f2b179', '#fff'], 16: ['#f59563', '#fff'], 32: ['#f67c5f', '#fff'], 64: ['#f65e3b', '#fff'],
        128: ['#edcf72', '#fff'], 256: ['#edcc61', '#fff'], 512: ['#edc850', '#fff'], 1024: ['#edc53f', '#fff'], 2048: ['#edc22e', '#fff']
    };
    function draw() {
        // фон с текстурой
        var bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        bg.addColorStop(0, '#bbada0'); bg.addColorStop(1, '#a89a8c');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        // тени клеток
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
            ctx.fillStyle = 'rgba(238,228,218,0.35)';
            ctx.fillRect(c * CELL + 6, r * CELL + 6, CELL - 12, CELL - 12);
            var v = grid[r][c];
            if (v) {
                var kk = r + '_' + c;
                var s = animScale[kk] || 0;
                var shrink = s > 0 ? (CELL - 12) * (1 - s * 0.15) : (CELL - 12);
                var off = (CELL - 12 - shrink) / 2;
                animScale[kk] = Math.max(0, s - 0.06);
                var col = colors[v] || ['#3c3a32', '#fff'];
                ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
                ctx.fillStyle = col[0];
                ctx.fillRect(c * CELL + 6 + off, r * CELL + 6 + off, shrink, shrink);
                ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
                ctx.fillStyle = col[1];
                ctx.font = 'bold ' + (v > 999 ? 24 : v > 99 ? 28 : 32) + 'px -apple-system,sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(v, c * CELL + CELL / 2, r * CELL + CELL / 2);
            }
        }
        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Игра окончена', canvas.width / 2, canvas.height / 2 - 10);
            ctx.font = '18px sans-serif';
            ctx.fillText('Счёт: ' + score, canvas.width / 2, canvas.height / 2 + 30);
        }
    }
    var lastKeys = {};
    function checkKeys() {
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].forEach(function (k) {
            if (window.gameKeys[k] && !lastKeys[k]) {
                var d = k === 'w' ? 'up' : k === 'a' ? 'left' : k === 's' ? 'down' : k === 'd' ? 'right' : k.replace('arrow', '');
                move(d);
            }
            lastKeys[k] = window.gameKeys[k];
        });
    }
    var tS = null;
    function tStart(e) { tS = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
    function tEnd(e) {
        if (!tS) return;
        var dx = e.changedTouches[0].clientX - tS.x, dy = e.changedTouches[0].clientY - tS.y;
        if (Math.abs(dx) < 30 && Math.abs(dy) < 30) { tS = null; return; }
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
        else move(dy > 0 ? 'down' : 'up');
        tS = null;
    }
    canvas.addEventListener('touchstart', tStart, { passive: true });
    canvas.addEventListener('touchend', tEnd, { passive: true });
    var loop = setInterval(function () { if (!over) checkKeys(); draw(); }, 60);
    addRandom(); addRandom(); draw();
    return { stop: function () { clearInterval(loop); canvas.removeEventListener('touchstart', tStart); canvas.removeEventListener('touchend', tEnd); } };
}

/* ===================== SNAKE ===================== */
function runSnake(canvas, ctx, gameId) {
    var CELL = 24, COLS = canvas.width / CELL, ROWS = canvas.height / CELL;
    var snake = [{ x: 10, y: 10 }];
    var dir = { x: 1, y: 0 }, nextDir = dir;
    var food = spawn();
    var score = 0, over = false, tickCount = 0;

    function spawn() { return { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }

    function tick() {
        if (over) return;
        tickCount++;
        if (window.gameKeys['arrowup'] && dir.y === 0) nextDir = { x: 0, y: -1 };
        if (window.gameKeys['arrowdown'] && dir.y === 0) nextDir = { x: 0, y: 1 };
        if (window.gameKeys['arrowleft'] && dir.x === 0) nextDir = { x: -1, y: 0 };
        if (window.gameKeys['arrowright'] && dir.x === 0) nextDir = { x: 1, y: 0 };
        dir = nextDir;
        var h = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
        for (var i = 0; i < snake.length; i++) if (snake[i].x === h.x && snake[i].y === h.y) { over = true; submitScore(gameId, score); return; }
        snake.unshift(h);
        if (h.x === food.x && h.y === food.y) { score += 10; setScore(score); food = spawn(); } else snake.pop();
    }

    function draw() {
        // фон
        var bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        bg.addColorStop(0, '#0d1117'); bg.addColorStop(1, '#161b22');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        // сетка
        ctx.strokeStyle = 'rgba(48,209,88,0.06)'; ctx.lineWidth = 1;
        for (var i = 0; i <= COLS; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height); ctx.stroke(); }
        for (var j = 0; j <= ROWS; j++) { ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(canvas.width, j * CELL); ctx.stroke(); }

        // еда — пульсирующее яблоко
        var pulse = 1 + Math.sin(tickCount * 0.3) * 0.15;
        ctx.fillStyle = '#ff3040'; ctx.shadowColor = '#ff3040'; ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, (CELL / 2 - 2) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // блик
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(food.x * CELL + CELL / 2 - 3, food.y * CELL + CELL / 2 - 3, 3, 0, Math.PI * 2);
        ctx.fill();

        // змея с градиентом
        for (var k = snake.length - 1; k >= 0; k--) {
            var s = snake[k];
            var ratio = k / Math.max(1, snake.length - 1);
            var r = Math.floor(48 + ratio * 30);
            var g = Math.floor(209 - ratio * 100);
            var b = Math.floor(88 + ratio * 40);
            ctx.fillStyle = k === 0 ? '#30ff80' : ('rgb(' + r + ',' + g + ',' + b + ')');
            if (k === 0) { ctx.shadowColor = '#30ff80'; ctx.shadowBlur = 15; }
            ctx.beginPath();
            var rad = k === 0 ? 10 : 8;
            var x = s.x * CELL + CELL / 2, y = s.y * CELL + CELL / 2;
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            // глаза у головы
            if (k === 0) {
                ctx.fillStyle = '#000';
                ctx.beginPath();
                var ex = dir.x !== 0 ? 4 : 0;
                var ey = dir.y !== 0 ? 4 : 0;
                var px = dir.x !== 0 ? 0 : 3;
                var py = dir.y !== 0 ? 0 : 3;
                ctx.arc(x + ex + px, y + ey - py, 2, 0, Math.PI * 2);
                ctx.arc(x + ex - px, y + ey + py, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (over) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('💀 Игра окончена', canvas.width / 2, canvas.height / 2);
        }
    }

    // Большой d-pad
    var c = document.getElementById('gameControls');
    if (c) {
        c.innerHTML = '<div class="dpad big"><span></span><button id="dp-up">▲</button><span></span><button id="dp-left">◀</button><span id="dp-fire"></span><button id="dp-right">▶</button><span></span><button id="dp-down">▼</button><span></span></div>';
        wireDpad();
    }

    // свайпы
    var tS = null;
    function tStart(e) { tS = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
    function tEnd(e) {
        if (!tS) return;
        var dx = e.changedTouches[0].clientX - tS.x, dy = e.changedTouches[0].clientY - tS.y;
        if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { tS = null; return; }
        if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0 && dir.x === 0) nextDir = { x: 1, y: 0 }; else if (dx < 0 && dir.x === 0) nextDir = { x: -1, y: 0 }; }
        else { if (dy > 0 && dir.y === 0) nextDir = { x: 0, y: 1 }; else if (dy < 0 && dir.y === 0) nextDir = { x: 0, y: -1 }; }
        tS = null;
    }
    canvas.addEventListener('touchstart', tStart, { passive: true });
    canvas.addEventListener('touchend', tEnd, { passive: true });
    var loop = setInterval(function () { tick(); draw(); }, 110);
    return { stop: function () { clearInterval(loop); canvas.removeEventListener('touchstart', tStart); canvas.removeEventListener('touchend', tEnd); } };
}

/* ===================== CYBER RUNNER (Dino-style) ===================== */
function runRunner(canvas, ctx, gameId) {
    var W = canvas.width, H = canvas.height, GROUND = H - 70;
    var player = { x: 60, y: GROUND - 46, w: 46, h: 46, vy: 0, onGround: true };
    var obstacles = [], clouds = [], particles = [];
    var frame = 0, score = 0, over = false, speed = 6, legFrame = 0;
    var hiScore = parseInt(localStorage.getItem('runner_hi') || '0');

    for (var i = 0; i < 6; i++) clouds.push({ x: Math.random() * W, y: 20 + Math.random() * 120, speed: 0.3 + Math.random() * 0.4, scale: 0.5 + Math.random() });

    function spawnObs() {
        var isBird = score > 250 && Math.random() < 0.3;
        if (isBird) obstacles.push({ type: 'bird', x: W + 20, y: GROUND - 90 - Math.random() * 40, w: 44, h: 32 });
        else {
            var n = Math.random() < 0.6 ? 1 : Math.random() < 0.5 ? 2 : 3;
            for (var i = 0; i < n; i++) obstacles.push({ type: 'cactus', x: W + 20 + i * 28, y: GROUND - 44, w: 24, h: 44 + (i === 0 ? 8 : 0) });
        }
    }
    function jump() {
        if (player.onGround) {
            player.vy = -13; player.onGround = false;
            // частицы пыли
            for (var i = 0; i < 8; i++) {
                particles.push({ x: player.x + 22, y: GROUND, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, life: 30, color: 'rgba(150,150,150,0.8)' });
            }
        }
    }
    function tick() {
        if (over) return;
        frame++;
        if (frame % 2 === 0) legFrame = (legFrame + 1) % 2;
        if ((window.gameKeys[' '] || window.gameKeys['arrowup'] || window.gameKeys['w']) && player.onGround) jump();
        player.vy += 0.7; player.y += player.vy;
        if (player.y >= GROUND - player.h) { player.y = GROUND - player.h; player.vy = 0; player.onGround = true; }
        speed += 0.001;
        if (frame % Math.max(40, Math.floor(80 - score / 50)) === 0) spawnObs();
        for (var i = obstacles.length - 1; i >= 0; i--) {
            var o = obstacles[i]; o.x -= speed;
            if (o.x + o.w < 0) { obstacles.splice(i, 1); score += 5; setScore(Math.floor(score)); continue; }
            if (player.x + 10 < o.x + o.w - 4 && player.x + player.w - 10 > o.x + 4 && player.y + 10 < o.y + o.h && player.y + player.h - 4 > o.y) {
                over = true; submitScore(gameId, Math.floor(score));
                if (Math.floor(score) > hiScore) { hiScore = Math.floor(score); localStorage.setItem('runner_hi', hiScore); }
            }
        }
        for (var c2 = 0; c2 < clouds.length; c2++) {
            clouds[c2].x -= clouds[c2].speed;
            if (clouds[c2].x < -100) { clouds[c2].x = W + 50; clouds[c2].y = 20 + Math.random() * 120; }
        }
        for (var p = particles.length - 1; p >= 0; p--) {
            var pt = particles[p];
            pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.15; pt.life--;
            if (pt.life <= 0) particles.splice(p, 1);
        }
        score += 0.15; setScore(Math.floor(score));
    }

    function drawDino(x, y, w, h, isJ) {
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.ellipse(x + w / 2, GROUND + 3, w / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
        // тело
        var g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, '#6b6b6b'); g.addColorStop(1, '#4a4a4a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x + 4, y + 4, w - 12, h - 12, 6);
        ctx.fill();
        // голова
        ctx.fillStyle = '#535353';
        ctx.beginPath(); ctx.roundRect(x + w - 22, y, 20, 20, 4); ctx.fill();
        // глаз
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + w - 8, y + 8, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x + w - 7, y + 8, 1.5, 0, Math.PI * 2); ctx.fill();
        // хвост
        ctx.fillStyle = '#535353';
        ctx.beginPath(); ctx.moveTo(x - 2, y + 10); ctx.lineTo(x - 8, y + 6); ctx.lineTo(x - 8, y + h - 10); ctx.lineTo(x - 2, y + h - 6); ctx.closePath(); ctx.fill();
        // ноги
        ctx.fillStyle = '#4a4a4a';
        if (isJ) {
            ctx.fillRect(x + 8, y + h - 6, 8, 8);
            ctx.fillRect(x + w - 20, y + h - 6, 8, 8);
        } else {
            if (legFrame === 0) { ctx.fillRect(x + 8, y + h - 6, 8, 10); ctx.fillRect(x + w - 20, y + h - 6, 8, 6); }
            else { ctx.fillRect(x + 8, y + h - 6, 8, 6); ctx.fillRect(x + w - 20, y + h - 6, 8, 10); }
        }
        // рука
        ctx.fillRect(x + w - 14, y + 16, 10, 5);
    }
    function drawCactus(o) {
        var g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
        g.addColorStop(0, '#4caf50'); g.addColorStop(1, '#1b5e20');
        ctx.fillStyle = g;
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, GROUND + 3, o.w / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
        // тело
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.roundRect(o.x + o.w / 2 - 5, o.y, 10, o.h, 4); ctx.fill();
        // левая ветка
        ctx.beginPath(); ctx.roundRect(o.x, o.y + o.h * 0.3, 7, o.h * 0.35, 3); ctx.fill();
        ctx.beginPath(); ctx.roundRect(o.x, o.y + o.h * 0.3, 12, 6, 3); ctx.fill();
        // правая ветка
        ctx.beginPath(); ctx.roundRect(o.x + o.w - 7, o.y + o.h * 0.2, 7, o.h * 0.3, 3); ctx.fill();
        ctx.beginPath(); ctx.roundRect(o.x + o.w - 12, o.y + o.h * 0.2, 12, 6, 3); ctx.fill();
    }
    function drawBird(o) {
        var wingUp = Math.sin(frame / 6) > 0;
        var g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
        g.addColorStop(0, '#444'); g.addColorStop(1, '#222');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y + o.h / 2);
        ctx.lineTo(o.x + o.w / 2, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h / 2);
        ctx.lineTo(o.x + o.w / 2, o.y + o.h);
        ctx.closePath(); ctx.fill();
        // крыло
        ctx.fillStyle = '#666';
        if (wingUp) ctx.fillRect(o.x + o.w / 2 - 5, o.y - 8, 10, 8);
        else ctx.fillRect(o.x + o.w / 2 - 5, o.y + o.h, 10, 8);
        // глаз
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(o.x + o.w - 8, o.y + o.h / 2, 2, 0, Math.PI * 2); ctx.fill();
    }
    function draw() {
        // небо с градиентом
        var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
        sky.addColorStop(0, '#f7f9fc'); sky.addColorStop(1, '#ffffff');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        // солнце
        ctx.fillStyle = 'rgba(255,220,100,0.5)';
        ctx.beginPath(); ctx.arc(W - 60, 60, 35, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,100,0.3)';
        ctx.beginPath(); ctx.arc(W - 60, 60, 45, 0, Math.PI * 2); ctx.fill();
        // облака
        ctx.fillStyle = 'rgba(220,220,230,0.8)';
        for (var c = 0; c < clouds.length; c++) {
            var cl = clouds[c];
            ctx.beginPath();
            ctx.arc(cl.x, cl.y, 16 * cl.scale, 0, Math.PI * 2);
            ctx.arc(cl.x + 18 * cl.scale, cl.y, 12 * cl.scale, 0, Math.PI * 2);
            ctx.arc(cl.x - 16 * cl.scale, cl.y, 12 * cl.scale, 0, Math.PI * 2);
            ctx.fill();
        }
        // земля с текстурой
        ctx.fillStyle = '#535353'; ctx.fillRect(0, GROUND, W, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0, GROUND + 3, W, H - GROUND - 3);
        // точки на земле
        ctx.fillStyle = '#999';
        for (var i = 0; i < 40; i++) { var px = ((i * 67 + frame * speed) % (W + 60)) - 30; ctx.fillRect(W - px, GROUND + 10, 3, 3); }
        // препятствия
        for (var o = 0; o < obstacles.length; o++) { if (obstacles[o].type === 'bird') drawBird(obstacles[o]); else drawCactus(obstacles[o]); }
        // частицы
        for (var p = 0; p < particles.length; p++) {
            var pt = particles[p];
            ctx.fillStyle = pt.color;
            ctx.globalAlpha = pt.life / 30;
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
        }
        // игрок
        drawDino(player.x, player.y, player.w, player.h, !player.onGround);
        // счёт
        ctx.fillStyle = '#535353'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'right';
        ctx.fillText('HI ' + hiScore.toString().padStart(5, '0'), W - 90, 30);
        ctx.fillText(Math.floor(score).toString().padStart(5, '0'), W - 20, 30);
        if (over) {
            ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#333'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('G A M E   O V E R', W / 2, H / 2 - 10);
            ctx.font = '16px sans-serif';
            ctx.fillStyle = '#666';
            ctx.fillText('Нажмите, чтобы начать заново', W / 2, H / 2 + 30);
            ctx.font = 'bold 20px monospace';
            ctx.fillStyle = '#535353';
            ctx.fillText('HI ' + hiScore + '   ' + Math.floor(score), W / 2, H / 2 + 60);
        }
    }
    function onTap() {
        if (over) {
            obstacles = []; particles = []; score = 0; over = false; frame = 0; speed = 6;
            player.y = GROUND - player.h; player.vy = 0; player.onGround = true;
            setScore(0);
        } else jump();
    }
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
    canvas.addEventListener('mousedown', onTap);
    var loop = setInterval(function () { tick(); draw(); }, 1000 / 60);
    return { stop: function () { clearInterval(loop); canvas.removeEventListener('mousedown', onTap); } };
}

/* ===================== D-PAD ===================== */
function wireDpad() {
    var map = { 'dp-up': 'arrowup', 'dp-down': 'arrowdown', 'dp-left': 'arrowleft', 'dp-right': 'arrowright', 'dp-fire': ' ' };
    Object.keys(map).forEach(function (id) {
        var el = document.getElementById(id); if (!el) return;
        var k = map[id];
        var on = function (e) { e.preventDefault(); window.gameKeys[k] = true; };
        var off = function (e) { e.preventDefault(); window.gameKeys[k] = false; };
        el.addEventListener('touchstart', on, { passive: false });
        el.addEventListener('touchend', off, { passive: false });
        el.addEventListener('mousedown', on);
        el.addEventListener('mouseup', off);
        el.addEventListener('mouseleave', off);
    });
}

/* ===================== ЛОББИ МУЛЬТИПЛЕЕРА ===================== */
function openMultiplayerLobby(gameId) {
    var meta = window.GAMES_META[gameId];
    var c = document.getElementById('tab-games');
    c.innerHTML =
        '<button class="btn-small" onclick="closeGame()">← Назад</button>' +
        '<div style="margin-top:14px;max-width:560px;margin-left:auto;margin-right:auto;">' +
        '<h1 class="page-title">' + meta.icon + ' ' + meta.name + '</h1>' +
        '<div class="settings-card" style="text-align:center;">' +
        '<div id="lobbyStatus" style="font-weight:700;margin-bottom:16px;font-size:1.1rem;">Поиск комнаты…</div>' +
        '<div id="lobbyPlayers" style="text-align:left;"></div>' +
        '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button class="btn-primary" id="readyBtn" onclick="toggleReady()" style="display:none;">✅ Готов</button>' +
        '<button class="btn-secondary" onclick="closeGame()" style="flex:1;">Выйти</button>' +
        '</div>' +
        '<div id="lobbyCountdown" style="margin-top:12px;font-size:1.4rem;font-weight:700;color:var(--accent-blue);"></div>' +
        '</div>' +
        '</div>';
    socket.emit('game:join_room', { gameType: gameId });
}

function toggleReady() { socket.emit('game:toggle_ready'); }
function leaveGameRoom() { socket.emit('game:leave_room'); window.gameRoom = null; }

function renderLobby() {
    var r = window.gameRoom; if (!r) return;
    var st = document.getElementById('lobbyStatus'),
        box = document.getElementById('lobbyPlayers'),
        btn = document.getElementById('readyBtn'),
        cd = document.getElementById('lobbyCountdown');
    if (!st || !box) return;
    var meta = window.GAMES_META[r.gameType];
    if (r.status === 'waiting') {
        st.innerHTML = '👥 Игроков: <b>' + r.players.length + '/' + r.maxPlayers + '</b><br><span style="font-size:0.85rem;color:var(--text-secondary);">Минимум ' + r.minPlayers + ' для старта</span>';
        cd.textContent = '';
    } else if (r.status === 'countdown') {
        st.innerHTML = '🚀 Готовность подтверждена!';
        cd.textContent = '⏱ ' + r.countdown;
    }
    box.innerHTML = r.players.map(function (p) {
        return '<div class="member-row" style="cursor:default;">' +
            '<div class="member-avatar">' + (p.avatarEmoji || '👤') + '</div>' +
            '<div class="member-info"><div class="member-name">' + escapeHtml(p.fullName) + '</div>' +
            '<div class="member-username">' + (p.ready ? '✅ Готов' : '⏳ Ожидание') + '</div></div></div>';
    }).join('');
    if (btn) {
        btn.style.display = r.status === 'waiting' ? 'inline-block' : 'none';
        var me = r.players.find(function (p) { return p.id === currentUser.id; });
        btn.textContent = me && me.ready ? '❌ Не готов' : '✅ Готов';
    }
    if (r.status === 'playing' && !document.getElementById('mpCanvas')) startMultiplayerGame(r);
}

/* ===================== ИГРОВОЙ ЭКРАН МУЛЬТИПЛЕЕРА ===================== */
function startMultiplayerGame(room) {
    var meta = window.GAMES_META[room.gameType];
    var c = document.getElementById('tab-games');
    var canvasW = 800, canvasH = 500;

    var controlsHTML = '';
    if (room.gameType === 'battle-tanks') {
        controlsHTML = '<div class="mp-hud">' +
            '<div class="mp-joystick" id="joy1"><div class="mp-knob" id="knob1"></div></div>' +
            '<button class="mp-fire-btn" id="fireBtn">🔥</button>' +
            '</div>';
    } else if (room.gameType === 'brawl-royale') {
        controlsHTML = '<div class="mp-hud">' +
            '<div class="mp-joystick" id="joy1"><div class="mp-knob" id="knob1"></div></div>' +
            '<div class="mp-right-group">' +
            '<button class="mp-super-btn" id="superBtn">⚡<div class="mp-super-fill" id="superFill"></div></button>' +
            '<div class="mp-joystick right" id="joy2"><div class="mp-knob" id="knob2"></div></div>' +
            '</div>' +
            '</div>';
    } else {
        controlsHTML = '<div class="mp-hud">' +
            '<div class="mp-joystick" id="joy1"><div class="mp-knob" id="knob1"></div></div>' +
            '<div class="mp-joystick right" id="joy2"><div class="mp-knob" id="knob2"></div></div>' +
            '</div>';
    }

    c.innerHTML =
        '<div class="game-view">' +
        '<div class="game-hud">' +
        '<span>' + meta.icon + ' ' + meta.name + '</span>' +
        '<span id="mpRoundInfo"></span>' +
        '</div>' +
        '<canvas id="mpCanvas" width="' + canvasW + '" height="' + canvasH + '" style="max-width:100%;border-radius:14px;touch-action:none;background:#000;display:block;margin:0 auto;box-shadow:0 10px 40px rgba(0,0,0,0.5);"></canvas>' +
        controlsHTML +
        '<button class="btn-secondary" style="margin-top:12px;width:100%;" onclick="closeGame()">Выйти из матча</button>' +
        '</div>';

    setupJoystick('joy1', 'knob1', 1);
    if (document.getElementById('joy2')) setupJoystick('joy2', 'knob2', 2);
    if (document.getElementById('fireBtn')) setupFire();
    if (document.getElementById('superBtn')) setupSuper();

    window.activeGame = { stop: function () { leaveGameRoom(); window.activeGame = null; } };
    renderMultiplayerLoop(room.gameType);
}

function setupJoystick(joyId, knobId, num) {
    var joy = document.getElementById(joyId); if (!joy) return;
    var knob = document.getElementById(knobId);
    var dragging = false, center = { x: 0, y: 0 };

    function start(e) {
        e.preventDefault(); dragging = true;
        var rect = joy.getBoundingClientRect();
        center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        move(e.touches ? e.touches[0] : e);
    }
    function move(e) {
        if (!dragging) return;
        e.preventDefault();
        var t = e.touches ? e.touches[0] : e;
        var dx = t.clientX - center.x, dy = t.clientY - center.y;
        var len = Math.sqrt(dx * dx + dy * dy), max = 50;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; len = max; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        var nx = dx / max, ny = dy / max;
        if (num === 1) window.mpInput.joy1 = { dx: nx, dy: ny };
        else window.mpInput.joy2 = { dx: nx, dy: ny, power: Math.min(1, len / max) };
        sendInput();
    }
    function end() {
        dragging = false; knob.style.transform = 'translate(0,0)';
        if (num === 1) window.mpInput.joy1 = { dx: 0, dy: 0 };
        else window.mpInput.joy2 = { dx: 0, dy: 0, power: 0 };
        sendInput();
    }
    joy.addEventListener('touchstart', start, { passive: false });
    joy.addEventListener('touchmove', move, { passive: false });
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);
    joy.addEventListener('mousedown', start);
    window.addEventListener('mousemove', function (e) { if (dragging) move(e); });
    window.addEventListener('mouseup', function (e) { if (dragging) end(e); });
}

function setupFire() {
    var btn = document.getElementById('fireBtn'); if (!btn) return;
    var pressed = false;
    function on(e) { e.preventDefault(); if (!pressed) { pressed = true; socket.emit('game:fire'); } }
    function off() { pressed = false; }
    btn.addEventListener('touchstart', on, { passive: false });
    btn.addEventListener('touchend', off);
    btn.addEventListener('mousedown', on);
    btn.addEventListener('mouseup', off);
    window.addEventListener('keydown', function (e) { if (e.code === 'Space' && !pressed) { pressed = true; socket.emit('game:fire'); } });
    window.addEventListener('keyup', function (e) { if (e.code === 'Space') pressed = false; });
}

function setupSuper() {
    var btn = document.getElementById('superBtn'); if (!btn) return;
    btn.addEventListener('touchstart', function (e) { e.preventDefault(); socket.emit('game:super'); });
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); socket.emit('game:super'); });
    window.addEventListener('keydown', function (e) { if (e.key.toLowerCase() === 'q') socket.emit('game:super'); });
}

// Клавиатура → joy1
setInterval(function () {
    if (!window.gameRoom || window.gameRoom.status !== 'playing') return;
    var dx = 0, dy = 0;
    if (window.gameKeys['arrowup'] || window.gameKeys['w']) dy -= 1;
    if (window.gameKeys['arrowdown'] || window.gameKeys['s']) dy += 1;
    if (window.gameKeys['arrowleft'] || window.gameKeys['a']) dx -= 1;
    if (window.gameKeys['arrowright'] || window.gameKeys['d']) dx += 1;
    var len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (dx !== window.mpInput.joy1.dx || dy !== window.mpInput.joy1.dy) {
        window.mpInput.joy1 = { dx: dx, dy: dy };
        sendInput();
    }
}, 50);

function sendInput() {
    socket.emit('game:input', {
        joystick1: window.mpInput.joy1,
        joystick2: window.mpInput.joy2
    });
}

/* ===================== РЕНДЕР МУЛЬТИПЛЕЕРА ===================== */
function renderMultiplayerLoop(gameType) {
    var canvas = document.getElementById('mpCanvas'); if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function draw() {
        var r = window.gameRoom;
        if (!r) return;
        if (r.status === 'playing' && r.state) {
            if (gameType === 'battle-tanks') drawTanks(ctx, canvas, r.state);
            else if (gameType === 'brawl-royale') drawBrawl(ctx, canvas, r.state);
            else if (gameType === 'cyber-arena') drawCyber(ctx, canvas, r.state);
        } else {
            ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Ожидание…', canvas.width / 2, canvas.height / 2);
        }
        var info = document.getElementById('mpRoundInfo');
        if (info && r.gameType === 'cyber-arena') {
            info.innerHTML = 'Раунд <b>' + r.round + '/' + r.maxRounds + '</b> · 🔴 ' + r.teamScore.red + ' : ' + r.teamScore.blue + ' 🔵';
        } else if (info) {
            info.textContent = 'Игроков: ' + (r.players ? r.players.length : 0);
        }
        requestAnimationFrame(draw);
    }
    draw();
}

/* ===================== BATTLE TANKS RENDER ===================== */
function drawTanks(ctx, canvas, state) {
    var W = canvas.width, H = canvas.height;
    // пустынный фон
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#8d7a5c'); g.addColorStop(1, '#5c4a35');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // текстура песка — точки
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (var i = 0; i < 200; i++) {
        var x = (i * 137.5) % W, y = (i * 79.3) % H;
        ctx.fillRect(x, y, 2, 2);
    }
    // сетка
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    for (var x2 = 0; x2 < W; x2 += 40) { ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, H); ctx.stroke(); }
    for (var y2 = 0; y2 < H; y2 += 40) { ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(W, y2); ctx.stroke(); }

    state.players.forEach(function (p) {
        if (!p.alive) return;
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 3, 20, 16, p.angle, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        // гусеницы
        ctx.fillStyle = '#222'; ctx.fillRect(-16, -14, 32, 5); ctx.fillRect(-16, 9, 32, 5);
        ctx.fillStyle = '#444';
        for (var t = -14; t < 16; t += 4) { ctx.fillRect(t, -14, 2, 5); ctx.fillRect(t, 9, 2, 5); }
        // корпус
        var bodyGrad = ctx.createLinearGradient(0, -12, 0, 12);
        bodyGrad.addColorStop(0, p.color); bodyGrad.addColorStop(1, shadeColor(p.color, -30));
        ctx.fillStyle = bodyGrad;
        ctx.beginPath(); ctx.roundRect(-14, -10, 28, 20, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        // башня
        ctx.fillStyle = shadeColor(p.color, 20);
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
        // ствол
        ctx.fillStyle = '#111';
        ctx.fillRect(6, -2.5, 22, 5);
        ctx.restore();
        // HP-бар над танком
        var bw = 50, bh = 6;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - bw / 2 - 1, p.y - 34, bw + 2, bh + 2);
        ctx.fillStyle = p.hp > 50 ? '#30d158' : p.hp > 20 ? '#ff9500' : '#ff453a';
        ctx.fillRect(p.x - bw / 2, p.y - 33, bw * Math.max(0, p.hp) / p.maxHp, bh);
        // имя
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText(p.fullName, p.x, p.y - 40);
        ctx.fillText(p.fullName, p.x, p.y - 40);
    });
    state.bullets.forEach(function (b) {
        ctx.fillStyle = b.color || '#ffeb3b';
        ctx.shadowColor = b.color || '#ffeb3b'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    });
}

/* ===================== BRAWL ROYALE RENDER ===================== */
function drawBrawl(ctx, canvas, state) {
    var W = canvas.width, H = canvas.height;
    // фиолетовый фон
    var g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H));
    g.addColorStop(0, '#3a2b5c'); g.addColorStop(0.5, '#1e1233'); g.addColorStop(1, '#0d0716');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // звёзды на фоне
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (var i = 0; i < 60; i++) {
        var x = (i * 131.7) % W, y = (i * 89.4) % H;
        var s = (Math.sin(i * 0.5 + performance.now() / 800) + 1) * 0.7 + 0.3;
        ctx.globalAlpha = s;
        ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // зона
    ctx.strokeStyle = 'rgba(255,80,80,0.7)'; ctx.lineWidth = 4; ctx.setLineDash([16, 10]);
    ctx.shadowColor = 'rgba(255,80,80,0.7)'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, state.zoneR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    // внутренняя зона (безопасная)
    var zG = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, state.zoneR);
    zG.addColorStop(0, 'rgba(80,200,255,0.06)');
    zG.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.fillStyle = zG;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, state.zoneR, 0, Math.PI * 2); ctx.fill();

    // пикапы
    state.pickups.forEach(function (pu) {
        var colors = { hp: '#00e676', dmg: '#ff5252', spd: '#ffd54f' };
        var icons = { hp: '+', dmg: '⚔', spd: '💨' };
        var pulse = 1 + Math.sin(performance.now() / 200) * 0.15;
        ctx.fillStyle = colors[pu.type];
        ctx.shadowColor = colors[pu.type]; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(icons[pu.type], pu.x, pu.y);
        ctx.textBaseline = 'alphabetic';
    });

    // игроки
    state.players.forEach(function (p) {
        if (!p.alive) return;
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
        // свечение
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 25;
        ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // тело с градиентом
        var pg = ctx.createRadialGradient(p.x - 5, p.y - 5, 2, p.x, p.y, 18);
        pg.addColorStop(0, shadeColor(p.color, 40));
        pg.addColorStop(1, p.color);
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        // эмодзи
        ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, p.x, p.y);
        ctx.textBaseline = 'alphabetic';
        // hp-бар
        var bw = 44;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - bw / 2 - 1, p.y - 30, bw + 2, 7);
        var hpRatio = Math.max(0, p.hp) / p.maxHp;
        ctx.fillStyle = hpRatio > 0.5 ? '#30d158' : hpRatio > 0.2 ? '#ff9500' : '#ff453a';
        ctx.fillRect(p.x - bw / 2, p.y - 29, bw * hpRatio, 5);
        // имя
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3;
        ctx.strokeText(p.fullName, p.x, p.y - 38);
        ctx.fillText(p.fullName, p.x, p.y - 38);
        // super charge ring
        if (p.superCharge >= 100) {
            var glow = (Math.sin(performance.now() / 150) + 1) / 2;
            ctx.strokeStyle = 'rgba(255,214,10,' + (0.5 + glow * 0.5) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.stroke();
        }
    });

    // пули
    state.bullets.forEach(function (b) {
        ctx.fillStyle = b.color || '#ffeb3b';
        ctx.shadowColor = b.color || '#ffeb3b'; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    });

    // обновление super-fill
    var me = state.players.find(function (p) { return p.id === (currentUser ? currentUser.id : null); });
    if (me) {
        var fill = document.getElementById('superFill');
        if (fill) fill.style.width = Math.min(100, me.superCharge) + '%';
    }
}

/* ===================== CYBER ARENA RENDER ===================== */
function drawCyber(ctx, canvas, state) {
    var W = canvas.width, H = canvas.height;
    // космический фон
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#050812'); g.addColorStop(1, '#0a1a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // сетка-пол
    ctx.strokeStyle = 'rgba(0,229,255,0.08)'; ctx.lineWidth = 1;
    for (var i = 0; i < W; i += 30) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke(); }
    for (var j = 0; j < H; j += 30) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(W, j); ctx.stroke(); }

    // стены — металлические блоки
    state.walls.forEach(function (w) {
        var wg = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
        wg.addColorStop(0, '#2a3d5c'); wg.addColorStop(1, '#1a2740');
        ctx.fillStyle = wg;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
        ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 12;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        ctx.shadowBlur = 0;
        // болты
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(w.x + 6, w.y + 6, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w.x + w.w - 6, w.y + 6, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w.x + 6, w.y + w.h - 6, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w.x + w.w - 6, w.y + w.h - 6, 2, 0, Math.PI * 2); ctx.fill();
    });

    state.players.forEach(function (p) {
        if (!p.alive) return;
        var color = p.team === 'red' ? '#ff5252' : '#00e5ff';
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
        // свечение
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // тело
        var pg = ctx.createRadialGradient(p.x - 5, p.y - 5, 2, p.x, p.y, 16);
        pg.addColorStop(0, shadeColor(color, 50));
        pg.addColorStop(1, color);
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        // ствол
        ctx.strokeStyle = color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20); ctx.stroke();
        // hp-бар
        var bw = 44;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - bw / 2 - 1, p.y - 30, bw + 2, 7);
        var hpRatio = Math.max(0, p.hp) / p.maxHp;
        ctx.fillStyle = hpRatio > 0.5 ? '#30d158' : hpRatio > 0.2 ? '#ff9500' : '#ff453a';
        ctx.fillRect(p.x - bw / 2, p.y - 29, bw * hpRatio, 5);
        // имя + оружие
        ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3;
        var label = p.fullName + ' · ' + p.weaponName;
        ctx.strokeText(label, p.x, p.y - 38);
        ctx.fillText(label, p.x, p.y - 38);
    });

    state.bullets.forEach(function (b) {
        var color = b.team === 'red' ? '#ff5252' : '#00e5ff';
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, 1.5, 0, Math.PI * 2); ctx.fill();
    });

    // счёт раундов в углу
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 130, 10, 120, 30);
    ctx.fillStyle = '#ff5252'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('🔴 RED', W - 120, 30);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('🔵 BLUE', W - 60, 30);
}

/* ===================== ХЕЛПЕР: цвет темнее/светлее ===================== */
function shadeColor(hex, percent) {
    var num = parseInt(hex.replace('#', ''), 16);
    var r = (num >> 16) + percent;
    var g = ((num >> 8) & 0x00FF) + percent;
    var b = (num & 0x0000FF) + percent;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/* ===================== SOCKET LISTENERS ===================== */
socket.on('game:room_update', function (room) {
    window.gameRoom = room;
    if (room.status === 'playing') {
        if (!document.getElementById('mpCanvas')) startMultiplayerGame(room);
    } else if (room.status === 'ended') {
        // ждём game:ended
    } else {
        renderLobby();
    }
});

socket.on('game:state', function (state) {
    if (window.gameRoom) window.gameRoom.state = state;
});

socket.on('game:round_end', function (data) {
    var el = document.getElementById('mpRoundInfo');
    if (el) el.innerHTML = '🏆 Раунд: ' + (data.winner === 'red' ? '🔴 победили' : '🔵 победили');
});

socket.on('game:ended', function (data) {
    if (window.gameRoom) {
        window.gameRoom.status = 'ended';
        window.gameRoom.state = data.state;
    }
    alert('🏁 Матч окончен!\nПобедитель: ' + (data.winner || '—'));
    setTimeout(function () {
        if (window.gameRoom) {
            window.gameRoom.status = 'waiting';
            if (document.getElementById('mpCanvas')) {
                stopActiveGame();
                openMultiplayerLobby(window.gameRoom.gameType);
            }
        }
    }, 500);
});

socket.on('game:error', function (data) {
    alert('Ошибка: ' + (data.error || 'Неизвестная'));
});
