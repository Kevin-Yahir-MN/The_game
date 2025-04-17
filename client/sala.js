document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const POLL_INTERVALS = {
        normal: 3000,
        fast: 1000,
        slow: 5000,
        reconnect: 2000
    };
    const MAX_RETRIES = 5;

    // Estado de la aplicación
    const appState = {
        polling: {
            active: false,
            interval: POLL_INTERVALS.normal,
            timeout: null,
            retries: 0
        },
        room: {
            id: sessionStorage.getItem('roomId'),
            players: []
        },
        player: {
            id: sessionStorage.getItem('playerId'),
            name: sessionStorage.getItem('playerName'),
            isHost: sessionStorage.getItem('isHost') === 'true'
        }
    };

    // Elementos UI
    const elements = {
        roomCode: document.getElementById('roomIdDisplay'),
        playersList: document.getElementById('playersList'),
        startBtn: document.getElementById('startGame'),
        gameSettings: document.getElementById('gameSettings'),
        initialCards: document.getElementById('initialCards'),
        statusIndicator: createStatusIndicator()
    };

    // Inicialización
    function initialize() {
        if (!appState.room.id || !appState.player.id) {
            return redirectToLobby('Datos de sala inválidos');
        }

        setupUI();
        startPolling();
        setupEventListeners();
    }

    function setupUI() {
        elements.roomCode.textContent = appState.room.id;
        document.querySelector('.room-header').appendChild(elements.statusIndicator);

        if (appState.player.isHost) {
            elements.gameSettings.style.display = 'block';
            elements.startBtn.classList.add('visible');
        } else {
            elements.startBtn.remove();
            elements.gameSettings.remove();
        }
    }

    function createStatusIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'connection-status';
        return indicator;
    }

    // Sistema de Polling
    function startPolling() {
        if (appState.polling.active) return;

        appState.polling.active = true;
        appState.polling.retries = 0;
        pollRoomInfo();
    }

    function stopPolling() {
        appState.polling.active = false;
        clearTimeout(appState.polling.timeout);
    }

    async function pollRoomInfo() {
        if (!appState.polling.active) return;

        try {
            const url = `${API_URL}/room/${appState.room.id}/info?playerId=${appState.player.id}&_=${Date.now()}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Invalid response');
            }

            handleSuccessfulPoll(data);
        } catch (error) {
            handlePollError(error);
        } finally {
            if (appState.polling.active) {
                scheduleNextPoll();
            }
        }
    }

    function handleSuccessfulPoll(data) {
        appState.polling.retries = 0;
        updateConnectionStatus('Conectado', false);

        // Actualizar lista de jugadores
        if (data.players && Array.isArray(data.players)) {
            appState.room.players = data.players;
            updatePlayersList();
        }

        // Guardar datos relevantes para todos los jugadores
        sessionStorage.setItem('roomId', appState.room.id);
        sessionStorage.setItem('playerId', appState.player.id);
        sessionStorage.setItem('playerName', appState.player.name);
        sessionStorage.setItem('isHost', appState.player.isHost.toString());

        // Solo guardar estos datos si eres el host
        if (appState.player.isHost) {
            sessionStorage.setItem('initialPlayers', JSON.stringify(data.players));
            sessionStorage.setItem('currentTurn', data.currentTurn);
            sessionStorage.setItem('initialCards', data.initialCards.toString());
            sessionStorage.setItem('lastModified', data.lastModified.toString());
        }

        // Manejar inicio del juego
        if (data.gameStarted) {
            handleGameStart(data);
        }

        adjustPollingSpeed(data);
    }

    function handlePollError(error) {
        console.error('Polling error:', error);
        appState.polling.retries++;

        if (appState.polling.retries >= MAX_RETRIES) {
            updateConnectionStatus('Error de conexión', true);
            stopPolling();
            return;
        }

        updateConnectionStatus(`Reconectando (${appState.polling.retries}/${MAX_RETRIES})`, true);
        appState.polling.interval = POLL_INTERVALS.reconnect * Math.pow(2, appState.polling.retries - 1);
    }

    function scheduleNextPoll() {
        appState.polling.timeout = setTimeout(() => {
            pollRoomInfo();
        }, appState.polling.interval);
    }

    function adjustPollingSpeed(data) {
        const hasActivity = checkRoomActivity(data);
        appState.polling.interval = hasActivity
            ? POLL_INTERVALS.fast
            : POLL_INTERVALS.normal;
    }

    function checkRoomActivity(data) {
        const previousCount = appState.room.players.length;
        const currentCount = data.players?.length || 0;
        return previousCount !== currentCount || data.gameStarted;
    }

    // Actualización de UI
    function updatePlayersList() {
        elements.playersList.innerHTML = appState.room.players
            .map(player => createPlayerElement(player))
            .join('');
    }

    function createPlayerElement(player) {
        return `
            <li class="${player.isHost ? 'host' : ''} ${player.id === appState.player.id ? 'you' : ''}">
                <span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${player.id === appState.player.id ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-icon">${player.connected ? '🟢' : '🔴'}</span>
            </li>
        `;
    }

    function updateConnectionStatus(message, isError) {
        elements.statusIndicator.textContent = message;
        elements.statusIndicator.className = `connection-status ${isError ? 'error' : ''}`;
    }

    // Manejadores de eventos
    function setupEventListeners() {
        if (appState.player.isHost) {
            elements.startBtn.addEventListener('click', handleStartGame);
        }

        window.addEventListener('beforeunload', stopPolling);
    }

    async function handleStartGame() {
        elements.startBtn.disabled = true;
        elements.startBtn.textContent = 'Iniciando...';

        try {
            const initialCards = parseInt(elements.initialCards.value) || 6;
            const response = await fetch(`${API_URL}/start-game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: appState.player.id,
                    roomId: appState.room.id,
                    initialCards: initialCards
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Error al iniciar juego');
            }

            // Esperar breve momento para asegurar propagación del estado
            await new Promise(resolve => setTimeout(resolve, 300));
            handleGameStart(data);
        } catch (error) {
            console.error('Start game error:', error);
            updateConnectionStatus('Error al iniciar: ' + error.message, true);
        } finally {
            elements.startBtn.disabled = false;
            elements.startBtn.textContent = 'Iniciar Juego';
        }
    }

    function handleGameStart(data) {
        stopPolling();
        sessionStorage.setItem('gameStarted', 'true');

        // Guardar datos necesarios para game.html
        sessionStorage.setItem('initialPlayers', JSON.stringify(data.players || []));
        sessionStorage.setItem('currentTurn', data.currentTurn || '');
        sessionStorage.setItem('initialCards', data.initialCards?.toString() || '6');
        sessionStorage.setItem('lastModified', data.lastModified?.toString() || Date.now().toString());

        window.location.href = 'game.html';
    }

    function redirectToLobby(message) {
        console.error(message);
        sessionStorage.clear();
        window.location.href = 'index.html';
    }

    // Iniciar la aplicación
    initialize();
});