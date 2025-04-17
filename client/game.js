document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const endTurnButton = document.getElementById('endTurnBtn');
    const STATE_UPDATE_INTERVAL = 2000;
    const TARGET_FPS = 60;

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

    const assetCache = new Map();
    let historyIcon = new Image();
    let lastRenderTime = 0;
    let pollingInterval;
    let lastUpdateTime = 0;

    let dragStartCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;

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
            this.dragOffsetX = offsetX - this.x;
            this.dragOffsetY = offsetY - this.y;
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

    function startGamePolling() {
        const poll = async () => {
            try {
                const response = await fetch(`${API_URL}/game-state/${roomId}?playerId=${currentPlayer.id}&lastUpdate=${lastUpdateTime}`);
                if (!response.ok) throw new Error('Error en la respuesta');

                const data = await response.json();
                if (data.success) {
                    lastUpdateTime = Date.now();
                    updateGameState(data.state);

                    // Manejar Game Over si existe
                    if (data.state.gameOver) {
                        handleGameOver(data.state.gameOver);
                        clearInterval(pollingInterval);
                        return;
                    }

                    if (data.notification) {
                        showNotification(data.notification.message, data.notification.isError);
                    }
                }
            } catch (error) {
                console.error('Error en polling del juego:', error);
            }
        };

        poll();
        pollingInterval = setInterval(poll, STATE_UPDATE_INTERVAL);
    }

    function showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            clearTimeout(notificationTimeout);
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;

        if (message.includes('GAME OVER') || message.includes('terminará') ||
            message.includes('derrota') || message.includes('no puede jugar')) {
            notification.style.zIndex = '1001';
            notification.style.fontSize = '1.2rem';
            notification.style.padding = '20px 40px';
            notification.style.maxWidth = '80%';
            notification.style.textAlign = 'center';
        }

        document.body.appendChild(notification);
        const duration = (isError || message.includes('GAME OVER')) ? 5000 : 3000;
        notificationTimeout = setTimeout(() => {
            notification.classList.add('notification-fade-out');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    function handleGameOver(gameOverData) {
        // Deshabilitar interacciones
        canvas.style.pointerEvents = 'none';
        endTurnButton.disabled = true;

        // Detener el polling
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }

        // Crear elementos del Game Over
        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';
        backdrop.id = 'gameOverBackdrop';

        const isWin = gameOverData.result === 'win';

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';
        gameOverDiv.innerHTML = `
            <h2>${isWin ? '¡VICTORIA!' : '¡GAME OVER!'}</h2>
            <p>${gameOverData.message}</p>
            <div class="game-over-actions">
                <button id="returnToRoom" class="btn-main">
                    Volver a la Sala
                </button>
                ${currentPlayer.isHost ? `
                <button id="newGame" class="btn-secondary">
                    Nueva Partida
                </button>` : ''}
            </div>
        `;

        backdrop.appendChild(gameOverDiv);
        document.body.appendChild(backdrop);

        // Manejar botón de volver
        document.getElementById('returnToRoom').addEventListener('click', () => {
            sessionStorage.removeItem('gameStarted');
            window.location.href = 'sala.html';
        });

        // Manejar botón de nueva partida (solo para host)
        if (currentPlayer.isHost) {
            document.getElementById('newGame').addEventListener('click', async () => {
                try {
                    backdrop.innerHTML = '<p>Preparando nueva partida...</p>';

                    const response = await fetch(`${API_URL}/new-game`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            roomId: roomId,
                            playerId: currentPlayer.id
                        })
                    });

                    const data = await response.json();
                    if (data.success) {
                        window.location.reload();
                    } else {
                        showNotification('Error al iniciar nueva partida', true);
                        backdrop.remove();
                    }
                } catch (error) {
                    console.error('Error:', error);
                    showNotification('Error de conexión', true);
                    backdrop.remove();
                }
            });
        }
    }

    function updateGameState(newState) {
        if (!newState) return;

        gameState.players = newState.players.map(player => ({
            id: player.id,
            name: player.name,
            cardCount: player.cardCount,
            isHost: player.isHost,
            connected: player.connected
        }));

        gameState.board = newState.board || gameState.board;
        gameState.currentTurn = newState.currentTurn || gameState.currentTurn;
        gameState.remainingDeck = newState.remainingDeck || gameState.remainingDeck;
        gameState.initialCards = newState.initialCards || gameState.initialCards;

        if (newState.yourCards) {
            updatePlayerCards(newState.yourCards);
        }

        updateGameInfo();
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

    function isValidMove(cardValue, position) {
        const target = position.includes('asc')
            ? gameState.board.ascending[position === 'asc1' ? 0 : 1]
            : gameState.board.descending[position === 'desc1' ? 0 : 1];

        return position.includes('asc')
            ? (cardValue > target || cardValue === target - 10)
            : (cardValue < target || cardValue === target + 10);
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

        const cardIndex = gameState.yourCards.findIndex(c => c === selectedCard);
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        if (position.includes('asc')) {
            gameState.board.ascending[position === 'asc1' ? 0 : 1] = cardValue;
        } else {
            gameState.board.descending[position === 'desc1' ? 0 : 1] = cardValue;
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

    function endTurn() {
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === currentPlayer.id
        ).length;

        if (currentPlayerCardsPlayed < minCardsRequired) {
            return showNotification(`Juega ${minCardsRequired - currentPlayerCardsPlayed} carta(s) más`, true);
        }

        fetch(`${API_URL}/end-turn`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerId: currentPlayer.id,
                roomId: roomId
            })
        })
            .then(response => response.json())
            .then(data => {
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
            })
            .catch(error => {
                console.error('Error al terminar turno:', error);
                showNotification(error.message || 'Error al terminar turno', true);
            });
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

    function updateGameInfo() {
        const currentPlayerObj = gameState.players.find(p => p.id === gameState.currentTurn);
        let currentPlayerName;

        if (currentPlayerObj) {
            currentPlayerName = currentPlayerObj.id === currentPlayer.id
                ? 'Tu turno'
                : `Turno de ${currentPlayerObj.name}`;
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
    }

    function initGame() {
        document.getElementById('waitingOverlay').style.display = 'flex';

        if (!canvas || !ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        fetch(`${API_URL}/check-game-started/${roomId}`)
            .then(response => response.json())
            .then(data => {
                if (!data.success || !data.gameStarted) {
                    setTimeout(initGame, 2000);
                    return;
                }

                return fetch(`${API_URL}/game-state/${roomId}?playerId=${currentPlayer.id}`);
            })
            .then(response => response.json())
            .then(data => {
                if (!data || !data.success) {
                    throw new Error('No se pudo obtener el estado del juego');
                }
                document.getElementById('waitingOverlay').style.display = 'none';

                gameState = {
                    players: data.state.players,
                    yourCards: data.state.yourCards.map(value =>
                        new Card(value, 0, 0, false, false)
                    ),
                    board: data.state.board,
                    currentTurn: data.state.currentTurn,
                    remainingDeck: data.state.remainingDeck,
                    initialCards: data.state.initialCards,
                    cardsPlayedThisTurn: [],
                    animatingCards: [],
                    columnHistory: {
                        asc1: data.state.board.ascending[0] === 1 ? [1] : [1, data.state.board.ascending[0]],
                        asc2: data.state.board.ascending[1] === 1 ? [1] : [1, data.state.board.ascending[1]],
                        desc1: data.state.board.descending[0] === 100 ? [100] : [100, data.state.board.descending[0]],
                        desc2: data.state.board.descending[1] === 100 ? [100] : [100, data.state.board.descending[1]]
                    }
                };

                updatePlayerCards(data.state.yourCards);
                return loadAsset('cards-icon.png');
            })
            .then(img => {
                if (img) historyIcon = img;

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

                startGamePolling();
                gameLoop();
            })
            .catch(error => {
                console.error('Error al inicializar el juego:', error);
                showNotification('Error al cargar el juego. Recarga la página.', true);
            });
    }

    initGame();
});