document.addEventListener('DOMContentLoaded', () => {
    // Configuración
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_BASE_DELAY = 2000;
    const CONNECTION_CHECK_INTERVAL = 30000;

    // Variables de estado
    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let connectionCheckInterval;
    let isConnected = false;
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

    // Inicialización UI
    function initializeUI() {
        roomIdDisplay.textContent = roomId;
        displayPlayerInfo();

        if (isHost) {
            gameSettings.style.display = 'block';
            startBtn.classList.add('visible');
            startBtn.addEventListener('click', handleStartGame);
        } else {
            startBtn.remove();
        }
    }

    function displayPlayerInfo() {
        const playerInfo = document.createElement('div');
        playerInfo.id = 'playerInfo';
        playerInfo.className = 'player-info';
        playerInfo.innerHTML = `
            <p>Jugador: <strong>${playerName}</strong></p>
            <p>${isHost ? '🏠 Host' : '👤 Jugador'}</p>
            <p id="connectionStatusText">Conectando...</p>
        `;
        document.querySelector('.room-header').appendChild(playerInfo);
    }

    function updateConnectionStatus(status, isError = false) {
        const statusElement = document.getElementById('connectionStatusText');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = isError ? 'error' : '';
        }
    }

    // Conexión WebSocket mejorada
    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            updateConnectionStatus('Desconectado - Recarga la página', true);
            return;
        }

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        updateConnectionStatus('Conectando...');

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            isConnected = true;
            updateConnectionStatus('Conectado');
            sendPlayerUpdate();
        };

        socket.onclose = (event) => {
            isConnected = false;
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            } else {
                updateConnectionStatus('Desconectado', true);
            }
        };

        socket.onerror = (error) => {
            updateConnectionStatus('Error de conexión', true);
        };

        socket.onmessage = handleSocketMessage;
    }

    // Enviar actualización de jugador
    function sendPlayerUpdate() {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'update_player',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId
            }));
        }
    }

    // Manejar mensajes del servidor
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'game_started') {
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

    // Actualizar lista de jugadores
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
        clearInterval(connectionCheckInterval);
        window.location.href = 'game.html';
    }

    // Iniciar juego (solo host)
    async function handleStartGame() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Error: No hay conexión', true);
            return;
        }

        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';

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
            updateConnectionStatus('Error al iniciar', true);
        }
    }

    // Actualizar lista de jugadores via API
    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    updatePlayersUI(data.players.map(p => ({
                        ...p,
                        connected: p.connected || false
                    })));
                }
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    // Verificar conexión periódicamente
    function startConnectionChecker() {
        connectionCheckInterval = setInterval(() => {
            if (!isConnected) {
                updatePlayersList();
            }
        }, CONNECTION_CHECK_INTERVAL);
    }

    // Mostrar notificación
    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('notification-fade-out');
            setTimeout(() => notification.remove(), 300);
        }, isError ? 5000 : 3000);
    }

    // Inicialización
    function initialize() {
        initializeUI();
        connectWebSocket();
        updatePlayersList();
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
        startConnectionChecker();
    }

    // Limpieza
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearInterval(connectionCheckInterval);
        if (socket) socket.close();
    });

    // Iniciar
    initialize();
});