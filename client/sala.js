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
    let gameStartTimeout;
    const GAME_START_TIMEOUT = 20000; // 20 segundos

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

    async function handleStartGame() {
        if (isStartingGame) return;
        isStartingGame = true;

        try {
            // 1. Verificar conexión WebSocket
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                throw new Error("No hay conexión con el servidor");
            }

            // 2. Configurar estado inicial
            updateStartButton('Iniciando partida...');
            showNotification("Preparando la partida...", false);

            // 3. Enviar solicitud de inicio
            const requestId = `startreq_${Date.now()}`;
            const initialCards = parseInt(initialCardsSelect.value) || 6;

            safeSend({
                type: 'start_game',
                requestId: requestId,
                playerId: playerId,
                roomId: roomId,
                initialCards: initialCards,
                timestamp: Date.now()
            });

            // 4. Configurar timeout
            gameStartTimeout = setTimeout(() => {
                throw new Error("El servidor no respondió a tiempo");
            }, GAME_START_TIMEOUT);

            // 5. Esperar confirmación
            const success = await waitForGameConfirmation(requestId);

            if (!success) {
                throw new Error("El servidor no pudo iniciar el juego");
            }

            // 6. Redirigir si todo sale bien
            window.location.href = 'game.html';

        } catch (error) {
            console.error("Error al iniciar juego:", error);
            handleStartGameError(error.message);
        } finally {
            clearTimeout(gameStartTimeout);
            isStartingGame = false;
        }
    }


    function waitForGameConfirmation(requestId) {
        return new Promise((resolve) => {
            const confirmationHandler = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'game_start_confirmation' && msg.requestId === requestId) {
                        socket.removeEventListener('message', confirmationHandler);
                        clearTimeout(gameStartTimeout);
                        resolve(msg.success);

                        if (msg.success) {
                            updateStartButton('¡Partida lista!');
                            setTimeout(() => window.location.href = 'game.html', 1000);
                        }
                    }
                } catch (error) {
                    console.error("Error procesando confirmación:", error);
                    resolve(false);
                }
            };

            socket.addEventListener('message', confirmationHandler);
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
        let userMessage = errorMessage;

        // Mensajes más amigables para el usuario
        const errorMessages = {
            "No hay conexión con el servidor": "No se pudo conectar al servidor. Intenta recargar la página.",
            "El servidor no respondió a tiempo": "El servidor está tardando demasiado. Intenta nuevamente.",
            "El servidor no pudo iniciar el juego": "No se pudo iniciar la partida. Verifica que todos los jugadores estén conectados."
        };

        userMessage = errorMessages[errorMessage] || errorMessage;

        showNotification(userMessage, true);
        resetStartButton();

        // Intentar reconectar si es un error de conexión
        if (errorMessage.includes("conexión") || errorMessage.includes("servidor")) {
            setTimeout(connectWebSocket, 3000);
        }
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