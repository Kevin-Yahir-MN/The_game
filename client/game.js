document.addEventListener('DOMContentLoaded', () => {
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
    const HISTORY_ICON_PULSE_INTERVAL = 20000;
    const HISTORY_ICON_PULSE_DURATION = 500;
    const HIGHLIGHT_COLOR = 'rgb(248, 51, 51)';
    const VALID_HIGHLIGHT_COLOR = 'rgb(67, 64, 250)';
    const INVALID_HIGHLIGHT_COLOR = 'rgb(248, 51, 51)';

    const BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3
    };
    const PLAYER_CARDS_Y = canvas.height * 0.6;
    const BUTTONS_Y = canvas.height * 0.85;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

    const assetCache = new Map();
    let historyIcon = new Image();
    let historyIconsAnimation = { interval: null, lastPulseTime: Date.now(), isAnimating: false };
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
    let socket;
    let animationQueue = [];
    let dirtyAreas = [];

    const currentPlayer = {
        id: sanitizeInput(sessionStorage.getItem('playerId')),
        name: sanitizeInput(sessionStorage.getItem('playerName')),
        isHost: sessionStorage.getItem('isHost') === 'true'
    };

    const roomId = sanitizeInput(sessionStorage.getItem('roomId'));
    if (!roomId) {
        window.location.href = 'sala.html';
        return;
    }

    let gameState = {
        players: [],
        yourCards: [],
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: null,
        remainingDeck: 98,
        initialCards: 6,
        cardsPlayedThisTurn: [],
        animatingCards: [],
        columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] },
        boardCards: [],
        historyIconAreas: []
    };

    function sanitizeInput(input) {
        return input ? input.replace(/[^a-zA-Z0-9-_]/g, '') : '';
    }

    function log(message, data) {
        console.log(`[${new Date().toISOString()}] ${message}`, data);
    }

    class Card {
        constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
            // Validar que value sea un número
            this.value = typeof value === 'number' ? value : 0;

            // Validar coordenadas
            this.x = typeof x === 'number' ? x : 0;
            this.y = typeof y === 'number' ? y : 0;

            this.width = CARD_WIDTH;
            this.height = CARD_HEIGHT;
            this.isPlayable = !!isPlayable;
            this.isPlayedThisTurn = !!isPlayedThisTurn;
            this.isFromCurrentTurn = !!isPlayedThisTurn;
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
            // Verificar si gameState y sus propiedades existen
            if (!gameState || !gameState.cardsPlayedThisTurn || !gameState.animatingCards) {
                return '#FFFFFF'; // Color por defecto si no hay estado
            }

            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(move => {
                // Verificar que move y sus propiedades existan
                return move && move.value === this.value &&
                    ((move.position === 'asc1' && gameState.board.ascending[0] === this.value) ||
                        (move.position === 'asc2' && gameState.board.ascending[1] === this.value) ||
                        (move.position === 'desc1' && gameState.board.descending[0] === this.value) ||
                        (move.position === 'desc2' && gameState.board.descending[1] === this.value));
            });

            const isAnimatedCard = gameState.animatingCards.some(anim => {
                // Verificar que anim y anim.card existan
                return anim && anim.card && anim.card.value === this.value &&
                    (anim.card.position === this.position || anim.column === this.position);
            });

            return (isPlayedThisTurn || isAnimatedCard || this.playedThisRound) ? '#99CCFF' : '#FFFFFF';
        }

        updateColor() {
            this.backgroundColor = this.determineColor();
        }

        draw() {
            ctx.save();
            if (!this.isDragging) ctx.translate(this.shakeOffset, 0);

            ctx.shadowColor = this.isPlayedThisTurn || this.playedThisRound
                ? 'rgba(0, 100, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
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
            markDirty(this.x, this.y, this.width, this.height);
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
            markDirty(this.x, this.y, this.width, this.height);
        }

        endDrag() {
            this.isDragging = false;
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.hoverOffset = 0;
            markDirty(this.x, this.y, this.width, this.height);
        }

        updateDragPosition(x, y) {
            if (this.isDragging) {
                markDirty(this.x, this.y, this.width, this.height);
                this.x = x - this.dragOffsetX;
                this.y = y - this.dragOffsetY;
                markDirty(this.x, this.y, this.width, this.height);
            }
        }
    }

    function markDirty(x, y, width, height) {
        dirtyAreas.push({ x, y, width, height });
    }

    function clearDirtyAreas() {
        dirtyAreas = [];
    }

    function getStackValue(position) {
        const [stack, idx] = position.includes('asc')
            ? [gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [gameState.board.descending, position === 'desc1' ? 0 : 1];
        return stack[idx];
    }

    function updateStack(position, value) {
        const [stack, idx] = position.includes('asc')
            ? [gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [gameState.board.descending, position === 'desc1' ? 0 : 1];
        stack[idx] = value;
    }

    function isValidMove(cardValue, position) {
        const currentValue = getStackValue(position);
        const isAscending = position.includes('asc');
        const exactDifference = isAscending
            ? cardValue === currentValue - 10
            : cardValue === currentValue + 10;
        const normalMove = isAscending
            ? cardValue > currentValue
            : cardValue < currentValue;
        return exactDifference || normalMove;
    }

    function addToHistory(position, value) {
        const history = gameState.columnHistory[position] ||
            (position.includes('asc') ? [1] : [100]);
        if (history[history.length - 1] !== value) {
            history.push(value);
            gameState.columnHistory[position] = history;
        }
    }

    function recordCardPlayed(cardValue, position, playerId, previousValue) {
        if (playerId !== currentPlayer.id) {
            gameState.cardsPlayedThisTurn.push({
                value: cardValue,
                position,
                playerId,
                previousValue
            });
        }
        updateGameInfo();
    }

    function isMyTurn() {
        return gameState.currentTurn === currentPlayer.id;
    }

    function setNextTurn() {
        const currentIndex = gameState.players.findIndex(p => p.id === gameState.currentTurn);
        let nextIndex = (currentIndex + 1) % gameState.players.length;
        gameState.currentTurn = gameState.players[nextIndex].id;
    }

    function loadAsset(url) {
        if (assetCache.has(url)) {
            return Promise.resolve(assetCache.get(url));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                assetCache.set(url, img);
                resolve(img);
            };
            img.onerror = (err) => {
                log('Error loading asset', { url, error: err });
                reject(err);
            };
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

        if (socket) {
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
            if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
                socket.close();
            }
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

        socket.onopen = () => {
            clearTimeout(reconnectTimeout);
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');
            restoreGameState();

            socket.send(JSON.stringify({
                type: 'get_full_state',
                playerId: currentPlayer.id,
                roomId: roomId,
                requireCurrentState: true
            }));

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
                reconnectTimeout = setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                connectionStatus = 'reconnecting';
            } else {
                updateConnectionStatus('Desconectado', true);
                connectionStatus = 'disconnected';
            }
        };

        socket.onerror = (error) => {
            log('Error en WebSocket', error);
            updateConnectionStatus('Error de conexión', true);
            connectionStatus = 'error';
        };

        socket.onmessage = (event) => {
            try {
                const now = Date.now();
                const message = validateMessage(JSON.parse(event.data));

                if (!message) return;

                if (message.errorCode === 'MISSING_REQUIRED_FIELDS') {
                    showNotification(`Error: ${message.message}`, true);
                    return;
                }

                if (message.type === 'player_state_update') {
                    handlePlayerStateUpdate(message);
                }

                if (message.type === 'pong') {
                    updateConnectionStatus('Conectado');
                    return;
                }

                if (message.type === 'gs' && now - lastStateUpdate < STATE_UPDATE_THROTTLE) {
                    return;
                }

                switch (message.type) {
                    case 'full_state_update': handleFullStateUpdate(message); break;
                    case 'init_game': handleInitGame(message); break;
                    case 'gs': handleGameStateUpdate(message); break;
                    case 'game_started': handleGameStarted(message); break;
                    case 'your_cards': updatePlayerCards(message.cards); break;
                    case 'game_over': handleGameOver(message.message, true); break;
                    case 'notification': showNotification(message.message, message.isError); break;
                    case 'column_history': updateColumnHistory(message); break;
                    case 'column_history_update': updateColumnHistoryUI(message.column, message.history); break;
                    case 'card_played': handleOpponentCardPlayed(message); break;
                    case 'card_played_animated': handleAnimatedCardPlay(message); break;
                    case 'deck_empty': handleDeckEmpty(); break;
                    case 'deck_updated': handleDeckUpdated(message); break;
                    case 'turn_changed': handleTurnChanged(message); break;
                    case 'deck_empty_state': handleDeckEmptyState(message); break;
                    case 'deck_empty_notification': showNotification(message.message, message.isError); break;
                    case 'move_undone': handleMoveUndone(message); break;
                    case 'room_reset': resetGameState(); break;
                    case 'player_update': handlePlayerUpdate(message); break;
                    default: log('Mensaje no reconocido:', message);
                }
            } catch (error) {
                log('Error procesando mensaje:', { error, data: event.data });
            }
        };
    }

    function validateMessage(message) {
        if (!message || typeof message !== 'object') return null;
        if (!message.type || typeof message.type !== 'string') return null;
        return message;
    }

    function handlePlayerStateUpdate(message) {
        const progressText = `${message.cardsPlayedThisTurn}/${message.minCardsRequired} carta(s) jugada(s)`;
        const progressPercentage = (message.cardsPlayedThisTurn / message.minCardsRequired) * 100;

        document.getElementById('progressText').textContent = progressText;
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;

        if (message.players) {
            gameState.players = message.players;
            updatePlayersPanel();
        }
        gameState.currentTurn = message.currentTurn;
        updateGameInfo();
    }

    function handleGameStateUpdate(message) {
        lastStateUpdate = Date.now();
        updateGameState(message.s);
        updateGameInfo();
    }

    function handleGameStarted(message) {
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
    }

    function updateColumnHistory(message) {
        gameState.columnHistory = {
            asc1: message.history.ascending1 || [1],
            asc2: message.history.ascending2 || [1],
            desc1: message.history.descending1 || [100],
            desc2: message.history.descending2 || [100]
        };
    }

    function handleDeckEmpty() {
        gameState.remainingDeck = 0;
        document.getElementById('remainingDeck').textContent = '0';
        updatePlayerCards(gameState.yourCards.map(c => c.value));
        updateGameInfo();
    }

    function handleTurnChanged(message) {
        gameState.cardsPlayedThisTurn = [];
        gameState.currentTurn = message.newTurn;
        if (message.deckEmpty !== undefined) {
            gameState.remainingDeck = message.remainingDeck || gameState.remainingDeck;
            document.getElementById('remainingDeck').textContent = gameState.remainingDeck;
            const minCardsRequired = message.deckEmpty ? 1 : 2;
            document.getElementById('progressText').textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
            document.getElementById('progressBar').style.width = '0%';
        }
        updatePlayerCards(gameState.yourCards.map(c => c.value));
        if (message.playerName) {
            const notificationMsg = message.newTurn === currentPlayer.id
                ? '¡Es tu turno!' + (message.deckEmpty ? ' (Mazo vacío)' : '')
                : `Turno de ${message.playerName}`;
            showNotification(notificationMsg);
        }
    }

    function handleDeckEmptyState(message) {
        gameState.remainingDeck = message.remaining;
        document.getElementById('remainingDeck').textContent = message.remaining;
        const minCardsRequired = message.minCardsRequired || 1;
        document.getElementById('progressText').textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
        document.getElementById('progressBar').style.width = '0%';
        updatePlayerCards(gameState.yourCards.map(c => c.value));
        updateGameInfo();
    }

    function handlePlayerUpdate(message) {
        if (message.players) {
            gameState.players = message.players;
            updateGameInfo();
        }
    }

    function resetGameState() {
        gameState = {
            players: [],
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: null,
            yourCards: [],
            remainingDeck: 98,
            initialCards: 6,
            cardsPlayedThisTurn: [],
            animatingCards: [],
            columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] },
            boardCards: []
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

        setTimeout(() => {
            notification.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => notification.remove(), 300);
        }, isError || message.includes('GAME OVER') ? 3000 : 3000);
    }

    function showColumnHistory(columnId) {
        // Solo permitir abrir un historial a la vez
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

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

        const history = gameState.columnHistory[columnId] || (columnId.includes('asc') ? [1] : [100]);

        // Mostrar en orden cronológico (primera -> última) y destacar la última
        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            // Usar history.length - 1 para identificar el último elemento
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
        canvas.style.pointerEvents = 'none';
    }

    function closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';

        // Restaurar interacción con el juego
        canvas.style.pointerEvents = 'auto';
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
        const originalX = card.x;
        const originalY = card.y;

        function shake() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / shakeDuration;

            if (progress >= 1) {
                card.shakeOffset = 0;
                card.x = originalX;
                card.y = originalY;
                markDirty(card.x, card.y, card.width, card.height);
                return;
            }

            card.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
            card.x = originalX + Math.sin(progress * Math.PI * 16) * shakeAmount * (1 - progress);
            markDirty(card.x, card.y, card.width, card.height);
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

            updateStack(message.position, message.previousValue);

            const card = new Card(message.cardValue, 0, 0, true, false);
            gameState.yourCards.push(card);
            updatePlayerCards(gameState.yourCards.map(c => c.value));
        }
    }

    function handleGameOver(message, isError = false) {
        canvas.style.pointerEvents = 'none';
        endTurnButton.disabled = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const isVictory = message.includes('Victoria') || message.includes('ganan');
        const title = isVictory ? '¡VICTORIA!' : '¡GAME OVER!';
        const titleColor = isVictory ? '#2ecc71' : '#e74c3c';

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';
        gameOverDiv.innerHTML = `
            <h2 style="color: ${titleColor}">${title}</h2>
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

                resetGameState();

                socket.send(JSON.stringify({
                    type: 'reset_room',
                    roomId: roomId,
                    playerId: currentPlayer.id,
                    resetHistory: true
                }));

                await new Promise(resolve => setTimeout(resolve, 500));
                window.location.href = 'sala.html';
            } catch (error) {
                log('Error al volver a la sala:', error);
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

        currentTurnElement.textContent = gameState.currentTurn === currentPlayer.id
            ? 'Tu turno'
            : `Turno de ${gameState.players.find(p => p.id === gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;

        if (endTurnButton) {
            endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id;
            const remainingCards = minCardsRequired - cardsPlayed;
            endTurnButton.title = remainingCards > 0
                ? `Necesitas jugar ${remainingCards} carta(s) más`
                : 'Puedes terminar tu turno';

            endTurnButton.style.backgroundColor = cardsPlayed >= minCardsRequired ? '#2ecc71' : '#e74c3c';
        }
    }

    function handleOpponentCardPlayed(message) {
        if (message.playerId !== currentPlayer.id) {
            updateStack(message.position, message.cardValue);
            recordCardPlayed(message.cardValue, message.position, message.playerId, message.previousValue);
            addToHistory(message.position, message.cardValue);
            showNotification(`${message.playerName || 'Un jugador'} jugó un ${message.cardValue}`);
        }

        if (gameState.currentTurn === currentPlayer.id) {
            const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id);
            if (currentPlayerObj) {
                currentPlayerObj.cardsPlayedThisTurn = (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
                updateGameInfo();
            }
        }
    }

    function updatePlayerCards(cards) {
        const isYourTurn = isMyTurn();
        const deckEmpty = gameState.remainingDeck === 0;
        const startX = (canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
        const startY = PLAYER_CARDS_Y;

        // Preservar las instancias de carta existentes
        const newCards = cards.map((cardValue, index) => {
            // Buscar si ya existe una carta con este valor
            const existingCard = gameState.yourCards.find(c =>
                c.value === cardValue && !c.isDragging
            );

            if (existingCard) {
                existingCard.x = startX + index * (CARD_WIDTH + CARD_SPACING);
                existingCard.y = startY;
                existingCard.isPlayable = isYourTurn && (
                    deckEmpty
                        ? (cardValue === gameState.board.ascending[0] - 10 ||
                            cardValue === gameState.board.ascending[1] - 10 ||
                            cardValue === gameState.board.descending[0] + 10 ||
                            cardValue === gameState.board.descending[1] + 10 ||
                            cardValue > gameState.board.ascending[0] ||
                            cardValue > gameState.board.ascending[1] ||
                            cardValue < gameState.board.descending[0] ||
                            cardValue < gameState.board.descending[1])
                        : (isValidMove(cardValue, 'asc1') ||
                            isValidMove(cardValue, 'asc2') ||
                            isValidMove(cardValue, 'desc1') ||
                            isValidMove(cardValue, 'desc2'))
                );
                existingCard.isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                    move => move.value === cardValue && move.playerId === currentPlayer.id
                );
                return existingCard;
            } else {
                return new Card(
                    cardValue,
                    startX + index * (CARD_WIDTH + CARD_SPACING),
                    startY,
                    isYourTurn && (
                        deckEmpty
                            ? (cardValue === gameState.board.ascending[0] - 10 ||
                                cardValue === gameState.board.ascending[1] - 10 ||
                                cardValue === gameState.board.descending[0] + 10 ||
                                cardValue === gameState.board.descending[1] + 10 ||
                                cardValue > gameState.board.ascending[0] ||
                                cardValue > gameState.board.ascending[1] ||
                                cardValue < gameState.board.descending[0] ||
                                cardValue < gameState.board.descending[1])
                            : (isValidMove(cardValue, 'asc1') ||
                                isValidMove(cardValue, 'asc2') ||
                                isValidMove(cardValue, 'desc1') ||
                                isValidMove(cardValue, 'desc2'))
                    ),
                    gameState.cardsPlayedThisTurn.some(
                        move => move.value === cardValue && move.playerId === currentPlayer.id
                    )
                );
            }
        });

        gameState.yourCards = newCards;

        // Asegurarse de que la carta arrastrada se mantenga si existe
        if (dragStartCard) {
            const dragCardIndex = gameState.yourCards.findIndex(c => c === dragStartCard);
            if (dragCardIndex === -1) {
                gameState.yourCards.push(dragStartCard);
            }
        }
    }

    function updateColumnHistoryUI(column, history) {
        if (!gameState.columnHistory[column]) {
            gameState.columnHistory[column] = column.includes('asc') ? [1] : [100];
        }
        gameState.columnHistory[column] = history;
    }

    function drawHistoryIcons() {
        if (!historyIcon.complete || historyIcon.naturalWidth === 0) return;

        const shouldAnimate = isMyTurn();
        const pulseProgress = shouldAnimate ? calculatePulseProgress() : 0;

        // Limpiar las áreas clickeables anteriores
        gameState.historyIconAreas = [];

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const baseX = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const baseY = HISTORY_ICON_Y;

            // Guardar área clickeable
            gameState.historyIconAreas.push({
                x: baseX,
                y: baseY,
                width: 40,
                height: 40,
                column: col
            });

            const scale = shouldAnimate ? (1 + 0.2 * pulseProgress) : 1;

            ctx.save();
            ctx.translate(baseX + 20, baseY + 20);
            ctx.scale(scale, scale);
            ctx.translate(-20, -20);
            ctx.drawImage(historyIcon, 0, 0, 40, 40);
            ctx.restore();
        });
    }

    function handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return; // Ignorar clics si el modal está abierto
        }

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Verificar clic en iconos de historial
        if (gameState.historyIconAreas) {
            for (const area of gameState.historyIconAreas) {
                if (x >= area.x && x <= area.x + area.width &&
                    y >= area.y && y <= area.y + area.height) {
                    showColumnHistory(area.column);
                    return;
                }
            }
        }
    }

    function handleTouchAsClick(e) {
        e.preventDefault();
        if (e.touches && e.touches.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            // Simular evento de clic
            const fakeClick = new MouseEvent('click', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true,
                cancelable: true,
                view: window
            });

            // Verificar si el toque fue en un icono de historial
            if (gameState.historyIconAreas) {
                for (const area of gameState.historyIconAreas) {
                    if (x >= area.x && x <= area.x + area.width &&
                        y >= area.y && y <= area.y + area.height) {
                        showColumnHistory(area.column);
                        return;
                    }
                }
            }

            // Si no fue en un icono, manejar como toque normal
            handleTouchStart(e);
        }
    }

    function calculatePulseProgress() {
        const now = Date.now();
        const timeSinceLastPulse = (now - historyIconsAnimation.lastPulseTime) % HISTORY_ICON_PULSE_INTERVAL;
        return (isMyTurn() && timeSinceLastPulse < HISTORY_ICON_PULSE_DURATION)
            ? Math.sin((timeSinceLastPulse / HISTORY_ICON_PULSE_DURATION) * Math.PI)
            : 0;
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
        if (clickedCard && clickedCard.isPlayable && isMyTurn()) {
            dragStartCard = clickedCard;
            dragStartX = x;
            dragStartY = y;
            isDragging = true;
            dragStartCard.startDrag(x - dragStartCard.x, y - dragStartCard.y);
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
        if (!isDragging || !dragStartCard) return;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e instanceof MouseEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.changedTouches?.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            resetCardPosition();
            return;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const targetColumn = getClickedColumn(x, y);
        if (targetColumn && isValidMove(dragStartCard.value, targetColumn)) {
            playCard(dragStartCard.value, targetColumn);
        } else {
            if (targetColumn) {
                animateInvalidCard(dragStartCard);
                showNotification('Movimiento no válido', true);
            }
            resetCardPosition();
        }

        // Limpiar estado de arrastre
        if (dragStartCard) {
            dragStartCard.endDrag();
        }
        dragStartCard = null;
        isDragging = false;
    }

    function resetCardPosition() {
        if (!dragStartCard) return;

        const cardIndex = gameState.yourCards.findIndex(c => c === dragStartCard);
        if (cardIndex === -1) {
            // Asegurarnos que la carta esté en el array
            gameState.yourCards.push(dragStartCard);
            cardIndex = gameState.yourCards.length - 1;
        }

        const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 + cardIndex * (CARD_WIDTH + CARD_SPACING);

        // Verificar que la carta aún existe antes de animar
        if (!dragStartCard) return;

        // Animación de regreso con verificación de existencia
        const animation = {
            card: dragStartCard,
            startTime: Date.now(),
            duration: 300,
            targetX: startX,
            targetY: PLAYER_CARDS_Y,
            fromX: dragStartCard.x,
            fromY: dragStartCard.y,
            onComplete: () => {
                if (dragStartCard) { // Verificación crucial
                    dragStartCard.x = startX;
                    dragStartCard.y = PLAYER_CARDS_Y;
                    dragStartCard.isDragging = false;
                }
                // Forzar redibujado
                updatePlayerCards(gameState.yourCards.map(c => c.value));
            }
        };

        gameState.animatingCards.push(animation);
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

    function playCard(cardValue, position) {
        if (!dragStartCard) return;

        const previousValue = getStackValue(position);

        // Actualización inmediata para el jugador actual
        updateStack(position, cardValue);

        // Eliminar carta de la mano visualmente
        const cardIndex = gameState.yourCards.findIndex(c => c === dragStartCard);
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        // Enviar movimiento al servidor
        socket.send(JSON.stringify({
            type: 'play_card',
            playerId: currentPlayer.id,
            roomId: roomId,
            cardValue: cardValue,
            position: position,
            previousValue: previousValue,
            isFirstMove: gameState.cardsPlayedThisTurn.length === 0
        }));

        // Actualizar UI
        updateGameInfo();
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

    function hasValidMoves(cards, board) {
        return cards.some(card => {
            return ['asc1', 'asc2', 'desc1', 'desc2'].some(pos => {
                const posValue = pos.includes('asc')
                    ? (pos === 'asc1' ? board.ascending[0] : board.ascending[1])
                    : (pos === 'desc1' ? board.descending[0] : board.descending[1]);

                const isValid = pos.includes('asc')
                    ? (card.value > posValue || card.value === posValue - 10)
                    : (card.value < posValue || card.value === posValue + 10);

                return isValid;
            });
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

        gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
            card.updateColor();
        });

        socket.send(JSON.stringify({
            type: 'end_turn',
            playerId: currentPlayer.id,
            roomId: roomId
        }));

        updateGameInfo();
    }

    function drawBoard() {
        // Limpiar el área del tablero
        ctx.clearRect(
            BOARD_POSITION.x - 30,
            BOARD_POSITION.y - 55,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 60,
            CARD_HEIGHT + 120
        );

        // Fondo del tablero con sombra
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

        // Resaltado de columnas durante arrastre
        if (isDragging && dragStartCard) {
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = isValidMove(dragStartCard.value, col);
                const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i;

                ctx.fillStyle = isValid ? 'rgba(67, 64, 250, 0.3)' : 'rgba(248, 51, 51, 0.3)';
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

        // Flechas indicadoras de dirección
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

        // Dibujar cartas del tablero
        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const value = i < 2 ? gameState.board.ascending[i % 2] : gameState.board.descending[i % 2];

            // Verificar si esta carta está siendo animada
            const isBeingAnimated = gameState.animatingCards.some(anim =>
                anim.card.value === value &&
                anim.targetX === BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i
            );

            // Solo dibujar si no está siendo animada O si es mi turno (ver animación propia)
            if (!isBeingAnimated || isMyTurn()) {
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
            }
        });

        // Dibujar iconos de historial
        drawHistoryIcons();

        // Manejar animaciones de cartas (incluyendo las que caen)
        handleCardAnimations();

        // Dibujar cartas especiales si existen
        if (gameState.specialCards) {
            gameState.specialCards.forEach(card => {
                if (!card.isAnimating) {
                    card.draw();
                }
            });
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
        markDirty((canvas.width - backgroundWidth) / 2, PLAYER_CARDS_Y - 15, backgroundWidth, backgroundHeight);

        gameState.yourCards.forEach((card, index) => {
            if (card && card !== dragStartCard) {
                card.x = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 + index * (CARD_WIDTH + CARD_SPACING);
                card.y = PLAYER_CARDS_Y;
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
            if (!anim.newCard || !anim.currentCard) {
                gameState.animatingCards.splice(i, 1);
                continue;
            }

            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            // Easing cuadrático para aceleración rápida
            const easedProgress = progress * progress;

            // Mover solo la nueva carta
            anim.newCard.y = anim.fromY + (anim.targetY - anim.fromY) * easedProgress;

            // Dibujar ambas cartas
            ctx.save();

            // 1. Carta actual (fija en su posición)
            anim.currentCard.draw();

            // 2. Nueva carta (en movimiento)
            ctx.shadowColor = 'rgba(0, 100, 255, 0.5)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 4;
            anim.newCard.draw();

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
        const previousValue = getStackValue(position);

        // Solo animar para otros jugadores (no para mí y no en mi turno)
        if (message.playerId !== currentPlayer.id && !isMyTurn()) {
            const targetPos = getColumnPosition(position);

            // Crear carta animada (nueva carta)
            const newCard = new Card(
                value,
                targetPos.x,
                -CARD_HEIGHT, // Comienza arriba
                false,
                true
            );

            // Crear representación de la carta actual (que se quedará)
            const currentCard = new Card(
                previousValue,
                targetPos.x,
                targetPos.y,
                false,
                false
            );

            // Animación rápida (300ms)
            gameState.animatingCards.push({
                newCard: newCard,
                currentCard: currentCard,
                startTime: Date.now(),
                duration: 300, // Animación más rápida
                targetX: targetPos.x,
                targetY: targetPos.y,
                column: position,
                onComplete: () => {
                    updateStack(position, value); // Actualizar estado al final
                    showNotification(`${message.playerName} jugó un ${value}`);
                }
            });
        } else {
            // Para el jugador actual, actualización inmediata
            updateStack(position, value);
            if (message.playerId === currentPlayer.id) {
                showNotification(`Colocaste un ${value}`);
            }
        }

        recordCardPlayed(value, position, message.playerId, previousValue);
    }

    function gameLoop(timestamp) {
        if (timestamp - lastRenderTime < 1000 / TARGET_FPS) {
            requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        if (dirtyAreas.length > 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1a6b1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            clearDirtyAreas();
        }

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
        // Limpiar animaciones
        gameState.animatingCards = [];

        // Limpiar estado de arrastre
        if (dragStartCard) {
            dragStartCard.endDrag();
            dragStartCard = null;
        }
        isDragging = false;
        clearInterval(historyIconsAnimation.interval);
        clearTimeout(reconnectTimeout);
        cancelAnimationFrame(animationFrameId);

        if (socket) {
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
            if (socket.readyState === WebSocket.OPEN) {
                socket.close(1000, 'Juego terminado');
            }
            socket = null;
        }

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
            loadAsset('cards-icon.png').then(img => { if (img) historyIcon = img; }).catch(err => {
                log('Error loading history icon', err);
            })
        ]).then(() => {
            canvas.width = 800;
            canvas.height = 700;

            // Event listeners para mouse
            canvas.addEventListener('click', handleCanvasClick);
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseleave', handleMouseUp);

            // Event listeners para touch (usando la nueva función)
            canvas.addEventListener('touchstart', handleTouchAsClick, { passive: false });
            canvas.addEventListener('touchmove', handleTouchMove);
            canvas.addEventListener('touchend', handleTouchEnd);

            // Otros event listeners
            endTurnButton.addEventListener('click', endTurn);
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);
            window.addEventListener('beforeunload', cleanup);

            // Ajustar posición de controles
            const controlsDiv = document.querySelector('.game-controls');
            if (controlsDiv) {
                controlsDiv.style.bottom = `${canvas.height - BUTTONS_Y}px`;
            }

            // Inicializar animación de iconos
            historyIconsAnimation = {
                interval: null,
                lastPulseTime: Date.now(),
                pulseDuration: 500,
                pulseInterval: 20000
            };

            // Conectar WebSocket y comenzar el juego
            connectWebSocket();
            setTimeout(() => {
                updatePlayersPanel();
            }, 1000);
            gameLoop();
        }).catch(err => {
            log('Error initializing game', err);
            showNotification('Error al cargar los recursos del juego', true);
        });
    }

    initGame();
});