let currentGameId = null;
let canvas = document.getElementById('gameCanvas');
let ctx = canvas ? canvas.getContext('2d') : null;

function startGame(gameId) {
    currentGameId = gameId;
    document.getElementById('games-menu').classList.add('hidden');
    document.getElementById('game-canvas-container').classList.remove('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');

    socket.emit('join_game_lobby', {
        gameId,
        spaceId: 'default_space',
        userId: currentUser ? currentUser.id : 'guest',
        username: currentUser ? currentUser.fullName : 'Гость'
    });
}

// Управление кнопкой «Готов»
Document.getElementById('ready-btn')?.addEventListener('click', () => {
    Socket.emit('player_toggle_ready');
});

Socket.on('lobby_state_update', (room) => {
    Const lobbyPlayers = document.getElementById('lobby-players');
    If (!lobbyPlayers) return;
    lobbyPlayers.innerHTML = Object.values(room.players).map(p => `
        <div class=»player-row»>
            <span>${p.username} ${p.isGhost ? '👻 (Призрак)' : ''}</span>
            <span>${p.ready ? '✅ Готов' : '⏳ Ожидание'}</span>
        </div>
    `).join('');
});

Socket.on('game_start_countdown', ({ duration }) => {
    Document.getElementById('game-lobby').classList.add('hidden');
    runCanvasGame();
});

Function runCanvasGame() {
    Function render() {
        If (!ctx) return;
        Ctx.clearRect(0, 0, canvas.width, canvas.height);
        Ctx.fillStyle = '#111';
        Ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        Ctx.fillStyle = '#0A84FF';
        Ctx.font = '20px sans-serif';
        Ctx.fillText(`Игра ${currentGameId} запущена! (Управление: WASD / Стрелки)`, 50, 50);

        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

