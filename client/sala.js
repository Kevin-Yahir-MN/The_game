document.addEventListener('DOMContentLoaded', () => {
    const API_URL =
        window.APP_CONFIG?.PROD_API_URL ||
        'https://the-game-2xks.onrender.com';
    const WS_URL =
        window.APP_CONFIG?.PROD_WS_URL ||
        'wss://the-game-2xks.onrender.com';
    const PLAYER_UPDATE_INTERVAL = 5000;
    const AVATARS = window.APP_AVATARS?.AVATARS || [];
    const DEFAULT_AVATAR_ID =
        window.APP_AVATARS?.DEFAULT_AVATAR_ID || (AVATARS[0]?.id ?? '');

    function getAvatarEmoji(avatarId) {
        const found = AVATARS.find((avatar) => avatar.id === avatarId);
        return found ? found.emoji : '';
    }

    function getAvatarMarkup(avatarId, avatarUrl) {
        if (avatarUrl) {
            return `<img class="avatar-img" src="${avatarUrl}" alt="" />`;
        }
        const emoji = getAvatarEmoji(avatarId);
        return emoji
            ? `<span class="avatar-chip" aria-hidden="true">${emoji}</span>`
            : '';
    }

    // --- autenticación ligera para manejo de amigos ---
    function getAuthToken() {
        // Tokens are httpOnly cookies and cannot be read from JS
        return null;
    }
    function getAuthUser() {
        const raw = localStorage.getItem('authUser');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    async function fetchWithAuth(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {}),
        };
        return fetch(url, {
            ...options,
            credentials: 'include',
            headers,
        });
    }

    // estado de amigos en sala
    let friends = [];
    let currentPlayers = [];
    async function loadFriends() {
        friends = [];
        try {
            const resp = await fetchWithAuth(`${API_URL}/friends`, {
                method: 'GET',
            });
            const json = await resp.json();
            if (resp.ok && json.success) friends = json.friends || [];
        } catch (e) {
            console.error('Error cargando amigos:', e);
        }
        renderFriendList();
    }
    function renderFriendList() {
        const c = document.getElementById('friendList');
        if (!c || !window.FriendsUI) return;

        window.FriendsUI.renderFriendList({
            container: c,
            friends,
            showInvite: true,
            onInvite: (friendId, friendName) => {
                if (
                    !friendId ||
                    !socket ||
                    socket.readyState !== WebSocket.OPEN
                ) {
                    showNotification('No se pudo enviar la invitación', true);
                    return;
                }
                try {
                    socket.send(
                        JSON.stringify({
                            type: 'invite_friend',
                            targetUserId: friendId,
                            roomId,
                        })
                    );
                } catch (e) {
                    console.error('Error enviando invitación:', e);
                    showNotification('Error enviando invitación', true);
                }
            },
            onSelectFriend: (friendId) => showFriendModal(friendId),
            isInviteDisabled: (friend) =>
                currentPlayers.some(
                    (p) =>
                        p &&
                        p.userId != null &&
                        String(p.userId) === String(friend.id)
                ),
        });
        updateEmojiPanelPosition();
    }

    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_BASE_DELAY = 2000;

    let socket;
    let reconnectAttempts = 0;
    let playerUpdateInterval;
    let reconnectTimeout;
    let connectionStatus = 'disconnected';
    const gameAudio = window.GameAudio || null;
    let hasRenderedPlayersOnce = false;

    const roomId = sessionStorage.getItem('roomId');
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName');
    let isHost = sessionStorage.getItem('isHost') === 'true';

    // Elementos UI
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    const playersList = document.getElementById('playersList');
    const startBtn = document.getElementById('startGame');
    const gameSettings = document.getElementById('gameSettings');
    const initialCardsSelect = document.getElementById('initialCards');
    const backToMenuBtn = document.getElementById('backToMenu');
    const emojiButtonsContainer = document.getElementById('emojiButtons');
    const emojiPopinsContainer = document.getElementById('emojiPopins');
    const friendsContainer = document.getElementById('friendsContainer');
    const emojiPanel = document.querySelector(
        '.room-emoji-chat.game-panel.game-emoji-panel'
    );
    // modal elements are handled by FriendsUI

    let startButtonBound = false;

    function setHostStatus(nextIsHost) {
        if (typeof nextIsHost !== 'boolean') return;
        isHost = nextIsHost;
        sessionStorage.setItem('isHost', nextIsHost ? 'true' : 'false');
    }

    function setupStartButton() {
        if (!startBtn || startButtonBound) return;
        startBtn.addEventListener('click', handleStartGame);
        startButtonBound = true;
    }

    function setHostUI() {
        if (gameSettings) {
            gameSettings.style.display = isHost ? 'block' : 'none';
        }
        if (startBtn) {
            if (isHost) {
                startBtn.classList.add('visible');
            } else {
                startBtn.classList.remove('visible');
            }
        }
    }

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

    // Mostrar un modal simple con mensaje y texto de redirección
    function showRedirectModal(message) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.style.opacity = '0';

        const dialog = document.createElement('div');
        dialog.className = 'redirect-modal';
        dialog.innerHTML = `
            <p>${message}</p>
            <p>Redirigiendo al menú...</p>
        `;

        document.body.appendChild(backdrop);
        backdrop.appendChild(dialog);

        // animar aparición
        setTimeout(() => {
            backdrop.style.opacity = '1';
        }, 10);
    }

    const friendModalController = window.FriendsUI
        ? window.FriendsUI.createFriendModalController({
            canRemove: () => !!getAuthUser(),
            fetchAccount: async (friendId) => {
                const resp = await fetchWithAuth(
                    `${API_URL}/users/${friendId}`
                );
                const data = await resp.json();
                return data && data.success ? data.account : null;
            },
            onFetchError: () => {
                showNotification(
                    'No se pudo cargar información del amigo',
                    true
                );
            },
            onRemove: async (friendId) => {
                const resp = await fetchWithAuth(
                    `${API_URL}/friends/${friendId}`,
                    { method: 'DELETE' }
                );
                const json = await resp.json();
                if (!json.success) {
                    showNotification('Error eliminando amigo', true);
                    throw new Error('remove_failed');
                }
                showNotification('Amigo eliminado');
                loadFriends();
            },
        })
        : null;

    function showFriendModal(friendId) {
        if (!friendModalController) return;
        const friendData = friends.find(
            (f) => String(f.id) === String(friendId)
        );
        const name = friendData ? friendData.displayName : '';
        friendModalController.showFriendModal(friendId, name);
    }

    function updateEmojiPanelPosition() {
        if (!friendsContainer || !emojiPanel) return;
        const gap = 16;
        const rect = friendsContainer.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            emojiPanel.style.top = '1rem';
            emojiPanel.style.left = '1rem';
            return;
        }
        emojiPanel.style.top = `${Math.round(rect.bottom + gap)}px`;
        emojiPanel.style.left = `${Math.round(rect.left)}px`;
    }

    // Actualizar estado de conexión en UI
    function updateConnectionStatus(status, isError = false) {
        connectionStatus = status;
        const statusElement =
            document.getElementById('connectionStatus') ||
            createConnectionStatusElement();
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
            showNotification(
                'No se puede conectar al servidor. Recarga la página.',
                true
            );
            return;
        }

        updateConnectionStatus('Conectando...');

        if (
            socket &&
            [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)
        ) {
            socket.close();
        }

        socket = new WebSocket(
            `${WS_URL}?roomId=${roomId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`
        );

        let pingInterval;

        socket.onopen = () => {
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');

            pingInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(
                            JSON.stringify({
                                type: 'ping',
                                playerId: playerId,
                                roomId: roomId,
                                timestamp: Date.now(),
                            })
                        );
                    } catch (error) {
                        console.error('Error enviando ping:', error);
                    }
                }
            }, 15000);

            sendPlayerUpdate();

            if (connectionStatus === 'reconnecting') {
                socket.send(
                    JSON.stringify({
                        type: 'get_full_state',
                        playerId: playerId,
                        roomId: roomId,
                    })
                );
            }
            connectionStatus = 'connected';
        };

        socket.onclose = (event) => {
            clearInterval(pingInterval);
            if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(
                    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1),
                    30000
                );
                reconnectTimeout = setTimeout(connectWebSocket, delay);
                updateConnectionStatus(
                    `Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
                );
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
                    showNotification(
                        accepted
                            ? 'Tu invitación fue aceptada'
                            : 'Tu invitación fue declinada'
                    );
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
            socket.send(
                JSON.stringify({
                    type: 'update_player',
                    playerId: playerId,
                    name: playerName,
                    isHost: isHost,
                    roomId: roomId,
                    status: 'active',
                })
            );
        }
    }

    // Manejar mensajes del servidor
    function handleSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'init_game') {
                // Actualizar lista de jugadores con el estado inicial
                updatePlayersUI(message.gameState.players);
                // asegurarse de que el sessionStorage está sincronizado con el servidor
                // así cuando se reconecta el cliente obtiene el estado correcto de host
                if (message.isHost !== undefined) {
                    setHostStatus(!!message.isHost);
                }
                setHostUI();
            } else if (message.type === 'full_state_update') {
                // Actualizar UI con el estado completo del servidor
                updatePlayersUI(message.room.players);

                // Nueva: Guardar estado en sessionStorage
                sessionStorage.setItem(
                    'gameState',
                    JSON.stringify({
                        players: message.room.players,
                        currentTurn: message.gameState.currentTurn,
                        initialCards: message.gameState.initialCards,
                    })
                );

                setHostUI();
            } else if (message.type === 'game_started') {
                handleGameStart();
            } else if (message.type === 'room_update') {
                updatePlayersUI(message.players);
            } else if (message.type === 'player_left') {
                updatePlayersUI(message.players);
                showNotification(`${message.playerName} salió de la sala`);
            } else if (message.type === 'host_left_room') {
                // Usar un modal en lugar de notificación
                showRedirectModal('El host abandonó la sala');
                setTimeout(() => {
                    // Limpiar sessionStorage
                    sessionStorage.removeItem('roomId');
                    sessionStorage.removeItem('playerId');
                    sessionStorage.removeItem('isHost');
                    window.location.href = 'index.html';
                }, 2000);
            } else if (message.type === 'notification') {
                showNotification(message.message, message.isError);
            } else if (message.type === 'emoji_reaction') {
                renderEmojiReaction(message);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    }

    function renderEmojiReaction(message) {
        if (!emojiPopinsContainer) return;

        const emojiMap = {
            happy: '😄',
            angry: '😡',
            poop: '💩',
            love: '😍',
            wow: '😮',
            middle: '🖕',
            cry: '😭',
            proud: '😎',
            angel: '😇',
            demon: '😈',
            sleep: '😴',
            crazy: '🤪',
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
        const previousPlayers = Array.isArray(currentPlayers)
            ? currentPlayers
            : [];
        const previousPlayerIds = new Set(
            previousPlayers.map((player) => String(player.id))
        );
        const joinedPlayers = players.filter(
            (player) => !previousPlayerIds.has(String(player.id))
        );

        if (hasRenderedPlayersOnce) {
            const joinedOtherPlayer = joinedPlayers.find(
                (player) => String(player.id) !== String(playerId)
            );
            if (joinedOtherPlayer) {
                gameAudio?.play('playerenter');
                showNotification(
                    (joinedOtherPlayer.name || 'Un jugador') + ' se unió a la sala'
                );
            }
        }

        currentPlayers = players; // guardar referencia global
        hasRenderedPlayersOnce = true;
        const me = getAuthUser();
        const mePlayer = players.find(
            (player) => String(player.id) === String(playerId)
        );
        if (mePlayer && mePlayer.isHost !== undefined) {
            setHostStatus(!!mePlayer.isHost);
        }
        playersList.innerHTML = players
            .map((player) => {
                const isMe = player.id === playerId;
                let extraButton = '';
                // mostrar "agregar amigo" sólo si estamos autenticados, el jugador tiene userId,
                // no es yo y no está ya en mi lista de amigos
                if (me && player.userId && !isMe) {
                    const already = friends.find((f) => f.id === player.userId);
                    if (!already) {
                        extraButton = ` <button class="add-friend-btn" data-userid="${player.userId}">Agregar amigo</button>`;
                    }
                }
                const avatarSpan = getAvatarMarkup(
                    player.avatarId,
                    player.avatarUrl
                );
                return `
            <li class="${player.isHost ? 'host' : ''} ${isMe ? 'you' : ''}" data-avatar-id="${player.avatarId || ''}" data-avatar-url="${player.avatarUrl || ''}">
                ${avatarSpan}<span class="player-name">${player.name || 'Jugador'}</span>
                ${player.isHost ? '<span class="host-tag">(Host)</span>' : ''}
                ${isMe ? '<span class="you-tag">(Tú)</span>' : ''}
                <span class="connection-status">${player.connected ? '🟢' : '🔴'}</span>
                ${extraButton}
            </li>
        `;
            })
            .join('');

        // attach listeners for add-friend buttons
        const buttons = playersList.querySelectorAll('.add-friend-btn');
        buttons.forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const uid = btn.dataset.userid;
                if (!uid) return;
                try {
                    const response = await fetchWithAuth(`${API_URL}/friends`, {
                        method: 'POST',
                        body: JSON.stringify({ friendId: uid }),
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        friends.push({
                            id: uid,
                            displayName: btn
                                .closest('li')
                                .querySelector('.player-name').textContent,
                            avatarId: btn.closest('li').dataset.avatarId || null,
                            avatarUrl: btn.closest('li').dataset.avatarUrl || null,
                        });
                        renderFriendList();
                        updatePlayersUI(currentPlayers); // rerender to remove button
                    } else {
                        showNotification(
                            data.message || 'Error agregando amigo',
                            true
                        );
                    }
                } catch (err) {
                    console.error('Error agregando amigo:', err);
                    showNotification('Error agregando amigo', true);
                    // Actualizar lista de amigos también, por si alguno está en la sala
                    renderFriendList();
                }
            });
        });

        // Re-render friends list to update disabled/enabled state of invite buttons
        renderFriendList();

        setHostUI();
    }

    function backToMenu() {
        // Notificar al servidor que estamos abandonando la sala
        // para que pueda transferir el host si es necesario
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(
                    JSON.stringify({
                        type: 'leave_room',
                        roomId: roomId,
                        playerId: playerId,
                    })
                );
            } catch (e) {
                console.error('Error notificando abandono:', e);
            }
            // Esperar un poco para que el mensaje se procese
            setTimeout(() => {
                socket.close();
            }, 100);
        }

        sessionStorage.removeItem('roomId');
        sessionStorage.removeItem('playerId');
        sessionStorage.removeItem('isHost');

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
            socket.send(
                JSON.stringify({
                    type: 'start_game',
                    playerId: playerId,
                    roomId: roomId,
                    initialCards: parseInt(initialCardsSelect.value),
                })
            );

            // Timeout de seguridad reducido a 8 segundos
            const timeout = setTimeout(() => {
                if (window.location.pathname.endsWith('sala.html')) {
                    resetStartButton();
                    showNotification(
                        'El servidor está tardando en responder',
                        true
                    );
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

        updatePlayersList();
        loadFriends();

        setupStartButton();
        setHostUI();

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
                    showNotification(
                        'No hay conexión para enviar reacción',
                        true
                    );
                    return;
                }

                socket.send(
                    JSON.stringify({
                        type: 'emoji_reaction',
                        emoji: emojiCode,
                        roomId,
                        playerId,
                    })
                );
            });
        }

        createConnectionStatusElement();
        updateConnectionStatus('Conectando...');

        // también renderizamos la lista de amigos ahora que may have loaded
        renderFriendList();
        updateEmojiPanelPosition();
    }

    // Inicializar la aplicación
    function initialize() {
        // Mostrar la pantalla de carga
        const loadingScreen = document.getElementById('loadingScreen');

        initializeUI();
        connectWebSocket();

        // Heartbeat para mantener la conexión activa
        setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 10000);

        // Actualizar lista de jugadores periódicamente
        playerUpdateInterval = setInterval(
            updatePlayersList,
            PLAYER_UPDATE_INTERVAL
        );

        // Ocultar la pantalla de carga después de 5 segundos
        setTimeout(() => {
            if (loadingScreen) {
                loadingScreen.classList.add('hidden');
            }
        }, 5000);
    }

    // Limpieza al salir
    window.addEventListener('beforeunload', () => {
        clearInterval(playerUpdateInterval);
        clearTimeout(reconnectTimeout);
        if (socket) socket.close();
    });

    window.addEventListener('resize', () => {
        updateEmojiPanelPosition();
    });

    // Iniciar
    initialize();
});
