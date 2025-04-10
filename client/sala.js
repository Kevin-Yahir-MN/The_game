document.addEventListener('DOMContentLoaded', () => {

    // Configuración de desarrollo
    const isDevelopment = false; // Cambiar a true solo durante desarrollo
    const HEARTBEAT_INTERVAL = 300000; // 5 minutos
    const MAX_RECONNECT_ATTEMPTS = 3;
    const BASE_RECONNECT_DELAY = 2000;

    // Sistema de logging condicional
    function debugLog(...args) {
        if (isDevelopment) {
            console.log('[DEBUG]', ...args);
        }
    }

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

    // Función initializeWebSocket optimizada
    function initializeWebSocket() {
        let reconnectAttempts = 0;
        let heartbeatInterval;
        let isManualClose = false;

        function connect() {
            isManualClose = false;
            debugLog(`Intento conexión sala ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`);

            if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
                socket.close();
            }

            socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

            socket.onopen = () => {
                reconnectAttempts = 0;
                debugLog('Conexión WebSocket establecida (sala)');

                heartbeatInterval = setInterval(() => {
                    if (socket?.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'heartbeat' }));
                    }
                }, HEARTBEAT_INTERVAL);
            };

            socket.onclose = (event) => {
                clearInterval(heartbeatInterval);

                if (isManualClose) return;

                debugLog(`Conexión cerrada (sala), intento ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`);

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
                    reconnectAttempts++;
                    setTimeout(connect, delay);
                } else {
                    showNotification('No se pudo reconectar a la sala. Recarga la página.', true);
                }
            };

            socket.onerror = (error) => {
                debugLog('Error en WebSocket (sala):', error);
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    // Solo loguear mensajes importantes
                    if (['game_started', 'room_update', 'notification'].includes(message.type)) {
                        debugLog('Mensaje WS (sala):', message.type);
                    }

                    switch (message.type) {
                        case 'game_started':
                            debugLog('Juego iniciado, redirigiendo...');
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
                            debugLog('Mensaje no reconocido (sala):', message.type);
                    }
                } catch (error) {
                    debugLog('Error procesando mensaje (sala):', error);
                }
            };
        }

        // Conectar inicialmente
        connect();

        // Manejar cierre de página/ventana
        window.addEventListener('beforeunload', () => {
            isManualClose = true;
            if (socket?.readyState === WebSocket.OPEN) {
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