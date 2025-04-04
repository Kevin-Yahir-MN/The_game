// Configuración inicial
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';
const endTurnButton = document.getElementById('endTurnBtn');
const undoButton = document.getElementById('undoBtn');

// Asegurar que el canvas tenga el tamaño correcto
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    canvas.width = container.clientWidth - 40; // Margen para dispositivos móviles
    canvas.height = Math.min(window.innerHeight - 200, 600); // Altura máxima 600px

    // Recalcular posición del tablero
    BOARD_POSITION.x = canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2;
    BOARD_POSITION.y = canvas.height / 2 - CARD_HEIGHT / 2;
}

// Constantes de diseño
const CARD_WIDTH = 80;
const CARD_HEIGHT = 120;
const COLUMN_SPACING = 60;
const CARD_SPACING = 10;
let BOARD_POSITION = {
    x: 0,
    y: 0
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
    moveHistory: [],
    animatingCards: []
};

// Clase Card optimizada
class Card {
    constructor(value, x, y, isPlayable = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = CARD_WIDTH;
        this.height = CARD_HEIGHT;
        this.isPlayable = isPlayable;
        this.radius = 5;
        this.shakeOffset = 0;
    }

    draw() {
        ctx.save();
        ctx.translate(this.shakeOffset, 0);

        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, this.height, this.radius);
        ctx.fillStyle = this === selectedCard ? '#FFFF99' : '#FFFFFF';
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

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        socket.send(JSON.stringify({ type: 'get_game_state' }));
    };

    socket.onclose = () => {
        console.log('Conexión WebSocket cerrada. Reconectando...');
        setTimeout(connectWebSocket, 2000);
    };

    socket.onerror = (error) => {
        console.error('Error en WebSocket:', error);
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Mensaje recibido:', message.type);

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
                    alert(message.message);
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
                case 'move_undone':
                    handleUndoMove(message);
                    break;
                default:
                    console.warn('Tipo de mensaje desconocido:', message.type);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    };
}

// Funciones de utilidad
function showNotification(message, isError = false) {
    console.log(`Notificación: ${message}`, isError ? '(Error)' : '');
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

// Actualización del estado
function updateGameState(newState) {
    if (!newState) {
        console.warn('Intento de actualizar estado con datos nulos');
        return;
    }

    console.log('Actualizando estado del juego:', newState);

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
            value: message.cardValue,
            position: message.position,
            playerId: message.playerId
        });

        showNotification(`${message.playerName} jugó un ${value}`);
    }
}

function handleUndoMove(message) {
    if (message.playerId !== currentPlayer.id) {
        if (message.position.includes('asc')) {
            const idx = message.position === 'asc1' ? 0 : 1;
            gameState.board.ascending[idx] = message.previousValue;
        } else {
            const idx = message.position === 'desc1' ? 0 : 1;
            gameState.board.descending[idx] = message.previousValue;
        }

        const moveIndex = gameState.cardsPlayedThisTurn.findIndex(
            card => card.playerId === message.playerId &&
                card.value === message.cardValue &&
                card.position === message.position
        );
        if (moveIndex !== -1) {
            gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
        }

        showNotification(`${message.playerName} deshizo una jugada`);
    }
}

function updatePlayerCards(cards) {
    console.log('Actualizando cartas del jugador:', cards);

    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    const startX = (canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
    const startY = canvas.height - CARD_HEIGHT - 20;

    gameState.yourCards = cards.map((card, index) => {
        const value = card instanceof Card ? card.value : card;
        const playable = isYourTurn && (
            isValidMove(value, 'asc1') || isValidMove(value, 'asc2') ||
            isValidMove(value, 'desc1') || isValidMove(value, 'desc2')
        );

        return card instanceof Card
            ? Object.assign(card, {
                x: startX + index * (CARD_WIDTH + CARD_SPACING),
                y: startY,
                isPlayable: playable
            })
            : new Card(
                value,
                startX + index * (CARD_WIDTH + CARD_SPACING),
                startY,
                playable
            );
    });
}

// Manejo de interacciones
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

    // Guardar en el historial
    const previousValue = position.includes('asc')
        ? gameState.board.ascending[position === 'asc1' ? 0 : 1]
        : gameState.board.descending[position === 'desc1' ? 0 : 1];

    gameState.moveHistory.push({
        cardValue,
        position,
        previousValue
    });

    // Actualizar contador
    gameState.cardsPlayedThisTurn.push({
        value: cardValue,
        position,
        playerId: currentPlayer.id
    });

    // Eliminar carta de la mano
    const cardIndex = gameState.yourCards.findIndex(c => c.value === cardValue);
    if (cardIndex !== -1) {
        gameState.yourCards.splice(cardIndex, 1);
    }

    // Actualizar tablero
    if (position.includes('asc')) {
        const idx = position === 'asc1' ? 0 : 1;
        gameState.board.ascending[idx] = cardValue;
    } else {
        const idx = position === 'desc1' ? 0 : 1;
        gameState.board.descending[idx] = cardValue;
    }

    // Enviar al servidor
    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue,
        position
    }));

    selectedCard = null;
}

