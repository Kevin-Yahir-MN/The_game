document.addEventListener('DOMContentLoaded', () => {
    const API_URL = window.location.origin; // Usar el mismo origen
    const PLAYER_UPDATE_INTERVAL = 5000;

    // Variables existentes
    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    // Elementos UI (igual que antes)
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');

    // Clase para manejar polling de la sala
    class RoomPollingConnection {
        constructor(roomId, playerId, onUpdate) {
            this.roomId = roomId;
            this.playerId = playerId;
            this.onUpdate = onUpdate;
            this.interval = null;
        }

        start() {
            this.interval = setInterval(() => this.checkRoom(), 3000);
            this.checkRoom(); // Llamada inmediata
        }

        async checkRoom() {
            try {
                const response = await fetch(`${API_URL}/room-info/${this.roomId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.onUpdate(data);
                    }
                }
            } catch (error) {
                console.error('Room polling error:', error);
                updateConnectionStatus('Error de conexión', true);
            }
        }

        async sendStartGame(initialCards) {
            try {
                const response = await fetch(`${API_URL}/start-game`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomId: this.roomId,
                        playerId: this.playerId,
                        initialCards: parseInt(initialCards)
                    })
                });

                if (!response.ok) {
                    throw new Error('Error al iniciar juego');
                }

                return await response.json();
            } catch (error) {
                console.error('Error al iniciar juego:', error);
                throw error;
            }
        }

        stop() {
            if (this.interval) {
                clearInterval(this.interval);
            }
        }
    }

    // Inicialización de la UI (igual que antes)
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

    // Mostrar información del jugador (igual que antes)
    function displayPlayerInfo() {
        const playerInfo = document.createElement('div');
        playerInfo.id = 'playerInfo';
        playerInfo.className = 'player-info';
        document.querySelector('.room-header').appendChild(playerInfo);
    }

    // Actualizar estado de conexión (igual que antes)
    function updateConnectionStatus(status, isError = false) {
        const statusElement = document.getElementById('connectionStatusText');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = isError ? 'error' : '';
        }
    }

    // Actualizar lista de jugadores (igual que antes)
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

    // Manejar inicio del juego (modificado para usar polling)
    async function handleStartGame() {
        try {
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';

            const connection = window.roomConnection;
            const result = await connection.sendStartGame(initialCardsSelect.value);

            if (result.success) {
                handleGameStart();
            } else {
                throw new Error(result.message || 'Error al iniciar juego');
            }
        } catch (error) {
            console.error('Error al iniciar juego:', error);
            showNotification('Error al iniciar el juego', true);
            startBtn.disabled = false;
            startBtn.textContent = 'Iniciar Juego';
        }
    }

    // Manejar inicio del juego (igual que antes)
    function handleGameStart() {
        if (window.roomConnection) {
            window.roomConnection.stop();
        }
        window.location.href = 'game.html';
    }

    // Inicializar la aplicación (modificado)
    function initialize() {
        initializeUI();

        // Crear conexión de polling
        const roomConnection = new RoomPollingConnection(
            roomId,
            playerId,
            (data) => {
                updatePlayersUI(data.players);
                if (data.gameStarted) {
                    handleGameStart();
                }
            }
        );
        roomConnection.start();

        // Guardar para acceso posterior
        window.roomConnection = roomConnection;
    }

    // Limpieza al salir (modificado)
    window.addEventListener('beforeunload', () => {
        if (window.roomConnection) {
            window.roomConnection.stop();
        }
    });

    // Iniciar
    initialize();
});