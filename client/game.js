document.addEventListener('DOMContentLoaded', () => {
    // Constantes del juego
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const endTurnButton = document.getElementById('endTurnBtn');
    const STATE_UPDATE_THROTTLE = 200;
    const TARGET_FPS = 60;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000;
    const CARD_WIDTH = 80;
    const CARD_HEIGHT = 120;
    const COLUMN_SPACING = 60;
    const CARD_SPACING = 15;
    const HISTORY_ICON_PULSE_INTERVAL = 20000; // 20 segundos
    const HISTORY_ICON_PULSE_DURATION = 500; // Duración de la animación en ms
    const HIGHLIGHT_COLOR = 'rgb(248, 51, 51)';
    const VALID_HIGHLIGHT_COLOR = 'rgb(67, 64, 250)';
    const INVALID_HIGHLIGHT_COLOR = 'rgb(248, 51, 51)';

    // Posiciones del tablero
    const BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3
    };
    const PLAYER_CARDS_Y = canvas.height * 0.6;
    const BUTTONS_Y = canvas.height * 0.85;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

    // Variables del juego
    const assetCache = new Map();
    let historyIcon = new Image();
    let historyIconsAnimation = {
        interval: null,
        lastPulseTime: Date.now(),
        isAnimating: false
    };
    let animationFrameId;
    let lastStateUpdate = 0;
    let lastRenderTime = 0;
    let reconnectAttempts = 0;
    let reconnectTimeout;
    let connectionStatus = 'disconnected';
    let dragStartCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let selectedCard = null;
    let socket;
    let surrenderBtn = document.getElementById('surrenderBtn');


    // Datos del jugador actual
    const currentPlayer = {
        id: sessionStorage.getItem('playerId'),
        name: sessionStorage.getItem('playerName'),
        isHost: sessionStorage.getItem('isHost') === 'true'
    };
    const roomId = sessionStorage.getItem('roomId');

    // Estado del juego
    let gameState = {
        players: [],
        yourCards: [],
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: null,
        remainingDeck: 98,
        initialCards: 6,
        cardsPlayedThisTurn: [],
        animatingCards: [],
        columnHistory: {
            asc1: [1],
            asc2: [1],
            desc1: [100],
            desc2: [100]
        }
    };

    class Card {
        constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
            this.value = value;
            this.x = x;
            this.y = y;
            this.width = CARD_WIDTH;
            this.height = CARD_HEIGHT;
            this.isPlayable = isPlayable;
            this.isPlayedThisTurn = isPlayedThisTurn;
            this.isFromCurrentTurn = isPlayedThisTurn;
            this.playedThisRound = false;
            this.radius = 10;
            this.shakeOffset = 0;
            this.hoverOffset = 0;
            this.backgroundColor = this.determineColor();
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.isDragging = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;
        }

        determineColor() {
            if (this === selectedCard) return '#FFFF99';

            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(move =>
                move.value === this.value &&
                ((move.position === 'asc1' && gameState.board.ascending[0] === this.value) ||
                    (move.position === 'asc2' && gameState.board.ascending[1] === this.value) ||
                    (move.position === 'desc1' && gameState.board.descending[0] === this.value) ||
                    (move.position === 'desc2' && gameState.board.descending[1] === this.value))
            );

            const isAnimatedCard = gameState.animatingCards.some(anim =>
                anim.card.value === this.value && anim.card.position === this.position
            );

            if (isPlayedThisTurn || isAnimatedCard || this.playedThisRound) return '#99CCFF';
            return '#FFFFFF';
        }

        updateColor() {
            this.backgroundColor = this.determineColor();
        }

        draw() {
            ctx.save();
            if (!this.isDragging) ctx.translate(this.shakeOffset, 0);

            ctx.shadowColor = this.isPlayedThisTurn || this.playedThisRound
                ? 'rgba(0, 100, 255, 0.3)'
                : 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 4;

            ctx.beginPath();
            ctx.roundRect(this.x, this.y - this.hoverOffset, this.width, this.height, this.radius);
            ctx.fillStyle = this.backgroundColor;
            ctx.fill();

            ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
            ctx.lineWidth = this.isPlayable ? 3 : 2;
            ctx.stroke();

            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'transparent';
            ctx.fillText(this.value.toString(), this.x + this.width / 2, this.y + this.height / 2 - this.hoverOffset);

            ctx.restore();
        }

        contains(x, y) {
            return x >= this.x && x <= this.x + this.width &&
                y >= this.y && y <= this.y + this.height;
        }

        startDrag(offsetX, offsetY) {
            this.isDragging = true;
            this.dragOffsetX = offsetX;
            this.dragOffsetY = offsetY;
            this.shadowColor = 'rgba(0, 0, 0, 0.5)';
            this.hoverOffset = 15;
        }

        endDrag() {
            this.isDragging = false;
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.hoverOffset = 0;
        }

        updateDragPosition(x, y) {
            if (this.isDragging) {
                this.x = x - this.dragOffsetX;
                this.y = y - this.dragOffsetY;
            }
        }
    }

    function loadAsset(url) {
        return assetCache.has(url) ? Promise.resolve(assetCache.get(url)) : new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                assetCache.set(url, img);
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede conectar al servidor. Recarga la página.', true);
            updateConnectionStatus('Desconectado', true);
            return;
        }

        updateConnectionStatus('Conectando...');

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');
            restoreGameState();

            // Solicitar estado completo inmediatamente al conectarse
            socket.send(JSON.stringify({
                type: 'get_full_state',
                playerId: currentPlayer.id,
                roomId: roomId,
                requireCurrentState: true
            }));

            // Solicitar estado específico del jugador
            socket.send(JSON.stringify({
                type: 'get_player_state',
                playerId: currentPlayer.id,
                roomId: roomId
            }));
        };

        socket.onclose = (event) => {
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                connectionStatus = 'reconnecting';
            } else {
                updateConnectionStatus('Desconectado', true);
                connectionStatus = 'disconnected';
            }
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
            updateConnectionStatus('Error de conexión', true);
            connectionStatus = 'error';
        };

        socket.onmessage = (event) => {
            try {
                const now = Date.now();
                const message = JSON.parse(event.data);

                if (message.type === 'player_state_update') {
                    const progressText = `${message.cardsPlayedThisTurn}/${message.minCardsRequired} carta(s) jugada(s)`;
                    const progressPercentage = (message.cardsPlayedThisTurn / message.minCardsRequired) * 100;

                    document.getElementById('progressText').textContent = progressText;
                    document.getElementById('progressBar').style.width = `${progressPercentage}%`;

                    gameState.players = message.players;
                    updatePlayersPanel();

                    gameState.currentTurn = message.currentTurn;
                    updateGameInfo();
                }

                if (message.type === 'pong') {
                    updateConnectionStatus('Conectado');
                    return;
                }

                if (message.type === 'gs' && now - lastStateUpdate < STATE_UPDATE_THROTTLE) {
                    return;
                }

                switch (message.type) {
                    case 'full_state_update':
                        handleFullStateUpdate(message);
                        break;
                    case 'init_game':
                        handleInitGame(message);
                        break;
                    case 'gs':
                        lastStateUpdate = now;
                        updateGameState(message.s);
                        updateGameInfo();
                        break;
                    // En socket.onmessage
                    case 'player_state_update':
                        // Actualizar el estado del jugador actual
                        const playerIndex = gameState.players.findIndex(p => p.id === message.playerId);
                        if (playerIndex !== -1) {
                            gameState.players[playerIndex].cardsPlayedThisTurn = message.cardsPlayedThisTurn || 0;
                            gameState.players[playerIndex].totalCardsPlayed = message.totalCardsPlayed || 0;
                        }

                        // Forzar actualización de UI
                        updateGameInfo();
                        break;
                    case 'game_started':
                        gameState.board = message.board || { ascending: [1, 1], descending: [100, 100] };
                        gameState.currentTurn = message.currentTurn;
                        gameState.remainingDeck = message.remainingDeck;
                        gameState.initialCards = message.initialCards;
                        gameState.gameStarted = true;
                        updateGameInfo();
                        updatePlayersPanel();
                        if (window.location.pathname.endsWith('sala.html')) {
                            window.location.href = 'game.html';
                        }
                        break;
                    case 'your_cards':
                        updatePlayerCards(message.cards);
                        updateGameInfo();
                        break;
                    case 'game_over':
                        handleGameOver(message.message);
                        break;
                    case 'notification':
                        showNotification(message.message, message.isError);
                        break;
                    case 'column_history':
                        if (!gameState.columnHistory[message.column]) {
                            gameState.columnHistory[message.column] = message.column.includes('asc') ? [1] : [100];
                        }
                        gameState.columnHistory[message.column] = message.history;
                        break;
                    case 'column_history_update':
                        updateColumnHistoryUI(message.column, message.history, message.newValue);
                        break;
                    case 'card_played':
                        handleOpponentCardPlayed(message);
                        updateGameInfo();
                        break;
                    case 'card_played_animated':
                        if (message.position.includes('asc')) {
                            const idx = message.position === 'asc1' ? 0 : 1;
                            gameState.board.ascending[idx] = message.cardValue;
                        } else {
                            const idx = message.position === 'desc1' ? 0 : 1;
                            gameState.board.descending[idx] = message.cardValue;
                        }

                        if (message.playerId !== currentPlayer.id) {
                            gameState.cardsPlayedThisTurn.push({
                                value: message.cardValue,
                                position: message.position,
                                playerId: message.playerId,
                                previousValue: message.previousValue
                            });
                        }
                        handleAnimatedCardPlay(message);
                        break;
                    case 'invalid_move':
                        if (message.playerId === currentPlayer.id && selectedCard) {
                            animateInvalidCard(selectedCard);
                        }
                        break;
                    case 'deck_updated':
                        handleDeckUpdated(message);
                        break;
                    case 'turn_changed':
                        gameState.cardsPlayedThisTurn = [];
                        gameState.currentTurn = message.newTurn;
                        gameState.remainingDeck = message.remainingDeck || gameState.remainingDeck;

                        const minCards = message.minCardsRequired !== undefined ?
                            message.minCardsRequired :
                            (gameState.remainingDeck > 0 ? 2 : 1);

                        // Actualizar el progreso para todos los jugadores
                        if (message.players) {
                            gameState.players = message.players;
                        }

                        updateGameInfo();

                        if (message.playerName) {
                            const notificationMsg = message.newTurn === currentPlayer.id ?
                                '¡Es tu turno!' :
                                `Turno de ${message.playerName}`;
                            showNotification(notificationMsg);
                        }
                        break;
                    case 'move_undone':
                        handleMoveUndone(message);
                        updateGameInfo();
                        break;
                    case 'room_reset':
                        gameState = {
                            players: message.players || [],
                            board: { ascending: [1, 1], descending: [100, 100] },
                            currentTurn: null,
                            yourCards: [],
                            remainingDeck: 98,
                            initialCards: 6,
                            cardsPlayedThisTurn: [],
                            animatingCards: [],
                            columnHistory: {
                                asc1: [1],
                                asc2: [1],
                                desc1: [100],
                                desc2: [100]
                            }
                        };
                        updateGameInfo();
                        break;
                    case 'player_update':
                        if (message.players) {
                            gameState.players = message.players;
                            updateGameInfo();
                        }
                        break;
                    default:
                        console.log('Mensaje no reconocido:', message);
                }
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        };
    }

    function restoreGameState() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            setTimeout(restoreGameState, 500);
            return;
        }

        socket.send(JSON.stringify({
            type: 'get_player_state',
            playerId: currentPlayer.id,
            roomId: roomId
        }));
    }

    function updateConnectionStatus(status, isError = false) {
        connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus') || createConnectionStatusElement();
        statusElement.textContent = `Estado: ${status}`;
        statusElement.className = isError ? 'connection-error' : 'connection-status';
    }

    function createConnectionStatusElement() {
        const panelContent = document.querySelector('.panel-content');
        const statusElement = document.createElement('p');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        const remainingDeckElement = document.getElementById('remainingDeck').parentNode;
        remainingDeckElement.parentNode.insertBefore(statusElement, remainingDeckElement.nextSibling);
        return statusElement;
    }

    function handleFullStateUpdate(message) {
        if (!message.room || !message.gameState) return;

        if (message.history) {
            gameState.columnHistory = {
                asc1: message.history.ascending1 || [1],
                asc2: message.history.ascending2 || [1],
                desc1: message.history.descending1 || [100],
                desc2: message.history.descending2 || [100]
            };
        }

        gameState.board = message.gameState.board || gameState.board;
        gameState.currentTurn = message.gameState.currentTurn || gameState.currentTurn;
        gameState.remainingDeck = message.gameState.remainingDeck || gameState.remainingDeck;
        gameState.initialCards = message.gameState.initialCards || gameState.initialCards;
        gameState.players = message.room.players || gameState.players;

        updateGameInfo();
    }

    function handleInitGame(message) {
        gameState.currentTurn = message.gameState.currentTurn;
        gameState.board = message.gameState.board;
        gameState.remainingDeck = message.gameState.remainingDeck;
        gameState.initialCards = message.gameState.initialCards || 6;

        gameState.columnHistory = {
            asc1: message.history?.ascending1 || [1],
            asc2: message.history?.ascending2 || [1],
            desc1: message.history?.descending1 || [100],
            desc2: message.history?.descending2 || [100]
        };

        if (message.gameState.gameStarted && message.yourCards) {
            updatePlayerCards(message.yourCards);
        }

        restoreGameState();
        updatePlayersPanel();
        updateGameInfo();
    }

    function showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => existing.remove(), 300);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        notification.style.animation = 'notificationEnter 0.3s forwards';

        document.body.appendChild(notification);

        const duration = (isError || message.includes('GAME OVER')) ? 3000 : 3000;

        setTimeout(() => {
            notification.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    function showColumnHistory(columnId) {
        const modal = document.getElementById('historyModal');
        const backdrop = document.getElementById('modalBackdrop');
        const title = document.getElementById('historyColumnTitle');
        const container = document.getElementById('historyCardsContainer');

        const columnNames = {
            asc1: 'Pila Ascendente 1 (↑)',
            asc2: 'Pila Ascendente 2 (↑)',
            desc1: 'Pila Descendente 1 (↓)',
            desc2: 'Pila Descendente 2 (↓)'
        };

        title.textContent = columnNames[columnId];
        container.innerHTML = '';

        const history = gameState.columnHistory[columnId] ||
            (columnId.includes('asc') ? [1] : [100]);

        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;

            if (index === history.length - 1) {
                cardElement.classList.add('recent');
            }

            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
    }

    function closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';
    }

    function isValidMove(cardValue, position) {
        const target = position.includes('asc')
            ? gameState.board.ascending[position === 'asc1' ? 0 : 1]
            : gameState.board.descending[position === 'desc1' ? 0 : 1];

        // Primero verificar las reglas especiales de diferencia exacta de 10
        if (position.includes('asc') && cardValue === target - 10) return true;
        if (position.includes('desc') && cardValue === target + 10) return true;

        // Luego verificar las reglas normales
        if (position.includes('asc') && cardValue > target) return true;
        if (position.includes('desc') && cardValue < target) return true;

        return false;
    }

    function getColumnPosition(position) {
        const index = ['asc1', 'asc2', 'desc1', 'desc2'].indexOf(position);
        return {
            x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * index,
            y: BOARD_POSITION.y
        };
    }

    function animateInvalidCard(card) {
        if (!card) return;

        const shakeAmount = 8;
        const shakeDuration = 200;
        const startTime = Date.now();

        function shake() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / shakeDuration;

            if (progress >= 1) {
                card.shakeOffset = 0;
                return;
            }

            card.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
            requestAnimationFrame(shake);
        }

        shake();
    }

    function resetCardsPlayedProgress() {
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent = '0/' + minCardsRequired + ' carta(s) jugada(s)';
        document.getElementById('progressBar').style.width = '0%';

        gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
            card.updateColor();
        });

        gameState.cardsPlayedThisTurn = [];
    }

    function handleMoveUndone(message) {
        if (message.playerId === currentPlayer.id) {
            const moveIndex = gameState.cardsPlayedThisTurn.findIndex(
                move => move.value === message.cardValue && move.position === message.position
            );

            if (moveIndex !== -1) {
                gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
            }

            if (message.position.includes('asc')) {
                const idx = message.position === 'asc1' ? 0 : 1;
                gameState.board.ascending[idx] = message.previousValue;
            } else {
                const idx = message.position === 'desc1' ? 0 : 1;
                gameState.board.descending[idx] = message.previousValue;
            }

            const card = new Card(message.cardValue, 0, 0, true, false);
            gameState.yourCards.push(card);
            updatePlayerCards(gameState.yourCards.map(c => c.value));
        }
    }

    function handleGameOver(message) {
        canvas.style.pointerEvents = 'none';
        endTurnButton.disabled = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';
        gameOverDiv.innerHTML = `
            <h2>¡GAME OVER!</h2>
            <p>${message}</p>
            <div class="game-over-buttons">
                <button id="returnToRoom" class="game-over-btn">Volver a la Sala</button>
            </div>
        `;

        document.body.appendChild(backdrop);
        backdrop.appendChild(gameOverDiv);

        setTimeout(() => {
            backdrop.style.opacity = '1';
            gameOverDiv.style.transform = 'translateY(0)';
        }, 10);

        document.getElementById('returnToRoom').addEventListener('click', async () => {
            try {
                const button = document.getElementById('returnToRoom');
                button.disabled = true;
                button.textContent = 'Cargando...';

                gameState.columnHistory = {
                    asc1: [1],
                    asc2: [1],
                    desc1: [100],
                    desc2: [100]
                };

                socket.send(JSON.stringify({
                    type: 'reset_room',
                    roomId: roomId,
                    playerId: currentPlayer.id,
                    resetHistory: true
                }));

                await new Promise(resolve => setTimeout(resolve, 500));
                window.location.href = 'sala.html';
            } catch (error) {
                console.error('Error al volver a la sala:', error);
                showNotification('Error al reiniciar la sala', true);
                const button = document.getElementById('returnToRoom');
                button.disabled = false;
                button.textContent = 'Volver a la Sala';
            }
        });
    }

    function handleDeckUpdated(message) {
        gameState.remainingDeck = message.remaining;
        updateGameInfo();
    }

    function updateGameState(newState) {
        if (!newState) return;

        if (newState.p) {
            updatePlayersPanel();
            gameState.players = newState.p.map(player => ({
                id: player.i,
                name: player.n || `Jugador_${player.i.slice(0, 4)}`,
                cardCount: player.c,
                isHost: player.h,
                cardsPlayedThisTurn: Number(player.s) || 0,
                totalCardsPlayed: Number(player.pt) || 0
            }));
        }

        gameState.board = newState.b || gameState.board;
        gameState.currentTurn = newState.t || gameState.currentTurn;
        gameState.remainingDeck = newState.d || gameState.remainingDeck;
        gameState.initialCards = newState.i || gameState.initialCards;

        if (newState.y) {
            updatePlayerCards(newState.y);
        }

        updatePlayersPanel();
        updateGameInfo();

        if (gameState.currentTurn !== currentPlayer.id) {
            selectedCard = null;
        }
    }

    function updateGameInfo() {
        const currentTurnElement = document.getElementById('currentTurn');
        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');
        const progressBarElement = document.getElementById('progressBar');

        if (!currentTurnElement || !remainingDeckElement || !progressTextElement || !progressBarElement) {
            setTimeout(updateGameInfo, 100);
            return;
        }

        const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id);
        const cardsPlayed = currentPlayerObj?.cardsPlayedThisTurn || 0;
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;

        // Actualizar UI
        currentTurnElement.textContent = gameState.currentTurn === currentPlayer.id
            ? 'Tu turno'
            : `Turno de ${gameState.players.find(p => p.id === gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;

        // Control botón Terminar Turno
        if (endTurnButton) {
            endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id;
            const remainingCards = minCardsRequired - cardsPlayed;
            endTurnButton.title = remainingCards > 0
                ? `Necesitas jugar ${remainingCards} carta(s) más`
                : 'Puedes terminar tu turno';

            endTurnButton.style.backgroundColor = cardsPlayed >= minCardsRequired ? '#2ecc71' : '#e74c3c';
        }

        // Control botón Rendirse (condiciones: es tu turno, hay baraja, menos de 2 jugadas y sin movimientos)
        const shouldShowSurrender = (
            gameState.currentTurn === currentPlayer.id &&
            gameState.remainingDeck > 0 &&
            cardsPlayed < 2 &&
            !hasValidMoves(gameState.yourCards, gameState.board)
        );

        surrenderBtn.style.display = shouldShowSurrender ? 'block' : 'none';
        endTurnButton.style.display = shouldShowSurrender ? 'none' : 'block';
    }

    // Función agregada para manejar la rendición
    function setupSurrenderButton() {
        surrenderBtn.addEventListener('click', () => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const confirmSurrender = confirm("¿Estás seguro que quieres rendirte? Esto terminará la partida.");
                if (confirmSurrender) {
                    socket.send(JSON.stringify({
                        type: 'surrender',
                        playerId: currentPlayer.id,
                        roomId: roomId
                    }));
                }
            }
        });
    }

    function handleOpponentCardPlayed(message) {
        if (message.playerId !== currentPlayer.id) {
            const position = message.position;
            const value = message.cardValue;

            if (position.includes('asc')) {
                const idx = position === 'asc1' ? 0 : 1;
                gameState.board.ascending[idx] = value;
            } else {
                const idx = position === 'desc1' ? 0 : 1;
                gameState.board.descending[idx] = value;
            }

            gameState.cardsPlayedThisTurn.push({
                value: value,
                position: position,
                playerId: message.playerId,
                previousValue: message.previousValue
            });

            const animCard = new Card(
                value,
                message.startX || BOARD_POSITION.x,
                message.startY || -CARD_HEIGHT * 1.5,
                false,
                true
            );
            animCard.isFromCurrentTurn = true;

            const boardCard = new Card(
                value,
                getColumnPosition(position).x,
                getColumnPosition(position).y,
                false,
                true
            );
            boardCard.isFromCurrentTurn = true;

            gameState.animatingCards.push({
                card: animCard,
                startTime: Date.now(),
                duration: 500,
                targetX: getColumnPosition(position).x,
                targetY: getColumnPosition(position).y,
                onComplete: () => {
                    gameState.boardCards = gameState.boardCards || [];
                    gameState.boardCards.push(boardCard);
                }
            });

            if (!gameState.columnHistory[position]) {
                gameState.columnHistory[position] = position.includes('asc') ? [1] : [100];
            }
            gameState.columnHistory[position].push(value);

            showNotification(`${message.playerName} jugó un ${value}`);
        }

        // Actualizar el contador para el jugador actual si es su turno
        if (gameState.currentTurn === currentPlayer.id) {
            const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id);
            if (currentPlayerObj) {
                currentPlayerObj.cardsPlayedThisTurn =
                    (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
                updateGameInfo(); // Actualizar UI inmediatamente
            }
        }
    }

    function updatePlayerCards(cards) {
        const isYourTurn = gameState.currentTurn === currentPlayer.id;
        const deckEmpty = gameState.remainingDeck === 0;
        const startX = (canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
        const startY = PLAYER_CARDS_Y;

        gameState.yourCards = cards.map((card, index) => {
            const value = card instanceof Card ? card.value : card;
            let playable = false;

            if (isYourTurn) {
                // Verificación más estricta cuando el mazo está vacío
                if (deckEmpty) {
                    playable = (
                        (value === gameState.board.ascending[0] - 10) ||
                        (value === gameState.board.ascending[1] - 10) ||
                        (value === gameState.board.descending[0] + 10) ||
                        (value === gameState.board.descending[1] + 10) ||
                        (value > gameState.board.ascending[0]) ||
                        (value > gameState.board.ascending[1]) ||
                        (value < gameState.board.descending[0]) ||
                        (value < gameState.board.descending[1])
                    );
                } else {
                    playable = (
                        isValidMove(value, 'asc1') ||
                        isValidMove(value, 'asc2') ||
                        isValidMove(value, 'desc1') ||
                        isValidMove(value, 'desc2')
                    );
                }
            }

            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                move => move.value === value && move.playerId === currentPlayer.id
            );

            if (card instanceof Card) {
                card.x = startX + index * (CARD_WIDTH + CARD_SPACING);
                card.y = startY;
                card.isPlayable = playable;
                card.isPlayedThisTurn = isPlayedThisTurn;
                card.backgroundColor = isPlayedThisTurn ? '#99CCFF' : '#FFFFFF';
                return card;
            } else {
                return new Card(
                    value,
                    startX + index * (CARD_WIDTH + CARD_SPACING),
                    startY,
                    playable,
                    isPlayedThisTurn
                );
            }
        });
    }

    function updateColumnHistoryUI(column, history) {
        if (!gameState.columnHistory[column]) {
            gameState.columnHistory[column] = column.includes('asc') ? [1] : [100];
        }
        gameState.columnHistory[column] = history;
    }

    function drawHistoryIcons() {
        if (!historyIcon.complete || historyIcon.naturalWidth === 0) return;

        const shouldAnimate = gameState.currentTurn === currentPlayer.id;
        const pulseProgress = shouldAnimate ? calculatePulseProgress() : 0;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const baseX = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const baseY = HISTORY_ICON_Y;

            const scale = shouldAnimate ? (1 + 0.2 * pulseProgress) : 1;

            ctx.save();
            ctx.translate(baseX + 20, baseY + 20);
            ctx.scale(scale, scale);
            ctx.translate(-20, -20);

            ctx.drawImage(historyIcon, 0, 0, 40, 40);
            ctx.restore();
        });
    }

    function calculatePulseProgress() {
        const now = Date.now();
        const timeSinceLastPulse = (now - historyIconsAnimation.lastPulseTime) % HISTORY_ICON_PULSE_INTERVAL;

        if (gameState.currentTurn === currentPlayer.id &&
            timeSinceLastPulse < HISTORY_ICON_PULSE_DURATION) {
            return Math.sin((timeSinceLastPulse / HISTORY_ICON_PULSE_DURATION) * Math.PI);
        }

        return 0;
    }

    function handleMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        startDrag(x, y);
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        startDrag(x, y);
    }

    function startDrag(x, y) {
        const clickedCard = gameState.yourCards.find(card => card.contains(x, y));
        if (clickedCard && clickedCard.isPlayable && gameState.currentTurn === currentPlayer.id) {
            dragStartCard = clickedCard;
            dragStartX = x;
            dragStartY = y;
            isDragging = true;
            dragStartCard.startDrag(x - dragStartCard.x, y - dragStartCard.y);
            selectedCard = dragStartCard;
        }
    }

    function handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        updateDrag(x, y);
    }

    function handleTouchMove(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        updateDrag(x, y);
    }

    function updateDrag(x, y) {
        if (isDragging && dragStartCard) {
            dragStartCard.updateDragPosition(x, y);
        }
    }

    function handleMouseUp(e) {
        endDrag(e);
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        if (e.changedTouches.length > 0) {
            const fakeMouseEvent = new MouseEvent('mouseup', {
                clientX: e.changedTouches[0].clientX,
                clientY: e.changedTouches[0].clientY
            });
            endDrag(fakeMouseEvent);
        }
    }

    function endDrag(e) {
        if (isDragging && dragStartCard) {
            const rect = canvas.getBoundingClientRect();
            let clientX, clientY;

            if (e instanceof MouseEvent) {
                clientX = e.clientX;
                clientY = e.clientY;
            } else if (e instanceof TouchEvent && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                dragStartCard.endDrag();
                dragStartCard = null;
                isDragging = false;
                return;
            }

            const x = clientX - rect.left;
            const y = clientY - rect.top;

            const targetColumn = getClickedColumn(x, y);
            if (targetColumn) {
                playCard(dragStartCard.value, targetColumn);
            } else {
                const cardIndex = gameState.yourCards.findIndex(c => c === dragStartCard);
                if (cardIndex !== -1) {
                    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 +
                        cardIndex * (CARD_WIDTH + CARD_SPACING);
                    dragStartCard.x = startX;
                    dragStartCard.y = PLAYER_CARDS_Y;
                }
            }

            dragStartCard.endDrag();
            dragStartCard = null;
            isDragging = false;
            selectedCard = null;
        }
    }

    function getClickedColumn(x, y) {
        if (y < BOARD_POSITION.y || y > BOARD_POSITION.y + CARD_HEIGHT) return null;

        const columns = [
            { x: BOARD_POSITION.x, id: 'asc1' },
            { x: BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, id: 'asc2' },
            { x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, id: 'desc1' },
            { x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, id: 'desc2' }
        ];

        const column = columns.find(col => x >= col.x && x <= col.x + CARD_WIDTH);
        return column ? column.id : null;
    }

    function handleCanvasClick(e) {
        if (isDragging) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const iconX = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const iconY = HISTORY_ICON_Y;

            if (x >= iconX && x <= iconX + 40 && y >= iconY && y <= iconY + 40) {
                return showColumnHistory(col);
            }
        });

        if (gameState.currentTurn !== currentPlayer.id) {
            return showNotification('No es tu turno', true);
        }

        const clickedColumn = getClickedColumn(x, y);
        if (clickedColumn && selectedCard) {
            playCard(selectedCard.value, clickedColumn);
            return;
        }

        const clickedCard = gameState.yourCards.find(card => card.contains(x, y));
        if (clickedCard) {
            selectedCard = clickedCard.isPlayable ? clickedCard : null;
            if (!clickedCard.isPlayable) {
                showNotification('No puedes jugar esta carta ahora', true);
                animateInvalidCard(clickedCard);
            }
        } else {
            selectedCard = null;
        }
    }

    function playCard(cardValue, position) {
        if (!selectedCard) return;

        if (!isValidMove(cardValue, position)) {
            showNotification('Movimiento inválido', true);
            animateInvalidCard(selectedCard);
            return;
        }

        const previousValue = position.includes('asc')
            ? gameState.board.ascending[position === 'asc1' ? 0 : 1]
            : gameState.board.descending[position === 'desc1' ? 0 : 1];

        if (position.includes('asc')) {
            const idx = position === 'asc1' ? 0 : 1;
            gameState.board.ascending[idx] = cardValue;
        } else {
            const idx = position === 'desc1' ? 0 : 1;
            gameState.board.descending[idx] = cardValue;
        }

        socket.send(JSON.stringify({
            type: 'play_card',
            playerId: currentPlayer.id,
            cardValue: cardValue,
            position: position,
            previousValue: previousValue,
            isFirstMove: gameState.cardsPlayedThisTurn.length === 0
        }));

        const cardIndex = gameState.yourCards.findIndex(c => c === selectedCard);
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id);
        if (currentPlayerObj) {
            currentPlayerObj.cardsPlayedThisTurn =
                (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
        }

        updateGameInfo(); // Actualizar UI inmediatamente

        selectedCard = null;
        updateCardsPlayedUI();
    }

    function updateCardsPlayedUI() {
        const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === currentPlayer.id
        ).length;

        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent =
            `${currentPlayerCardsPlayed + 1}/${minCardsRequired} carta(s) jugada(s)`;

        const progressPercentage = Math.min(((currentPlayerCardsPlayed + 1) / minCardsRequired) * 100, 100);
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;
    }

    // Función hasValidMoves (actualizada para reutilización)
    function hasValidMoves(cards, board) {
        if (!cards || !board) return false;

        return cards.some(card => {
            const canPlayAsc1 = card.value > board.ascending[0] || card.value === board.ascending[0] - 10;
            const canPlayAsc2 = card.value > board.ascending[1] || card.value === board.ascending[1] - 10;
            const canPlayDesc1 = card.value < board.descending[0] || card.value === board.descending[0] + 10;
            const canPlayDesc2 = card.value < board.descending[1] || card.value === board.descending[1] + 10;

            return canPlayAsc1 || canPlayAsc2 || canPlayDesc1 || canPlayDesc2;
        });
    }

    function endTurn() {
        const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id);
        const cardsPlayed = currentPlayerObj?.cardsPlayedThisTurn || 0;
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;

        if (cardsPlayed < minCardsRequired) {
            const remainingCards = minCardsRequired - cardsPlayed;
            showNotification(`Necesitas jugar ${remainingCards} carta(s) más para terminar tu turno`, true);
            return;
        }

        socket.send(JSON.stringify({
            type: 'end_turn',
            playerId: currentPlayer.id,
            roomId: roomId
        }));


    }

    function drawBoard() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.roundRect(
            BOARD_POSITION.x - 25,
            BOARD_POSITION.y - 50,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 50,
            CARD_HEIGHT + 110,
            15
        );
        ctx.fill();

        if (selectedCard || isDragging) {
            const currentCard = selectedCard || dragStartCard;
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = isValidMove(currentCard.value, col);
                const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i;

                ctx.fillStyle = isValid ? VALID_HIGHLIGHT_COLOR :
                    (isDragging ? INVALID_HIGHLIGHT_COLOR : HIGHLIGHT_COLOR);
                ctx.beginPath();
                ctx.roundRect(
                    x - 5,
                    BOARD_POSITION.y - 10,
                    CARD_WIDTH + 10,
                    CARD_HEIGHT + 20,
                    15
                );
                ctx.fill();
            });
        }

        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2;
            ctx.fillText(i < 2 ? '↑' : '↓', x, BOARD_POSITION.y - 25);
        });

        ctx.shadowColor = 'transparent';

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const value = i < 2 ? gameState.board.ascending[i % 2] : gameState.board.descending[i % 2];

            const wasPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                move => move.value === value && move.position === col
            );

            const card = new Card(
                value,
                BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i,
                BOARD_POSITION.y,
                false,
                wasPlayedThisTurn
            );

            card.draw();
        });

        handleCardAnimations();
        if (gameState.boardCards) {
            gameState.boardCards.forEach(card => card.draw());
        }
    }

    function drawPlayerCards() {
        const backgroundHeight = CARD_HEIGHT + 30;
        const backgroundWidth = gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING) + 40;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.roundRect(
            (canvas.width - backgroundWidth) / 2,
            PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        ctx.fill();

        gameState.yourCards.forEach((card, index) => {
            if (card && card !== dragStartCard) {
                card.x = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 +
                    index * (CARD_WIDTH + CARD_SPACING);
                card.y = PLAYER_CARDS_Y;
                card.hoverOffset = card === selectedCard ? 10 : 0;
                card.draw();
            }
        });
    }

    function createPlayersPanel() {
        const panel = document.createElement('div');
        panel.id = 'playersPanel';
        panel.className = 'players-panel';
        document.body.appendChild(panel);
        return panel;
    }

    function updatePlayersPanel() {
        const panel = document.getElementById('playersPanel') || createPlayersPanel();

        panel.innerHTML = `
            <h3>Jugadores (${gameState.players.length})</h3>
            <ul>
                ${gameState.players.map(player => {
            const displayName = player.name || `Jugador_${player.id.slice(0, 4)}`;
            const cardCount = player.cardCount || (player.cards ? player.cards.length : 0);

            return `
                        <li class="${player.id === currentPlayer.id ? 'you' : ''} 
                                   ${player.id === gameState.currentTurn ? 'current-turn' : ''}">
                            <span class="player-name">${displayName}</span>
                            <span class="card-count">🃏 ${cardCount}</span>
                            ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                        </li>
                    `;
        }).join('')}
            </ul>
        `;
    }

    function handleCardAnimations() {
        const now = Date.now();
        for (let i = gameState.animatingCards.length - 1; i >= 0; i--) {
            const anim = gameState.animatingCards[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            anim.card.x = anim.fromX + (anim.targetX - anim.fromX) * progress;
            anim.card.y = anim.fromY + (anim.targetY - anim.fromY) * progress;

            ctx.save();
            ctx.shadowColor = 'rgba(0, 100, 255, 0.7)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;
            anim.card.draw();
            ctx.restore();

            if (progress === 1) {
                if (anim.onComplete) anim.onComplete();
                gameState.animatingCards.splice(i, 1);
            }
        }
    }

    function handleAnimatedCardPlay(message) {
        const position = message.position;
        const value = message.cardValue;

        if (position.includes('asc')) {
            const idx = position === 'asc1' ? 0 : 1;
            gameState.board.ascending[idx] = value;
        } else {
            const idx = position === 'desc1' ? 0 : 1;
            gameState.board.descending[idx] = value;
        }

        if (message.playerId !== currentPlayer.id) {
            const card = new Card(
                value,
                0,
                0,
                false,
                true
            );
            card.playedThisRound = true;

            const targetPos = getColumnPosition(position);

            gameState.animatingCards.push({
                card: card,
                startTime: Date.now(),
                duration: 250,
                targetX: targetPos.x,
                targetY: targetPos.y,
                fromX: targetPos.x,
                fromY: -CARD_HEIGHT * 2,
                isOpponentCard: true
            });
        }

        gameState.cardsPlayedThisTurn.push({
            value: value,
            position: position,
            playerId: message.playerId,
            previousValue: message.previousValue,
            persistColor: message.persistColor || true
        });

        if (message.playerId !== currentPlayer.id) {
            showNotification(`${message.playerName} jugó un ${value}`);
        }
    }

    function gameLoop(timestamp) {
        if (timestamp - lastRenderTime < 1000 / TARGET_FPS) {
            requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#1a6b1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawBoard();
        drawHistoryIcons();
        handleCardAnimations();
        drawPlayerCards();

        if (isDragging && dragStartCard) {
            dragStartCard.draw();
        }

        requestAnimationFrame(gameLoop);
    }

    function cleanup() {
        clearInterval(historyIconsAnimation.interval);
        historyIconsAnimation.interval = null;
        historyIconsAnimation.isAnimating = false;

        if (socket) {
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
            if (socket.readyState === WebSocket.OPEN) {
                socket.close(1000, 'Juego terminado');
            }
            socket = null;
        }

        clearTimeout(reconnectTimeout);
        cancelAnimationFrame(animationFrameId);

        const events = {
            click: handleCanvasClick,
            mousedown: handleMouseDown,
            mousemove: handleMouseMove,
            mouseup: handleMouseUp,
            mouseleave: handleMouseUp,
            touchstart: handleTouchStart,
            touchmove: handleTouchMove,
            touchend: handleTouchEnd
        };

        Object.entries(events).forEach(([event, handler]) => {
            canvas.removeEventListener(event, handler);
        });

        document.getElementById('endTurnBtn')?.removeEventListener('click', endTurn);
        document.getElementById('modalBackdrop')?.removeEventListener('click', closeHistoryModal);

        document.querySelectorAll('.notification, .game-over-backdrop').forEach(el => el.remove());

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        gameState.animatingCards = [];
        assetCache.clear();
    }

    function initGame() {
        if (!canvas || !ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        Promise.all([
            loadAsset('cards-icon.png').then(img => { if (img) historyIcon = img; })
        ]).then(() => {
            canvas.width = 800;
            canvas.height = 700;

            endTurnButton.addEventListener('click', endTurn);
            canvas.addEventListener('click', handleCanvasClick);
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseleave', handleMouseUp);
            canvas.addEventListener('touchstart', handleTouchStart);
            canvas.addEventListener('touchmove', handleTouchMove);
            canvas.addEventListener('touchend', handleTouchEnd);
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);
            window.addEventListener('beforeunload', cleanup);

            const controlsDiv = document.querySelector('.game-controls');
            if (controlsDiv) {
                controlsDiv.style.bottom = `${canvas.height - BUTTONS_Y}px`;
            }

            historyIconsAnimation = {
                interval: null,
                lastPulseTime: Date.now(),
                pulseDuration: 500,
                pulseInterval: 20000
            };

            connectWebSocket();
            setTimeout(() => {
                updatePlayersPanel();
            }, 1000); // Pequeño delay para asegurar la conexión
            setupSurrenderButton(); // Agregar esta línea
            gameLoop();
        });
    }

    initGame();
});