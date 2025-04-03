// Configuración del juego
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Elementos de la interfaz
const startButton = document.getElementById('startGame');
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
    }

    draw() {
        // Fondo de la carta
        let fillColor = '#FFFFFF';
        if (this === selectedCard) fillColor = '#FFFF99';
        else if (this.isPlayedThisTurn) {
            fillColor = this.isMostRecent ? '#ADD8E6' : '#A0C0E0';
        }

        ctx.fillStyle = fillColor;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Borde
        ctx.strokeStyle = this.isPlayable ? '#00FF00' : '#000000';
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // Valor de la carta
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.value.toString(), this.x + this.width / 2, this.y + this.height / 2);
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }
}

// Inicialización del juego
function initGame() {
    console.log('Iniciando juego para:', currentPlayer.name, 'ID:', currentPlayer.id, 'en sala:', roomId);

    // Verificar que el canvas existe
    if (!canvas) {
        console.error('Canvas no encontrado');
        alert('Error: No se encontró el elemento canvas');
        return;
    }

    // Establecer tamaño del canvas
    canvas.width = 800;
    canvas.height = 600;

    // Verificar que el contexto 2D se obtuvo correctamente
    if (!ctx) {
        console.error('No se pudo obtener el contexto 2D');
        alert('Error: No se pudo inicializar el contexto de dibujo');
        return;
    }

    // Verificar datos del jugador
    if (!currentPlayer.id || !roomId) {
        console.error('Faltan datos del jugador o sala');
        alert('Error: No se encontraron datos del jugador. Vuelve a la sala.');
        return;
    }

    // Configurar botones
    if (currentPlayer.isHost) {
        startButton.style.display = 'block';
        startButton.addEventListener('click', startGame);
    } else {
        startButton.style.display = 'none';
    }

    endTurnButton.addEventListener('click', endTurn);

    // Iniciar conexión WebSocket
    connectWebSocket();

    // Configurar evento de clic en el canvas
    canvas.addEventListener('click', handleCanvasClick);

    // Iniciar bucle del juego
    gameLoop();
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
            console.log('Mensaje recibido:', message);

            switch (message.type) {
                case 'game_state':
                    updateGameState(message.state);
                    break;

                case 'game_started':
                    startButton.style.display = 'none';
                    updateGameState(message.state);
                    break;

                case 'your_cards':
                    gameState.yourCards = message.cards.map(value =>
                        new Card(value, 0, 0, false));
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
                        ...message.state
                    };
                    break;

                case 'notification':
                    showNotification(message.message, message.isError);
                    break;

                case 'card_returned':
                    showNotification('Carta devuelta a tu mano', false);
                    break;

                default:
                    console.warn('Tipo de mensaje no reconocido:', message.type);
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

// Función para iniciar el juego (solo host)
function startGame() {
    startButton.disabled = true;
    startButton.textContent = 'Iniciando...';

    socket.send(JSON.stringify({
        type: 'start_game'
    }));
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
    console.log('Actualizando estado del juego:', newState);

    // Validar el estado recibido
    if (!newState || !newState.board) {
        console.error('Estado del juego inválido:', newState);
        return;
    }

    // Actualizar el estado manteniendo los valores por defecto si son undefined
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

    // Actualizar estado de las cartas jugables
    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    if (Array.isArray(gameState.yourCards)) {
        gameState.yourCards = gameState.yourCards.map(value => {
            return new Card(
                value,
                0,
                0,
                isYourTurn && canPlayCard(value)
            );
        });
    }

    // Deseleccionar carta si no es nuestro turno
    if (!isYourTurn) {
        selectedCard = null;
    }

    // Actualizar estado del botón de terminar turno
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
        showNotification('No es tu turno', true);
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Verificar si se hizo clic en una columna con carta seleccionada
    const clickedColumn = getClickedColumn(x, y);
    if (clickedColumn && selectedCard) {
        playCard(selectedCard.value, clickedColumn);
        return;
    }

    // Verificar si se hizo clic en una carta jugada este turno (para devolverla)
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

    // Verificar si se hizo clic en una carta de la mano
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;
    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;

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

// Devolver carta a la mano
function returnCardToHand(cardToReturn) {
    if (!gameState.yourCards.some(card => card.value === cardToReturn.value)) {
        showNotification('No puedes devolver cartas que no hayas jugado este turno', true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'return_card',
        playerId: currentPlayer.id,
        cardValue: cardToReturn.value,
        position: cardToReturn.position
    }));

    // Actualizar estado local
    gameState.cardsPlayedThisTurn = gameState.cardsPlayedThisTurn.filter(
        card => !(card.value === cardToReturn.value && card.position === cardToReturn.position)
    );

    updateEndTurnButton();
}

// Obtener columna clickeada
function getClickedColumn(x, y) {
    if (y < BOARD_POSITION.y || y > BOARD_POSITION.y + CARD_HEIGHT) {
        return null;
    }

    if (x >= BOARD_POSITION.x && x <= BOARD_POSITION.x + CARD_WIDTH) return 'asc1';
    if (x >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING &&
        x <= BOARD_POSITION.x + CARD_WIDTH * 2 + COLUMN_SPACING) return 'asc2';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 &&
        x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) return 'desc1';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 &&
        x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) return 'desc2';

    return null;
}

