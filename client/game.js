// Configuración inicial
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const endTurnButton = document.getElementById('endTurnBtn');
const returnCardBtn = document.getElementById('returnCardBtn');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Constantes de diseño
const CARD_COLORS = {
    SELECTED: 'rgba(255, 255, 153, 0.7)',
    PLAYED_CURRENT: {
        MOST_RECENT: 'rgba(100, 200, 255, 0.7)',
        REGULAR: 'rgba(100, 180, 240, 0.5)'
    },
    PLAYED_OTHER: {
        MOST_RECENT: 'rgba(255, 150, 150, 0.7)',
        REGULAR: 'rgba(220, 120, 120, 0.5)'
    },
    BORDER: {
        PLAYABLE: '#00FF00',
        DEFAULT: '#000000'
    }
};

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
        ascending: [1, 1],
        descending: [100, 100]
    },
    currentTurn: null,
    remainingDeck: 98,
    cardsPlayedThisTurn: []
};

// Clase Card
class Card {
    constructor(value, x, y, isPlayable = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = 0;
        this.height = 0;
        this.isPlayable = isPlayable;
        this.isPlayedThisTurn = false;
        this.isMostRecent = false;
        this.playedByCurrentPlayer = false;
        this.radius = 8;
        this.updateSize();
    }

    updateSize() {
        this.width = canvas.width * 0.1;
        this.height = this.width * 1.5;
    }

    draw() {
        ctx.save();

        // Dibujar carta con esquinas redondeadas
        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, this.height, this.radius);

        // Fondo blanco
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Resaltado según estado
        if (this === selectedCard) {
            ctx.fillStyle = CARD_COLORS.SELECTED;
            ctx.fill();
        } else if (this.isPlayedThisTurn) {
            if (this.isMostRecent) {
                ctx.fillStyle = this.playedByCurrentPlayer
                    ? CARD_COLORS.PLAYED_CURRENT.MOST_RECENT
                    : CARD_COLORS.PLAYED_OTHER.MOST_RECENT;
            } else {
                ctx.fillStyle = this.playedByCurrentPlayer
                    ? CARD_COLORS.PLAYED_CURRENT.REGULAR
                    : CARD_COLORS.PLAYED_OTHER.REGULAR;
            }
            ctx.fill();
        }

        // Borde
        ctx.strokeStyle = this.isPlayable
            ? CARD_COLORS.BORDER.PLAYABLE
            : CARD_COLORS.BORDER.DEFAULT;
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.stroke();

