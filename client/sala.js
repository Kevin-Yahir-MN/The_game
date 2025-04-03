const API_URL = 'https://the-game-2xks.onrender.com';
const WS_URL = 'wss://the-game-2xks.onrender.com';

// Variables globales
let socket;
const roomId = sessionStorage.getItem('roomId');
const playerId = sessionStorage.getItem('playerId');
const playerName = sessionStorage.getItem('playerName');
const isHost = sessionStorage.getItem('isHost') === 'true';

// Elementos del DOM
const roomIdDisplay = document.getElementById('roomIdDisplay');
const playersList = document.getElementById('playersList');
const startBtn = document.getElementById('startGame');

document.addEventListener('DOMContentLoaded', () => {
    // Configurar elementos iniciales
    roomIdDisplay.textContent = roomId;

    if (isHost) {
        startBtn.classList.remove('hidden');
        startBtn.addEventListener('click', handleStartGame);
    }

    // Iniciar conexión WebSocket
    initializeWebSocket();
    updatePlayersList();
    setInterval(updatePlayersList, 3000);
});

function initializeWebSocket() {
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
        socket.close();
    }

    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Mensaje recibido:', message);

        if (message.type === 'game_started') {
            window.location.href = 'game.html';
        } else if (message.type === 'room_update') {
            updatePlayersUI(message.players);
        }
    };

    socket.onclose = () => {
        console.log('Conexión cerrada, reconectando...');
        setTimeout(initializeWebSocket, 2000);
    };

    socket.onerror = (error) => {
        console.error('Error en WebSocket:', error);
    };
}

function handleStartGame() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Error: No hay conexión con el servidor. Reconectando...');
        initializeWebSocket();
        return;
    }

    try {
        startBtn.disabled = true;
        startBtn.textContent = 'Iniciando...';

        socket.send(JSON.stringify({
            type: 'start_game',
            playerId: playerId,
            roomId: roomId
        }));
    } catch (error) {
        console.error('Error al iniciar juego:', error);
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar Juego';
        alert('Error al iniciar el juego. Intenta nuevamente.');
    }
}

async function updatePlayersList() {
    try {
        const response = await fetch(`${API_URL}/room-info/${roomId}`);
        if (!response.ok) throw new Error('Error en la respuesta');

        const data = await response.json();
        if (data.success) {
            updatePlayersUI(data.players);
        }
    } catch (error) {
        console.error('Error al actualizar jugadores:', error);
    }
}

function updatePlayersUI(players) {
    playersList.innerHTML = players.map(player => {
        const isCurrentPlayer = player.id === playerId;
        return `
            <li class="${player.isHost ? 'host' : ''} ${isCurrentPlayer ? 'you' : ''}">
                ${player.name}
                ${player.isHost ? ' (Host)' : ''}
                ${isCurrentPlayer ? ' (Tú)' : ''}
                ${player.connected ? '🟢' : '🔴'}
            </li>`;
    }).join('');
}