// Configuración del juego
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Elementos de la interfaz
const returnCardsButton = document.getElementById('returnCards');
const endTurnButton = document.getElementById('endTurn');

// Variables del juego
let socket;
let currentPlayer = {
    id: sessionStorage.getItem('playerId'),
    name: sessionStorage.getItem('playerName'),
    isHost: sessionStorage.getItem('isHost') === 'true'
};
let roomId = sessionStorage.getItem('roomId');
let selectedCard = null;
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
const CARD_SPACING = 10;
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
        this.isPlayedThisTurn = false;
        this.isMostRecent = false;
        this.radius = 5;
    }

    draw() {
        ctx.save();

        // Dibujar carta con esquinas redondeadas
        ctx.beginPath();
        ctx.moveTo(this.x + this.radius, this.y);
        ctx.lineTo(this.x + this.width - this.radius, this.y);
        ctx.quadraticCurveTo(this.x + this.width, this.y, this.x + this.width, this.y + this.radius);
        ctx.lineTo(this.x + this.width, this.y + this.height - this.radius);
        ctx.quadraticCurveTo(this.x + this.width, this.y + this.height, this.x + this.width - this.radius, this.y + this.height);
        ctx.lineTo(this.x + this.radius, this.y + this.height);
        ctx.quadraticCurveTo(this.x, this.y + this.height, this.x, this.y + this.height - this.radius);
        ctx.lineTo(this.x, this.y + this.radius);
        ctx.quadraticCurveTo(this.x, this.y, this.x + this.radius, this.y);
        ctx.closePath();

        // Fondo de la carta
        let fillColor = '#FFFFFF';
        if (this === selectedCard) {
            fillColor = '#FFFF99';
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 4;
            ctx.setLineDash([5, 3]);
        } else if (this.isPlayedThisTurn) {
            fillColor = this.isMostRecent ? '#ADD8E6' : '#A0C0E0';
        }

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Valor de la carta
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

// Inicialización del juego
function initGame() {
    console.log('Iniciando juego para:', currentPlayer.name, 'en sala:', roomId);

    if (!canvas || !ctx) {
        console.error('Error al inicializar canvas');
        alert('Error al cargar el juego. Por favor recarga la página.');
        return;
    }

    canvas.width = 800;
    canvas.height = 600;

    if (!currentPlayer.id || !roomId) {
        alert('Datos de jugador no encontrados. Regresa a la sala.');
        window.location.href = 'sala.html';
        return;
    }

    returnCardsButton.addEventListener('click', handleReturnCards);
    endTurnButton.addEventListener('click', endTurn);
    canvas.addEventListener('click', handleCanvasClick);

    connectWebSocket();
    gameLoop();
}

// Función para manejar el botón de devolver cartas
function handleReturnCards() {
    if (gameState.currentTurn !== currentPlayer.id) {
        showNotification('No es tu turno', true);
        return;
    }

    if (gameState.cardsPlayedThisTurn.length === 0) {
        showNotification('No hay cartas para devolver', true);
        return;
    }

    gameState.cardsPlayedThisTurn.forEach(card => {
        socket.send(JSON.stringify({
            type: 'return_card',
            playerId: currentPlayer.id,
            cardValue: card.value,
            position: card.position
        }));
    });

    selectedCard = null;
    gameState.cardsPlayedThisTurn = [];
    updateEndTurnButton();
}

// Conectar al servidor WebSocket
function connectWebSocket() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        socket.send(JSON.stringify({ type: 'get_game_state' }));
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleSocketMessage(message);
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

function handleSocketMessage(message) {
    switch (message.type) {
        case 'game_state':
            updateGameState(message.state);
            break;
        case 'game_started':
            updateGameState(message.state);
            break;
        case 'your_cards':
            gameState.yourCards = message.cards.map(value => new Card(value, 0, 0, false));
            break;
        case 'game_over':
            alert(message.message);
            break;
        case 'invalid_move':
            showNotification(message.reason, true);
            break;
        case 'init_state':
            gameState = { ...gameState, ...message.state };
            break;
        case 'notification':
            showNotification(message.message, message.isError);
            break;
        case 'card_returned':
            showNotification('Carta devuelta a tu mano', false);
            break;
        default:
            console.warn('Mensaje no reconocido:', message.type);
    }
}

// Mostrar notificación en pantalla
function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Actualizar el estado del juego
function updateGameState(newState) {
    if (!newState || !newState.board) {
        console.error('Estado del juego inválido');
        return;
    }

    gameState = {
        ...gameState,
        ...newState,
        board: {
            ascending: newState.board.ascending || [1, 1],
            descending: newState.board.descending || [100, 100]
        },
        remainingDeck: newState.remainingDeck || 98,
        cardsPlayedThisTurn: newState.cardsPlayedThisTurn || []
    };

    if (!Array.isArray(gameState.yourCards)) {
        gameState.yourCards = [];
    }

    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
    const startY = canvas.height - CARD_HEIGHT - 20;

    gameState.yourCards = gameState.yourCards.map((value, index) => {
        if (value instanceof Card) {
            value.x = startX + index * (CARD_WIDTH + CARD_SPACING);
            value.y = startY;
            value.isPlayable = isYourTurn && canPlayCard(value.value);
            return value;
        }
        return new Card(
            value,
            startX + index * (CARD_WIDTH + CARD_SPACING),
            startY,
            isYourTurn && canPlayCard(value)
        );
    });

    if (!isYourTurn) {
        selectedCard = null;
    }

    updateEndTurnButton();
}

// Verificar si una carta puede ser jugada
function canPlayCard(cardValue) {
    const { ascending, descending } = gameState.board;
    return (cardValue > ascending[0] || cardValue === ascending[0] - 10) ||
        (cardValue > ascending[1] || cardValue === ascending[1] - 10) ||
        (cardValue < descending[0] || cardValue === descending[0] + 10) ||
        (cardValue < descending[1] || cardValue === descending[1] + 10);
}

// Manejar clic en el canvas
function handleCanvasClick(event) {
    if (gameState.currentTurn !== currentPlayer.id) {
        showNotification('Espera tu turno para jugar', true);
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const clickedColumn = getClickedColumn(x, y);
    if (clickedColumn && selectedCard) {
        playCard(selectedCard.value, clickedColumn);
        return;
    }

    if (!selectedCard) {
        const clickedPlayedCard = gameState.cardsPlayedThisTurn.find(card => {
            const pos = getCardPosition(card.position);
            return x >= pos.x && x <= pos.x + CARD_WIDTH &&
                y >= pos.y && y <= pos.y + CARD_HEIGHT;
        });

        if (clickedPlayedCard) {
            returnCardToHand(clickedPlayedCard);
            return;
        }
    }

    gameState.yourCards.forEach(card => {
        if (card.contains(x, y)) {
            if (selectedCard === card) {
                selectedCard = null;
            } else if (card.isPlayable) {
                selectedCard = card;
            } else {
                showNotification('No puedes jugar esta carta ahora', true);
            }
        }
    });
}

// Jugar una carta
function playCard(cardValue, position) {
    if (!selectedCard || selectedCard.value !== cardValue) {
        showNotification('Primero selecciona una carta válida', true);
        return;
    }

    const { isValid, reason } = isValidMove(cardValue, position);

    if (!isValid) {
        showNotification(`No puedes colocar ${cardValue} aquí: ${reason}`, true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    const cardIndex = gameState.yourCards.findIndex(card => card.value === cardValue);
    if (cardIndex !== -1) {
        gameState.yourCards.splice(cardIndex, 1);
    }

    gameState.cardsPlayedThisTurn.push({
        value: cardValue,
        position: position
    });

    selectedCard = null;
    updateEndTurnButton();
    showNotification(`¡Carta ${cardValue} colocada en ${positionToName(position)}!`, false);
}

function isValidMove(cardValue, position) {
    const { ascending, descending } = gameState.board;
    let isValid = false;
    let reason = '';

    if (position.includes('asc')) {
        const target = position === 'asc1' ? 0 : 1;
        isValid = cardValue > ascending[target] || cardValue === ascending[target] - 10;
        reason = isValid ? '' :
            `Debe ser > ${ascending[target]} o = ${ascending[target] - 10}`;
    } else {
        const target = position === 'desc1' ? 0 : 1;
        isValid = cardValue < descending[target] || cardValue === descending[target] + 10;
        reason = isValid ? '' :
            `Debe ser < ${descending[target]} o = ${descending[target] + 10}`;
    }

    return { isValid, reason };
}

function positionToName(position) {
    const names = {
        'asc1': 'Pila Ascendente 1 (↑)',
        'asc2': 'Pila Ascendente 2 (↑)',
        'desc1': 'Pila Descendente 1 (↓)',
        'desc2': 'Pila Descendente 2 (↓)'
    };
    return names[position] || position;
}

// Obtener columna clickeada
function getClickedColumn(x, y) {
    if (y < BOARD_POSITION.y || y > BOARD_POSITION.y + CARD_HEIGHT) {
        return null;
    }

    if (x >= BOARD_POSITION.x && x <= BOARD_POSITION.x + CARD_WIDTH) return 'asc1';
    if (x >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING &&
        x <= BOARD_POSITION.x + C  ARD_WIDTH * 2 + COLUMN_SPACING) return 'asc2';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 &&
        x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) return 'desc1';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 &&
        x <= BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) return 'desc2';

    return null;
}

// Obtener posición de una carta en el tablero
function getCardPosition(position) {
    switch (position) {
        case 'asc1': return { x: BOARD_POSITION.x, y: BOARD_POSITION.y };
        case 'asc2': return { x: BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, y: BOARD_POSITION.y };
        case 'desc1': return { x: BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 2, y: BOARD_POSITION.y
    };
        case 'desc2': return { x: BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 3, y: BOARD_POSITION.y
};
        default: return { x: 0, y: 0 };
    }
}

// Terminar turno
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
    selectedCard = null;
    updateEndTurnButton();
}

// Actualizar estado de los botones
function updateEndTurnButton() {
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.length < minCardsRequired;
    returnCardsButton.disabled = gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.length === 0;
}

// Bucle principal del juego
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
        drawGameInfo();
        drawBoard();
        drawPlayerCards();
    } catch (error) {
        console.error('Error al dibujar:', error);
    }

    requestAnimationFrame(gameLoop);
}

