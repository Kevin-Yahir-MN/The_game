document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const roomId = sessionStorage.getItem('roomId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    // Mostrar código de sala
    document.getElementById('roomIdDisplay').textContent = roomId;

    // Configurar botón de inicio (solo host)
    const startBtn = document.getElementById('startGame');
    if (isHost) {
        startBtn.classList.remove('hidden');
        startBtn.addEventListener('click', startGame);
    }

    // Conexión WebSocket
    const socket = new WebSocket(`wss://the-game-2xks.onrender.com?roomId=${roomId}&playerName=${playerName}`);

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'game_started') {
            window.location.href = 'game.html';
        }
        updatePlayersList();
    };

    // Actualizar lista de jugadores
    function updatePlayersList() {
        fetch(`${API_URL}/room-info/${roomId}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const playersList = document.getElementById('playersList');
                    playersList.innerHTML = data.players.map(player =>
                        `<li class="${player === data.host ? 'host' : ''}">
                ${player} ${player === data.host ? '(Host)' : ''}
                ${player === playerName ? '(Tú)' : ''}
              </li>`
                    ).join('');
                }
            });
    }

    function startGame() {
        socket.send(JSON.stringify({ type: 'start_game' }));
    }

    // Actualizar al cargar y cada 5 segundos
    updatePlayersList();
    setInterval(updatePlayersList, 5000);
});