// Configuración
const WS_URL = 'wss://the-game-2xks.onrender.com';
let socket;
let currentPlayer = sessionStorage.getItem('playerName');
let roomId = sessionStorage.getItem('roomId');

// Inicialización del juego
function initGame() {
    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerName=${currentPlayer}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
        setupGame();
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
function setupGame() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // ... (tu lógica de juego existente)
    console.log('Juego inicializado para', currentPlayer);
}

function handleGameMessage(message) {
    switch (message.type) {
        case 'card_played':
            // Lógica para manejar cartas jugadas
            break;
        case 'player_turn':
            // Actualizar turno
            break;
    }
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initGame);