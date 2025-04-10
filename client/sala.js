window.addEventListener('error', (event) => {
    if (event.message.includes('UNSUPPORTED_OS')) {
        console.warn('Funcionalidad de sistema operativo no disponible en navegador');
        event.preventDefault(); // Previene que el error se propague
        return false;
    }
});
document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000; // 5 segundos

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

    roomIdDisplay.textContent = roomId;

    if (isHost) {
        gameSettings.style.display = 'block';
        startBtn.classList.add('visible');
        startBtn.addEventListener('click', handleStartGame);
    } else {
        startBtn.remove();
    }

    initializeWebSocket();
    updatePlayersList();
    playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);

    function initializeWebSocket() {
        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

        socket.onopen = () => {
            console.log('Conexión WebSocket establecida');
        };

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.type === 'game_started') {
                clearInterval(playerUpdateInterval);
                window.location.href = 'game.html';
            } else if (message.type === 'notification') {
                showNotification(message.message, message.isError);
            } else if (message.type === 'room_reset') {
                showNotification(message.message);
                updatePlayersList();
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
            const response = await fetch(`${API_URL}/room-info/${roomId}`, {
                cache: 'no-store'
            });

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
                    ${player.name}
                    ${player.isHost ? ' (Host)' : ''}
                    ${isCurrentPlayer ? ' (Tú)' : ''}
                    ${player.connected ? '🟢' : '🔴'}
                </li>`;
        }).join('');
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        if (socket) {
            socket.close();
        }
    });
});