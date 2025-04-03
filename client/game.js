// Configuración del juego
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Variables del juego
let socket;
let currentPlayer = sessionStorage.getItem('playerName');
let roomId = sessionStorage.getItem('roomId');
let gameState = {
    players: [],
    cards: [],
    currentTurn: null
};

// Clases del juego
class Card {
    constructor(value, x, y) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = 80;
        this.height = 120;
    }

    draw() {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.fillStyle = '#000000';
        ctx.font = '20px Arial';
        ctx.fillText(this.value, this.x + 30, this.y + 60);
    }
}

// Inicialización del juego
function initGame() {
    console.log('Iniciando juego para:', currentPlayer);

    // Conexión WebSocket
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerName=${currentPlayer}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        setupGameElements();
        gameLoop();
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'game_state') {
            updateGameState(message.state);
        }
    };
}

function setupGameElements() {
    // Crear cartas de ejemplo (deberías recibirlas del servidor)
    for (let i = 0; i < 5; i++) {
        gameState.cards.push(new Card(i + 1, 100 + (i * 100), 300));
    }

    // Marcador de turno
    gameState.currentTurn = currentPlayer;
}

function updateGameState(newState) {
    gameState = { ...gameState, ...newState };
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fondo verde
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar cartas
    gameState.cards.forEach(card => card.draw());

    // Dibujar información de jugadores
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '24px Arial';
    ctx.fillText(`Turno: ${gameState.currentTurn}`, 50, 50);

    requestAnimationFrame(gameLoop);
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);

// Evento para terminar turno
document.getElementById('endTurn').addEventListener('click', () => {
    socket.send(JSON.stringify({
        type: 'end_turn',
        playerName: currentPlayer
    }));
});