// Configuración inicial
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';
const endTurnButton = document.getElementById('endTurnBtn');
const undoButton = document.getElementById('undoBtn');

// Constantes de diseño
const CARD_WIDTH = 80;
const CARD_HEIGHT = 120;
const COLUMN_SPACING = 60;
const CARD_SPACING = 10;
const BOARD_POSITION = {
    x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
    y: canvas.height / 2 - CARD_HEIGHT / 2
};

// Estado del juego
const currentPlayer = {
    id: sessionStorage.getItem('playerId'),
    name: sessionStorage.getItem('playerName'),
    isHost: sessionStorage.getItem('isHost') === 'true'
};
const roomId = sessionStorage.getItem('roomId');
let selectedCard = null;
let gameState = {
    players: [],
    yourCards: [],
    board: { ascending: [1, 1], descending: [100, 100] },
    currentTurn: null,
    remainingDeck: 98,
    cardsPlayedThisTurn: [],
    animatingCards: []
};

// Clase Card
class Card {
    constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = CARD_WIDTH;
        this.height = CARD_HEIGHT;
        this.isPlayable = isPlayable;
        this.isPlayedThisTurn = isPlayedThisTurn;
        this.radius = 5;
        this.shakeOffset = 0;
        this.backgroundColor = isPlayedThisTurn ? '#99CCFF' : '#FFFFFF';
    }

    draw() {
        ctx.save();
        ctx.translate(this.shakeOffset, 0);

        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, this.height, this.radius);
        ctx.fillStyle = this === selectedCard ? '#FFFF99' : this.backgroundColor;
        ctx.fill();
        ctx.strokeStyle = this.isPlayable ? '#00FF00' : '#000000';
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.value.toString(), this.x + this.width / 2, this.y + this.height / 2);
        ctx.restore();
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }
}

// Conexión WebSocket
let socket;

function connectWebSocket() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

    socket.onopen = () => socket.send(JSON.stringify({ type: 'get_game_state' }));
    socket.onclose = () => setTimeout(connectWebSocket, 2000);
    socket.onerror = console.error;

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'game_state':
                    updateGameState(message.state);
                    break;
                case 'game_started':
                    updateGameState(message.state);
                    break;
                case 'your_cards':
                    updatePlayerCards(message.cards);
                    break;
                case 'game_over':
                    handleGameOver(message);
                    break;
                case 'notification':
                    showNotification(message.message, message.isError);
                    break;
                case 'card_played':
                    handleOpponentCardPlayed(message);
                    break;
                case 'invalid_move':
                    if (message.playerId === currentPlayer.id && selectedCard) {
                        animateInvalidCard(selectedCard);
                    }
                    break;
                case 'turn_changed':
                    handleTurnChanged(message);
                    break;
                case 'move_undone':
                    handleMoveUndone(message);
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    };
}

// Funciones de utilidad
function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
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

    const shakeAmount = 5;
    const shakeDuration = 300;
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
    undoButton.disabled = true;
    showNotification(`Ahora es el turno de ${gameState.players.find(p => p.id === message.newTurn)?.name || 'otro jugador'}`);
}

