document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const HEARTBEAT_INTERVAL = 300000;

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
    const startText = startBtn.querySelector('span') || startBtn;

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
    setInterval(updatePlayersList, 3000);

    async function handleStartGame() {
        const initialCards = parseInt(initialCardsSelect.value);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showNotification('No hay conexión con el servidor', true);
            return;
        }

        try {
            console.log('Intentando iniciar juego...');
            startBtn.disabled = true;
            startText.textContent = 'Iniciando...';

            socket.send(JSON.stringify({
                type: 'start_game',
                playerId: playerId,
                roomId: roomId,
                initialCards: initialCards
            }));

            setTimeout(() => {
                window.location.href = 'game.html';
            }, 1000);

        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startText.textContent = 'Iniciar Juego';
            showNotification(`Error: ${error.message}`, true);
        }
    }

    function initializeWebSocket() {
        let reconnectAttempts = 0;
        const MAX_RECONNECT_ATTEMPTS = 3;
        const BASE_RECONNECT_DELAY = 2000;
        let heartbeatInterval;
        let isManualClose = false;

        function connect() {
            isManualClose = false;
            console.log(`Conectando a WebSocket (intento ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

            if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
                socket.close();
            }

            socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

            socket.onopen = () => {
                reconnectAttempts = 0;
                console.log('Conexión WebSocket establecida');

                heartbeatInterval = setInterval(() => {
                    if (socket?.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'heartbeat',
                            playerId: playerId,
                            roomId: roomId,
                            timestamp: Date.now()
                        }));
                    }
                }, HEARTBEAT_INTERVAL);
            };

            socket.onclose = (event) => {
                clearInterval(heartbeatInterval);
                if (isManualClose) return;

                console.log(`WebSocket cerrado, código: ${event.code}, razón: ${event.reason}`);

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
                    reconnectAttempts++;
                    setTimeout(connect, delay);
                } else {
                    console.error('Máximo de intentos de reconexión alcanzado');
                    showNotification('No se pudo reconectar al servidor', true);
                }
            };

            socket.onerror = (error) => {
                console.error('Error en WebSocket:', error);
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('Mensaje recibido:', message);

                    switch (message.type) {
                        case 'game_started':
                            console.log('Juego iniciado, redirigiendo...');
                            window.location.href = 'game.html';
                            break;
                        case 'room_update':
                            updatePlayersUI(message.players);
                            break;
                        case 'notification':
                            showNotification(message.message, message.isError);
                            break;
                        case 'room_reset':
                            showNotification(message.message);
                            updatePlayersList();
                            break;
                        default:
                            console.log('Mensaje no reconocido:', message.type);
                    }
                } catch (error) {
                    console.error('Error procesando mensaje:', error);
                }
            };
        }

        window.addEventListener('beforeunload', () => {
            isManualClose = true;
            if (socket?.readyState === WebSocket.OPEN) {
                socket.close();
            }
        });

        connect();
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
            if (!response.ok) throw new Error('Error en la respuesta del servidor');

            const data = await response.json();
            if (data.success) {
                updatePlayersUI(data.players);
            }
        } catch (error) {
            console.error('Error al actualizar lista de jugadores:', error);
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
});