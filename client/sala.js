document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;

    let socket;
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
    const connectionStatus = document.getElementById('connectionStatusText');

    // Inicialización de la UI
    function initializeUI() {
        if (!roomId || !playerId) {
            window.location.href = 'index.html';
            return;
        }

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
            <p>${isHost ? '👑 Eres el host' : ''}</p>
        `;
        document.querySelector('.room-header').appendChild(playerInfo);
    }

    function updateConnectionStatus(status, isError = false) {
        if (connectionStatus) {
            connectionStatus.textContent = status;
            connectionStatus.className = isError ? 'error' : '';
        }
    }

    // Conexión WebSocket con manejo de reconexión
    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            updateConnectionStatus('Desconectado', true);
            showNotification('No se pudo reconectar. Recarga la página.', true);
            return;
        }

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        updateConnectionStatus('Conectando...');

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            sendPlayerUpdate();
            showNotification('Conectado al servidor');
        };

        socket.onclose = (event) => {
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                showNotification(`Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            } else {
                updateConnectionStatus('Desconectado', true);
                showNotification('Se perdió la conexión con el servidor', true);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('Error de conexión', true);
            showNotification('Error de conexión con el servidor', true);
        };

        socket.onmessage = handleSocketMessage;
    }

    async function handleSocketMessage(event) {
        try {
            let messageData;
            let rawData;

            // 1. Obtener los datos crudos
            if (event.data instanceof Blob) {
                rawData = await event.data.text();
            } else {
                rawData = event.data;
            }

            // 2. Intentar parsear directamente (si no está comprimido)
            try {
                messageData = JSON.parse(rawData);
            } catch (e) {
                // 3. Si falla, intentar descomprimir
                try {
                    const decompressed = await decompressGzip(rawData);
                    messageData = JSON.parse(decompressed);
                } catch (decompressError) {
                    console.error('Error al descomprimir mensaje:', decompressError);
                    throw new Error('No se pudo procesar el mensaje');
                }
            }

            // Validar estructura básica del mensaje
            if (!messageData || !messageData.type) {
                throw new Error('Mensaje inválido recibido');
            }

            switch (messageData.type) {
                case 'game_started':
                    handleGameStart();
                    break;
                case 'room_update':
                    updatePlayersUI(messageData.players);
                    break;
                case 'notification':
                    showNotification(messageData.message, messageData.isError);
                    break;
                case 'player_update':
                    updatePlayersUI(messageData.players);
                    break;
                case 'host_changed':
                    if (messageData.newHostId === playerId) {
                        sessionStorage.setItem('isHost', 'true');
                        showNotification('¡Ahora eres el host!');
                        window.location.reload();
                    }
                    break;
                default:
                    console.log('Mensaje no reconocido:', messageData);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            showNotification('Error al procesar mensaje del servidor', true);
        }
    }

    // Función auxiliar para descomprimir gzip
    async function decompressGzip(compressedData) {
        try {
            // Si es un string, convertirlo a Uint8Array primero
            if (typeof compressedData === 'string') {
                compressedData = new TextEncoder().encode(compressedData);
            }

            const ds = new DecompressionStream('gzip');
            const decompressedStream = new Blob([compressedData]).stream().pipeThrough(ds);
            return await new Response(decompressedStream).text();
        } catch (error) {
            console.error('Error en decompressGzip:', error);
            throw error;
        }
    }

    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    function sendPlayerUpdate() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'player_update',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId
            }));
        }
    }

    function updatePlayersUI(players) {
        if (!players || !Array.isArray(players)) return;

        playersList.innerHTML = players.map(player => `
            <li class="${player.isHost ? 'host' : ''} ${player.id === playerId ? 'you' : ''}">
                <span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${player.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-status">${player.connected ? '🟢 Conectado' : '🔴 Desconectado'}</span>
            </li>
        `).join('');

        // Actualizar visibilidad del botón de inicio si soy host
        if (isHost) {
            const canStart = players.length >= 2 && players.filter(p => p.connected).length >= 2;
            startBtn.disabled = !canStart;
            if (!canStart) {
                startBtn.title = 'Se necesitan al menos 2 jugadores conectados';
            }
        }
    }

    function handleGameStart() {
        clearInterval(playerUpdateInterval);
        if (socket) socket.close();
        window.location.href = 'game.html';
    }

    async function handleStartGame() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Error: No hay conexión', true);
            showNotification('No hay conexión con el servidor', true);
            return;
        }

        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';

            socket.send(JSON.stringify({
                type: 'start_game',
                playerId: playerId,
                roomId: roomId,
                initialCards: parseInt(initialCardsSelect.value)
            }));

            showNotification('Iniciando juego...');
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
            showNotification('Error al iniciar el juego', true);
        }
    }

    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    updatePlayersUI(data.players);

                    // Si el host se desconectó y soy el nuevo host
                    if (!isHost && data.players.some(p => p.id === playerId && p.isHost)) {
                        sessionStorage.setItem('isHost', 'true');
                        showNotification('¡Ahora eres el host de la sala!');
                        window.location.reload();
                    }
                }
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    function initialize() {
        if (!roomId || !playerId || !playerName) {
            window.location.href = 'index.html';
            return;
        }

        initializeUI();
        connectWebSocket();
        updatePlayersList();
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        if (socket) socket.close();
    });

    initialize();
});