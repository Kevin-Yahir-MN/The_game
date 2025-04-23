document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;
    const PING_INTERVAL = 5 * 60 * 1000;

    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let pingInterval;
    let lastPong = Date.now();
    const messageQueue = [];

    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');

    // Función para mostrar notificaciones
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

    // Función para actualizar la lista de jugadores
    function updatePlayersUI(players) {
        if (!players || !Array.isArray(players)) return;

        playersList.innerHTML = players.map(player => `
            <li class="${player.isHost ? 'host' : ''} ${player.id === playerId ? 'you' : ''}">
                <span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${player.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-status">${player.connected ? '🟢' : '🔴'}</span>
            </li>
        `).join('');
    }

    // Función para manejar el inicio del juego
    function handleGameStart(message) {
        clearInterval(playerUpdateInterval);
        clearInterval(pingInterval);
        window.location.href = 'game.html';
    }

    // Handler de mensajes WebSocket
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            switch (message.type) {
                case 'game_started':
                    handleGameStart(message);
                    break;

                case 'start_game_ack':
                    // Confirmación de que el servidor recibió la solicitud
                    showNotification('El servidor está preparando el juego...', false);
                    break;

                case 'start_game_error':
                    resetStartButton();
                    showNotification('Error: ' + message.error, true);
                    break;

                case 'room_update':
                    updatePlayersUI(message.players);
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
    // Función para conectar WebSocket
    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            updateConnectionStatus('No se puede reconectar. Recarga la página.', true);
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

        updateConnectionStatus('Conectando...');
        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            startPingInterval();
            processQueue();
            sendPlayerUpdate();
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                reconnectAttempts++;
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                setTimeout(connectWebSocket, delay);
            } else {
                updateConnectionStatus('Desconectado', true);
            }
        };

        socket.onerror = (error) => {
            updateConnectionStatus('Error de conexión', true);
        };

        socket.onmessage = handleSocketMessage;
    }

    // Función para iniciar el intervalo de ping
    function startPingInterval() {
        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                safeSend({ type: 'ping' });

                // Verificar si hemos recibido pong recientemente
                if (Date.now() - lastPong > PING_INTERVAL * 1.5) {
                    updateConnectionStatus('Conexión inestable', true);
                    connectWebSocket(); // Reconectar
                }
            }
        }, PING_INTERVAL);
    }

    // Función para enviar mensajes de forma segura
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
            if (!socket || socket.readyState === WebSocket.CLOSED) {
                connectWebSocket();
            }
        }
    }

    // Función para procesar la cola de mensajes
    function processQueue() {
        if (!socket || socket.readyState !== WebSocket.OPEN || messageQueue.length === 0) return;

        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            safeSend(message);
        }
    }

    // Función para enviar actualización del jugador
    function sendPlayerUpdate() {
        safeSend({
            type: 'player_update',
            playerId: playerId,
            name: playerName,
            isHost: isHost,
            roomId: roomId
        });
    }

    // Función para actualizar el estado de conexión
    function updateConnectionStatus(status, isError = false) {
        const statusElement = document.getElementById('connectionStatus') || createConnectionStatusElement();
        statusElement.textContent = status;
        statusElement.className = isError ? 'error' : '';
    }

    // Función para crear elemento de estado de conexión
    function createConnectionStatusElement() {
        const statusElement = document.createElement('div');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        document.querySelector('.room-header').appendChild(statusElement);
        return statusElement;
    }

    function checkWebSocketConnection() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Conexión perdida', true);
            connectWebSocket();
            return false;
        }
        return true;
    }

    // Función para manejar el inicio del juego
    async function handleStartGame() {
        if ((!checkWebSocketConnection())) {
            updateConnectionStatus('Error: No hay conexión', true);
            return;
        }

        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';
            startBtn.style.backgroundColor = '#f39c12';

            const initialCards = parseInt(initialCardsSelect.value);
            const message = {
                type: 'start_game',
                playerId: playerId,
                roomId: roomId,
                initialCards: initialCards
            };

            // Crear un ID único para esta solicitud
            const requestId = Date.now();
            window.startGameRequestId = requestId;

            // Timeout extendido a 20 segundos
            const timeout = setTimeout(() => {
                if (window.startGameRequestId === requestId && startBtn.textContent === 'Iniciando...') {
                    startBtn.disabled = false;
                    startBtn.textContent = 'Iniciar Juego';
                    startBtn.style.backgroundColor = '';
                    updateConnectionStatus('El servidor no respondió', true);
                    showNotification('El servidor está tardando más de lo esperado. Intenta nuevamente.', true);
                }
            }, 20000); // Aumentado a 20 segundos

            // Esperar confirmación de inicio
            const gameStarted = await new Promise((resolve) => {
                const handler = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'game_started' && window.startGameRequestId === requestId) {
                            clearTimeout(timeout);
                            socket.removeEventListener('message', handler);
                            resolve(true);
                        }
                    } catch (error) {
                        console.error('Error procesando mensaje:', error);
                    }
                };
                socket.addEventListener('message', handler);
            });

            if (gameStarted) {
                window.location.href = 'game.html';
            }

        } catch (error) {
            console.error('Error al iniciar juego:', error);
            resetStartButton();
            updateConnectionStatus('Error al iniciar', true);
            showNotification('Error al iniciar el juego: ' + error.message, true);
        }
    }

    function resetStartButton() {
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar Juego';
        startBtn.style.backgroundColor = '';
    }

    // Función para actualizar la lista de jugadores
    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    updatePlayersUI(data.players);

                    // Actualizar estado de host si es necesario
                    if (data.players.some(p => p.id === playerId && p.isHost && !isHost)) {
                        sessionStorage.setItem('isHost', 'true');
                    }
                }
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    // Función para inicializar la UI
    function initializeUI() {
        roomIdDisplay.textContent = roomId;

        // Mostrar configuración solo para el host
        if (isHost) {
            gameSettings.style.display = 'block';
            startBtn.classList.add('visible');
            startBtn.addEventListener('click', handleStartGame);
        } else {
            startBtn.remove();
        }

        // Crear elemento de estado de conexión
        createConnectionStatusElement();
    }

    // Función principal de inicialización
    function initialize() {
        initializeUI();
        connectWebSocket();
        updatePlayersList();

        // Actualizar lista de jugadores periódicamente
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);

        // Verificar conexión periódicamente
        setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                if (Date.now() - lastPong > PING_INTERVAL * 2) {
                    updateConnectionStatus('Reconectando...', true);
                    connectWebSocket();
                }
            }
        }, 10000);
    }

    // Limpieza al salir de la página
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearInterval(pingInterval);
        if (socket) socket.close();
    });

    // Iniciar la aplicación
    initialize();
});