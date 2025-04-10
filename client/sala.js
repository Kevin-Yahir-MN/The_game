document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';

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

    roomIdDisplay.textContent = roomId;

    if (isHost) {
        gameSettings.style.display = 'block';
        startBtn.classList.add('visible');
        startBtn.addEventListener('click', handleStartGame);
    } else {
        startBtn.remove();
    }

    // Nueva función initializeWebSocket mejorada
    function initializeWebSocket() {
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const baseReconnectDelay = 1000;
        let heartbeatInterval;
        let isManualClose = false;

        function connect() {
            isManualClose = false;

            if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
                socket.close();
            }

            socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

            socket.onopen = () => {
                console.log('Conexión WebSocket establecida (sala)');
                reconnectAttempts = 0;

                // Configurar heartbeat
                heartbeatInterval = setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'heartbeat' }));
                    }
                }, 120000);
            };

            socket.onclose = (event) => {
                clearInterval(heartbeatInterval);

                if (isManualClose) return;

                console.log(`Conexión cerrada (sala), reconectando... Intento ${reconnectAttempts + 1}/${maxReconnectAttempts}`);

                if (reconnectAttempts < maxReconnectAttempts) {
                    const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
                    reconnectAttempts++;
                    setTimeout(connect, delay);
                } else {
                    showNotification('No se pudo reconectar a la sala. Recarga la página.', true);
                }
            };

            socket.onerror = (error) => {
                console.error('Error en WebSocket (sala):', error);
            };

            socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                console.log('Mensaje recibido:', message);

                if (message.type === 'game_started') {
                    console.log('Juego iniciado, redirigiendo...');
                    window.location.href = 'game.html';
                } else if (message.type === 'room_update') {
                    updatePlayersUI(message.players);
                } else if (message.type === 'notification') {
                    showNotification(message.message, message.isError);
                } else if (message.type === 'room_reset') {
                    showNotification(message.message);
                    updatePlayersList();
                }
            };
        }

        // Conectar inicialmente
        connect();

        // Manejar cierre de página/ventana
        window.addEventListener('beforeunload', () => {
            isManualClose = true;
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        });
    }

    // Resto de funciones existentes (sin cambios)
    function handleStartGame() {
        const initialCards = parseInt(initialCardsSelect.value);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            alert('Error: No hay conexión con el servidor. Reconectando...');
            initializeWebSocket();
            return;
        }

        try {
            console.log('Intentando iniciar juego...');
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
            alert('Error al iniciar el juego. Intenta nuevamente.');
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
            if (!response.ok) throw new Error('Error en la respuesta');

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

    // Inicialización
    initializeWebSocket();
    updatePlayersList();
    setInterval(updatePlayersList, 3000);
});