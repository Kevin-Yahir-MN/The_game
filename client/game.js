document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const endTurnButton = document.getElementById('endTurnBtn');

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
    const BUTTONS_Y = canvas.height * 0.85;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

    // Icono de historial
    const historyIcon = new Image();
    historyIcon.src = 'cards-icon.png';

    // Datos del jugador
    const currentPlayer = {
        id: sessionStorage.getItem('playerId'),
        name: sessionStorage.getItem('playerName'),
        isHost: sessionStorage.getItem('isHost') === 'true'
    };
    const roomId = sessionStorage.getItem('roomId');

    // Estado del juego
    let activeNotifications = [];
    const NOTIFICATION_COOLDOWN = 3000;
    let selectedCard = null;
    let dragState = {
        active: false,
        card: null
    };

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

            // Drag & Drop
            this.isDragging = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;
            this.originalX = x;
            this.originalY = y;

            // Efectos visuales
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.shadowBlur = 8;
            this.shadowOffsetY = 4;
            this.rotation = 0;
            this.scale = 1.0;
            this.zIndex = 0;

            // Animación
            this.animation = {
                active: false,
                startTime: 0,
                duration: 0,
                fromX: 0,
                fromY: 0,
                fromRotation: 0,
                targetX: 0,
                targetY: 0,
                targetRotation: 0
            };
        }

        draw(ctx) {
            // Actualizar animación si está activa
            this.updateAnimation();

            ctx.save();

            // Aplicar transformaciones
            const shakeX = this.isDragging ? 0 : this.shakeOffset;
            ctx.translate(this.x + this.width / 2 + shakeX, this.y + this.height / 2);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.scale(this.scale, this.scale);
            ctx.translate(-this.width / 2, -this.height / 2);

            // Sombra
            ctx.shadowColor = this.shadowColor;
            ctx.shadowBlur = this.isDragging ? 20 : this.shadowBlur;
            ctx.shadowOffsetY = this.isDragging ? 15 : (this.hoverOffset > 0 ? 8 : 4);

            // Cuerpo de la carta
            ctx.beginPath();
            ctx.roundRect(0, -this.hoverOffset, this.width, this.height, this.radius);

            // Color basado en estado
            if (this.isDragging) {
                ctx.fillStyle = '#FFFFE0';
            } else if (this.hoverOffset > 0) {
                ctx.fillStyle = '#FFFF99';
            } else {
                ctx.fillStyle = this.backgroundColor;
            }

            ctx.fill();

            // Borde
            ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
            ctx.lineWidth = this.isPlayable ? 3 : 2;
            ctx.stroke();

            // Texto
            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'transparent';
            ctx.fillText(this.value.toString(), this.width / 2, this.height / 2 - this.hoverOffset);

            ctx.restore();
        }

        contains(x, y) {
            const relX = x - this.x - this.width / 2;
            const relY = y - this.y - this.height / 2;
            const angle = -this.rotation * Math.PI / 180;

            const rotatedX = relX * Math.cos(angle) - relY * Math.sin(angle);
            const rotatedY = relX * Math.sin(angle) + relY * Math.cos(angle);

            return rotatedX >= -this.width / 2 && rotatedX <= this.width / 2 &&
                rotatedY >= -this.height / 2 && rotatedY <= this.height / 2;
        }

        startDrag(mouseX, mouseY) {
            if (!this.isPlayable) return false;

            this.isDragging = true;
            this.dragOffsetX = mouseX - this.x;
            this.dragOffsetY = mouseY - this.y;
            this.originalX = this.x;
            this.originalY = this.y;

            // Efecto visual al agarrar
            this.applyGrabEffect();
            return true;
        }

        updateDrag(mouseX, mouseY) {
            if (!this.isDragging) return;

            const targetX = mouseX - this.dragOffsetX;
            const targetY = mouseY - this.dragOffsetY - 20; // Elevación

            this.x += (targetX - this.x) * 0.3;
            this.y += (targetY - this.y) * 0.3;

            const dx = targetX - this.x;
            this.rotation = dx * 0.1;
        }

        endDrag(success) {
            if (!this.isDragging) return;

            this.isDragging = false;
            this.resetCardStyle();

            if (!success) {
                this.animateReturn();
            }
        }

        applyGrabEffect() {
            this.shadowBlur = 20;
            this.shadowColor = 'rgba(0, 0, 0, 0.6)';
            this.rotation = Math.random() * 8 - 4;
            this.scale = 1.1;
            this.zIndex = 100;
        }

        resetCardStyle() {
            this.shadowBlur = 8;
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.rotation = 0;
            this.scale = 1.0;
            this.zIndex = 0;
        }

        animateReturn() {
            this.animation = {
                active: true,
                startTime: Date.now(),
                duration: 600,
                fromX: this.x,
                fromY: this.y,
                fromRotation: this.rotation,
                targetX: this.originalX,
                targetY: this.originalY,
                targetRotation: 0
            };
        }

        updateAnimation() {
            if (!this.animation.active) return;

            const elapsed = Date.now() - this.animation.startTime;
            const progress = Math.min(elapsed / this.animation.duration, 1);

            const elasticProgress = this.easeOutElastic(progress);

            this.x = this.animation.fromX +
                (this.animation.targetX - this.animation.fromX) * elasticProgress;
            this.y = this.animation.fromY +
                (this.animation.targetY - this.animation.fromY) * elasticProgress;
            this.rotation = this.animation.fromRotation +
                (this.animation.targetRotation - this.animation.fromRotation) * elasticProgress;

            if (progress === 1) {
                this.animation.active = false;
            }
        }

        easeOutElastic(t) {
            const p = 0.3;
            return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        }

        animateShake() {
            const shakeAmount = 8;
            const shakeDuration = 400;
            const startTime = Date.now();

            const shake = () => {
                const elapsed = Date.now() - startTime;
                const progress = elapsed / shakeDuration;

                if (progress >= 1) {
                    this.shakeOffset = 0;
                    return;
                }

                this.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
                requestAnimationFrame(shake);
            };

            shake();
        }

        updateHoverState(mouseX, mouseY) {
            const isHovered = this.contains(mouseX, mouseY);
            this.hoverOffset = isHovered && this.isPlayable ? 10 : 0;
            return isHovered;
        }
    }

    function connectWebSocket() {
        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

        socket.onopen = () => {
            console.log('Conexión WebSocket establecida');
            socket.send(JSON.stringify({ type: 'get_game_state' }));
        };

        socket.onclose = () => {
            console.log('Conexión WebSocket cerrada - Reconectando...');
            setTimeout(connectWebSocket, 2000);
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case 'game_state':
                        updateGameState(message.state);
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
                    default:
                        console.log('Mensaje no reconocido:', message);
                }
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        };
    }

    function showNotification(message, isError = false) {
        const now = Date.now();

        // Limpiar notificaciones antiguas
        activeNotifications = activeNotifications.filter(notif => {
            if (now - notif.time > NOTIFICATION_COOLDOWN) {
                notif.element.classList.add('notification-fade-out');
                setTimeout(() => notif.element.remove(), 300);
                return false;
            }
            return true;
        });

        if (activeNotifications.length > 0) return;

        // Crear nueva notificación
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        // Registrar notificación
        const notificationObj = {
            element: notification,
            time: now
        };
        activeNotifications.push(notificationObj);

        // Eliminar después de 3 segundos
        setTimeout(() => {
            notification.classList.add('notification-fade-out');
            setTimeout(() => {
                notification.remove();
                activeNotifications = activeNotifications.filter(n => n !== notificationObj);
            }, 300);
        }, 3000);
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
        const shakeDuration = 400;
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
        gameState.currentTurn = message.newTurn;
        gameState.cardsPlayedThisTurn = gameState.cardsPlayedThisTurn.filter(
            card => card.playerId !== currentPlayer.id
        );

        const playerName = gameState.players.find(p => p.id === message.newTurn)?.name || 'otro jugador';
        showNotification(`Ahora es el turno de ${playerName}`);
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
            socket.send(JSON.stringify({
                type: 'reset_room',
                roomId: roomId,
                playerId: currentPlayer.id
            }));
            window.location.href = 'sala.html';
        });
    }

    function updateGameState(newState) {
        if (!newState) return;

        gameState.board = newState.board || gameState.board;
        gameState.currentTurn = newState.currentTurn || gameState.currentTurn;
        gameState.remainingDeck = newState.remainingDeck || gameState.remainingDeck;
        gameState.players = newState.players || gameState.players;
        gameState.initialCards = newState.initialCards || gameState.initialCards;
        gameState.cardsPlayedThisTurn = newState.cardsPlayedThisTurn || gameState.cardsPlayedThisTurn;

        if (newState.yourCards) {
            updatePlayerCards(newState.yourCards);
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
                duration: 400,
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
            console.log('Icono de historial no cargado todavía');
            return;
        }

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2 - 20;
            const y = HISTORY_ICON_Y;

            ctx.drawImage(historyIcon, x, y, 40, 40);
        });
    }

    function handleCanvasClick(event) {
        if (dragState.active) {
            dragState.active = false;
            if (dragState.card) {
                dragState.card.endDrag(false);
                dragState.card = null;
            }
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Verificar clicks en los iconos de historial
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
                        socket.send(JSON.stringify({
                            type: 'self_blocked',
                            playerId: currentPlayer.id,
                            roomId: roomId
                        }));
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
                clickedCard.animateShake();
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
            selectedCard.animateShake();
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
            duration: 400,
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

        socket.send(JSON.stringify({
            type: 'play_card',
            playerId: currentPlayer.id,
            cardValue,
            position
        }));

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

        socket.send(JSON.stringify({
            type: 'end_turn',
            playerId: currentPlayer.id
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
            card.draw(ctx);
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

        // Ordenar cartas por z-index (excepto la que se está arrastrando)
        const cardsToDraw = [...gameState.yourCards].sort((a, b) => {
            if (a.isDragging) return 1;
            if (b.isDragging) return -1;
            return a.zIndex - b.zIndex;
        });

        cardsToDraw.forEach(card => {
            card.draw(ctx);
        });
    }

    function updateGameInfo() {
        const currentPlayerName = gameState.players.find(p => p.id === gameState.currentTurn)?.name || 'Esperando...';

        document.getElementById('currentTurn').textContent = currentPlayerName;
        document.getElementById('remainingDeck').textContent = gameState.remainingDeck;

        if (gameState.currentTurn === currentPlayer.id) {
            const cardsPlayed = gameState.cardsPlayedThisTurn.filter(c => c.playerId === currentPlayer.id).length;
            const required = gameState.remainingDeck > 0 ? 2 : 1;
            const progress = Math.min(cardsPlayed / required, 1) * 100;

            const progressBar = document.getElementById('progressBar');
            progressBar.style.width = `${progress}%`;
            progressBar.style.backgroundColor = progress >= 100 ? 'var(--secondary)' : 'var(--primary)';

            document.getElementById('progressText').textContent = `${cardsPlayed}/${required} cartas jugadas`;
        }
    }

    function handleCardAnimations() {
        const now = Date.now();
        for (let i = gameState.animatingCards.length - 1; i >= 0; i--) {
            const anim = gameState.animatingCards[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            anim.card.x = anim.fromX + (anim.targetX - anim.fromX) * progress;
            anim.card.y = anim.fromY + (anim.targetY - anim.fromY) * progress;

            anim.card.draw(ctx);

            if (progress === 1) {
                gameState.animatingCards.splice(i, 1);
            }
        }
    }

    function gameLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#1a6b1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawBoard();
        drawHistoryIcons();
        handleCardAnimations();
        drawPlayerCards();

        requestAnimationFrame(gameLoop);
    }

    function initGame() {
        if (!canvas || !ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        const loadIcon = new Promise((resolve) => {
            historyIcon.onload = () => {
                console.log('Icono de historial cargado correctamente');
                resolve();
            };
            historyIcon.onerror = () => {
                console.error('Error cargando el icono de historial');
                resolve();
            };
        });

        loadIcon.then(() => {
            canvas.width = 800;
            canvas.height = 700;

            // Configurar eventos
            endTurnButton.addEventListener('click', endTurn);
            canvas.addEventListener('click', handleCanvasClick);
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseleave', handleMouseUp);
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);

            updateGameInfo();

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