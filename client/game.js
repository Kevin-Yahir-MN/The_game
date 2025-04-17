document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const endTurnButton = document.getElementById('endTurnBtn');

    // Configuración de polling adaptativo
    const POLL_CONFIG = {
        BASE_INTERVAL: 2000,
        MIN_INTERVAL: 500,
        MAX_INTERVAL: 5000,
        PRIORITIES: {
            MY_TURN: 500,
            OPPONENT_TURN: 1000,
            GAME_OVER: 3000,
            MENU: 5000
        }
    };

    let currentPollInterval = POLL_CONFIG.BASE_INTERVAL;
    let pollingTimeout;
    let lastUpdateTime = 0;
    let lastActivityTime = Date.now();
    let selectedCard = null;

    // Dimensiones y posiciones
    const CARD_WIDTH = 80;
    const CARD_HEIGHT = 120;
    const COLUMN_SPACING = 60;
    const CARD_SPACING = 15;
    const BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3
    };
    const PLAYER_CARDS_Y = canvas.height * 0.6;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;
    const TARGET_FPS = 60;
    let lastRenderTime = 0;

    // Variables para drag and drop
    let dragStartCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;

    // Cache de assets
    const assetCache = new Map();

    // Datos del jugador
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
            asc1: [],
            asc2: [],
            desc1: [],
            desc2: []
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
            this.radius = 10;
            this.shakeOffset = 0;
            this.hoverOffset = 0;
            this.backgroundColor = isPlayedThisTurn ? '#99CCFF' : '#FFFFFF';
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.isDragging = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;
        }

        draw() {
            ctx.save();
            if (!this.isDragging) {
                ctx.translate(this.shakeOffset, 0);
            }
            ctx.shadowColor = this.shadowColor;
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 4;
            ctx.beginPath();
            ctx.roundRect(this.x, this.y - this.hoverOffset, this.width, this.height, this.radius);
            ctx.fillStyle = this === selectedCard ? '#FFFF99' : this.backgroundColor;
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

    // Sistema de polling optimizado
    function startGamePolling() {
        const poll = async () => {
            try {
                const response = await fetch(`${API_URL}/game-state-updates/${roomId}?playerId=${currentPlayer.id}&lastUpdate=${lastUpdateTime}`);
                const data = await response.json();

                if (data.success) {
                    const hasActivity = checkGameActivity(data.state);
                    adjustPollingInterval(hasActivity);

                    if (data.state) {
                        lastUpdateTime = data.lastModified || Date.now();
                        updateGameState(data.state);
                    }

                    if (data.notification) {
                        showNotification(data.notification.message, data.notification.isError);
                    }

                    if (data.gameOver) {
                        handleGameOver(data.gameOver.message);
                        setPollingPriority('GAME_OVER');
                    }
                }
            } catch (error) {
                console.error('Error en polling del juego:', error);
                adjustPollingInterval(false);
            } finally {
                pollingTimeout = setTimeout(poll, currentPollInterval);
            }
        };

        poll();
    }

    function checkGameActivity(state) {
        if (!state) return false;

        const turnChanged = state.currentTurn !== gameState.currentTurn;
        const boardChanged = !deepEqual(state.board, gameState.board);
        const cardsChanged = !deepEqual(state.yourCards, gameState.yourCards);

        if (turnChanged || boardChanged || cardsChanged) {
            lastActivityTime = Date.now();
            return true;
        }

        return state.currentTurn === currentPlayer.id;
    }

    function adjustPollingInterval(hasActivity) {
        if (hasActivity) {
            currentPollInterval = Math.max(POLL_CONFIG.MIN_INTERVAL, currentPollInterval - 300);
        } else {
            currentPollInterval = Math.min(POLL_CONFIG.MAX_INTERVAL, currentPollInterval + 300);
        }
    }

    function setPollingPriority(priority) {
        currentPollInterval = POLL_CONFIG.PRIORITIES[priority] || POLL_CONFIG.BASE_INTERVAL;
    }

    function deepEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;

        if (message.includes('GAME OVER') || message.includes('terminará') ||
            message.includes('derrota') || message.includes('no puede jugar')) {
            notification.classList.add('important');
        }

        document.body.appendChild(notification);
        const duration = (isError || message.includes('GAME OVER')) ? 5000 : 3000;
        setTimeout(() => {
            notification.classList.add('notification-fade-out');
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

        gameState.columnHistory[columnId].forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === gameState.columnHistory[columnId].length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
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

        return position.includes('asc')
            ? (cardValue > target || cardValue === target - 10)
            : (cardValue < target || cardValue === target + 10);
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

    function handleTurnChanged() {
        const isMyTurn = gameState.currentTurn === currentPlayer.id;
        setPollingPriority(isMyTurn ? 'MY_TURN' : 'OPPONENT_TURN');

        const currentPlayerObj = gameState.players.find(p => p.id === gameState.currentTurn);
        let currentPlayerName;

        if (currentPlayerObj) {
            currentPlayerName = currentPlayerObj.id === currentPlayer.id
                ? 'Tu turno'
                : `Turno de ${currentPlayerObj.name}`;

            if (isMyTurn) {
                gameState.yourCards.forEach(card => {
                    card.isPlayable = ['asc1', 'asc2', 'desc1', 'desc2'].some(pos =>
                        isValidMove(card.value, pos)
                    );
                });
            }
        } else {
            currentPlayerName = 'Esperando jugador...';
        }

        document.getElementById('currentTurn').textContent = currentPlayerName;
        resetCardsPlayedProgress();
    }

    function resetCardsPlayedProgress() {
        document.getElementById('progressText').textContent = '0/2 cartas jugadas';
        document.getElementById('progressBar').style.width = '0%';

        gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
            card.backgroundColor = '#FFFFFF';
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
            <button id="returnToRoom">Volver a la Sala</button>
        `;

        document.body.appendChild(backdrop);
        backdrop.appendChild(gameOverDiv);

        document.getElementById('returnToRoom').addEventListener('click', () => {
            window.location.href = 'sala.html';
        });
    }

    function updateGameState(newState) {
        try {
            if (!newState) {
                throw new Error('Estado nulo recibido');
            }

            // Validación mínima del estado
            if (!newState.board || !newState.currentTurn) {
                throw new Error('Estado del juego incompleto');
            }

            // Actualizar jugadores (mantener existentes si no vienen nuevos)
            if (newState.players && Array.isArray(newState.players)) {
                gameState.players = newState.players.map(player => ({
                    id: player.id,
                    name: player.name || `Jugador_${player.id.slice(0, 4)}`,
                    cardCount: player.cardCount || 0,
                    isHost: Boolean(player.isHost),
                    connected: Boolean(player.connected)
                }));
            } else if (!gameState.players) {
                gameState.players = [];
            }

            // Actualizar resto del estado
            gameState.board = newState.board || gameState.board;
            gameState.currentTurn = newState.currentTurn || gameState.currentTurn;
            gameState.remainingDeck = newState.remainingDeck ?? gameState.remainingDeck;
            gameState.initialCards = newState.initialCards || gameState.initialCards;

            if (newState.yourCards && Array.isArray(newState.yourCards)) {
                updatePlayerCards(newState.yourCards);
            }

            updateGameInfo();
        } catch (error) {
            console.error('Error al actualizar el estado del juego:', error);
            console.debug('Estado recibido:', newState);

            // Recuperación mínima - mantener al menos al jugador actual
            if (!gameState.players.length && currentPlayer.id) {
                gameState.players = [{
                    id: currentPlayer.id,
                    name: currentPlayer.name,
                    cardCount: gameState.yourCards?.length || 0,
                    isHost: currentPlayer.isHost,
                    connected: true
                }];
            }
        }
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

            const cardPosition = getColumnPosition(position);
            const opponentCard = new Card(value, cardPosition.x, cardPosition.y, false, true);

            gameState.animatingCards.push({
                card: opponentCard,
                startTime: Date.now(),
                duration: 200,
                targetX: cardPosition.x,
                targetY: cardPosition.y,
                fromX: cardPosition.x,
                fromY: -CARD_HEIGHT
            });

            gameState.cardsPlayedThisTurn.push({
                value: message.cardValue,
                position: message.position,
                playerId: message.playerId,
                isPlayedThisTurn: true
            });

            gameState.columnHistory[message.position].push(message.cardValue);
            showNotification(`${message.playerName} jugó un ${value}`);
        }
    }

    function updatePlayerCards(cards) {
        const isYourTurn = gameState.currentTurn === currentPlayer.id;
        const startX = (canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;

        gameState.yourCards = cards.map((cardValue, index) => {
            const playable = isYourTurn && (
                isValidMove(cardValue, 'asc1') ||
                isValidMove(cardValue, 'asc2') ||
                isValidMove(cardValue, 'desc1') ||
                isValidMove(cardValue, 'desc2')
            );

            return new Card(
                cardValue,
                startX + index * (CARD_WIDTH + CARD_SPACING),
                PLAYER_CARDS_Y,
                playable,
                false
            );
        });
    }

    function drawHistoryIcons() {
        const icon = document.getElementById('preloadedCardsIcon');
        if (!icon.complete || icon.naturalWidth === 0) return;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const y = HISTORY_ICON_Y;
            ctx.drawImage(icon, x, y, 40, 40);
        });
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
        }
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
            if (gameState.remainingDeck > 0 &&
                gameState.cardsPlayedThisTurn.filter(c => c.playerId === currentPlayer.id).length === 0) {

                const tempBoard = JSON.parse(JSON.stringify(gameState.board));
                if (clickedColumn.includes('asc')) {
                    tempBoard.ascending[clickedColumn === 'asc1' ? 0 : 1] = selectedCard.value;
                } else {
                    tempBoard.descending[clickedColumn === 'desc1' ? 0 : 1] = selectedCard.value;
                }

                const remainingCards = gameState.yourCards.filter(c => c !== selectedCard);
                const hasOtherMoves = remainingCards.some(card => {
                    return ['asc1', 'asc2', 'desc1', 'desc2'].some(pos => {
                        const posValue = pos.includes('asc')
                            ? tempBoard.ascending[pos === 'asc1' ? 0 : 1]
                            : tempBoard.descending[pos === 'desc1' ? 0 : 1];

                        return pos.includes('asc')
                            ? (card.value > posValue || card.value === posValue - 10)
                            : (card.value < posValue || card.value === posValue + 10);
                    });
                });

                if (!hasOtherMoves) {
                    const confirmMove = confirm(
                        'ADVERTENCIA: Jugar esta carta te dejará sin movimientos posibles.\n' +
                        'Si continúas, el juego terminará con derrota.\n\n' +
                        '¿Deseas continuar?'
                    );

                    if (confirmMove) {
                        playCard(selectedCard.value, clickedColumn);
                        fetch(`${API_URL}/self-blocked`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                playerId: currentPlayer.id,
                                roomId: roomId
                            })
                        });
                        return;
                    } else {
                        return;
                    }
                }
            }

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

        gameState.cardsPlayedThisTurn.push({
            value: cardValue,
            position,
            playerId: currentPlayer.id,
            previousValue
        });

        gameState.columnHistory[position].push(cardValue);
        selectedCard.isPlayedThisTurn = true;
        selectedCard.backgroundColor = '#99CCFF';

        const cardPosition = getColumnPosition(position);
        gameState.animatingCards.push({
            card: selectedCard,
            startTime: Date.now(),
            duration: 200,
            targetX: cardPosition.x,
            targetY: cardPosition.y,
            fromX: selectedCard.x,
            fromY: selectedCard.y
        });

        const cardIndex = gameState.yourCards.findIndex(c => c === selectedCard);
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        if (position.includes('asc')) {
            const idx = position === 'asc1' ? 0 : 1;
            gameState.board.ascending[idx] = cardValue;
        } else {
            const idx = position === 'desc1' ? 0 : 1;
            gameState.board.descending[idx] = cardValue;
        }

        fetch(`${API_URL}/play-card`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerId: currentPlayer.id,
                roomId: roomId,
                cardValue: cardValue,
                position: position
            })
        }).catch(error => {
            console.error('Error al enviar movimiento:', error);
            showNotification('Error al enviar movimiento', true);
        });

        selectedCard = null;
        updateGameInfo();
    }

    async function endTurn() {
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === currentPlayer.id
        ).length;

        if (currentPlayerCardsPlayed < minCardsRequired) {
            return showNotification(`Juega ${minCardsRequired - currentPlayerCardsPlayed} carta(s) más`, true);
        }

        try {
            const response = await fetch(`${API_URL}/end-turn`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerId: currentPlayer.id,
                    roomId: roomId
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Error al terminar turno');
            }

            gameState.currentTurn = data.nextPlayer.id;

            const isMyTurn = data.nextPlayer.id === currentPlayer.id;
            const turnMessage = isMyTurn
                ? '¡Es tu turno!'
                : `Turno de ${data.nextPlayer.name}`;

            showNotification(turnMessage);

            if (isMyTurn) {
                gameState.yourCards.forEach(card => {
                    card.isPlayable = ['asc1', 'asc2', 'desc1', 'desc2'].some(pos =>
                        isValidMove(card.value, pos)
                    );
                });
            }

            resetCardsPlayedProgress();
            updateGameInfo();
        } catch (error) {
            console.error('Error al terminar turno:', error);
            showNotification(error.message || 'Error al terminar turno', true);
        }
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
            const card = new Card(
                value,
                BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i,
                BOARD_POSITION.y,
                false,
                gameState.cardsPlayedThisTurn.some(c => c.value === value)
            );
            card.draw();
        });
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

    function updateGameInfo() {
        const currentPlayerObj = gameState.players.find(p => p.id === gameState.currentTurn);
        let currentPlayerName;

        if (currentPlayerObj) {
            currentPlayerName = currentPlayerObj.id === currentPlayer.id ?
                'Tu turno' :
                `Turno de ${currentPlayerObj.name}`;
        } else {
            currentPlayerName = 'Esperando jugador...';
        }

        document.getElementById('currentTurn').textContent = currentPlayerName;
        document.getElementById('remainingDeck').textContent = gameState.remainingDeck;

        if (gameState.currentTurn === currentPlayer.id) {
            const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
                card => card.playerId === currentPlayer.id
            ).length;

            const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
            const progressText = `${currentPlayerCardsPlayed}/${minCardsRequired} cartas jugadas`;
            document.getElementById('progressText').textContent = progressText;

            const progressPercentage = Math.min((currentPlayerCardsPlayed / minCardsRequired) * 100, 100);
            document.getElementById('progressBar').style.width = `${progressPercentage}%`;
        }

        updatePlayersPanel();
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

            return `
                        <li class="${player.id === currentPlayer.id ? 'you' : ''} 
                                   ${player.id === gameState.currentTurn ? 'current-turn' : ''}">
                            <span class="player-name">${displayName}</span>
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

            anim.card.draw();

            if (progress === 1 || now - anim.startTime > 1000) {
                gameState.animatingCards.splice(i, 1);
            }
        }
    }
    let animationFrameId = null;

    function gameLoop(timestamp) {
        // 1. Controlar FPS
        if (timestamp - lastRenderTime < 1000 / TARGET_FPS) {
            animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        try {
            // 2. Limpiar canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 3. Dibujar elementos del juego
            drawGameBackground();
            drawBoard();
            drawHistoryIcons();
            handleCardAnimations();
            drawPlayerCards();

            // 4. Dibujar carta arrastrada si existe
            if (isDragging && dragStartCard) {
                dragStartCard.draw();
            }
        } catch (error) {
            console.error('Error en gameLoop:', error);
            handleCriticalError('Error en el motor gráfico');
            return;
        }

        // 5. Solicitar siguiente frame
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    function drawGameBackground() {
        ctx.fillStyle = '#1a6b1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /**
     * Limpia todos los recursos y event listeners del juego
     * Se ejecuta al salir de la partida o cuando ocurre un error crítico
     */
    function cleanup() {
        // 1. Detener todos los intervalos y timeouts
        clearTimeout(pollingTimeout);
        cancelAnimationFrame(animationFrameId);

        // 2. Eliminar todos los event listeners del canvas
        const canvasEvents = [
            'click', 'mousedown', 'mousemove', 'mouseup', 'mouseleave',
            'touchstart', 'touchmove', 'touchend'
        ];

        canvasEvents.forEach(event => {
            canvas.removeEventListener(event, handleCanvasEvent);
        });

        // 3. Eliminar listener del botón de terminar turno
        if (endTurnButton) {
            endTurnButton.removeEventListener('click', endTurn);
        }

        // 4. Eliminar listeners de ventana
        window.removeEventListener('beforeunload', cleanup);
        window.removeEventListener('pagehide', cleanup);
        window.removeEventListener('unload', cleanup);

        // 5. Limpiar sessionStorage (excepto datos esenciales)
        const keysToRemove = [
            'gameStarted', 'initialPlayers', 'currentTurn',
            'initialCards', 'lastModified', 'cardsPlayed'
        ];

        keysToRemove.forEach(key => {
            sessionStorage.removeItem(key);
        });

        console.log('[Cleanup] Todos los recursos han sido liberados');
    }

    // Manejador unificado para eventos del canvas
    function handleCanvasEvent(e) {
        switch (e.type) {
            case 'click': handleCanvasClick(e); break;
            case 'mousedown': handleMouseDown(e); break;
            case 'mousemove': handleMouseMove(e); break;
            case 'mouseup':
            case 'mouseleave':
                handleMouseUp(e);
                break;
            case 'touchstart': handleTouchStart(e); break;
            case 'touchmove': handleTouchMove(e); break;
            case 'touchend': handleTouchEnd(e); break;
        }
    }

    function handleCriticalError(message, redirectUrl = 'sala.html', delay = 3000) {
        console.error('Critical Error:', message);
        showNotification(`Error: ${message}`, true);

        // Limpiar solo datos específicos, mantener identificación del jugador
        ['initialPlayers', 'currentTurn', 'initialCards', 'lastModified', 'gameStarted'].forEach(key => {
            sessionStorage.removeItem(key);
        });

        setTimeout(() => {
            // Forzar recarga completa de la sala
            window.location.href = redirectUrl + '?reload=' + Date.now();
        }, delay);
    }

    /**
   * Inicializa el juego con validaciones robustas
   */
    function initGame() {
        // 1. Validación de requisitos mínimos
        if (!validateRequirements()) {
            return;
        }

        // 2. Configurar estado inicial
        setupInitialState();

        // 3. Cargar estado del juego desde el servidor
        loadGameState()
            .then(state => {
                initializeGameComponents(state);
                startGameSystems();
            })
            .catch(error => {
                handleCriticalError(error.message || 'Error al cargar el juego');
            });
    }

    // Funciones auxiliares para initGame()

    function validateRequirements() {
        if (!canvas || !ctx) {
            handleCriticalError('Error de renderización', 'sala.html');
            return false;
        }

        if (!sessionStorage.getItem('playerId') || !sessionStorage.getItem('roomId')) {
            handleCriticalError('Datos de sesión incompletos', 'sala.html');
            return false;
        }

        return true;
    }

    function setupInitialState() {
        gameState = {
            players: [],
            yourCards: [],
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: '',
            remainingDeck: 0,
            initialCards: 6,
            gameOver: null,
            animatingCards: [],
            columnHistory: {
                asc1: [1],
                asc2: [1],
                desc1: [100],
                desc2: [100]
            }
        };
    }

    async function loadGameState() {
        const roomId = sessionStorage.getItem('roomId');
        const playerId = sessionStorage.getItem('playerId');

        // Verificar si el juego está iniciado
        const checkResponse = await fetch(`${API_URL}/check-game-started/${roomId}`);
        const checkData = await checkResponse.json();

        if (!checkData.success || !checkData.gameStarted) {
            throw new Error(checkData.message || 'El juego no ha comenzado');
        }

        // Obtener estado completo
        const stateResponse = await fetch(
            `${API_URL}/game-state/${roomId}?playerId=${playerId}&_=${Date.now()}`
        );
        const stateData = await stateResponse.json();

        if (!stateData.success || !stateData.state) {
            throw new Error(stateData.message || 'Estado del juego inválido');
        }

        return stateData.state;
    }

    function initializeGameComponents(state) {
        // Actualizar gameState con datos del servidor
        gameState.players = state.players || [];
        gameState.yourCards = state.yourCards || [];
        gameState.board = state.board || { ascending: [1, 1], descending: [100, 100] };
        gameState.currentTurn = state.currentTurn || '';
        gameState.remainingDeck = state.remainingDeck || 0;
        gameState.initialCards = state.initialCards || 6;
        gameState.gameOver = state.gameOver || null;

        // Configurar UI inicial
        updateGameInfo();
    }

    function startGameSystems() {
        // Iniciar sistemas del juego
        startGamePolling();
        gameLoop();
        setupEventListeners();

        // Mostrar notificación adecuada
        const isHost = sessionStorage.getItem('isHost') === 'true';
        showNotification(isHost ? '¡Has iniciado el juego!' : '¡El juego ha comenzado!');
    }

    function setupEventListeners() {
        try {
            // Configurar listeners del canvas
            const canvasEvents = [
                'click', 'mousedown', 'mousemove',
                'mouseup', 'mouseleave', 'touchstart',
                'touchmove', 'touchend'
            ];

            canvasEvents.forEach(event => {
                canvas.addEventListener(event, handleCanvasEvent);
            });

            // Botón de terminar turno
            endTurnButton.addEventListener('click', endTurn);

            // Modal de historial
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);

            // Configurar cleanup para varios escenarios de salida
            window.addEventListener('beforeunload', cleanup);
            window.addEventListener('pagehide', cleanup);
            window.addEventListener('unload', cleanup);
        } catch (e) {
            console.error('Error configurando event listeners:', e);
            handleCriticalError('Error interno al configurar controles');
        }
    }

    function handleCriticalError(message, redirectUrl = 'sala.html', delay = 3000) {
        console.error('[Critical Error]', message);

        // 1. Ejecutar limpieza completa
        cleanup();

        // 2. Mostrar notificación
        const notification = document.createElement('div');
        notification.className = 'notification error important';
        notification.textContent = message;
        document.body.appendChild(notification);

        // 3. Redirigir con parámetro de recarga forzada
        setTimeout(() => {
            const url = new URL(redirectUrl, window.location.origin);
            url.searchParams.append('reload', Date.now());
            window.location.href = url.toString();
        }, delay);
    }
    initGame();

});