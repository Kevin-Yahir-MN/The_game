document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 3000; // 3 segundos para polling
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;

    let pollingInterval;
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

    // Polling para actualizaciones de sala
    function startPolling() {
        let retryCount = 0;

        const poll = async () => {
            try {
                const response = await fetch(`${API_URL}/room-info/${roomId}`);
                if (!response.ok) throw new Error('Error en la respuesta');

                const data = await response.json();
                if (data.success) {
                    retryCount = 0;
                    updatePlayersUI(data.players);
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
            }
        };

        poll(); // Primera llamada inmediata
        pollingInterval = setInterval(poll, PLAYER_UPDATE_INTERVAL);
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
        clearInterval(pollingInterval);
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
                    playerId: playerId,
                    playerName: playerName,
                    roomId: roomId,
                    initialCards: parseInt(initialCardsSelect.value)
                })
            });

            if (!response.ok) {
                throw new Error('Error al iniciar juego');
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || 'Error al iniciar juego');
            }
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            updateConnectionStatus('Error al iniciar', true);
        }
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(pollingInterval);
    });

    // Iniciar
    initializeUI();
    startPolling();
});