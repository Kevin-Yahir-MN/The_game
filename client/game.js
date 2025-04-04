// Configuración inicial
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';
const endTurnButton = document.getElementById('endTurnBtn');

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
    lastPlayedCards: [],
    invalidCards: [] // Nuevo: para animaciones de cartas inválidas
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
        this.shakeOffset = 0; // Para animación de invalidación
    }

    draw() {
        ctx.save();
        // Aplicar desplazamiento para animación de invalidación
        ctx.translate(this.shakeOffset, 0);

        // Dibujar fondo de la carta
        ctx.beginPath();
        ctx.roundRect(this.x, this.y, this.width, this.height, this.radius);
        ctx.fillStyle = this === selectedCard ? '#FFFF99' : '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = this.isPlayable ? '#00FF00' : '#000000';
        ctx.lineWidth = this.isPlayable ? 3 : 1;
        ctx.stroke();

        // Dibujar valor de la carta
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
                    if (message.playerId !== currentPlayer.id) {
                        gameState.lastPlayedCards.push({
                            value: message.cardValue,
                            position: message.position,
                            x: canvas.width / 2,
                            y: canvas.height / 2,
                            targetX: getColumnPosition(message.position).x,
                            targetY: BOARD_POSITION.y,
                            alpha: 1.0,
                            shouldRemove: true
                        });
                        showNotification(`${message.playerName} jugó un ${message.cardValue}`);
                    }
                    break;
                case 'invalid_move':
                    if (message.playerId === currentPlayer.id && selectedCard) {
                        animateInvalidCard(selectedCard);
                    }
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

// Animación para carta inválida
function animateInvalidCard(card) {
    if (!card) return;

    const originalX = card.x;
    let shakeDirection = 1;
    const shakeAmount = 5;
    const shakeDuration = 300; // ms
    const startTime = Date.now();

    function shake() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / shakeDuration;

        if (progress >= 1) {
            card.shakeOffset = 0;
            return;
        }

        // Oscilación suave
        card.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
        requestAnimationFrame(shake);
    }

    shake();
}

// Actualización del estado
function updateGameState(newState) {
    if (!newState?.board) return;

    // Actualizar el tablero primero
    gameState.board = newState.board || gameState.board;
    gameState.currentTurn = newState.currentTurn || gameState.currentTurn;
    gameState.remainingDeck = newState.remainingDeck || gameState.remainingDeck;
    gameState.players = newState.players || gameState.players;
    gameState.cardsPlayedThisTurn = newState.cardsPlayedThisTurn || gameState.cardsPlayedThisTurn;

    // Manejar cartas jugadas por otros jugadores
    if (newState.lastPlayedCards) {
        newState.lastPlayedCards.forEach(card => {
            if (!gameState.lastPlayedCards.some(c =>
                c.value === card.value && c.position === card.position)) {
                gameState.lastPlayedCards.push({
                    value: card.value,
                    position: card.position,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    targetX: getColumnPosition(card.position).x,
                    targetY: BOARD_POSITION.y,
                    alpha: 1.0,
                    shouldRemove: true
                });
            }
        });
    }

    // Actualizar cartas del jugador
    if (newState.yourCards) {
        updatePlayerCards(newState.yourCards);
    }

    if (gameState.currentTurn !== currentPlayer.id) {
        selectedCard = null;
    }
}

function updatePlayerCards(cards) {
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

    // Verificar movimiento válido localmente primero
    if (!isValidMove(cardValue, position)) {
        showNotification('Movimiento inválido', true);
        animateInvalidCard(selectedCard);
        return;
    }

    // Añadir visualización temporal local
    gameState.lastPlayedCards.push({
        value: cardValue,
        position,
        x: selectedCard.x,
        y: selectedCard.y,
        targetX: getColumnPosition(position).x,
        targetY: BOARD_POSITION.y,
        alpha: 1.0,
        shouldRemove: false // No eliminar hasta confirmación del servidor
    });

    // Enviar al servidor
    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue,
        position
    }));

    selectedCard = null;
}

function endTurn() {
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    if (gameState.cardsPlayedThisTurn.length < minCardsRequired) {
        return showNotification(`Juega ${minCardsRequired - gameState.cardsPlayedThisTurn.length} carta(s) más`, true);
    }

    socket.send(JSON.stringify({
        type: 'end_turn',
        playerId: currentPlayer.id
    }));

    gameState.cardsPlayedThisTurn = [];
    selectedCard = null;
}

// Renderizado del juego
function drawGameInfo() {
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);
    const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
    const cardsNeeded = Math.max(0, minCardsRequired - gameState.cardsPlayedThisTurn.length);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';

    ctx.fillText(`Turno: ${currentTurnPlayer?.name || 'Esperando...'}`, 20, 20);
    ctx.fillText(`Baraja: ${gameState.remainingDeck}`, 20, 50);
    ctx.fillStyle = gameState.cardsPlayedThisTurn.length >= minCardsRequired ? '#00FF00' : '#FFFF00';
    ctx.fillText(`Cartas: ${gameState.cardsPlayedThisTurn.length}/${minCardsRequired}`, 20, 80);

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
    gameState.yourCards.forEach(card => card?.draw());
}

function drawLastPlayedCards() {
    ctx.save();
    gameState.lastPlayedCards.forEach((card, index, array) => {
        ctx.globalAlpha = card.alpha;
        new Card(
            card.value,
            card.x,
            card.y,
            false
        ).draw();

        // Actualizar posición para animación
        card.x += (card.targetX - card.x) * 0.1;
        card.y += (card.targetY - card.y) * 0.1;
        card.alpha -= 0.02;

        // Eliminar cuando la animación termina
        if (card.alpha <= 0) {
            array.splice(index, 1);
            // Si es una carta del jugador actual y no debería eliminarse (por invalidación)
            if (!card.shouldRemove) {
                // Restaurar la carta a la mano
                updatePlayerCards([...gameState.yourCards, card.value]);
            }
        }
    });
    ctx.restore();
}

// Bucle principal
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGameInfo();
    drawBoard();
    drawPlayerCards();
    drawLastPlayedCards();
    requestAnimationFrame(gameLoop);
}

// Inicialización
function initGame() {
    if (!canvas || !ctx || !currentPlayer.id || !roomId) {
        alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
        return;
    }

    canvas.width = 800;
    canvas.height = 600;
    endTurnButton.addEventListener('click', endTurn);
    canvas.addEventListener('click', handleCanvasClick);
    connectWebSocket();
    gameLoop();
}

document.addEventListener('DOMContentLoaded', initGame);