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
        document.querySelector('.room-header').appendChild(playerInfo);
    }

    function updateConnectionStatus(status, isError = false) {
        const statusElement = document.getElementById('connectionStatusText');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = isError ? 'error' : '';
        }
    }

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

    function startPingInterval() {
        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                safeSend({ type: 'ping' });
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
            if (!socket || socket.readyState === WebSocket.CLOSED) {
                connectWebSocket();
            }
        }
    }

    function processQueue() {
        if (!socket || socket.readyState !== WebSocket.OPEN || messageQueue.length === 0) return;
        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            safeSend(message);
        }
    }

    function sendPlayerUpdate() {
        safeSend({
            type: 'player_update',
            playerId: playerId,
            name: playerName,
            isHost: isHost,
            roomId: roomId
        });
    }

    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'game_started') {
                handleGameStart();
            }
            else if (message.type === 'room_update') {
                updatePlayersUI(message.players);
            }
            else if (message.type === 'pong') {
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

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

    function handleGameStart() {
        clearInterval(playerUpdateInterval);
        clearInterval(pingInterval);
        window.location.href = 'game.html';
    }

    async function handleStartGame() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Error: No hay conexión', true);
            return;
        }
        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';
            safeSend({
                type: 'start_game',
                playerId: playerId,
                playerName: playerName,
                roomId: roomId,
                initialCards: parseInt(initialCardsSelect.value)
            });
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            updateConnectionStatus('Error al iniciar', true);
        }
    }

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

    function initialize() {
        initializeUI();
        connectWebSocket();
        updatePlayersList();
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearInterval(pingInterval);
        if (socket) socket.close();
    });

    initialize();
});