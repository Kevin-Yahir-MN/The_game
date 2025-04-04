// Configuración del juego
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Elementos de la interfaz
const endTurnButton = document.getElementById('endTurnBtn');

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
            fillColor = '#FFFF99'; // Amarillo para seleccionada
        } else if (this.isPlayedThisTurn) {
            fillColor = this.isMostRecent ? '#ADD8E6' : '#A0C0E0'; // Azul claro para más reciente, azul normal para otras
        }

        ctx.fillStyle = fillColor;
        ctx.fill();

        // Borde
        ctx.strokeStyle = this.isPlayable ? '#00FF00' : '#000000';
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.stroke();

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
    console.log('Iniciando juego para:', currentPlayer.name, 'ID:', currentPlayer.id, 'en sala:', roomId);

    if (!canvas) {
        console.error('Canvas no encontrado');
        alert('Error: No se encontró el elemento canvas');
        return;
    }

    canvas.width = 800;
    canvas.height = 600;

    if (!ctx) {
        console.error('No se pudo obtener el contexto 2D');
        alert('Error: No se pudo inicializar el contexto de dibujo');
        return;
    }

    if (!currentPlayer.id || !roomId) {
        console.error('Faltan datos del jugador o sala');
        alert('Error: No se encontraron datos del jugador. Vuelve a la sala.');
        return;
    }

    endTurnButton.addEventListener('click', endTurn);
    connectWebSocket();
    canvas.addEventListener('click', handleCanvasClick);
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
                    if (message.cardValue) {
                        gameState.yourCards.push(new Card(message.cardValue, 0, 0, false));
                        gameState.cardsPlayedThisTurn = gameState.cardsPlayedThisTurn.filter(
                            c => c.value !== message.cardValue
                        );
                    }
                    break;
                case 'card_played':
                    showNotification(`Carta ${message.cardValue} colocada correctamente`, false);
                    break;
                case 'init_state':
                    gameState = { ...gameState, ...message.state };
                    break;
                case 'notification':
                    showNotification(message.message, message.isError);
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

// Validar si un movimiento es válido
function isValidMove(cardValue, position) {
    const { ascending, descending } = gameState.board;

    switch (position) {
        case 'asc1':
            return cardValue > ascending[0] || cardValue === ascending[0] - 10;
        case 'asc2':
            return cardValue > ascending[1] || cardValue === ascending[1] - 10;
        case 'desc1':
            return cardValue < descending[0] || cardValue === descending[0] + 10;
        case 'desc2':
            return cardValue < descending[1] || cardValue === descending[1] + 10;
        default:
            return false;
    }
}

