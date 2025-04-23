document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const endTurnButton = document.getElementById('endTurnBtn');
    const STATE_UPDATE_THROTTLE = 200;
    const TARGET_FPS = 60;
    const PING_INTERVAL = 5 * 60 * 1000;
    const CARD_WIDTH = 80;
    const CARD_HEIGHT = 120;
    const COLUMN_SPACING = 60;
    const CARD_SPACING = 15;
    const BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3
    };
    const PLAYER_CARDS_Y = canvas.height * 0.6;
    const BUTTONS_Y = canvas.height * 0.85;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;
    const RECONNECT_DELAY = 2000;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const WS_RECONNECT_DELAYS = [1000, 3000, 5000, 10000];

    const assetCache = new Map();
    let historyIcon = new Image();
    let lastStateUpdate = 0;
    let lastRenderTime = 0;
    let reconnectAttempts = 0;
    let reconnectTimeout;
    let dragStartCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let isManualClose = false;

    const currentPlayer = {
        id: sessionStorage.getItem('playerId'),
        name: sessionStorage.getItem('playerName'),
        isHost: sessionStorage.getItem('isHost') === 'true'
    };

    const roomId = sessionStorage.getItem('roomId');
    let activeNotifications = [];
    let selectedCard = null;
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

    let socket;
    let pingInterval;
    const messageQueue = [];
    let isProcessingQueue = false;

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

    function connectWebSocket() {
        if (isManualClose || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                showNotification('No se puede reconectar. Recarga la página.', true);
            }
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

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

        socket.onopen = () => {
            reconnectAttempts = 0;
            showNotification('Conectado al servidor', false);
            startPingInterval();
            processQueue();
            requestGameState();
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && !isManualClose && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                const delay = WS_RECONNECT_DELAYS[reconnectAttempts] || RECONNECT_DELAY;
                reconnectAttempts++;
                showNotification(`Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, true);
                reconnectTimeout = setTimeout(connectWebSocket, delay);
            }
        };

        socket.onerror = (error) => {
            showNotification('Error de conexión', true);
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
        if (isProcessingQueue || !socket || socket.readyState !== WebSocket.OPEN) return;
        isProcessingQueue = true;
        while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            safeSend(message);
        }
        isProcessingQueue = false;
    }

    function showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.remove();
        }
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        const duration = isError ? 5000 : 3000;
        setTimeout(() => notification.remove(), duration);
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

    function handleTurnChanged(message) {
        const currentPlayerObj = gameState.players.find(p => p.id === message.newTurn);
        let currentPlayerName;
        if (currentPlayerObj) {
            currentPlayerName = currentPlayerObj.id === currentPlayer.id ?
                'Tu turno' :
                `Turno de ${currentPlayerObj.name}`;
        } else {
            currentPlayerName = 'Esperando jugador...';
        }
        if (message.newTurn === currentPlayer.id) {
            const playableCards = gameState.yourCards.filter(card => {
                return ['asc1', 'asc2', 'desc1', 'desc2'].some(pos =>
                    isValidMove(card.value, pos)
                );
            });
        }
        showNotification(currentPlayerName);
        gameState.currentTurn = message.newTurn;
        resetCardsPlayedProgress();
        updateGameInfo();
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
            safeSend({
                type: 'reset_room',
                roomId: roomId,
                playerId: currentPlayer.id
            });
            window.location.href = 'sala.html';
        });
    }

    function updateGameState(newState) {
        if (!newState) return;
        if (newState.p) {
            gameState.players = newState.p.map(player => ({
                id: player.i,
                name: player.n || `Jugador_${player.i.slice(0, 4)}`,
                cardCount: player.c,
                isHost: player.h,
                cardsPlayedThisTurn: player.s || 0
            }));
            if (!currentPlayer.name && currentPlayer.id) {
                const player = gameState.players.find(p => p.id === currentPlayer.id);
                if (player) {
                    currentPlayer.name = player.name;
                    sessionStorage.setItem('playerName', player.name);
                }
            }
        }
        gameState.board = newState.b || gameState.board;
        gameState.currentTurn = newState.t || gameState.currentTurn;
        gameState.remainingDeck = newState.d || gameState.remainingDeck;
        gameState.initialCards = newState.i || gameState.initialCards;
        if (newState.y) {
            updatePlayerCards(newState.y);
        }
        if (gameState.currentTurn !== currentPlayer.id) {
            selectedCard = null;
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
        const startY = PLAYER_CARDS_Y;
        gameState.yourCards = cards.map((card, index) => {
            const value = card instanceof Card ? card.value : card;
            const playable = isYourTurn && (
                isValidMove(value, 'asc1') || isValidMove(value, 'asc2') ||
                isValidMove(value, 'desc1') || isValidMove(value, 'desc2')
            );
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

    function drawHistoryIcons() {
        if (!historyIcon.complete || historyIcon.naturalWidth === 0) {
            return;
        }
        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const y = HISTORY_ICON_Y;
            ctx.drawImage(historyIcon, x, y, 40, 40);
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
                        safeSend({
                            type: 'self_blocked',
                            playerId: currentPlayer.id,
                            roomId: roomId
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
        safeSend({
            type: 'play_card',
            playerId: currentPlayer.id,
            cardValue,
            position
        });
        selectedCard = null;
        updateGameInfo();
    }

    function endTurn() {
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === currentPlayer.id
        ).length;
        if (currentPlayerCardsPlayed < minCardsRequired) {
            return showNotification(`Juega ${minCardsRequired - currentPlayerCardsPlayed} carta(s) más`, true);
        }
        safeSend({
            type: 'end_turn',
            playerId: currentPlayer.id,
            roomId: roomId
        });
        resetCardsPlayedProgress();
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
            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                c => c.value === value && c.playerId === currentPlayer.id
            );
            const card = new Card(
                value,
                BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i,
                BOARD_POSITION.y,
                false,
                isPlayedThisTurn
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
            const cardsPlayed = gameState.cardsPlayedThisTurn.filter(
                c => c.playerId === player.id
            ).length;
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
        isManualClose = true;
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            if (socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        }
        canvas.removeEventListener('click', handleCanvasClick);
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseUp);
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        endTurnButton.removeEventListener('click', endTurn);
    }

    function requestGameState() {
        safeSend({
            type: 'get_game_state',
            playerId: currentPlayer.id,
            roomId: roomId
        });
    }

    function handleSocketMessage(event) {
        try {
            const now = Date.now();
            const message = JSON.parse(event.data);
            if (message.type === 'gs' && now - lastStateUpdate < STATE_UPDATE_THROTTLE) {
                return;
            }
            switch (message.type) {
                case 'init_game':
                    handleInitGame(message);
                    break;
                case 'gs':
                    lastStateUpdate = now;
                    updateGameState(message.s);
                    updateGameInfo();
                    break;
                case 'game_started':
                    updateGameState(message.state);
                    showNotification('¡El juego ha comenzado!');
                    updateGameInfo();
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
                case 'card_played':
                    handleOpponentCardPlayed(message);
                    updateGameInfo();
                    break;
                case 'invalid_move':
                    if (message.playerId === currentPlayer.id && selectedCard) {
                        animateInvalidCard(selectedCard);
                    }
                    break;
                case 'turn_changed':
                    handleTurnChanged(message);
                    updateGameInfo();
                    break;
                case 'move_undone':
                    handleMoveUndone(message);
                    updateGameInfo();
                    break;
                case 'room_reset':
                    break;
                case 'player_update':
                    if (message.players) {
                        gameState.players = message.players;
                        updateGameInfo();
                    }
                    break;
                case 'pong':
                    break;
                case 'game_state_restored':
                    gameState = message.state;
                    updateGameUI();
                    showNotification('Estado del juego restaurado', false);
                    break;
                default:
                    console.log('Mensaje no reconocido:', message);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

    function handleInitGame(message) {
        gameState.currentTurn = message.gameState.currentTurn;
        gameState.board = message.gameState.board;
        gameState.remainingDeck = message.gameState.remainingDeck;
        if (message.gameState.gameStarted && message.yourCards) {
            updatePlayerCards(message.yourCards);
        }
        updateGameInfo();
    }

    function updateGameUI() {
        updateGameInfo();
        drawBoard();
        drawPlayerCards();
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
            connectWebSocket();
            gameLoop();
        });
    }

    initGame();
});