function handleMoveUndone(message) {
    if (message.playerId === currentPlayer.id) {
        const moveIndex = gameState.cardsPlayedThisTurn.findIndex(
            move => move.value === message.cardValue &&
                move.position === message.position
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

        const card = new Card(
            message.cardValue,
            0,
            0,
            true,
            false
        );
        gameState.yourCards.push(card);
        updatePlayerCards(gameState.yourCards.map(c => c.value));
    }
}

function handleGameOver(message) {
    if (message.reason === 'min_cards_not_met') {
        canvas.style.pointerEvents = 'none';
        endTurnButton.disabled = true;
        undoButton.disabled = true;

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';
        gameOverDiv.innerHTML = `
            <h2>¡GAME OVER!</h2>
            <p>${message.message}</p>
            <button id="returnToLobby">Volver al Lobby</button>
        `;
        document.body.appendChild(gameOverDiv);

        document.getElementById('returnToLobby').addEventListener('click', () => {
            window.location.href = '/';
        });
    }
}

function updateGameState(newState) {
    if (!newState) return;

    gameState.board = newState.board || gameState.board;
    gameState.currentTurn = newState.currentTurn || gameState.currentTurn;
    gameState.remainingDeck = newState.remainingDeck || gameState.remainingDeck;
    gameState.players = newState.players || gameState.players;
    gameState.cardsPlayedThisTurn = newState.cardsPlayedThisTurn || gameState.cardsPlayedThisTurn;

    if (newState.yourCards) {
        updatePlayerCards(newState.yourCards);
    }

    if (gameState.currentTurn !== currentPlayer.id) {
        selectedCard = null;
    }

    undoButton.disabled =
        gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.filter(c => c.playerId === currentPlayer.id).length === 0;
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
        const opponentCard = new Card(
            value,
            cardPosition.x,
            cardPosition.y,
            false,
            true
        );

        gameState.animatingCards.push({
            card: opponentCard,
            startTime: Date.now(),
            duration: 300,
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

        showNotification(`${message.playerName} jugó un ${value}`);
    }
}

function updatePlayerCards(cards) {
    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    const startX = (canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
    const startY = canvas.height - CARD_HEIGHT - 100; // Ajustado para los botones

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

function handleCanvasClick(event) {
    if (gameState.currentTurn !== currentPlayer.id) {
        return showNotification('No es tu turno', true);
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

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

    selectedCard.isPlayedThisTurn = true;
    selectedCard.backgroundColor = '#99CCFF';

    const cardPosition = getColumnPosition(position);
    gameState.animatingCards.push({
        card: selectedCard,
        startTime: Date.now(),
        duration: 300,
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

    undoButton.disabled = false;
    selectedCard = null;
}

function undoLastMove() {
    if (gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.filter(c => c.playerId === currentPlayer.id).length === 0) {
        return;
    }

    const lastMove = [...gameState.cardsPlayedThisTurn]
        .reverse()
        .find(move => move.playerId === currentPlayer.id);

    if (!lastMove) {
        return showNotification('No hay movimientos para deshacer', true);
    }

    socket.send(JSON.stringify({
        type: 'undo_move',
        playerId: currentPlayer.id,
        cardValue: lastMove.value,
        position: lastMove.position
    }));
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

function drawGameInfo() {
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    const currentPlayerCardsPlayed = gameState.currentTurn === currentPlayer.id
        ? gameState.cardsPlayedThisTurn.filter(card => card.playerId === currentPlayer.id).length
        : 0;
    const cardsNeeded = Math.max(0, minCardsRequired - currentPlayerCardsPlayed);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 20);
    ctx.fillText(`Baraja: ${gameState.remainingDeck}`, 20, 50);

    if (gameState.currentTurn === currentPlayer.id) {
        ctx.fillStyle = currentPlayerCardsPlayed >= minCardsRequired ? '#00FF00' : '#FFFF00';
        ctx.fillText(`Cartas: ${currentPlayerCardsPlayed}/${minCardsRequired}`, 20, 80);

        if (cardsNeeded > 0) {
            ctx.fillStyle = '#FF0000';
            ctx.fillText(`Faltan ${cardsNeeded}`, 20, 110);
        }
    }
}

function drawBoard() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';

    ['asc1', 'asc2'].forEach((col, i) => {
        ctx.fillText('↑', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
        const card = new Card(
            gameState.board.ascending[i],
            BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i,
            BOARD_POSITION.y,
            false,
            gameState.cardsPlayedThisTurn.some(c => c.value === gameState.board.ascending[i])
        );
        card.draw();
    });

    ['desc1', 'desc2'].forEach((col, i) => {
        ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * (i + 2) + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
        const card = new Card(
            gameState.board.descending[i],
            BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * (i + 2),
            BOARD_POSITION.y,
            false,
            gameState.cardsPlayedThisTurn.some(c => c.value === gameState.board.descending[i])
        );
        card.draw();
    });
}

function drawPlayerCards() {
    gameState.yourCards.forEach(card => card?.draw());
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

        if (progress === 1) {
            gameState.animatingCards.splice(i, 1);
        }
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGameInfo();
    drawBoard();
    handleCardAnimations();
    drawPlayerCards();
    requestAnimationFrame(gameLoop);
}

function initGame() {
    if (!canvas || !ctx || !currentPlayer.id || !roomId) {
        alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
        return;
    }

    canvas.width = 800;
    canvas.height = 700; // Aumentado para acomodar los botones
    endTurnButton.addEventListener('click', endTurn);
    undoButton.addEventListener('click', undoLastMove);
    canvas.addEventListener('click', handleCanvasClick);
    connectWebSocket();
    gameLoop();
}

document.addEventListener('DOMContentLoaded', initGame);