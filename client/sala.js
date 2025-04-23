document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;
    const PING_INTERVAL = 30000; // 30 segundos

    // Elementos del DOM
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');

    // Variables de estado
    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let pingInterval;
    let lastPong = Date.now();
    const messageQueue = [];
    let isStartingGame = false;

    // Datos de la sesión
    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    // 1. Función para mostrar notificaciones
    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, isError ? 5000 : 3000);
    }

    // 2. Actualizar lista de jugadores en la UI
    function updatePlayersUI(players) {
        if (!players || !Array.isArray(players)) return;

        playersList.innerHTML = players.map(player => `
            <li class="player ${player.isHost ? 'host' : ''} ${player.id === playerId ? 'you' : ''}">
                <span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${player.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-status">${player.connected ? '🟢' : '🔴'}</span>
            </li>
        `).join('');
    }

    // 3. Handler de mensajes WebSocket
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'game_started':
                    if (message.success) {
                        window.location.href = 'game.html';
                    } else {
                        handleStartGameError(message.error || "Error desconocido al iniciar el juego");
                    }
                    break;

                case 'start_game_progress':
                    updateStartButton(message.message);
                    break;

                case 'room_update':
                    updatePlayersUI(message.players);
                    break;

                case 'notification':
                    showNotification(message.message, message.isError);
                    break;

                case 'pong':
                    lastPong = Date.now();
                    break;

                default:
                    console.log('Mensaje no reconocido:', message);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

    // 4. Conexión WebSocket
    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede reconectar. Recarga la página.', true);
            return;
        }

        if (socket) {
            socket.onopen = null;
            socket.onclose = null;
            socket.onerror = null;
            socket.onmessage = null;
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close();
            }
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            showNotification('Conectado al servidor', false);
            startPingInterval();
            processQueue();
            sendPlayerUpdate();
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                reconnectAttempts++;
                showNotification(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, true);
                setTimeout(connectWebSocket, delay);
            }
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
            showNotification('Error de conexión', true);
        };

        socket.onmessage = handleSocketMessage;
    }

    // 5. Función para iniciar el juego
    async function handleStartGame() {
        if (isStartingGame) return;
        isStartingGame = true;

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showNotification("Error: No hay conexión con el servidor", true);
            resetStartButton();
            isStartingGame = false;
            return;
        }

        updateStartButton('Preparando juego...');

        try {
            const initialCards = parseInt(initialCardsSelect.value) || 6;
            const requestId = 'req_' + Date.now();

            safeSend({
                type: 'start_game',
                requestId: requestId,
                playerId: playerId,
                roomId: roomId,
                initialCards: initialCards
            });

            // Esperar máximo 15 segundos por respuesta
            const gameStarted = await Promise.race([
                waitForGameStart(requestId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), 15000))
            ]);

            if (!gameStarted) {
                throw new Error('El servidor no pudo iniciar el juego');
            }

        } catch (error) {
            console.error("Error al iniciar juego:", error);
            handleStartGameError(error.message);
        } finally {
            isStartingGame = false;
        }
    }

    // 6. Función auxiliar para esperar inicio de juego
    function waitForGameStart(requestId) {
        return new Promise((resolve) => {
            const listener = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'game_started' && msg.requestId === requestId) {
                        socket.removeEventListener('message', listener);
                        resolve(msg.success);
                    }
                } catch (error) {
                    console.error("Error procesando mensaje:", error);
                }
            };
            socket.addEventListener('message', listener);
        });
    }

    // 7. Funciones auxiliares para UI
    function updateStartButton(text) {
        startBtn.disabled = true;
        startBtn.textContent = text;
        startBtn.classList.add('loading');
    }

    function resetStartButton() {
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar Juego';
        startBtn.classList.remove('loading');
    }

    function handleStartGameError(errorMessage) {
        showNotification(errorMessage, true);
        resetStartButton();
    }

    // 8. Funciones de conexión
    function startPingInterval() {
        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                safeSend({ type: 'ping' });

                // Verificar si hemos recibido pong recientemente
                if (Date.now() - lastPong > PING_INTERVAL * 1.5) {
                    showNotification('Reconectando...', true);
                    connectWebSocket();
                }
            }
        }, PING_INTERVAL);
    }

    function safeSend(message) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error al enviar mensaje:', error);
                messageQueue.push(message);
            }
        } else {
            messageQueue.push(message);
            connectWebSocket();
        }
    }

    function processQueue() {
        if (!socket || socket.readyState !== WebSocket.OPEN || messageQueue.length === 0) return;

        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            safeSend(message);
        }
    }

    // 9. Funciones de datos
    function sendPlayerUpdate() {
        safeSend({
            type: 'player_update',
            playerId: playerId,
            name: playerName,
            isHost: isHost,
            roomId: roomId
        });
    }

    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    updatePlayersUI(data.players);
                }
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    // 10. Inicialización
    function initializeUI() {
        roomIdDisplay.textContent = roomId;

        if (isHost) {
            gameSettings.style.display = 'block';
            startBtn.style.display = 'block';
            startBtn.addEventListener('click', handleStartGame);
        } else {
            gameSettings.style.display = 'none';
            startBtn.style.display = 'none';
        }
    }

    function initialize() {
        initializeUI();
        connectWebSocket();
        updatePlayersList();

        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearInterval(pingInterval);
        if (socket) socket.close();
    });

    // Iniciar la aplicación
    initialize();
});