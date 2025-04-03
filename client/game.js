// Configuración del juego
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Variables del juego
let socket;
let currentPlayer = {
    id: sessionStorage.getItem('playerId'),
    name: sessionStorage.getItem('playerName')
};
let roomId = sessionStorage.getItem('roomId');
let gameState = {
    players: [],
    yourCards: [],
    board: {
        ascending: [1, 1],    // [asc1, asc2]
        descending: [100, 100] // [desc1, desc2]
    },
    currentTurn: null,
    remainingDeck: 98,
    cardsPlayedThisTurn: [] // Registro de cartas jugadas en el turno actual
};

// Constantes de diseño
const CARD_WIDTH = 80;
const CARD_HEIGHT = 120;
const COLUMN_SPACING = 60;
const BOARD_POSITION = {
    x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
    y: canvas.height / 2 - CARD_HEIGHT / 2
};

// Clase Card para representar las cartas
class Card {
    constructor(value, x, y, isPlayable = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = CARD_WIDTH;
        this.height = CARD_HEIGHT;
        this.isPlayable = isPlayable;
        this.isSelected = false;
    }

    draw() {
        // Fondo de la carta
        ctx.fillStyle = this.isSelected ? '#FFD700' : '#FFFFFF';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Borde
        if (this.isPlayable) {
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 3;
            ctx.strokeRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4);
        } else {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(this.x, this.y, this.width, this.height);
        }

        // Valor de la carta
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.value, this.x + this.width / 2, this.y + this.height / 2 + 10);
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }
}

// Inicialización del juego
function initGame() {
    console.log('Iniciando juego para:', currentPlayer.name, 'en sala:', roomId);

    // Conexión WebSocket
    connectWebSocket();

    // Event listeners
    canvas.addEventListener('click', handleCanvasClick);
    document.getElementById('endTurn').addEventListener('click', endTurn);
    document.getElementById('returnCards').addEventListener('click', returnCards);

    gameLoop();
}

function connectWebSocket() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Mensaje recibido:', message);

        switch (message.type) {
            case 'game_state':
                updateGameState(message.state);
                break;
            case 'game_over':
                alert(message.message);
                break;
            case 'invalid_move':
                alert('Movimiento inválido: ' + message.reason);
                break;
        }
    };

    socket.onclose = () => {
        console.log('Conexión cerrada, reconectando...');
        setTimeout(connectWebSocket, 2000);
    };

    socket.onerror = (error) => {
        console.error('Error en WebSocket:', error);
    };
}

function updateGameState(newState) {
    // Guardar cartas jugadas este turno
    const prevCardsPlayed = gameState.cardsPlayedThisTurn;

    // Actualizar estado
    gameState = { ...gameState, ...newState };
    gameState.cardsPlayedThisTurn = prevCardsPlayed;

    // Actualizar estado de las cartas jugables
    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    gameState.yourCards = gameState.yourCards.map(value => {
        const card = new Card(
            value,
            0, 0, // Posición se calcula al dibujar
            isYourTurn && canPlayCard(value)
        );
        return card;
    });

    // Actualizar estado del botón de terminar turno
    updateEndTurnButton();
}

function canPlayCard(cardValue) {
    const { ascending, descending } = gameState.board;

    // Verificar si la carta puede jugarse en alguna pila
    return (cardValue > ascending[0] || cardValue === ascending[0] - 10) ||  // asc1
        (cardValue > ascending[1] || cardValue === ascending[1] - 10) ||  // asc2
        (cardValue < descending[0] || cardValue === descending[0] + 10) || // desc1
        (cardValue < descending[1] || cardValue === descending[1] + 10);   // desc2
}

