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
const startGameBtn = document.getElementById('startGame');

document.addEventListener('DOMContentLoaded', () => {
    // Configurar elementos iniciales
    roomIdDisplay.textContent = roomId;

    if (isHost) {
        startGameBtn.classList.remove('hidden');
        startGameBtn.addEventListener('click', startGame);
    }

    // Iniciar conexión y actualizaciones
    connectWebSocket();
    updatePlayersList();
    setInterval(updatePlayersList, 3000);
});

function connectWebSocket() {
    // Cerrar conexión existente si está abierta
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
        socket.close();
    }

    socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}`);

    socket.onopen = () => {
        console.log('Conexión WebSocket establecida');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'game_started') {
            window.location.href = 'game.html';
        } else if (message.type === 'room_update') {
            updatePlayersUI(message.players);
        }
    };

    socket.onclose = () => {
        console.log('Conexión WebSocket cerrada');
    };

    socket.onerror = (error) => {
        console.error('Error en WebSocket:', error);
    };
}

function updatePlayersList() {
    fetch(`${API_URL}/room-info/${roomId}`)
        .then(response => {
            if (!response.ok) throw new Error('Error en la respuesta');
            return response.json();
        })
        .then(data => {
            if (data.success) {
                updatePlayersUI(data.players);
            }
        })
        .catch(error => {
            console.error('Error al actualizar jugadores:', error);
        });
}

function updatePlayersUI(players) {
    playersList.innerHTML = players.map(player => {
        // Manejo seguro del nombre del jugador
        const name = typeof player === 'object' ? player.name : player;
        const isCurrentPlayer = name === playerName;
        const isHostPlayer = typeof player === 'object' ? player.isHost : false;

        return `
            <li class="${isHostPlayer ? 'host' : ''} ${isCurrentPlayer ? 'you' : ''}">
                ${name}
                ${isHostPlayer ? ' (Host)' : ''}
                ${isCurrentPlayer ? ' (Tú)' : ''}
            </li>`;
    }).join('');
}

function startGame() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert('Error: No hay conexión con el servidor. Intenta nuevamente.');
        connectWebSocket();
        return;
    }

    try {
        socket.send(JSON.stringify({
            type: 'start_game',
            playerId: playerId,
            roomId: roomId
        }));
    } catch (error) {
        console.error('Error al iniciar juego:', error);
        alert('Error al iniciar el juego. Recargando...');
        window.location.reload();
    }
}