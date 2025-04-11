document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;

    let socket;
    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');
    let playerUpdateInterval;

    // Mostrar información del jugador actual
    function displayPlayerInfo() {
        const playerInfo = document.getElementById('playerInfo') || document.createElement('div');
        playerInfo.id = 'playerInfo';
        playerInfo.className = 'player-info';
        playerInfo.innerHTML = `
            <h3>Jugador: <span class="player-name">${playerName || 'Anónimo'}</span></h3>
            <p>Sala: ${roomId} ${isHost ? '(Host)' : ''}</p>
        `;

        const header = document.querySelector('.room-header');
        if (!document.getElementById('playerInfo')) {
            header.appendChild(playerInfo);
        }
    }

    roomIdDisplay.textContent = roomId;
    displayPlayerInfo();

    if (isHost) {
        gameSettings.style.display = 'block';
        startBtn.classList.add('visible');
        startBtn.addEventListener('click', handleStartGame);
    } else {
        startBtn.remove();
    }

    function initializeWebSocket() {
        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            console.log('Conexión WebSocket establecida');
            // Enviar mensaje de actualización de nombre
            socket.send(JSON.stringify({
                type: 'update_player',
                playerId: playerId,
                name: playerName
            }));
        };
        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            console.log('Conexión WebSocket establecida');
        };

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.type === 'game_started') {
                clearInterval(playerUpdateInterval);
                window.location.href = 'game.html';
            } else if (message.type === 'room_update') {
                updatePlayersUI(message.players);
            } else if (message.type === 'notification') {
                showNotification(message.message, message.isError);
            }
        };

        socket.onclose = () => {
            console.log('Conexión cerrada, reconectando...');
            setTimeout(initializeWebSocket, 2000);
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
        };
    }

    function handleStartGame() {
        const initialCards = parseInt(initialCardsSelect.value);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showNotification('Error: No hay conexión con el servidor. Reconectando...', true);
            initializeWebSocket();
            return;
        }

        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';

            socket.send(JSON.stringify({
                type: 'start_game',
                playerId: playerId,
                playerName: playerName, // Envía el nombre al servidor
                roomId: roomId,
                initialCards: initialCards
            }));
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            showNotification('Error al iniciar el juego. Intenta nuevamente.', true);
        }
    }

    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);

            const data = await response.json();
            if (data.success) {
                updatePlayersUI(data.players);
            }
        } catch (error) {
            console.error('Error al actualizar jugadores:', error);
        }
    }

    function updatePlayersUI(players) {
        playersList.innerHTML = players.map(player => {
            const isCurrentPlayer = player.id === playerId;
            return `
                <li class="${player.isHost ? 'host' : ''} ${isCurrentPlayer ? 'you' : ''}">
                    <span class="player-name">${player.name || 'Jugador'}</span>
                    ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                    ${isCurrentPlayer ? ' <span class="you-tag">(Tú)</span>' : ''}
                    <span class="connection-status">${player.connected ? '🟢' : '🔴'}</span>
                </li>`;
        }).join('');
    }

    initializeWebSocket();
    updatePlayersList();
    playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);

    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        if (socket) {
            socket.close();
        }
    });
});