function handleCanvasClick(event) {
    if (gameState.currentTurn !== currentPlayer.id) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Verificar clic en cartas del jugador
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;

        if (card.contains(x, y)) {
            card.isSelected = !card.isSelected;
            // Deseleccionar otras cartas
            gameState.yourCards.forEach((otherCard, otherIndex) => {
                if (index !== otherIndex) otherCard.isSelected = false;
            });
        }
    });

    // Verificar clic en pilas del tablero
    if (y >= BOARD_POSITION.y && y <= BOARD_POSITION.y + CARD_HEIGHT) {
        const selectedCard = gameState.yourCards.find(card => card.isSelected && card.isPlayable);
        if (!selectedCard) return;

        // Determinar en qué columna se hizo clic
        let position;
        if (x >= BOARD_POSITION.x && x <= BOARD_POSITION.x + CARD_WIDTH) {
            position = 'asc1';
        }
        else if (x >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING && x <= BOARD_POSITION.x + CARD_WIDTH * 2 + COLUMN_SPACING) {
            position = 'asc2';
        }
        else if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 && x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) {
            position = 'desc1';
        }
        else if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 && x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) {
            position = 'desc2';
        } else {
            return;
        }

        playCard(selectedCard.value, position);
    }
}

function playCard(cardValue, position) {
    if (gameState.currentTurn !== currentPlayer.id) return;

    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    // Registrar carta jugada este turno
    gameState.cardsPlayedThisTurn.push({
        value: cardValue,
        position: position
    });

    // Actualizar estado del botón
    updateEndTurnButton();
}

function returnCards() {
    if (gameState.currentTurn !== currentPlayer.id || gameState.cardsPlayedThisTurn.length === 0) return;

    socket.send(JSON.stringify({
        type: 'return_cards',
        playerId: currentPlayer.id,
        cards: gameState.cardsPlayedThisTurn
    }));

    // Limpiar registro de cartas jugadas este turno
    gameState.cardsPlayedThisTurn = [];
    updateEndTurnButton();
}

function endTurn() {
    if (gameState.currentTurn !== currentPlayer.id) return;

    // Verificar mínimo de cartas jugadas
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    if (gameState.cardsPlayedThisTurn.length < minCardsRequired) {
        alert(`Debes jugar al menos ${minCardsRequired} cartas este turno`);
        return;
    }

    socket.send(JSON.stringify({
        type: 'end_turn',
        playerId: currentPlayer.id,
        cardsPlayed: gameState.cardsPlayedThisTurn.length
    }));

    // Limpiar registro de cartas jugadas este turno
    gameState.cardsPlayedThisTurn = [];
}

function updateEndTurnButton() {
    const endTurnBtn = document.getElementById('endTurn');
    const returnBtn = document.getElementById('returnCards');
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;

    // Habilitar/deshabilitar botón de terminar turno
    endTurnBtn.disabled = gameState.cardsPlayedThisTurn.length < minCardsRequired;

    // Habilitar/deshabilitar botón de devolver cartas
    returnBtn.disabled = gameState.cardsPlayedThisTurn.length === 0;
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo verde
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar información del juego
    drawGameInfo();

    // Dibujar tablero
    drawBoard();

    // Dibujar cartas del jugador
    drawPlayerCards();

    requestAnimationFrame(gameLoop);
}

function drawGameInfo() {
    // Turno actual
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Turno: ${currentTurnPlayer?.name || ''}`, 20, 40);

    // Cartas en la baraja
    ctx.fillText(`Cartas en la baraja: ${gameState.remainingDeck}`, 20, 80);

    // Cartas jugadas este turno
    ctx.fillText(`Cartas jugadas este turno: ${gameState.cardsPlayedThisTurn.length}`, 20, 120);

    // Mínimo requerido
    const minRequired = gameState.remainingDeck > 0 ? 2 : 1;
    ctx.fillText(`Mínimo requerido: ${minRequired}`, 20, 160);
}

function drawBoard() {
    // Dibujar las 4 pilas del tablero con flechas
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';

    // Pila Ascendente 1 (↑)
    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[0], BOARD_POSITION.x, BOARD_POSITION.y).draw();

    // Pila Ascendente 2 (↑)
    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[1], BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, BOARD_POSITION.y).draw();

    // Pila Descendente 1 (↓)
    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[0], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, BOARD_POSITION.y).draw();

    // Pila Descendente 2 (↓)
    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[1], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, BOARD_POSITION.y).draw();
}

function drawPlayerCards() {
    if (!gameState.yourCards || gameState.yourCards.length === 0) return;

    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;

    // Título "Tu mano"
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tu mano', canvas.width / 2, canvas.height - CARD_HEIGHT - 50);

    // Dibujar cartas
    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;
        card.draw();
    });
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);