// Actualizar el estado del juego
function updateGameState(newState) {
    console.log('Actualizando estado del juego:', newState);

    if (!newState || !newState.board) {
        console.error('Estado del juego inválido:', newState);
        return;
    }

    gameState = {
        ...gameState,
        ...newState,
        board: {
            ascending: newState.board.ascending || [1, 1],
            descending: newState.board.descending || [100, 100]
        },
        remainingDeck: newState.remainingDeck || 98
    };

    if (!Array.isArray(gameState.yourCards)) {
        gameState.yourCards = [];
    }

    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    const startX = (canvas.width - (gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
    const startY = canvas.height - CARD_HEIGHT - 20;

    gameState.yourCards = gameState.yourCards.map((card, index) => {
        if (typeof card === 'number') {
            return new Card(
                card,
                startX + index * (CARD_WIDTH + CARD_SPACING),
                startY,
                isYourTurn && canPlayCard(card)
            );
        }

        card.x = startX + index * (CARD_WIDTH + CARD_SPACING);
        card.y = startY;
        card.isPlayable = isYourTurn && canPlayCard(card.value);
        return card;
    });

    // Resetear estado de cartas jugadas
    gameState.yourCards.forEach(card => {
        card.isPlayedThisTurn = false;
        card.isMostRecent = false;
    });

    // Marcar cartas jugadas este turno
    if (newState.cardsPlayedThisTurn && Array.isArray(newState.cardsPlayedThisTurn)) {
        newState.cardsPlayedThisTurn.forEach(playedCard => {
            const card = gameState.yourCards.find(c => c.value === playedCard.value);
            if (card) {
                card.isPlayedThisTurn = true;
                card.isMostRecent = playedCard.isMostRecent || false;
            }
        });
    }

    if (!isYourTurn) {
        selectedCard = null;
        gameState.cardsPlayedThisTurn = [];
    }
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

    // Verificar si se hizo clic en una columna del tablero
    const clickedColumn = getClickedColumn(x, y);
    if (clickedColumn && selectedCard) {
        playCard(selectedCard.value, clickedColumn);
        return;
    }

    // Verificar si se hizo clic en una carta de la mano
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
        showNotification('Selecciona una carta válida primero', true);
        return;
    }

    if (!isValidMove(cardValue, position)) {
        const { ascending, descending } = gameState.board;
        let reason = position.includes('asc')
            ? `En pilas ascendentes, la carta debe ser mayor que ${ascending[position === 'asc1' ? 0 : 1]} o igual a ${ascending[position === 'asc1' ? 0 : 1] - 10}`
            : `En pilas descendentes, la carta debe ser menor que ${descending[position === 'desc1' ? 0 : 1]} o igual a ${descending[position === 'desc1' ? 0 : 1] + 10}`;
        showNotification(reason, true);
        return;
    }

    // Enviar jugada al servidor
    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    selectedCard = null;
}

// Terminar turno
function endTurn() {
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    if (gameState.cardsPlayedThisTurn.length < minCardsRequired) {
        const missingCards = minCardsRequired - gameState.cardsPlayedThisTurn.length;
        showNotification(`Debes jugar ${missingCards} carta(s) más para terminar el turno`, true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'end_turn',
        playerId: currentPlayer.id,
        cardsPlayed: gameState.cardsPlayedThisTurn.length
    }));

    gameState.cardsPlayedThisTurn = [];
    selectedCard = null;
    showNotification('Turno terminado', false);
}

// Obtener columna clickeada
function getClickedColumn(x, y) {
    if (y < BOARD_POSITION.y || y > BOARD_POSITION.y + CARD_HEIGHT) {
        return null;
    }

    if (x >= BOARD_POSITION.x && x <= BOARD_POSITION.x + CARD_WIDTH) return 'asc1';
    if (x >= BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING && x <= BOARD_POSITION.x + CARD_WIDTH * 2 + COLUMN_SPACING) return 'asc2';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 && x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH) return 'desc1';
    if (x >= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 && x <= BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH) return 'desc2';

    return null;
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
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    const cardsNeeded = Math.max(0, minCardsRequired - gameState.cardsPlayedThisTurn.length);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 20);
    ctx.fillText(`Cartas en la baraja: ${gameState.remainingDeck}`, 20, 50);

    ctx.fillStyle = gameState.cardsPlayedThisTurn.length >= minCardsRequired ? '#00FF00' : '#FFFF00';
    ctx.fillText(`Cartas jugadas: ${gameState.cardsPlayedThisTurn.length}/${minCardsRequired}`, 20, 80);

    if (cardsNeeded > 0 && gameState.currentTurn === currentPlayer.id) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText(`Faltan ${cardsNeeded} carta(s)`, 20, 110);
    }
}

// Dibujar el tablero
function drawBoard() {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Dibujar flechas y cartas ascendentes
    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[0], BOARD_POSITION.x, BOARD_POSITION.y).draw();

    ctx.fillText('↑', BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.ascending[1], BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, BOARD_POSITION.y).draw();

    // Dibujar flechas y cartas descendentes
    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[0], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, BOARD_POSITION.y).draw();

    ctx.fillText('↓', BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3 + CARD_WIDTH / 2, BOARD_POSITION.y - 15);
    new Card(gameState.board.descending[1], BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, BOARD_POSITION.y).draw();
}

// Dibujar las cartas del jugador
function drawPlayerCards() {
    if (!gameState.yourCards || !Array.isArray(gameState.yourCards)) {
        console.warn('yourCards no es un array válido:', gameState.yourCards);
        return;
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tu mano', canvas.width / 2, canvas.height - CARD_HEIGHT - 50);

    gameState.yourCards.forEach(card => card && card.draw());
}

// Iniciar el juego cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);