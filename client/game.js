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
    cardsPlayedThisTurn: []
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
    constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = CARD_WIDTH;
        this.height = CARD_HEIGHT;
        this.isPlayable = isPlayable;
        this.isPlayedThisTurn = isPlayedThisTurn;
    }

    draw() {
        // Fondo de la carta
        ctx.fillStyle = this.isPlayedThisTurn ? '#ADD8E6' : '#FFFFFF';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Borde
        ctx.strokeStyle = this.isPlayable ? '#00FF00' : '#000000';
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

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
    console.log('Iniciando juego para:', currentPlayer.name, 'ID:', currentPlayer.id, 'en sala:', roomId);

    // Verificar que tenemos los datos necesarios
    if (!currentPlayer.id || !roomId) {
        console.error('Faltan datos del jugador o sala');
        alert('Error: No se encontraron datos del jugador. Vuelve a la sala.');
        return;
    }

    // Conexión WebSocket
    connectWebSocket();

    // Event listeners
    canvas.addEventListener('click', handleCanvasClick);
    document.getElementById('endTurn').addEventListener('click', endTurn);

    // Iniciar bucle del juego
    gameLoop();
}

function connectWebSocket() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        // Solicitar estado actual del juego
        socket.send(JSON.stringify({
            type: 'get_game_state'
        }));
    };

    socket.onmessage = (event) => {
        try {
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
                    showNotification(message.reason, true);
                    break;
                case 'init_state':
                    gameState = {
                        ...gameState,
                        ...message.state,
                        yourCards: message.yourCards || [],
                        cardsPlayedThisTurn: message.isYourTurn ? gameState.cardsPlayedThisTurn : []
                    };
                    break;
                case 'notification':
                    showNotification(message.message, message.isError);
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
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

function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

function updateGameState(newState) {
    console.log('Actualizando estado del juego:', newState);

    // Mantener las cartas jugadas este turno solo si es nuestro turno
    gameState = {
        ...gameState,
        ...newState,
        cardsPlayedThisTurn: newState.currentTurn === currentPlayer.id ?
            gameState.cardsPlayedThisTurn : []
    };

    // Actualizar estado de las cartas jugables
    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    if (Array.isArray(gameState.yourCards)) {
        gameState.yourCards = gameState.yourCards.map(value => {
            return new Card(
                value,
                0, // x se calcula al dibujar
                0, // y se calcula al dibujar
                isYourTurn && canPlayCard(value)
            );
        });
    }

    // Actualizar estado del botón
    updateEndTurnButton();
}

function canPlayCard(cardValue) {
    const { ascending, descending } = gameState.board;

    return (cardValue === ascending[0] - 10 || cardValue > ascending[0]) ||  // asc1
        (cardValue === ascending[1] - 10 || cardValue > ascending[1]) ||  // asc2
        (cardValue === descending[0] + 10 || cardValue < descending[0]) || // desc1
        (cardValue === descending[1] + 10 || cardValue < descending[1]);   // desc2
}

function handleCanvasClick(event) {
    if (gameState.currentTurn !== currentPlayer.id) {
        showNotification('No es tu turno', true);
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Verificar clic en cartas del jugador
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;

        if (card.contains(x, y) && card.isPlayable) {
            // Determinar en qué columna soltar
            if (y >= BOARD_POSITION.y && y <= BOARD_POSITION.y + CARD_HEIGHT) {
                let position;
                if (x >= BOARD_POSITION.x && x <= BOARD_POSITION.x + CARD_WIDTH) {
                    position = 'asc1';
                }
                else if (x >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING &&
                    x <= BOARD_POSITION.x + CARD_WIDTH * 2 + COLUMN_SPACING) {
                    position = 'asc2';
                }
                else if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 &&
                    x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) {
                    position = 'desc1';
                }
                else if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 &&
                    x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) {
                    position = 'desc2';
                }

                if (position) {
                    playCard(card.value, position);
                }
            }
        }
    });

    // Verificar clic en cartas jugadas este turno (para devolver)
    gameState.cardsPlayedThisTurn.forEach(card => {
        if (x >= card.x && x <= card.x + CARD_WIDTH &&
            y >= card.y && y <= card.y + CARD_HEIGHT) {
            returnCardToHand(card);
        }
    });
}

function playCard(cardValue, position) {
    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    // Registrar carta jugada este turno
    let x, y;
    switch (position) {
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

    gameState.cardsPlayedThisTurn.push({
        value: cardValue,
        position: position,
        x: x,
        y: y
    });

    updateEndTurnButton();
}

function returnCardToHand(cardInfo) {
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

    updateEndTurnButton();
}

function endTurn() {
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    if (gameState.cardsPlayedThisTurn.length < minCardsRequired) {
        showNotification(`Debes jugar al menos ${minCardsRequired} cartas este turno`, true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'end_turn',
        playerId: currentPlayer.id,
        cardsPlayed: gameState.cardsPlayedThisTurn.length
    }));

    gameState.cardsPlayedThisTurn = [];
    updateEndTurnButton();
}

function updateEndTurnButton() {
    const endTurnBtn = document.getElementById('endTurn');
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    endTurnBtn.disabled = gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.length < minCardsRequired;
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

    // Dibujar cartas jugadas este turno
    drawCardsPlayedThisTurn();

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
    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 40);

    // Cartas en la baraja
    ctx.fillText(`Cartas en la baraja: ${gameState.remainingDeck}`, 20, 80);

    // Cartas jugadas este turno
    ctx.fillText(`Cartas jugadas: ${gameState.cardsPlayedThisTurn.length}`, 20, 120);
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

function drawCardsPlayedThisTurn() {
    gameState.cardsPlayedThisTurn.forEach(card => {
        const cardObj = new Card(card.value, card.x, card.y, false, true);
        cardObj.draw();
    });
}

function drawPlayerCards() {
    if (!gameState.yourCards || !Array.isArray(gameState.yourCards)) return;

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