function undoLastMove() {
    if (gameState.currentTurn !== currentPlayer.id) {
        return showNotification('Solo puedes deshacer en tu turno', true);
    }

    if (gameState.moveHistory.length === 0) {
        return showNotification('No hay jugadas para deshacer', true);
    }

    const lastMove = gameState.moveHistory.pop();
    const { cardValue, position, previousValue } = lastMove;

    // Devolver carta a la mano
    gameState.yourCards.push(new Card(
        cardValue,
        0, // Posición temporal
        0, // Se actualizará en updatePlayerCards
        true
    ));

    // Restaurar valor anterior en el tablero
    if (position.includes('asc')) {
        const idx = position === 'asc1' ? 0 : 1;
        gameState.board.ascending[idx] = previousValue;
    } else {
        const idx = position === 'desc1' ? 0 : 1;
        gameState.board.descending[idx] = previousValue;
    }

    // Actualizar contador
    const moveIndex = gameState.cardsPlayedThisTurn.findIndex(
        card => card.playerId === currentPlayer.id &&
            card.value === cardValue &&
            card.position === position
    );
    if (moveIndex !== -1) {
        gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
    }

    // Actualizar mano
    updatePlayerCards(gameState.yourCards.map(card => card.value));

    // Notificar al servidor
    socket.send(JSON.stringify({
        type: 'undo_move',
        playerId: currentPlayer.id,
        cardValue,
        position,
        previousValue
    }));

    showNotification('Última jugada deshecha', false);
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

    // Limpiar historial al terminar turno
    gameState.moveHistory = [];
}

// Renderizado del juego
function drawGameInfo() {
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;

    const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
        card => card.playerId === gameState.currentTurn
    ).length;

    const cardsNeeded = Math.max(0, minCardsRequired - currentPlayerCardsPlayed);

    // Actualizar estado del botón Deshacer
    undoButton.disabled = gameState.moveHistory.length === 0 || gameState.currentTurn !== currentPlayer.id;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 20);
    ctx.fillText(`Baraja: ${gameState.remainingDeck}`, 20, 50);
    ctx.fillStyle = currentPlayerCardsPlayed >= minCardsRequired ? '#00FF00' : '#FFFF00';
    ctx.fillText(`Cartas: ${currentPlayerCardsPlayed}/${minCardsRequired}`, 20, 80);

    if (cardsNeeded > 0 && gameState.currentTurn === currentPlayer.id) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText(`Faltan ${cardsNeeded}`, 20, 110);
    }
}

function drawBoard() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';

    // Dibujar pilas ascendentes
    ['asc1', 'asc2'].forEach((col, i) => {
        ctx.fillText('↑', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
        new Card(gameState.board.ascending[i], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i, BOARD_POSITION.y).draw();
    });

    // Dibujar pilas descendentes
    ['desc1', 'desc2'].forEach((col, i) => {
        ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * (i + 2) + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
        new Card(gameState.board.descending[i], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * (i + 2), BOARD_POSITION.y).draw();
    });
}

function drawPlayerCards() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Tu mano', canvas.width / 2, canvas.height - CARD_HEIGHT - 50);

    if (gameState.yourCards && gameState.yourCards.length > 0) {
        gameState.yourCards.forEach(card => {
            if (card) card.draw();
        });
    }
}

// Bucle principal
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGameInfo();
    drawBoard();
    drawPlayerCards();
    requestAnimationFrame(gameLoop);
}

// Inicialización
function initGame() {
    console.log('Inicializando juego...');

    if (!canvas || !ctx) {
        console.error('Canvas no disponible');
        alert('Error: No se pudo acceder al canvas del juego.');
        return;
    }

    if (!currentPlayer.id || !roomId) {
        console.error('Falta información de jugador o sala');
        alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
        return;
    }

    // Configurar tamaño del canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Configurar eventos
    endTurnButton.addEventListener('click', endTurn);
    undoButton.addEventListener('click', undoLastMove);
    canvas.addEventListener('click', handleCanvasClick);

    // Iniciar conexión y juego
    connectWebSocket();
    gameLoop();
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM cargado, iniciando juego...');
    initGame();
});