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
        ascending: [1, 1],
        descending: [100, 100]
    },
    currentTurn: null,
    remainingDeck: 0
};

// Clases del juego
class Card {
    constructor(value, x, y, isPlayable = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = 60;
        this.height = 90;
        this.isPlayable = isPlayable;
        this.isSelected = false;
    }

    draw() {
        // Fondo de la carta
        ctx.fillStyle = this.isSelected ? '#FFD700' : '#FFFFFF';
        if (this.isPlayable) {
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 3;
            ctx.strokeRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4);
        }
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Valor de la carta
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.value, this.x + this.width / 2, this.y + this.height / 2 + 7);
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }
}

class BoardPile {
    constructor(x, y, value, type, index) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.type = type; // 'asc' o 'desc'
        this.index = index; // 0 o 1
        this.width = 60;
        this.height = 90;
    }

    draw() {
        // Fondo del montón
        ctx.fillStyle = '#F5F5F5';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Borde
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // Valor actual
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.value, this.x + this.width / 2, this.y + this.height / 2 + 7);

        // Indicador de tipo
        ctx.font = '12px Arial';
        ctx.fillText(this.type === 'asc' ? '↑' : '↓', this.x + this.width / 2, this.y + 20);
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
    document.getElementById('drawCard').addEventListener('click', drawCard);

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
    gameState = { ...gameState, ...newState };

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
    const cardWidth = 60;
    const cardHeight = 90;
    const startX = (canvas.width - (gameState.yourCards.length * (cardWidth + 10))) / 2;

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (cardWidth + 10);
        card.y = canvas.height - cardHeight - 20;

        if (card.contains(x, y) {
            card.isSelected = !card.isSelected;
            // Deseleccionar otras cartas
            gameState.yourCards.forEach((otherCard, otherIndex) => {
                if (index !== otherIndex) otherCard.isSelected = false;
            });
        }
    });

    // Verificar clic en pilas del tablero
    const boardPiles = createBoardPiles();
    boardPiles.forEach(pile => {
        if (x >= pile.x && x <= pile.x + pile.width &&
            y >= pile.y && y <= pile.y + pile.height) {

            const selectedCard = gameState.yourCards.find(card => card.isSelected);
            if (selectedCard && selectedCard.isPlayable) {
                playCard(selectedCard.value, `${pile.type}${pile.index + 1}`);
            }
        }
    });
}

function createBoardPiles() {
    const centerX = canvas.width / 2;
    return [
        new BoardPile(centerX - 150, 150, gameState.board.ascending[0], 'asc', 0),
        new BoardPile(centerX - 50, 150, gameState.board.ascending[1], 'asc', 1),
        new BoardPile(centerX + 50, 150, gameState.board.descending[0], 'desc', 0),
        new BoardPile(centerX + 150, 150, gameState.board.descending[1], 'desc', 1)
    ];
}

function playCard(cardValue, position) {
    if (gameState.currentTurn !== currentPlayer.id) return;

    socket.send(JSON.stringify({
        type: 'play_card',
        playerId: currentPlayer.id,
        cardValue: cardValue,
        position: position
    }));
}

function drawCard() {
    if (gameState.currentTurn !== currentPlayer.id) return;

    socket.send(JSON.stringify({
        type: 'draw_card',
        playerId: currentPlayer.id
    }));
}

function endTurn() {
    if (gameState.currentTurn !== currentPlayer.id) return;

    socket.send(JSON.stringify({
        type: 'end_turn',
        playerId: currentPlayer.id
    }));
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo verde
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar información del juego
    drawGameInfo();

    // Dibujar tablero
    const boardPiles = createBoardPiles();
    boardPiles.forEach(pile => pile.draw());

    // Dibujar cartas del jugador
    drawPlayerCards();

    requestAnimationFrame(gameLoop);
}

function drawGameInfo() {
    // Turno actual
    const currentTurnPlayer = gameState.players.find(p => p.id === gameState.currentTurn);
    const turnText = currentTurnPlayer ?
        (currentTurnPlayer.id === currentPlayer.id ?
            'TU TURNO' : `Turno de: ${currentTurnPlayer.name}`) : 'Esperando jugadores...';

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(turnText, canvas.width / 2, 50);

    // Cartas restantes
    ctx.font = '16px Arial';
    ctx.fillText(`Mazo: ${gameState.remainingDeck} cartas`, canvas.width / 2, 80);

    // Cartas por jugador
    ctx.textAlign = 'left';
    gameState.players.forEach((player, index) => {
        const text = `${player.name}: ${player.cardCount} cartas`;
        ctx.fillText(text, 20, 100 + (index * 30));
    });
}

function drawPlayerCards() {
    if (!gameState.yourCards || gameState.yourCards.length === 0) return;

    const cardWidth = 60;
    const cardHeight = 90;
    const startX = (canvas.width - (gameState.yourCards.length * (cardWidth + 10))) / 2;

    gameState.yourCards.forEach((card, index) => {
        card.x = startX + index * (cardWidth + 10);
        card.y = canvas.height - cardHeight - 20;
        card.draw();
    });
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);