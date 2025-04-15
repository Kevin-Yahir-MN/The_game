document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;

    let eventSource;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
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

    // Inicialización de la UI
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

    // Mostrar información del jugador
    function displayPlayerInfo() {
        const playerInfo = document.createElement('div');
        playerInfo.id = 'playerInfo';
        playerInfo.className = 'player-info';
        document.querySelector('.room-header').appendChild(playerInfo);
    }

    // Actualizar estado de conexión
    function updateConnectionStatus(status, isError = false) {
        const statusElement = document.getElementById('connectionStatusText');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = isError ? 'error' : '';
        }
    }

    // Conexión SSE mejorada
    function connectSSE() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            updateConnectionStatus('Desconectado', true);
            return;
        }

        // Cerrar conexión existente
        if (eventSource) {
            eventSource.close();
        }

        updateConnectionStatus('Conectando...');

        eventSource = new EventSource(`${API_URL}/sse?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        eventSource.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            sendPlayerUpdate();
        };

        eventSource.onerror = (error) => {
            updateConnectionStatus('Error de conexión', true);

            if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                setTimeout(connectSSE, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            }
        };

        eventSource.onmessage = (event) => {
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
        };
    }

    // Enviar actualización de jugador
    function sendPlayerUpdate() {
        fetch(`${API_URL}/update-player`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                roomId,
                playerId,
                name: playerName,
                isHost
            })
        }).catch(error => console.error('Error actualizando jugador:', error));
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
        window.location.href = 'game.html';
    }

    // Iniciar juego (solo host)
    async function handleStartGame() {
        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';

            const response = await fetch(`${API_URL}/start-game`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    roomId,
                    playerId,
                    initialCards: parseInt(initialCardsSelect.value)
                })
            });

            if (!response.ok) {
                throw new Error('Error al iniciar juego');
            }
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            showNotification('Error al iniciar', true);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
        }
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
        }, 3000);
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

    // Inicializar la aplicación
    function initialize() {
        initializeUI();
        connectSSE();
        updatePlayersList();
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        if (eventSource) eventSource.close();
    });

    // Iniciar
    initialize();
});