// Obtener posición de una carta en el tablero
function getCardPosition(position) {
    switch (position) {
        case 'asc1': return { x: BOARD_POSITION.x, y: BOARD_POSITION.y };
        case 'asc2': return { x: BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, y: BOARD_POSITION.y };
        case 'desc1': return { x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, y: BOARD_POSITION.y };
        case 'desc2': return { x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, y: BOARD_POSITION.y };
        default: return { x: 0, y: 0 };
    }
}

// Jugar una carta
function playCard(cardValue, position) {
    if (!selectedCard || selectedCard.value !== cardValue) {
        showNotification('Selecciona una carta válida primero', true);
        return;
    }

    if (!isValidMove(cardValue, position)) {
        const { ascending, descending } = gameState.board;
        let reason = '';

        if (position.includes('asc')) {
            const target = position === 'asc1' ? 0 : 1;
            reason = `En pilas ascendentes, la carta debe ser mayor que ${ascending[target]} o igual a ${ascending[target] - 10}`;
        } else {
            const target = position === 'desc1' ? 0 : 1;
            reason = `En pilas descendentes, la carta debe ser menor que ${descending[target]} o igual a ${descending[target] + 10}`;
        }

        showNotification(reason, true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    gameState.cardsPlayedThisTurn.push({
        value: cardValue,
        position: position
    });

    selectedCard = null;
    updateEndTurnButton();
}

// Verificar si un movimiento es válido
function isValidMove(cardValue, position) {
    const { ascending, descending } = gameState.board;

    if (position.includes('asc')) {
        const target = position === 'asc1' ? 0 : 1;
        return cardValue > ascending[target] || cardValue === ascending[target] - 10;
    } else {
        const target = position === 'desc1' ? 0 : 1;
        return cardValue < descending[target] || cardValue === descending[target] + 10;
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

// Actualizar estado del botón de terminar turno
function updateEndTurnButton() {
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id ||
        gameState.cardsPlayedThisTurn.length < minCardsRequired;
}

// Bucle principal del juego
function gameLoop() {
    // Limpiar el canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar fondo verde
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar elementos del juego
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
    ctx.fillText(`Cartas en la baraja: ${gameState.remainingDeck}`, 20, 50);
    ctx.fillText(`Cartas jugadas: ${gameState.cardsPlayedThisTurn.length}`, 20, 80);
}

// Dibujar el tablero
function drawBoard() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Dibujar flechas y cartas ascendentes
    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    const asc1Card = new Card(gameState.board.ascending[0], BOARD_POSITION.x, BOARD_POSITION.y);
    asc1Card.draw();

    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    const asc2Card = new Card(gameState.board.ascending[1], BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, BOARD_POSITION.y);
    asc2Card.draw();

    // Dibujar flechas y cartas descendentes
    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    const desc1Card = new Card(gameState.board.descending[0], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, BOARD_POSITION.y);
    desc1Card.draw();

    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    const desc2Card = new Card(gameState.board.descending[1], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, BOARD_POSITION.y);
    desc2Card.draw();
}

// Dibujar las cartas del jugador
function drawPlayerCards() {
    if (!gameState.yourCards || !Array.isArray(gameState.yourCards)) return;

    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + 10))) / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tu mano', canvas.width / 2, canvas.height - CARD_HEIGHT - 50);

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (CARD_WIDTH + 10);
        card.y = canvas.height - CARD_HEIGHT - 20;
        card.draw();
    });
}

// Iniciar el juego cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);