        // Valor de la carta
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${this.width * 0.3}px Arial`;
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
    if (!canvas) {
        console.error('Canvas no encontrado');
        alert('Error: No se encontró el elemento canvas');
        return;
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if (!currentPlayer.id || !roomId) {
        console.error('Faltan datos del jugador o sala');
        alert('Error: No se encontraron datos del jugador. Vuelve a la sala.');
        return;
    }

    endTurnButton.addEventListener('click', endTurn);
    returnCardBtn.addEventListener('click', handleReturnCard);
    canvas.addEventListener('click', handleCanvasClick);

    connectWebSocket();
    gameLoop();
}

// Ajustar tamaño del canvas
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    canvas.width = container.clientWidth * 0.95;
    canvas.height = canvas.width * 0.75;

    // Actualizar tamaños de cartas existentes
    gameState.yourCards.forEach(card => card.updateSize());
}

// Conectar WebSocket
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

// Manejar mensajes del servidor
function handleSocketMessage(message) {
    console.log('Mensaje recibido:', message);

    switch (message.type) {
        case 'game_state':
            updateGameState(message.state);
            break;
        case 'game_started':
            updateGameState(message.state);
            break;
        case 'your_cards':
            handleYourCards(message.cards);
            break;
        case 'game_over':
            handleGameOver(message);
            break;
        case 'notification':
            showNotification(message.message, message.isError);
            break;
        default:
            console.warn('Tipo de mensaje no reconocido:', message.type);
    }
}

// Actualizar estado del juego
function updateGameState(newState) {
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

    // Actualizar cartas del jugador
    if (Array.isArray(gameState.yourCards)) {
        const isYourTurn = gameState.currentTurn === currentPlayer.id;
        const startX = (canvas.width - (gameState.yourCards.length * (canvas.width * 0.1 + canvas.width * 0.02))) / 2;
        const startY = canvas.height - canvas.width * 0.15 - 30;

        gameState.yourCards = gameState.yourCards.map((card, index) => {
            if (typeof card === 'number') {
                const newCard = new Card(
                    card,
                    startX + index * (canvas.width * 0.1 + canvas.width * 0.02),
                    startY,
                    isYourTurn && canPlayCard(card)
                );
                newCard.playedByCurrentPlayer = true;
                return newCard;
            }

            card.x = startX + index * (canvas.width * 0.1 + canvas.width * 0.02);
            card.y = startY;
            card.isPlayable = isYourTurn && canPlayCard(card.value);
            card.playedByCurrentPlayer = true;
            return card;
        });
    }

    // Actualizar estado de botones
    updateButtonsState();
}

// Manejar cartas recibidas
function handleYourCards(cards) {
    gameState.yourCards = cards.map(value => {
        const card = new Card(value, 0, 0, false);
        card.playedByCurrentPlayer = true;
        return card;
    });
}

// Mostrar notificación
function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Bucle principal del juego
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo del tablero
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

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 30);
    ctx.fillText(`Cartas en baraja: ${gameState.remainingDeck}`, 20, 60);

    ctx.fillStyle = gameState.cardsPlayedThisTurn.length >= minCardsRequired ? '#00FF00' : '#FFFF00';
    ctx.fillText(`Cartas jugadas: ${gameState.cardsPlayedThisTurn.length}/${minCardsRequired}`, 20, 90);

    if (cardsNeeded > 0 && gameState.currentTurn === currentPlayer.id) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText(`Faltan ${cardsNeeded} carta(s)`, 20, 120);
    }
}

// Dibujar el tablero
function drawBoard() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height * 0.4;
    const spacing = canvas.width * 0.15;

    // Posiciones de las pilas
    const positions = [
        { x: centerX - spacing * 1.5, y: centerY, type: 'asc', index: 0 },
        { x: centerX - spacing * 0.5, y: centerY, type: 'asc', index: 1 },
        { x: centerX + spacing * 0.5, y: centerY, type: 'desc', index: 0 },
        { x: centerX + spacing * 1.5, y: centerY, type: 'desc', index: 1 }
    ];

    // Dibujar flechas y cartas
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';

    positions.forEach(pos => {
        const value = gameState.board[pos.type + 'ending'][pos.index];
        const card = new Card(value, pos.x, pos.y);
        markIfPlayedThisTurn(card, `${pos.type}${pos.index + 1}`);
        card.draw();

        // Flecha indicadora
        ctx.fillText(pos.type === 'asc' ? '↑' : '↓', pos.x + card.width / 2, pos.y - 15);
    });
}

// Dibujar cartas del jugador
function drawPlayerCards() {
    if (!gameState.yourCards || !Array.isArray(gameState.yourCards)) return;

    const startY = canvas.height - canvas.width * 0.15 - 30;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tu mano', canvas.width / 2, startY - 40);

    gameState.yourCards.forEach(card => card && card.draw());
}

// Actualizar estado de los botones
function updateButtonsState() {
    const isYourTurn = gameState.currentTurn === currentPlayer.id;
    const hasPlayedCards = gameState.cardsPlayedThisTurn.length > 0;

    endTurnButton.disabled = !isYourTurn;
    returnCardBtn.disabled = !(isYourTurn && hasPlayedCards);
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

    // Verificar clic en columna del tablero
    const clickedColumn = getClickedColumn(x, y);
    if (clickedColumn && selectedCard) {
        playCard(selectedCard.value, clickedColumn);
        return;
    }

    // Verificar clic en carta de la mano
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

    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));

    selectedCard = null;
}

// Manejar devolución de carta
function handleReturnCard() {
    if (gameState.currentTurn !== currentPlayer.id) {
        showNotification('No es tu turno', true);
        return;
    }

    if (!gameState.cardsPlayedThisTurn || gameState.cardsPlayedThisTurn.length === 0) {
        showNotification('No has jugado cartas este turno', true);
        return;
    }

    const lastPlayedCard = [...gameState.cardsPlayedThisTurn]
        .reverse()
        .find(card => card.value !== undefined);

    if (!lastPlayedCard) {
        showNotification('No hay cartas para regresar', true);
        return;
    }

    socket.send(JSON.stringify({
        type: 'return_card',
        playerId: currentPlayer.id,
        cardValue: lastPlayedCard.value,
        position: lastPlayedCard.position
    }));
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

// Funciones auxiliares
function getClickedColumn(x, y) {
    const centerY = canvas.height * 0.4;
    if (y < centerY || y > centerY + canvas.width * 0.15) return null;

    const centerX = canvas.width / 2;
    const spacing = canvas.width * 0.15;
    const cardWidth = canvas.width * 0.1;

    if (x >= centerX - spacing * 1.5 && x <= centerX - spacing * 1.5 + cardWidth) return 'asc1';
    if (x >= centerX - spacing * 0.5 && x <= centerX - spacing * 0.5 + cardWidth) return 'asc2';
    if (x >= centerX + spacing * 0.5 && x <= centerX + spacing * 0.5 + cardWidth) return 'desc1';
    if (x >= centerX + spacing * 1.5 && x <= centerX + spacing * 1.5 + cardWidth) return 'desc2';

    return null;
}

function isValidMove(cardValue, position) {
    const { ascending, descending } = gameState.board;

    switch (position) {
        case 'asc1': return cardValue > ascending[0] || cardValue === ascending[0] - 10;
        case 'asc2': return cardValue > ascending[1] || cardValue === ascending[1] - 10;
        case 'desc1': return cardValue < descending[0] || cardValue === descending[0] + 10;
        case 'desc2': return cardValue < descending[1] || cardValue === descending[1] + 10;
        default: return false;
    }
}

function canPlayCard(cardValue) {
    const { ascending, descending } = gameState.board;
    return (cardValue > ascending[0] || cardValue === ascending[0] - 10) ||
        (cardValue > ascending[1] || cardValue === ascending[1] - 10) ||
        (cardValue < descending[0] || cardValue === descending[0] + 10) ||
        (cardValue < descending[1] || cardValue === descending[1] + 10);
}

function markIfPlayedThisTurn(card, position) {
    if (gameState.cardsPlayedThisTurn && Array.isArray(gameState.cardsPlayedThisTurn)) {
        const playedCard = gameState.cardsPlayedThisTurn.find(c =>
            c.position === position && c.value === card.value
        );
        if (playedCard) {
            card.isPlayedThisTurn = true;
            card.isMostRecent = playedCard.isMostRecent;
            card.playedByCurrentPlayer = playedCard.playedBy === currentPlayer.id;
        }
    }
}

function handleGameOver(message) {
    alert(message.message);
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 5000);
}

// Iniciar el juego cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);