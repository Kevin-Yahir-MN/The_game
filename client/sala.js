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

    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            updateConnectionStatus('🔴 Desconectado');
            return;
        }

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        updateConnectionStatus('🟡 Conectando...');

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('🟢 Conectado');

            socket.send(JSON.stringify({
                type: 'player_update',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId
            }));
        };

        socket.onclose = (event) => {
            if (!event.wasClean) {
                reconnectAttempts++;
                updateConnectionStatus('🔴 Reconectando...');
                setTimeout(connectWebSocket, Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 30000));
            } else {
                updateConnectionStatus('🔴 Desconectado');
            }
        };

        socket.onerror = (error) => {
            updateConnectionStatus('🔴 Error de conexión');
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