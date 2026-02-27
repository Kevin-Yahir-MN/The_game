document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://the-game-2xks.onrender.com';
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;

    // --- autenticación ligera para manejo de amigos ---
    function getAuthToken() {
        return localStorage.getItem('authToken');
    }
    function getAuthUser() {
        const raw = localStorage.getItem('authUser');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }
    async function fetchWithAuth(url, options = {}) {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
    }

    // estado de amigos en sala
    let friends = [];
    async function loadFriends() {
        friends = [];
        try {
            const resp = await fetchWithAuth(`${API_URL}/friends`, { method: 'GET' });
            const json = await resp.json();
            if (resp.ok && json.success) friends = json.friends || [];
        } catch (e) {
            console.error('Error cargando amigos:', e);
        }
        renderFriendList();
    }
    function renderFriendList() {
        const c = document.getElementById('friendList');
        if (!c) return;
        if (friends.length === 0) {
            c.innerHTML = '<li>(sin amigos)</li>';
            return;
        }
        c.innerHTML = friends.map(f => `<li>${f.displayName}</li>`).join('');
    }

    function showInviteModal() {
        if (!friends || friends.length === 0) {
            showNotification('No tienes amigos para invitar', true);
            return;
        }
        // simple modal listing friends; clicking one sends invite
        const modal = document.createElement('div');
        modal.className = 'invite-modal';
        modal.innerHTML = `
            <div class="invite-modal-content">
                <h3>Invitar amigo</h3>
                <ul id="inviteFriendList">
                    ${friends.map(f => `<li data-id="${f.id}">${f.displayName}</li>`).join('')}
                </ul>
                <button id="closeInviteModal">Cerrar</button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#closeInviteModal').addEventListener('click', () => modal.remove());
        modal.querySelectorAll('#inviteFriendList li').forEach(li => {
            li.addEventListener('click', () => {
                const fid = li.dataset.id;
                if (!fid) return;
                // enviar mensaje a servidor via socket
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'invite_friend',
                        targetUserId: fid,
                        roomId
                    }));
                    showNotification(`Invitación enviada a ${li.textContent}`);
                } else {
                    showNotification('No hay conexión para enviar invitación', true);
                }
                modal.remove();
            });
        });
    }

    // estilos temporales del modal
    const inviteStyle = document.createElement('style');
    inviteStyle.textContent = `
        .invite-modal {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .invite-modal-content {
            background: #222;
            padding: 1.5rem;
            border-radius: 8px;
            color: white;
            max-width: 300px;
        }
        #inviteFriendList li {
            padding: 0.5rem;
            cursor: pointer;
        }
        #inviteFriendList li:hover { background: rgba(255,255,255,0.1); }
    `;
    document.head.appendChild(inviteStyle);

    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_BASE_DELAY = 2000;

    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let reconnectTimeout;
    let connectionStatus = 'disconnected';

    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    const isHost = sessionStorage.getItem('isHost') === 'true';

    // Elementos UI
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');
    const backToMenuBtn = document.getElementById('backToMenu');
    const emojiButtonsContainer = document.getElementById('emojiButtons');
    const emojiPopinsContainer = document.getElementById('emojiPopins');

    // Mostrar notificación
    function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Actualizar estado de conexión en UI
    function updateConnectionStatus(status, isError = false) {
        connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus') || createConnectionStatusElement();
        statusElement.textContent = status;
        statusElement.className = isError ? 'error' : '';
    }

    // Crear elemento de estado de conexión si no existe
    function createConnectionStatusElement() {
        const statusElement = document.createElement('div');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        document.querySelector('.room-header').appendChild(statusElement);
        return statusElement;
    }

    function connectWebSocket() {
        clearTimeout(reconnectTimeout);

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('No se puede conectar al servidor. Recarga la página.', true);
            return;
        }

        updateConnectionStatus('Conectando...');

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`);

        let pingInterval;

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');

            pingInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(JSON.stringify({
                            type: 'ping',
                            playerId: playerId,
                            roomId: roomId,
                            timestamp: Date.now()
                        }));
                    } catch (error) {
                        console.error('Error enviando ping:', error);
                    }
                }
            }, 15000);

            sendPlayerUpdate();

            if (connectionStatus === 'reconnecting') {
                socket.send(JSON.stringify({
                    type: 'get_full_state',
                    playerId: playerId,
                    roomId: roomId
                }));
            }
            connectionStatus = 'connected';
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 30000);
                reconnectTimeout = setTimeout(connectWebSocket, delay);
                updateConnectionStatus(`Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                connectionStatus = 'reconnecting';
            } else {
                updateConnectionStatus('Desconectado', true);
                connectionStatus = 'disconnected';
            }
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
            updateConnectionStatus('Error de conexión', true);
            connectionStatus = 'error';
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'game_started') {
                    window.location.href = 'game.html';
                }
                if (message.type === 'pong') {
                    updateConnectionStatus('Conectado');
                    return;
                }
                if (message.type === 'friend_invite_response') {
                    const accepted = message.accepted;
                    const other = message.fromUserId || '';
                    showNotification(accepted ? 'Tu invitación fue aceptada' : 'Tu invitación fue declinada');
                    return;
                }

                handleSocketMessage(event);
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        };
    }

    // Enviar actualización de jugador
    function sendPlayerUpdate() {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'update_player',
                playerId: playerId,
                name: playerName,
                isHost: isHost,
                roomId: roomId,
                status: 'active'
            }));
        }
    }

    // Manejar mensajes del servidor
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'full_state_update') {
                // Actualizar UI con el estado completo del servidor
                updatePlayersUI(message.room.players);

                // Nueva: Guardar estado en sessionStorage
                sessionStorage.setItem('gameState', JSON.stringify({
                    players: message.room.players,
                    currentTurn: message.gameState.currentTurn,
                    initialCards: message.gameState.initialCards
                }));

                if (isHost) {
                    gameSettings.style.display = 'block';
                    startBtn.classList.add('visible');
                }
            }
            else if (message.type === 'game_started') {
                handleGameStart();
            }
            else if (message.type === 'room_update') {
                updatePlayersUI(message.players);
            }
            else if (message.type === 'notification') {
                showNotification(message.message, message.isError);
            }
            else if (message.type === 'emoji_reaction') {
                renderEmojiReaction(message);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

    function renderEmojiReaction(message) {
        if (!emojiPopinsContainer) return;

        const emojiMap = {
            sad: '😢',
            angry: '😡',
            poop: '💩',
            love: '😍',
            wow: '😮',
            middle: '🖕',
            cry: '😭',
            proud: '😎',
            angel: '😇',
            demon: '😈',
            sleep: '😴'
        };

        const emojiChar = emojiMap[message.emoji];
        if (!emojiChar) return;

        const item = document.createElement('div');
        item.className = 'emoji-popin emoji-message';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'emoji-message-name';
        nameSpan.textContent = message.fromPlayerName || 'Jugador';

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'emoji-message-emoji';
        emojiSpan.textContent = emojiChar;

        item.appendChild(nameSpan);
        item.appendChild(emojiSpan);

        emojiPopinsContainer.appendChild(item);

        setTimeout(() => {
            if (emojiPopinsContainer.contains(item)) {
                emojiPopinsContainer.removeChild(item);
            }
        }, 3500); // mostrar popin 3.5 segundos
    }

    // Actualizar lista de jugadores en UI
    function updatePlayersUI(players) {
        if (!players || !Array.isArray(players)) return;
        const me = getAuthUser();
        playersList.innerHTML = players.map(player => {
            const isMe = player.id === playerId;
            let extraButton = '';
            // mostrar "agregar amigo" sólo si estamos autenticados, el jugador tiene userId,
            // no es yo y no está ya en mi lista de amigos
            if (me && player.userId && !isMe) {
                const already = friends.find(f => f.id === player.userId);
                if (!already) {
                    extraButton = ` <button class="add-friend-btn" data-userid="${player.userId}">Agregar amigo</button>`;
                }
            }
            return `
            <li class="${player.isHost ? 'host' : ''} ${isMe ? 'you' : ''}">
                <span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${isMe ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-status">${player.connected ? '🟢' : '🔴'}</span>
                ${extraButton}
            </li>
        `;
        }).join('');

        // attach listeners for add-friend buttons
        const buttons = playersList.querySelectorAll('.add-friend-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const uid = btn.dataset.userid;
                if (!uid) return;
                try {
                    const response = await fetchWithAuth(`${API_URL}/friends`, {
                        method: 'POST',
                        body: JSON.stringify({ friendId: uid })
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        friends.push({ id: uid, displayName: btn.closest('li').querySelector('.player-name').textContent });
                        renderFriendList();
                        updatePlayersUI(players); // rerender to remove button
                    } else {
                        showNotification(data.message || 'Error agregando amigo', true);
                    }
                } catch (err) {
                    console.error('Error agregando amigo:', err);
                    showNotification('Error agregando amigo', true);
                }
            });
        });
    }


    function backToMenu() {
        sessionStorage.removeItem('roomId');
        sessionStorage.removeItem('playerId');
        sessionStorage.removeItem('isHost');

        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            socket.close();
        }

        window.location.href = 'index.html';
    }

    // Manejar inicio del juego
    function handleGameStart() {
        clearInterval(playerUpdateInterval);
        window.location.href = 'game.html';
    }

    async function handleStartGame() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            updateConnectionStatus('Error: No hay conexión', true);
            return;
        }

        startBtn.disabled = true;
        startBtn.textContent = 'Iniciando...';
        startBtn.classList.add('loading');

        try {
            // Verificar estado de los jugadores primero
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            const data = await response.json();

            if (!data.success || data.players.length < 1) {
                throw new Error('No hay suficientes jugadores');
            }

            // Enviar comando de inicio al servidor
            socket.send(JSON.stringify({
                type: 'start_game',
                playerId: playerId,
                roomId: roomId,
                initialCards: parseInt(initialCardsSelect.value)
            }));

            // Timeout de seguridad reducido a 8 segundos
            const timeout = setTimeout(() => {
                if (window.location.pathname.endsWith('sala.html')) {
                    resetStartButton();
                    showNotification('El servidor está tardando en responder', true);
                }
            }, 8000);

            // Limpiar timeout si el juego inicia correctamente
            socket.addEventListener('message', function handler(event) {
                const message = JSON.parse(event.data);
                if (message.type === 'game_started') {
                    clearTimeout(timeout);
                    socket.removeEventListener('message', handler);
                    window.location.href = 'game.html';
                }
            });

        } catch (error) {
            console.error('Error al iniciar juego:', error);
            resetStartButton();
            showNotification('Error al iniciar: ' + error.message, true);
        }
    }

    // Nueva función para resetear el botón
    function resetStartButton() {
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar Juego';
        startBtn.classList.remove('loading');
    }


    // Actualizar lista de jugadores via API
    async function updatePlayersList() {
        try {
            const response = await fetch(`${API_URL}/room-info/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) updatePlayersUI(data.players);
            }
        } catch (error) {
            console.error('Error actualizando jugadores:', error);
        }
    }

    // Inicializar la UI
    function initializeUI() {
        roomIdDisplay.textContent = roomId;
        // ocultar lista de amigos si no hay usuario autenticado
        const authUser = getAuthUser();
        const fc = document.getElementById('friendsContainer');
        if (fc) fc.style.display = authUser ? 'block' : 'none';

        const inviteBtn = document.getElementById('inviteFriendBtn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', () => {
                showInviteModal();
            });
        }

        updatePlayersList();
        loadFriends().then(() => {
            if (inviteBtn) {
                inviteBtn.style.display = (!authUser || friends.length === 0) ? 'none' : '';
            }
        });

        if (inviteBtn) {
            // ocultar botón si no hay usuario o no hay amigos
            if (!authUser || friends.length === 0) {
                inviteBtn.style.display = 'none';
            }
        }

        if (isHost) {
            gameSettings.style.display = 'block';
            startBtn.classList.add('visible');
            startBtn.addEventListener('click', handleStartGame);
        } else {
            startBtn.remove();
        }

        if (backToMenuBtn) {
            backToMenuBtn.addEventListener('click', backToMenu);
        }

        if (emojiButtonsContainer) {
            emojiButtonsContainer.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                const emojiCode = target.dataset.emoji;
                if (!emojiCode) return;
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                    showNotification('No hay conexión para enviar reacción', true);
                    return;
                }

                socket.send(JSON.stringify({
                    type: 'emoji_reaction',
                    emoji: emojiCode,
                    roomId,
                    playerId
                }));
            });
        }

        createConnectionStatusElement();
        updateConnectionStatus('Conectando...');

        // también renderizamos la lista de amigos ahora que may have loaded
        renderFriendList();
    }

    // Inicializar la aplicación
    function initialize() {
        initializeUI();
        connectWebSocket();

        // Heartbeat para mantener la conexión activa
        setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 10000);

        // Actualizar lista de jugadores periódicamente
        playerUpdateInterval = setInterval(updatePlayersList, PLAYER_UPDATE_INTERVAL);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearTimeout(reconnectTimeout);
        if (socket) socket.close();
    });

    // Iniciar
    initialize();
});
