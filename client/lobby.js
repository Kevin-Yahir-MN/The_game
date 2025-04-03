document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const playerNameInput = document.getElementById('playerName');
    const createRoomBtn = document.getElementById('createRoom');
    const joinRoomBtn = document.getElementById('joinRoom');
    const roomCodeInput = document.getElementById('roomCode');

    createRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) return alert('Ingresa tu nombre');

        try {
            const response = await fetch(`${API_URL}/create-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName })
            });
            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', data.playerName);
                sessionStorage.setItem('roomId', data.roomId);
                sessionStorage.setItem('isHost', 'true');
                window.location.href = 'sala.html';
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error al crear sala');
        }
    });

    joinRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!playerName || !roomCode) return alert('Datos incompletos');

        try {
            const response = await fetch(`${API_URL}/join-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName, roomId: roomCode })
            });
            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('roomId', roomCode);
                sessionStorage.setItem('isHost', 'false');
                window.location.href = 'sala.html';
            } else {
                alert(data.message || 'Error al unirse');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error de conexión');
        }
    });
});