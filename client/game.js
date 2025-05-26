document.addEventListener('DOMContentLoaded', () => {
    const gameConfig = {
        canvas: document.getElementById('gameCanvas'),
        ctx: null,
        WS_URL: 'wss://the-game-2xks.onrender.com',
        endTurnButton: document.getElementById('endTurnBtn'),
        STATE_UPDATE_THROTTLE: 200,
        TARGET_FPS: 60,
        MAX_RECONNECT_ATTEMPTS: 5,
        RECONNECT_BASE_DELAY: 2000,
        CARD_WIDTH: 80,
        CARD_HEIGHT: 120,
        COLUMN_SPACING: 60,
        CARD_SPACING: 15,
        HISTORY_ICON_PULSE_INTERVAL: 20000,
        HISTORY_ICON_PULSE_DURATION: 500
    };

    const positions = {
        BOARD_POSITION: { x: 0, y: 0 },
        PLAYER_CARDS_Y: 0,
        BUTTONS_Y: 0,
        HISTORY_ICON_Y: 0
    };

    const assets = {
        cache: new Map(),
        historyIcon: new Image(),
        historyIconsAnimation: { interval: null, lastPulseTime: Date.now(), isAnimating: false }
    };

    const animationState = {
        frameId: null,
        lastRenderTime: 0,
        queue: [],
        dirtyAreas: [],
        needsRedraw: true
    };

    const connectionState = {
        socket: null,
        reconnectAttempts: 0,
        reconnectTimeout: null,
        status: 'disconnected'
    };

    const dragState = {
        startCard: null,
        startX: 0,
        startY: 0,
        isDragging: false
    };

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

    let gameState = initializeGameState();

    const cardPool = createCardPool();

    function initializeGameState() {
        return {
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
    }

    function createCardPool() {
        return {
            pool: [],
            get(value, x, y, isPlayable, isPlayedThisTurn) {
                if (this.pool.length > 0) {
                    const card = this.pool.pop();
                    card.value = value;
                    card.x = x;
                    card.y = y;
                    card.isPlayable = isPlayable;
                    card.isPlayedThisTurn = isPlayedThisTurn;
                    return card;
                }
                return new Card(value, x, y, isPlayable, isPlayedThisTurn);
            },
            release(card) {
                this.pool.push(card);
            }
        };
    }

    function sanitizeInput(input) {
        return input ? input.replace(/[^a-zA-Z0-9-_]/g, '') : '';
    }

    function log(message, data) {
        console.log(`[${new Date().toISOString()}] ${message}`, data);
    }

    class Card {
        constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
            this.value = typeof value === 'number' ? value : 0;
            this.x = typeof x === 'number' ? x : 0;
            this.y = typeof y === 'number' ? y : 0;
            this.width = gameConfig.CARD_WIDTH;
            this.height = gameConfig.CARD_HEIGHT;
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
            if (!gameState || !gameState.cardsPlayedThisTurn || !gameState.animatingCards) {
                return '#FFFFFF';
            }

            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(move => {
                return move && move.value === this.value &&
                    ((move.position === 'asc1' && gameState.board.ascending[0] === this.value) ||
                        (move.position === 'asc2' && gameState.board.ascending[1] === this.value) ||
                        (move.position === 'desc1' && gameState.board.descending[0] === this.value) ||
                        (move.position === 'desc2' && gameState.board.descending[1] === this.value));
            });

            const isAnimatedCard = gameState.animatingCards.some(anim => {
                return anim && anim.card && anim.card.value === this.value &&
                    (anim.card.position === this.position || anim.column === this.position);
            });

            return (isPlayedThisTurn || isAnimatedCard || this.playedThisRound) ? '#99CCFF' : '#FFFFFF';
        }

        updateColor() {
            this.backgroundColor = this.determineColor();
        }

        draw() {
            gameConfig.ctx.save();
            if (!this.isDragging) gameConfig.ctx.translate(this.shakeOffset, 0);

            gameConfig.ctx.shadowColor = this.isPlayedThisTurn || this.playedThisRound ? 'rgba(0, 100, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
            gameConfig.ctx.shadowBlur = 8;
            gameConfig.ctx.shadowOffsetY = 4;

            gameConfig.ctx.beginPath();
            gameConfig.ctx.roundRect(this.x, this.y - this.hoverOffset, this.width, this.height, this.radius);
            gameConfig.ctx.fillStyle = this.backgroundColor;
            gameConfig.ctx.fill();

            gameConfig.ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
            gameConfig.ctx.lineWidth = this.isPlayable ? 3 : 2;
            gameConfig.ctx.stroke();

            gameConfig.ctx.fillStyle = '#2c3e50';
            gameConfig.ctx.font = 'bold 28px Arial';
            gameConfig.ctx.textAlign = 'center';
            gameConfig.ctx.textBaseline = 'middle';
            gameConfig.ctx.shadowColor = 'transparent';
            gameConfig.ctx.fillText(this.value.toString(), this.x + this.width / 2, this.y + this.height / 2 - this.hoverOffset);

            gameConfig.ctx.restore();
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
        animationState.dirtyAreas.push({ x, y, width, height });
        animationState.needsRedraw = true;
    }

    function clearDirtyAreas() {
        animationState.dirtyAreas = [];
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
        if (assets.cache.has(url)) {
            return Promise.resolve(assets.cache.get(url));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                assets.cache.set(url, img);
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
        if (connectionState.reconnectAttempts >= gameConfig.MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede conectar al servidor. Recarga la página.', true);
            updateConnectionStatus('Desconectado', true);
            return;
        }

        updateConnectionStatus('Conectando...');

        if (connectionState.socket) {
            connectionState.socket.onopen = connectionState.socket.onmessage =
                connectionState.socket.onclose = connectionState.socket.onerror = null;
            if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(connectionState.socket.readyState)) {
                connectionState.socket.close();
            }
        }

        connectionState.socket = new WebSocket(`${gameConfig.WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

        connectionState.socket.onopen = () => {
            clearTimeout(connectionState.reconnectTimeout);
            connectionState.reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');
            restoreGameState();

            connectionState.socket.send(JSON.stringify({
                type: 'get_full_state',
                playerId: currentPlayer.id,
                roomId: roomId,
                requireCurrentState: true
            }));

            connectionState.socket.send(JSON.stringify({
                type: 'get_player_state',
                playerId: currentPlayer.id,
                roomId: roomId
            }));
        };

        connectionState.socket.onclose = (event) => {
            if (!event.wasClean && connectionState.reconnectAttempts < gameConfig.MAX_RECONNECT_ATTEMPTS) {
                connectionState.reconnectAttempts++;
                const delay = Math.min(gameConfig.RECONNECT_BASE_DELAY * Math.pow(2, connectionState.reconnectAttempts - 1), 30000);
                connectionState.reconnectTimeout = setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${connectionState.reconnectAttempts}/${gameConfig.MAX_RECONNECT_ATTEMPTS})...`);
                connectionState.status = 'reconnecting';
            } else {
                updateConnectionStatus('Desconectado', true);
                connectionState.status = 'disconnected';
            }
        };

        connectionState.socket.onerror = (error) => {
            log('Error en WebSocket', error);
            updateConnectionStatus('Error de conexión', true);
            connectionState.status = 'error';
        };

        connectionState.socket.onmessage = handleWebSocketMessage;
    }

    function handleWebSocketMessage(event) {
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

            if (message.type === 'gs' && now - animationState.lastRenderTime < gameConfig.STATE_UPDATE_THROTTLE) {
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
        animationState.lastRenderTime = Date.now();
        updateGameState(message.s);
        updateGameInfo();
    }

    function handleGameStarted(message) {
        gameState.board = message.board || { ascending: [1, 1], descending: [100, 100] };
        gameState.currentTurn = message.currentTurn;
        gameState.remainingDeck = message.remainingDeck;
        gameState.initialCards = message.initialCards;
        gameState.gameStarted = true;

        if (gameState.players) {
            gameState.players.forEach(player => {
                player.cardsPlayedThisTurn = 0;
            });
        }

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

        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');

        if (remainingDeckElement) {
            remainingDeckElement.textContent = '0';
        }

        if (progressTextElement) {
            progressTextElement.textContent = '0/1 carta(s) jugada(s)';
        }

        updateGameInfo(true);
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
                ? '¡Es tu turno!'
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
        gameState = initializeGameState();
        updateGameInfo();
    }

    function restoreGameState() {
        if (!connectionState.socket || connectionState.socket.readyState !== WebSocket.OPEN) {
            setTimeout(restoreGameState, 500);
            return;
        }

        connectionState.socket.send(JSON.stringify({
            type: 'get_player_state',
            playerId: currentPlayer.id,
            roomId: roomId
        }));
    }

    function updateConnectionStatus(status, isError = false) {
        connectionState.status = status;
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

        if (gameState.players) {
            gameState.players.forEach(player => {
                player.cardsPlayedThisTurn = 0;
            });
        }

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

        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
        gameConfig.canvas.style.pointerEvents = 'none';
    }

    function closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';
        gameConfig.canvas.style.pointerEvents = 'auto';
    }

    function getColumnPosition(position) {
        const index = ['asc1', 'asc2', 'desc1', 'desc2'].indexOf(position);
        return {
            x: positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * index,
            y: positions.BOARD_POSITION.y
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

            const card = cardPool.get(message.cardValue, 0, 0, true, false);
            gameState.yourCards.push(card);
            updatePlayerCards(gameState.yourCards.map(c => c.value));
        }
    }

    function handleGameOver(message, isError = false) {
        gameConfig.canvas.style.pointerEvents = 'none';
        gameConfig.endTurnButton.disabled = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const isVictory = !isError || message.includes('Victoria') || message.includes('ganan');

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';

        const title = isVictory ? '¡VICTORIA!' : '¡GAME OVER!';
        const titleColor = isVictory ? '#2ecc71' : '#e74c3c';

        gameOverDiv.innerHTML = `
            <h2 style="color: ${titleColor}">${title}</h2>
            <p>${message}</p>
            <div class="game-over-buttons">
                <button id="returnToRoom" class="game-over-btn" 
                        style="background-color: ${titleColor}">
                    Volver a la Sala
                </button>
            </div>
        `;

        document.body.appendChild(backdrop);
        backdrop.appendChild(gameOverDiv);

        setTimeout(() => {
            backdrop.style.opacity = '1';
            gameOverDiv.style.transform = 'translateY(0)';
        }, 10);

        document.getElementById('returnToRoom').addEventListener('click', async () => {
            const button = document.getElementById('returnToRoom');
            button.disabled = true;
            button.textContent = 'Cargando...';

            resetGameState();

            connectionState.socket.send(JSON.stringify({
                type: 'reset_room',
                roomId: roomId,
                playerId: currentPlayer.id,
                resetHistory: true
            }));

            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.href = 'sala.html';
        });
    }

    function handleDeckUpdated(message) {
        gameState.remainingDeck = message.remaining;
        const isDeckEmpty = message.remaining === 0;

        const remainingDeckElement = document.getElementById('remainingDeck');
        if (remainingDeckElement) {
            remainingDeckElement.textContent = message.remaining;
        }

        updateGameInfo(isDeckEmpty);

        if (isDeckEmpty) {
            showNotification('¡El mazo se ha agotado! Ahora solo necesitas jugar 1 carta por turno');
        }
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

    function updateGameInfo(deckEmpty = false) {
        const currentTurnElement = document.getElementById('currentTurn');
        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');
        const progressBarElement = document.getElementById('progressBar');

        if (!currentTurnElement || !remainingDeckElement || !progressTextElement || !progressBarElement) {
            setTimeout(() => updateGameInfo(deckEmpty), 100);
            return;
        }

        const currentPlayerObj = gameState.players.find(p => p.id === currentPlayer.id) || {
            cardsPlayedThisTurn: 0,
            totalCardsPlayed: 0
        };

        const minCardsRequired = deckEmpty || gameState.remainingDeck === 0 ? 1 : 2;
        const cardsPlayed = currentPlayerObj.cardsPlayedThisTurn || 0;

        currentTurnElement.textContent = gameState.currentTurn === currentPlayer.id
            ? 'Tu turno'
            : `Turno de ${gameState.players.find(p => p.id === gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;

        if (gameConfig.endTurnButton) {
            gameConfig.endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id;
            const remainingCards = minCardsRequired - cardsPlayed;
            gameConfig.endTurnButton.title = remainingCards > 0
                ? `Necesitas jugar ${remainingCards} carta(s) más${deckEmpty ? ' (Mazo vacío)' : ''}`
                : 'Puedes terminar tu turno';
            gameConfig.endTurnButton.style.backgroundColor = cardsPlayed >= minCardsRequired ? '#2ecc71' : '#e74c3c';
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
        const startX = (gameConfig.canvas.width - (cards.length * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING))) / 2;
        const startY = positions.PLAYER_CARDS_Y;

        const newCards = cards.map((cardValue, index) => {
            const existingCard = gameState.yourCards.find(c =>
                c.value === cardValue && !c.isDragging
            );

            if (existingCard) {
                existingCard.x = startX + index * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING);
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
                return cardPool.get(
                    cardValue,
                    startX + index * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING),
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

        if (dragState.startCard) {
            const dragCardIndex = gameState.yourCards.findIndex(c => c === dragState.startCard);
            if (dragCardIndex === -1) {
                gameState.yourCards.push(dragState.startCard);
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
        if (!assets.historyIcon.complete || assets.historyIcon.naturalWidth === 0) return;

        const shouldAnimate = isMyTurn();
        const pulseProgress = shouldAnimate ? calculatePulseProgress() : 0;

        gameState.historyIconAreas = [];

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const baseX = positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * i + gameConfig.CARD_WIDTH / 2 - 20;
            const baseY = positions.HISTORY_ICON_Y;

            gameState.historyIconAreas.push({
                x: baseX,
                y: baseY,
                width: 40,
                height: 40,
                column: col
            });

            const scale = shouldAnimate ? (1 + 0.2 * pulseProgress) : 1;

            gameConfig.ctx.save();
            gameConfig.ctx.translate(baseX + 20, baseY + 20);
            gameConfig.ctx.scale(scale, scale);
            gameConfig.ctx.translate(-20, -20);
            gameConfig.ctx.drawImage(assets.historyIcon, 0, 0, 40, 40);
            gameConfig.ctx.restore();
        });
    }

    function handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const rect = gameConfig.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

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
            const rect = gameConfig.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const fakeClick = new MouseEvent('click', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true,
                cancelable: true,
                view: window
            });

            if (gameState.historyIconAreas) {
                for (const area of gameState.historyIconAreas) {
                    if (x >= area.x && x <= area.x + area.width &&
                        y >= area.y && y <= area.y + area.height) {
                        showColumnHistory(area.column);
                        return;
                    }
                }
            }

            handleTouchStart(e);
        }
    }

    function calculatePulseProgress() {
        const now = Date.now();
        const timeSinceLastPulse = (now - assets.historyIconsAnimation.lastPulseTime) % gameConfig.HISTORY_ICON_PULSE_INTERVAL;
        return (isMyTurn() && timeSinceLastPulse < gameConfig.HISTORY_ICON_PULSE_DURATION)
            ? Math.sin((timeSinceLastPulse / gameConfig.HISTORY_ICON_PULSE_DURATION) * Math.PI)
            : 0;
    }

    function handleMouseDown(e) {
        const rect = gameConfig.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        startDrag(x, y);
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const rect = gameConfig.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        startDrag(x, y);
    }

    function startDrag(x, y) {
        const clickedCard = gameState.yourCards.find(card => card.contains(x, y));
        if (clickedCard && clickedCard.isPlayable && isMyTurn()) {
            dragState.startCard = clickedCard;
            dragState.startX = x;
            dragState.startY = y;
            dragState.isDragging = true;
            dragState.startCard.startDrag(x - dragState.startCard.x, y - dragState.startCard.y);
        }
    }

    function handleMouseMove(e) {
        const rect = gameConfig.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        updateDrag(x, y);
    }

    function handleTouchMove(e) {
        e.preventDefault();
        const rect = gameConfig.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        updateDrag(x, y);
    }

    function updateDrag(x, y) {
        if (dragState.isDragging && dragState.startCard) {
            dragState.startCard.updateDragPosition(x, y);
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
        if (!dragState.isDragging || !dragState.startCard) return;

        const rect = gameConfig.canvas.getBoundingClientRect();
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
        if (targetColumn && isValidMove(dragState.startCard.value, targetColumn)) {
            playCard(dragState.startCard.value, targetColumn);
        } else {
            if (targetColumn) {
                animateInvalidCard(dragState.startCard);
                showNotification('Movimiento no válido', true);
            }
            resetCardPosition();
        }

        if (dragState.startCard) {
            dragState.startCard.endDrag();
        }
        dragState.startCard = null;
        dragState.isDragging = false;
    }

    function resetCardPosition() {
        if (!dragState.startCard) return;

        let cardIndex = gameState.yourCards.findIndex(c => c === dragState.startCard);
        if (cardIndex === -1) {
            gameState.yourCards.push(dragState.startCard);
            cardIndex = gameState.yourCards.length - 1;
        }

        const startX = (gameConfig.canvas.width - (gameState.yourCards.length * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING))) / 2 + cardIndex * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING);

        if (!dragState.startCard) return;

        const animation = {
            card: dragState.startCard,
            startTime: Date.now(),
            duration: 300,
            targetX: startX,
            targetY: positions.PLAYER_CARDS_Y,
            fromX: dragState.startCard.x,
            fromY: dragState.startCard.y,
            onComplete: () => {
                if (dragState.startCard) {
                    dragState.startCard.x = startX;
                    dragState.startCard.y = positions.PLAYER_CARDS_Y;
                    dragState.startCard.isDragging = false;
                }
                updatePlayerCards(gameState.yourCards.map(c => c.value));
            }
        };

        gameState.animatingCards.push(animation);
    }

    function getClickedColumn(x, y) {
        if (y < positions.BOARD_POSITION.y || y > positions.BOARD_POSITION.y + gameConfig.CARD_HEIGHT) return null;

        const columns = [
            { x: positions.BOARD_POSITION.x, id: 'asc1' },
            { x: positions.BOARD_POSITION.x + gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING, id: 'asc2' },
            { x: positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * 2, id: 'desc1' },
            { x: positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * 3, id: 'desc2' }
        ];

        const column = columns.find(col => x >= col.x && x <= col.x + gameConfig.CARD_WIDTH);
        return column ? column.id : null;
    }

    function playCard(cardValue, position) {
        if (!dragState.startCard) return;

        const previousValue = getStackValue(position);

        updateStack(position, cardValue);

        const cardIndex = gameState.yourCards.findIndex(c => c === dragState.startCard);
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        connectionState.socket.send(JSON.stringify({
            type: 'play_card',
            playerId: currentPlayer.id,
            roomId: roomId,
            cardValue: cardValue,
            position: position,
            previousValue: previousValue,
            isFirstMove: gameState.cardsPlayedThisTurn.length === 0
        }));

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

        connectionState.socket.send(JSON.stringify({
            type: 'end_turn',
            playerId: currentPlayer.id,
            roomId: roomId
        }));

        updateGameInfo();
    }

    function drawBoard() {
        gameConfig.ctx.clearRect(
            positions.BOARD_POSITION.x - 30,
            positions.BOARD_POSITION.y - 55,
            gameConfig.CARD_WIDTH * 4 + gameConfig.COLUMN_SPACING * 3 + 60,
            gameConfig.CARD_HEIGHT + 120
        );

        gameConfig.ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        gameConfig.ctx.beginPath();
        gameConfig.ctx.roundRect(
            positions.BOARD_POSITION.x - 25,
            positions.BOARD_POSITION.y - 50,
            gameConfig.CARD_WIDTH * 4 + gameConfig.COLUMN_SPACING * 3 + 50,
            gameConfig.CARD_HEIGHT + 110,
            15
        );
        gameConfig.ctx.fill();

        if (dragState.isDragging && dragState.startCard) {
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = isValidMove(dragState.startCard.value, col);
                const x = positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * i;

                gameConfig.ctx.fillStyle = isValid ? 'rgb(67, 64, 250)' : 'rgb(248, 51, 51)';
                gameConfig.ctx.beginPath();
                gameConfig.ctx.roundRect(
                    x - 5,
                    positions.BOARD_POSITION.y - 10,
                    gameConfig.CARD_WIDTH + 10,
                    gameConfig.CARD_HEIGHT + 20,
                    15
                );
                gameConfig.ctx.fill();
            });
        }

        gameConfig.ctx.fillStyle = 'white';
        gameConfig.ctx.font = 'bold 36px Arial';
        gameConfig.ctx.textAlign = 'center';
        gameConfig.ctx.textBaseline = 'middle';
        gameConfig.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        gameConfig.ctx.shadowBlur = 5;
        gameConfig.ctx.shadowOffsetY = 2;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * i + gameConfig.CARD_WIDTH / 2;
            gameConfig.ctx.fillText(i < 2 ? '↑' : '↓', x, positions.BOARD_POSITION.y - 25);
        });

        gameConfig.ctx.shadowColor = 'transparent';

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const isColumnAnimating = gameState.animatingCards.some(anim => anim.column === col);

            if (!isColumnAnimating) {
                const value = i < 2 ? gameState.board.ascending[i % 2] : gameState.board.descending[i % 2];
                const wasPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                    move => move.value === value && move.position === col
                );

                const card = cardPool.get(
                    value,
                    positions.BOARD_POSITION.x + (gameConfig.CARD_WIDTH + gameConfig.COLUMN_SPACING) * i,
                    positions.BOARD_POSITION.y,
                    false,
                    wasPlayedThisTurn
                );
                card.draw();
            }
        });

        handleCardAnimations();
        drawHistoryIcons();

        if (gameState.specialCards) {
            gameState.specialCards.forEach(card => {
                if (!card.isAnimating) {
                    card.draw();
                }
            });
        }
    }

    function drawPlayerCards() {
        const backgroundHeight = gameConfig.CARD_HEIGHT + 30;
        const backgroundWidth = gameState.yourCards.length * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING) + 40;

        gameConfig.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        gameConfig.ctx.beginPath();
        gameConfig.ctx.roundRect(
            (gameConfig.canvas.width - backgroundWidth) / 2,
            positions.PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        gameConfig.ctx.fill();
        markDirty((gameConfig.canvas.width - backgroundWidth) / 2, positions.PLAYER_CARDS_Y - 15, backgroundWidth, backgroundHeight);

        gameState.yourCards.forEach((card, index) => {
            if (card && card !== dragState.startCard) {
                card.x = (gameConfig.canvas.width - (gameState.yourCards.length * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING))) / 2 + index * (gameConfig.CARD_WIDTH + gameConfig.CARD_SPACING);
                card.y = positions.PLAYER_CARDS_Y;
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

            const easedProgress = progress * progress;

            anim.newCard.y = -gameConfig.CARD_HEIGHT + (anim.targetY - (-gameConfig.CARD_HEIGHT)) * easedProgress;

            gameConfig.ctx.save();

            anim.currentCard.draw();

            gameConfig.ctx.shadowColor = 'rgba(0, 100, 255, 0.7)';
            gameConfig.ctx.shadowBlur = 10;
            gameConfig.ctx.shadowOffsetY = 5;
            anim.newCard.draw();

            gameConfig.ctx.restore();

            if (progress === 1) {
                if (anim.onComplete) anim.onComplete();
                gameState.animatingCards.splice(i, 1);
                updateGameInfo();
            }
        }
    }

    function handleAnimatedCardPlay(message) {
        const position = message.position;
        const value = message.cardValue;
        const previousValue = getStackValue(position);

        if (message.playerId !== currentPlayer.id && !isMyTurn()) {
            const targetPos = getColumnPosition(position);

            const animation = {
                newCard: cardPool.get(value, targetPos.x, -gameConfig.CARD_HEIGHT, false, true),
                currentCard: cardPool.get(previousValue, targetPos.x, targetPos.y, false, false),
                startTime: Date.now(),
                duration: 300,
                targetX: targetPos.x,
                targetY: targetPos.y,
                fromY: -gameConfig.CARD_HEIGHT,
                column: position,
                onComplete: () => {
                    updateStack(position, value);
                    showNotification(`${message.playerName} jugó un ${value}`);
                }
            };

            gameState.animatingCards.push(animation);
        } else {
            updateStack(position, value);
        }

        recordCardPlayed(value, position, message.playerId, previousValue);
    }

    function gameLoop(timestamp) {
        if (timestamp - animationState.lastRenderTime < 1000 / gameConfig.TARGET_FPS) {
            animationState.frameId = requestAnimationFrame(gameLoop);
            return;
        }

        animationState.lastRenderTime = timestamp;

        if (animationState.dirtyAreas.length > 0 || animationState.needsRedraw) {
            gameConfig.ctx.clearRect(0, 0, gameConfig.canvas.width, gameConfig.canvas.height);
            gameConfig.ctx.fillStyle = '#1a6b1a';
            gameConfig.ctx.fillRect(0, 0, gameConfig.canvas.width, gameConfig.canvas.height);
            clearDirtyAreas();
            animationState.needsRedraw = false;
        }

        drawBoard();
        drawHistoryIcons();
        handleCardAnimations();
        drawPlayerCards();

        if (dragState.isDragging && dragState.startCard) {
            dragState.startCard.draw();
        }

        animationState.frameId = requestAnimationFrame(gameLoop);
    }

    function cleanup() {
        gameState.animatingCards = [];

        if (dragState.startCard) {
            dragState.startCard.endDrag();
            dragState.startCard = null;
        }
        dragState.isDragging = false;
        clearInterval(assets.historyIconsAnimation.interval);
        clearTimeout(connectionState.reconnectTimeout);
        cancelAnimationFrame(animationState.frameId);

        if (connectionState.socket) {
            connectionState.socket.onopen = connectionState.socket.onmessage =
                connectionState.socket.onclose = connectionState.socket.onerror = null;
            if (connectionState.socket.readyState === WebSocket.OPEN) {
                connectionState.socket.close(1000, 'Juego terminado');
            }
            connectionState.socket = null;
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
            gameConfig.canvas.removeEventListener(event, handler);
        });

        gameConfig.endTurnButton?.removeEventListener('click', endTurn);
        document.getElementById('modalBackdrop')?.removeEventListener('click', closeHistoryModal);

        document.querySelectorAll('.notification, .game-over-backdrop').forEach(el => el.remove());

        gameConfig.ctx.clearRect(0, 0, gameConfig.canvas.width, gameConfig.canvas.height);
        gameState.animatingCards = [];
        assets.cache.clear();
    }

    function initGame() {
        gameConfig.ctx = gameConfig.canvas.getContext('2d');

        if (!gameConfig.canvas || !gameConfig.ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        positions.BOARD_POSITION = {
            x: gameConfig.canvas.width / 2 - (gameConfig.CARD_WIDTH * 4 + gameConfig.COLUMN_SPACING * 3) / 2,
            y: gameConfig.canvas.height * 0.3
        };
        positions.PLAYER_CARDS_Y = gameConfig.canvas.height * 0.6;
        positions.BUTTONS_Y = gameConfig.canvas.height * 0.85;
        positions.HISTORY_ICON_Y = positions.BOARD_POSITION.y + gameConfig.CARD_HEIGHT + 15;

        Promise.all([
            loadAsset('cards-icon.png').then(img => { if (img) assets.historyIcon = img; }).catch(err => {
                log('Error loading history icon', err);
            })
        ]).then(() => {
            gameConfig.canvas.width = 800;
            gameConfig.canvas.height = 700;

            gameConfig.canvas.addEventListener('click', handleCanvasClick);
            gameConfig.canvas.addEventListener('mousedown', handleMouseDown);
            gameConfig.canvas.addEventListener('mousemove', handleMouseMove);
            gameConfig.canvas.addEventListener('mouseup', handleMouseUp);
            gameConfig.canvas.addEventListener('mouseleave', handleMouseUp);

            gameConfig.canvas.addEventListener('touchstart', handleTouchAsClick, { passive: false });
            gameConfig.canvas.addEventListener('touchmove', handleTouchMove);
            gameConfig.canvas.addEventListener('touchend', handleTouchEnd);

            gameConfig.endTurnButton.addEventListener('click', endTurn);
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);
            window.addEventListener('beforeunload', cleanup);

            const controlsDiv = document.querySelector('.game-controls');
            if (controlsDiv) {
                controlsDiv.style.bottom = `${gameConfig.canvas.height - positions.BUTTONS_Y}px`;
            }

            assets.historyIconsAnimation = {
                interval: null,
                lastPulseTime: Date.now(),
                pulseDuration: 500,
                pulseInterval: 20000
            };

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