document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const playerNameInput = document.getElementById('playerName');
    const createRoomBtn = document.getElementById('createRoom');
    const joinRoomBtn = document.getElementById('joinRoom');
    const roomCodeInput = document.getElementById('roomCode');

    function showError(message) {
        const errorElement = document.createElement('div');
        errorElement.className = 'notification error';
        errorElement.textContent = message;
        document.body.appendChild(errorElement);

        setTimeout(() => {
            errorElement.remove();
        }, 3000);
    }

    function validatePlayerName(name) {
        if (!name || name.trim() === '') {
            showError('Ingresa tu nombre');
            return false;
        }
        if (name.length > 20) {
            showError('El nombre no puede tener más de 20 caracteres');
            return false;
        }
        return true;
    }

    function validateRoomCode(code) {
        if (!code || code.trim() === '') {
            showError('Ingresa el código de sala');
            return false;
        }
        if (!/^\d{4}$/.test(code)) {
            showError('El código debe tener 4 dígitos');
            return false;
        }
        return true;
    }

    createRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();

        if (!validatePlayerName(playerName)) return;

        createRoomBtn.disabled = true;
        createRoomBtn.textContent = 'Creando...';

        try {
            const response = await fetch(`${API_URL}/create-room`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ playerName })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('playerId', data.playerId);
                sessionStorage.setItem('roomId', data.roomId);
                sessionStorage.setItem('isHost', 'true');
                window.location.href = 'sala.html';
            } else {
                showError(data.message || 'Error al crear la sala');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error al conectar con el servidor');
        } finally {
            createRoomBtn.disabled = false;
            createRoomBtn.textContent = 'Crear Sala';
        }
    });

    joinRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!validatePlayerName(playerName)) return;
        if (!validateRoomCode(roomCode)) return;

        joinRoomBtn.disabled = true;
        joinRoomBtn.textContent = 'Uniendo...';

        try {
            const response = await fetch(`${API_URL}/join-room`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    playerName,
                    roomId: roomCode
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('playerId', data.playerId);
                sessionStorage.setItem('roomId', roomCode);
                sessionStorage.setItem('isHost', 'false');
                window.location.href = 'sala.html';
            } else {
                showError(data.message || 'Error al unirse a la sala');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error al conectar con el servidor');
        } finally {
            joinRoomBtn.disabled = false;
            joinRoomBtn.textContent = 'Unirse';
        }
    });

    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createRoomBtn.click();
        }
    });

    roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinRoomBtn.click();
        }
    });
});