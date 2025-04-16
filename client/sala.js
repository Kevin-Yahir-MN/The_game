document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const BASE_POLL_INTERVAL = 3000;
    const MIN_POLL_INTERVAL = 1000;
    const MAX_POLL_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;

    let currentPollInterval = BASE_POLL_INTERVAL;
    let pollingTimeout;
    let lastActivityTime = Date.now();
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

    // Polling adaptativo
    function startPolling() {
        let retryCount = 0;

        const poll = async () => {
            try {
                const response = await fetch(`${API_URL}/room-info/${roomId}?_=${Date.now()}`);
                if (!response.ok) throw new Error('Error en la respuesta');

                const data = await response.json();
                if (data.success) {
                    retryCount = 0;
                    updatePlayersUI(data.players);

                    // Ajustar intervalo basado en actividad
                    const hasActivity = checkRoomActivity(data);
                    adjustPollingInterval(hasActivity);

                    if (data.gameStarted) {
                        handleGameStart();
                    }
                }
            } catch (error) {
                retryCount++;
                console.error('Error en polling:', error);
                if (retryCount >= MAX_RECONNECT_ATTEMPTS) {
                    updateConnectionStatus('Error de conexión', true);
                    return;
                }
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, retryCount - 1), 30000);
                setTimeout(poll, delay);
                updateConnectionStatus(`Reconectando (${retryCount}/${MAX_RECONNECT_ATTEMPTS})...`);
            } finally {
                if (!retryCount || retryCount < MAX_RECONNECT_ATTEMPTS) {
                    pollingTimeout = setTimeout(poll, currentPollInterval);
                }
            }
        };

        poll(); // Primera llamada inmediata
    }

    function checkRoomActivity(data) {
        // Verificar cambios significativos en el estado de la sala
        const previousPlayerCount = playersList.children.length;
        const currentPlayerCount = data.players?.length || 0;

        return (previousPlayerCount !== currentPlayerCount) ||
            data.gameStarted ||
            (Date.now() - lastActivityTime < 5000);
    }

    function adjustPollingInterval(hasActivity) {
        if (hasActivity) {
            // Reducir intervalo si hay actividad
            currentPollInterval = Math.max(MIN_POLL_INTERVAL, currentPollInterval - 500);
            lastActivityTime = Date.now();
        } else {
            // Aumentar intervalo gradualmente
            currentPollInterval = Math.min(MAX_POLL_INTERVAL, currentPollInterval + 500);
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
        clearTimeout(pollingTimeout);
        sessionStorage.setItem('gameStarted', 'true');
        window.location.href = 'game.html';
    }

    async function handleStartGame() {
        if (!roomId || !playerId) {
            showNotification('Error: No se encontraron datos de la sala', true);
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = 'Iniciando...';

        try {
            const initialCards = parseInt(initialCardsSelect.value) || 6;

            const response = await fetch(`${API_URL}/start-game`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerId: playerId,
                    roomId: roomId,
                    initialCards: initialCards
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Error al iniciar juego');
            }

            // Guardar datos iniciales antes de redirigir
            sessionStorage.setItem('initialPlayers', JSON.stringify(data.players));
            sessionStorage.setItem('currentTurn', data.currentTurn);
            sessionStorage.setItem('initialCards', data.initialCards);
            sessionStorage.setItem('lastModified', data.lastModified);

            // Pequeña espera para asegurar propagación del estado
            await new Promise(resolve => setTimeout(resolve, 300));

            // Redirigir al juego
            window.location.href = 'game.html';

        } catch (error) {
            console.error('Error al iniciar juego:', error);
            showNotification(error.message || 'Error al iniciar el juego', true);
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
        }
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearTimeout(pollingTimeout);
    });

    // Iniciar
    initializeUI();
    startPolling();
});