// Configuración
const API_URL = 'https://the-game-2xks.onrender.com';
const WS_URL = 'wss://the-game-2xks.onrender.com';
let socket;
let currentPlayer = sessionStorage.getItem('playerName');
let roomId = sessionStorage.getItem('roomId');

// Elementos del DOM
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const endTurnBtn = document.getElementById('endTurn');

// Conexión WebSocket
function connectWebSocket() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerName=${currentPlayer}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        initGame();
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleGameMessage(message);
    };

    socket.onclose = () => {
        console.log('Conexión cerrada');
    };
}

// Lógica del juego
class Game {
    constructor() {
        this.cards = [];
        this.players = [];
        this.currentTurn = null;
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'card_played':
                this.addCard(msg.card);
                break;
            case 'player_left':
                this.removePlayer(msg.playerName);
                break;
            case 'game_state':
                this.updateState(msg.state);
                break;
        }
        this.render();
    }

    // ... (resto de métodos del juego)
}

// Event Listeners
endTurnBtn.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'end_turn' }));
});

// Inicialización
function initGame() {
    window.game = new Game();
    game.render();
}

connectWebSocket();