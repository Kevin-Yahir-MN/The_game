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
    cardsPlayedThisTurn: [] // {value, position, x, y}
};

// Constantes de diseño
const CARD_WIDTH = 80;
const CARD_HEIGHT = 120;
const COLUMN_SPACING = 60;
const BOARD_POSITION = {
    x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
    y: canvas.height / 2 - CARD_HEIGHT / 2
};

// Variables para drag & drop
let draggedCard = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// Clase Card para representar las cartas
class Card {
    constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = CARD_WIDTH;
        this.height = CARD_HEIGHT;
        this.isPlayable = isPlayable;
        this.isSelected = false;
        this.isPlayedThisTurn = isPlayedThisTurn;
        this.isBeingDragged = false;
    }

    draw() {
        // Fondo de la carta
        if (this.isPlayedThisTurn) {
            ctx.fillStyle = '#ADD8E6'; // Azul claro para cartas jugadas este turno
        } else {
            ctx.fillStyle = this.isSelected ? '#FFD700' : '#FFFFFF';
        }
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Borde
        if (this.isPlayable && !this.isPlayedThisTurn) {
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

    // Event listeners para drag & drop
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', dragCard);
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', cancelDrag);

    // Event listener para terminar turno
    document.getElementById('endTurn').addEventListener('click', endTurn);

    gameLoop();
}

// [Las funciones connectWebSocket, updateGameState, canPlayCard permanecen igual]

function startDrag(event) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Verificar si se está arrastrando una carta de la mano
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;

        if (card.contains(mouseX, mouseY) && card.isPlayable) {
            draggedCard = card;
            dragOffsetX = mouseX - card.x;
            dragOffsetY = mouseY - card.y;
            card.isBeingDragged = true;
        }
    });

    // Verificar si se hace clic en una carta jugada este turno (para devolverla)
    if (!draggedCard && gameState.currentTurn === currentPlayer.id) {
        gameState.cardsPlayedThisTurn.forEach(card => {
            if (mouseX >= card.x && mouseX <= card.x + CARD_WIDTH &&
                mouseY >= card.y && mouseY <= card.y + CARD_HEIGHT) {
                returnCardToHand(card);
            }
        });
    }
}

function dragCard(event) {
    if (!draggedCard) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    draggedCard.x = mouseX - dragOffsetX;
    draggedCard.y = mouseY - dragOffsetY;
}

function endDrag(event) {
    if (!draggedCard) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Verificar si se soltó sobre una columna válida
    if (mouseY >= BOARD_POSITION.y && mouseY <= BOARD_POSITION.y + CARD_HEIGHT) {
        let position;
        if (mouseX >= BOARD_POSITION.x && mouseX <= BOARD_POSITION.x + CARD_WIDTH) {
            position = 'asc1';
        }
        else if (mouseX >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING &&
            mouseX <= BOARD_POSITION.x + CARD_WIDTH * 2 + COLUMN_SPACING) {
            position = 'asc2';
        }
        else if (mouseX >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 &&
            mouseX <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) {
            position = 'desc1';
        }
        else if (mouseX >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 &&
            mouseX <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) {
            position = 'desc2';
        }

        if (position) {
            playCard(draggedCard.value, position, draggedCard.x, draggedCard.y);
        }
    }

    // Restablecer la carta a su posición original si no se soltó en un lugar válido
    cancelDrag();
}

function cancelDrag() {
    if (!draggedCard) return;

    draggedCard.isBeingDragged = false;
    draggedCard = null;
}

function returnCardToHand(cardInfo) {
    if (gameState.currentTurn !== currentPlayer.id) return;

    socket.send(JSON.stringify({
        type: 'return_card',
        playerId: currentPlayer.id,
        cardValue: cardInfo.value,
        position: cardInfo.position
    }));

    // Eliminar de las cartas jugadas este turno
    gameState.cardsPlayedThisTurn = gameState.cardsPlayedThisTurn.filter(
        c => !(c.value === cardInfo.value && c.position === cardInfo.position)
    );
}

function playCard(cardValue, position, x, y) {
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
        position: position,
        x: x,
        y: y
    });

    // Actualizar estado del botón
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
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    endTurnBtn.disabled = gameState.cardsPlayedThisTurn.length < minCardsRequired;
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

    // Dibujar cartas jugadas este turno (en azul)
    drawPlayedCardsThisTurn();

    // Dibujar cartas del jugador
    drawPlayerCards();

    requestAnimationFrame(gameLoop);
}

function drawPlayedCardsThisTurn() {
    gameState.cardsPlayedThisTurn.forEach(cardInfo => {
        let x, y;
        switch (cardInfo.position) {
            case 'asc1':
                x = BOARD_POSITION.x;
                y = BOARD_POSITION.y;
                break;
            case 'asc2':
                x = BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING;
                y = BOARD_POSITION.y;
                break;
            case 'desc1':
                x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2;
                y = BOARD_POSITION.y;
                break;
            case 'desc2':
                x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3;
                y = BOARD_POSITION.y;
                break;
        }

        const card = new Card(cardInfo.value, x, y, false, true);
        card.draw();
    });
}

// [Las funciones drawGameInfo, drawBoard, drawPlayerCards permanecen igual]

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);