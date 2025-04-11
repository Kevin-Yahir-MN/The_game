document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 2000;

    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');

    // Mostrar información del jugador actual
    function displayPlayerInfo() {
        const playerInfo = document.getElementById('playerInfo') || document.createElement('div');
        playerInfo.id = 'playerInfo';
        playerInfo.className = 'player-info';

        const header = document.querySelector('.room-header');
        if (!document.getElementById('playerInfo')) {
            header.appendChild(playerInfo);
        }
    }

    // Inicializar la UI
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

    // Función para mostrar notificaciones
    function showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('notification-fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Conectar WebSocket con manejo de reconexión
    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede conectar al servidor. Recarga la página.', true);
            updateConnectionStatus('🔴 Desconectado');
            return;
        }

        // Cerrar conexión existente si hay una
        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        updateConnectionStatus('🟡 Conectando...');
        showNotification(reconnectAttempts > 0 ? `Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...` : 'Conectando al servidor...');

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('🟢 Conectado');
            showNotification('Conectado al servidor', false);
            console.log('Conexión WebSocket establecida');

            // Enviar mensaje de actualización de jugador
            socket.send(JSON.stringify({
                type: 'player_update',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId
            }));
        };

        socket.onclose = (event) => {
            console.log('Conexión cerrada:', event.code, event.reason);

            if (!event.wasClean) {
                reconnectAttempts++;
                updateConnectionStatus('🔴 Reconectando...');
                showNotification(`Conexión perdida. Intentando nuevamente... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, true);

                const delay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                setTimeout(connectWebSocket, delay);
            } else {
                updateConnectionStatus('🔴 Desconectado');
            }
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
            updateConnectionStatus('🔴 Error de conexión');
            showNotification('Error en la conexión', true);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'game_started') {
                    clearInterval(playerUpdateInterval);
                    window.location.href = 'game.html';
                }
                else if (message.type === 'room_update') {
                    updatePlayersUI(message.players);
                }
                else if (message.type === 'notification') {
                    showNotification(message.message, message.isError);
                }
                else if (message.type === 'connection_error') {
                    showNotification(message.message, true);
                    setTimeout(connectWebSocket, 3000);
                }
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        };
    }

    // Actualizar estado de conexión en la UI
    function updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    // Actualizar lista de jugadores en la UI
    function updatePlayersUI(players) {
        if (!players || !Array.isArray(players)) {
            console.error('Datos de jugadores inválidos:', players);
            return;
        }

        try {
            playersList.innerHTML = players.map(player => {
                const isCurrentPlayer = player.id === playerId;
                const status = player.connected ? '🟢 Conectado' : '🔴 Desconectado';

                return `
                    <li class="${player.isHost ? 'host' : ''} ${isCurrentPlayer ? 'you' : ''}">
                        <span class="player-name">${player.name || 'Jugador'}</span>
                        ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                        ${isCurrentPlayer ? ' <span class="you-tag">(Tú)</span>' : ''}
                        <span class="connection-status">${status}</span>
                    </li>`;
            }).join('');
        } catch (error) {
            console.error('Error actualizando UI de jugadores:', error);
        }
    }

    // Manejar inicio del juego
    async function handleStartGame() {
        const initialCards = parseInt(initialCardsSelect.value);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showNotification('Error: No hay conexión con el servidor. Reconectando...', true);
            connectWebSocket();
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
                initialCards: initialCards
            }));
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            showNotification('Error al iniciar el juego. Intenta nuevamente.', true);
        }
    }

    // Actualizar lista de jugadores periódicamente
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

    // Inicializar la aplicación
    function initialize() {
        initializeUI();
        connectWebSocket();
        updatePlayersList();
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        if (socket) {
            socket.close();
        }
    });

    // Iniciar la aplicación
    initialize();
});