// Dibujar información del juego
function drawGameInfo() {
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 20);
    ctx.fillText(`Cartas en baraja: ${gameState.remainingDeck}`, 20, 50);

    // Contador de cartas jugadas
    ctx.fillStyle = '#FFFF00';
    ctx.font = 'bold 26px Arial';
    ctx.fillText(`Cartas jugadas: ${gameState.cardsPlayedThisTurn.length}`, 20, 80);
}

// Dibujar el tablero
function drawBoard() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Dibujar flechas y cartas ascendentes
    ctx.fillText('↑', BOARD_POSITION.x + C  ARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[0], BOARD_POSITION.x, BOARD_POSITION.y).draw();

    ctx.fillText('↑', BOARD_POSITION.x + C  ARD_WIDTH + COLUMN_SPACING + C  ARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[1], BOARD_POSITION.x + C  ARD_WIDTH + COLUMN_SPACING, BOARD_POSITION.y).draw();

    // Dibujar flechas y cartas descendentes
    ctx.fillText('↓', BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 2 + C  ARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[0], BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 2, BOARD_POSITION.y).draw();

    ctx.fillText('↓', BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 3 + C  AR  D_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[1], BOARD_POSITION.x + (C  ARD_WIDTH + COLUMN_SPACING) * 3, BOARD_POSITION.y).draw();
}

// Dibujar las cartas del jugador
function drawPlayerCards() {
    if (!gameState.yourCards || !Array.isArray(gameState.yourCards)) {
        console.warn('Cartas no válidas:', gameState.yourCards);
        return;
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tu mano', canvas.width / 2, canvas.height - C  ARD_HEIGHT - 50);

    gameState.yourCards.forEach(card => {
        if (card) {
            card.draw();
        }
    });
}

// Iniciar el juego
document.addEventListener('DOMContentLoaded', initGame);