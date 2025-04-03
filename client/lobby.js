document.addEventListener('DOMContentLoaded', () => {
    const playerNameInput = document.getElementById('playerName');
    const createRoomBtn = document.getElementById('createRoom');
    const roomCodeInput = document.getElementById('roomCode');
    const joinRoomBtn = document.getElementById('joinRoom');
    const roomInfo = document.getElementById('roomInfo');
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const startGameBtn = document.getElementById('startGame');

    // URL del servidor backend (debes cambiarla por tu URL de Render)
    const SERVER_URL = 'https://your-render-app.onrender.com';

    createRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) {
            alert('Por favor ingresa tu nombre');
            return;
        }

        try {
            const response = await fetch(`${SERVER_URL}/create-room`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ playerName })
            });

            const data = await response.json();

            if (data.success) {
                roomIdDisplay.textContent = data.roomId;
                roomInfo.classList.remove('hidden');
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('roomId', data.roomId);
                sessionStorage.setItem('isHost', 'true');
            } else {
                alert('Error al crear la sala: ' + data.message);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error al conectar con el servidor');
        }
    });

    joinRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!playerName) {
            alert('Por favor ingresa tu nombre');
            return;
        }

        if (!roomCode || roomCode.length !== 4) {
            alert('Por favor ingresa un código de sala válido (4 dígitos)');
            return;
        }

        try {
            const response = await fetch(`${SERVER_URL}/join-room`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    playerName,
                    roomId: roomCode
                })
            });

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('roomId', roomCode);
                sessionStorage.setItem('isHost', 'false');
                startGame();
            } else {
                alert('Error al unirse a la sala: ' + data.message);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error al conectar con el servidor');
        }
    });

    startGameBtn.addEventListener('click', startGame);

    function startGame() {
        window.location.href = 'game.html';
    }
});