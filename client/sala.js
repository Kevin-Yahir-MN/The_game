document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_BASE_DELAY = 2000;

    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let reconnectTimeout;
    let connectionStatus = 'disconnected';

    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    // Elementos UI
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');

    // Mostrar notificación
    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Actualizar estado de conexión en UI
    function updateConnectionStatus(status, isError = false) {
        connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus') || createConnectionStatusElement();
        statusElement.textContent = status;
        statusElement.className = isError ? 'error' : '';
    }

    // Crear elemento de estado de conexión si no existe
    function createConnectionStatusElement() {
        const statusElement = document.createElement('div');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        document.querySelector('.room-header').appendChild(statusElement);
        return statusElement;
    }

    function connectWebSocket() {
        clearTimeout(reconnectTimeout);

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede conectar al servidor. Recarga la página.', true);
            return;
        }

        updateConnectionStatus('Conectando...');

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        let pingInterval;

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');

            pingInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(JSON.stringify({
                            type: 'ping',
                            playerId: playerId,
                            roomId: roomId,
                            timestamp: Date.now()
                        }));
                    } catch (error) {
                        console.error('Error enviando ping:', error);
                    }
                }
            }, 15000);

            sendPlayerUpdate();

            if (connectionStatus === 'reconnecting') {
                socket.send(JSON.stringify({
                    type: 'get_full_state',
                    playerId: playerId,
                    roomId: roomId
                }));
            }
            connectionStatus = 'connected';
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                reconnectTimeout = setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                connectionStatus = 'reconnecting';
            } else {
                updateConnectionStatus('Desconectado', true);
                connectionStatus = 'disconnected';
            }
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
            updateConnectionStatus('Error de conexión', true);
            connectionStatus = 'error';
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'pong') {
                    updateConnectionStatus('Conectado');
                    return;
                }

                handleSocketMessage(event);
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        };
    }

    // Enviar actualización de jugador
    function sendPlayerUpdate() {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'player_update',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId,
                status: 'active'
            }));
        }
    }

    // Manejar mensajes del servidor
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'full_state_update') {
                // Actualizar UI con el estado completo del servidor
                updatePlayersUI(message.room.players);

                if (isHost) {
                    gameSettings.style.display = 'block';
                    startBtn.classList.add('visible');
                }
            }
            else if (message.type === 'game_started') {
                handleGameStart();
            }
            else if (message.type === 'room_update') {
                updatePlayersUI(message.players);
            }
            else if (message.type === 'notification') {
                showNotification(message.message, message.isError);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

    // Actualizar lista de jugadores en UI
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

    // Manejar inicio del juego
    function handleGameStart() {
        clearInterval(playerUpdateInterval);
        window.location.href = 'game.html';
    }

    async function handleStartGame() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Error: No hay conexión', true);
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = 'Iniciando...';
        startBtn.classList.add('loading');

        try {
            // Forzar registro inicial antes de empezar
            await fetch(`${API_URL}/register-connection`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: playerId,
                    roomId: roomId
                })
            });

            socket.send(JSON.stringify({
                type: 'start_game',
                playerId: playerId,
                playerName: playerName,
                roomId: roomId,
                initialCards: parseInt(initialCardsSelect.value)
            }));
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            startBtn.classList.remove('loading');
            updateConnectionStatus('Error al iniciar', true);
        }
    }

    // Actualizar lista de jugadores via API
    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) updatePlayersUI(data.players);
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    // Inicializar la UI
    function initializeUI() {
        roomIdDisplay.textContent = roomId;
        updatePlayersList();

        if (isHost) {
            gameSettings.style.display = 'block';
            startBtn.classList.add('visible');
            startBtn.addEventListener('click', handleStartGame);
        } else {
            startBtn.remove();
        }

        createConnectionStatusElement();
        updateConnectionStatus('Conectando...');
    }

    // Inicializar la aplicación
    function initialize() {
        initializeUI();
        connectWebSocket();

        // Heartbeat para mantener la conexión activa
        setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 10000);

        // Actualizar lista de jugadores periódicamente
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearTimeout(reconnectTimeout);
        if (socket) socket.close();
    });

    // Iniciar
    initialize();
});