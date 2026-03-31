document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const WS_URL =
        window.APP_CONFIG?.PROD_WS_URL ||
        'wss://the-game-2xks.onrender.com';
    const endTurnButton = document.getElementById('endTurnBtn');
    const GAME_RULES = window.GAME_RULES;
    const emojiButtonsContainer = document.getElementById('emojiButtons');
    const AVATARS = window.APP_AVATARS?.AVATARS || [];
    // throttle for incoming full-state updates (ms). set to 0 to process every message immediately
    const STATE_UPDATE_THROTTLE = 0;
    // reposition floating emoji messages when the window resizes
    window.addEventListener('resize', () => {
        applyResponsiveCanvasSizing();
        applyHudPanelLayout();
        updateEmojiPanelPosition();
        positionEmojiMessages();
    });
    const TARGET_FPS = 60;
    const MAX_RECONNECT_ATTEMPTS = 12;
    const RECONNECT_BASE_DELAY = 2000;
    let CARD_WIDTH = 80;
    let CARD_HEIGHT = 120;
    let COLUMN_SPACING = 60;
    let CARD_SPACING = 15;
    const HISTORY_ICON_PULSE_INTERVAL = 20000;
    const HISTORY_ICON_PULSE_DURATION = 500;
    const SPECIAL_MOVE_EFFECT_DURATION = 900;
    const EMOJI_ERROR_COOLDOWN_MS = 4000;
    const ERROR_NOTIFICATION_DURATION_MS = 3000;
    const NOTIFICATION_COOLDOWN_MS = 4000;
    const MAX_VISIBLE_EMOJI_REACTIONS = 9;

    let BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3,
    };
    let PLAYER_CARDS_Y = canvas.height * 0.6;
    let BUTTONS_Y = canvas.height * 0.85;
    let HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

    const assetCache = new Map();
    let historyIcon = new Image();
    let historyIconsAnimation = {
        interval: null,
        lastPulseTime: Date.now(),
        isAnimating: false,
    };
    let animationFrameId;
    let lastStateUpdate = 0;
    let lastRenderTime = 0;
    let reconnectAttempts = 0;
    let reconnectTimeout;
    let pingInterval;
    let connectionStatus = 'disconnected';
    const gameAudio = window.GameAudio || null;
    let lastTurnSoundTurnId = null;
    let lastNotificationAt = 0;
    let isPlayersPanelCollapsed = false;
    let dragStartCard = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let socket;
    let animationQueue = [];
    let dirtyAreas = [];
    let needsRedraw = true;
    let lastEmojiErrorNotificationAt = 0;

    const currentPlayer = {
        id: sanitizeInput(sessionStorage.getItem('playerId')),
        name: sanitizeInput(sessionStorage.getItem('playerName')),
        isHost: sessionStorage.getItem('isHost') === 'true',
    };

    const roomId = sanitizeInput(sessionStorage.getItem('roomId'));
    if (!roomId) {
        window.location.href = 'sala.html';
        return;
    }

    let gameState = {
        players: [],
        yourCards: [],
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: null,
        remainingDeck: 98,
        initialCards: 6,
        cardsPlayedThisTurn: [],
        animatingCards: [],
        columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] },
        boardCards: [],
        historyIconAreas: [],
        specialMoveEffects: [],
    };

    const cardPool = {
        pool: [],
        get(value, x, y, isPlayable, isPlayedThisTurn) {
            if (this.pool.length > 0) {
                const card = this.pool.pop();
                card.value = value;
                card.x = x;
                card.y = y;
                card.isPlayable = isPlayable;
                card.isPlayedThisTurn = isPlayedThisTurn;
                return card;
            }
            return new Card(value, x, y, isPlayable, isPlayedThisTurn);
        },
        release(card) {
            this.pool.push(card);
        },
    };

    function sanitizeInput(input) {
        return input ? input.replace(/[^a-zA-Z0-9-_]/g, '') : '';
    }

    function applyResponsiveCanvasSizing() {
        const viewportWidth = window.innerWidth || 800;
        const viewportHeight = window.innerHeight || 700;
        const maxWidth = Math.min(900, viewportWidth - 32);
        const targetWidth = Math.max(320, maxWidth);
        const targetHeight = Math.min(
            Math.max(520, Math.floor(targetWidth * 0.85)),
            Math.floor(viewportHeight * 0.9)
        );

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const scale = Math.min(targetWidth / 800, targetHeight / 700);
        CARD_WIDTH = Math.round(80 * scale);
        CARD_HEIGHT = Math.round(120 * scale);
        COLUMN_SPACING = Math.round(60 * scale);
        CARD_SPACING = Math.max(10, Math.round(15 * scale));

        BOARD_POSITION = {
            x:
                canvas.width / 2 -
                (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
            y: Math.round(canvas.height * 0.3),
        };
        PLAYER_CARDS_Y = Math.round(canvas.height * 0.6);
        BUTTONS_Y = Math.round(canvas.height * 0.85);
        HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

        needsRedraw = true;
    }

    function log(message, data) {
        console.log(`[${new Date().toISOString()}] ${message}`, data);
    }

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

    class Card {
        constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
            this.value = typeof value === 'number' ? value : 0;
            this.x = typeof x === 'number' ? x : 0;
            this.y = typeof y === 'number' ? y : 0;
            this.width = CARD_WIDTH;
            this.height = CARD_HEIGHT;
            this.isPlayable = !!isPlayable;
            this.isPlayedThisTurn = !!isPlayedThisTurn;
            this.isFromCurrentTurn = !!isPlayedThisTurn;
            this.playedThisRound = false;
            this.radius = 10;
            this.shakeOffset = 0;
            this.hoverOffset = 0;
            this.backgroundColor = this.determineColor();
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.isDragging = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;
        }

        determineColor() {
            if (
                !gameState ||
                !gameState.cardsPlayedThisTurn ||
                !gameState.animatingCards
            ) {
                return '#FFFFFF';
            }

            const isPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                (move) => {
                    return (
                        move &&
                        move.value === this.value &&
                        ((move.position === 'asc1' &&
                            gameState.board.ascending[0] === this.value) ||
                            (move.position === 'asc2' &&
                                gameState.board.ascending[1] === this.value) ||
                            (move.position === 'desc1' &&
                                gameState.board.descending[0] === this.value) ||
                            (move.position === 'desc2' &&
                                gameState.board.descending[1] === this.value))
                    );
                }
            );

            const isAnimatedCard = gameState.animatingCards.some((anim) => {
                return (
                    anim &&
                    anim.card &&
                    anim.card.value === this.value &&
                    (anim.card.position === this.position ||
                        anim.column === this.position)
                );
            });

            return isPlayedThisTurn || isAnimatedCard || this.playedThisRound
                ? '#99CCFF'
                : '#FFFFFF';
        }

        updateColor() {
            this.backgroundColor = this.determineColor();
        }

        draw() {
            ctx.save();
            if (!this.isDragging) ctx.translate(this.shakeOffset, 0);

            ctx.shadowColor =
                this.isPlayedThisTurn || this.playedThisRound
                    ? 'rgba(0, 100, 255, 0.3)'
                    : 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 4;

            ctx.beginPath();
            ctx.roundRect(
                this.x,
                this.y - this.hoverOffset,
                this.width,
                this.height,
                this.radius
            );
            ctx.fillStyle = this.backgroundColor;
            ctx.fill();

            ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
            ctx.lineWidth = this.isPlayable ? 3 : 2;
            ctx.stroke();

            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'transparent';
            ctx.fillText(
                this.value.toString(),
                this.x + this.width / 2,
                this.y + this.height / 2 - this.hoverOffset
            );

            ctx.restore();
            markDirty(this.x, this.y, this.width, this.height);
        }

        contains(x, y) {
            return (
                x >= this.x &&
                x <= this.x + this.width &&
                y >= this.y &&
                y <= this.y + this.height
            );
        }

        startDrag(offsetX, offsetY) {
            this.isDragging = true;
            this.dragOffsetX = offsetX;
            this.dragOffsetY = offsetY;
            this.shadowColor = 'rgba(0, 0, 0, 0.5)';
            this.hoverOffset = 15;
            markDirty(this.x, this.y, this.width, this.height);
        }

        endDrag() {
            this.isDragging = false;
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.hoverOffset = 0;
            markDirty(this.x, this.y, this.width, this.height);
        }

        updateDragPosition(x, y) {
            if (this.isDragging) {
                markDirty(this.x, this.y, this.width, this.height);
                this.x = x - this.dragOffsetX;
                this.y = y - this.dragOffsetY;
                markDirty(this.x, this.y, this.width, this.height);
            }
        }
    }

    function markDirty(x, y, width, height) {
        dirtyAreas.push({ x, y, width, height });
        needsRedraw = true;
    }

    function clearDirtyAreas() {
        dirtyAreas = [];
    }

    function getStackValue(position) {
        const [stack, idx] = position.includes('asc')
            ? [gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [gameState.board.descending, position === 'desc1' ? 0 : 1];
        return stack[idx];
    }

    function updateStack(position, value) {
        const [stack, idx] = position.includes('asc')
            ? [gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [gameState.board.descending, position === 'desc1' ? 0 : 1];
        stack[idx] = value;
    }

    function isValidMove(cardValue, position) {
        if (GAME_RULES && typeof GAME_RULES.isValidMove === 'function') {
            return GAME_RULES.isValidMove(
                cardValue,
                position,
                gameState.board
            ).isValid;
        }
        const currentValue = getStackValue(position);
        const isAscending = position.includes('asc');
        const exactDifference = isAscending
            ? cardValue === currentValue - 10
            : cardValue === currentValue + 10;
        const normalMove = isAscending
            ? cardValue > currentValue
            : cardValue < currentValue;
        return exactDifference || normalMove;
    }

    function addToHistory(position, value) {
        const history =
            gameState.columnHistory[position] ||
            (position.includes('asc') ? [1] : [100]);
        if (history[history.length - 1] !== value) {
            history.push(value);
            gameState.columnHistory[position] = history;
        }
    }

    function recordCardPlayed(cardValue, position, playerId, previousValue) {
        gameState.cardsPlayedThisTurn.push({
            value: cardValue,
            position,
            playerId,
            previousValue,
        });
        updateGameInfo();
    }

    function isSpecialMove(cardValue, position, previousValue) {
        const numericCardValue = Number(cardValue);
        const numericPreviousValue = Number(previousValue);

        if (
            !Number.isFinite(numericCardValue) ||
            !Number.isFinite(numericPreviousValue)
        ) {
            return false;
        }

        return position.includes('asc')
            ? numericCardValue === numericPreviousValue - 10
            : numericCardValue === numericPreviousValue + 10;
    }

    function playBoardMoveSound(
        cardValue,
        position,
        previousValue,
        isSpecialMoveOverride = null
    ) {
        const soundName =
            typeof isSpecialMoveOverride === 'boolean'
                ? isSpecialMoveOverride
                    ? 'specialmove'
                    : 'put'
                : isSpecialMove(cardValue, position, previousValue)
                    ? 'specialmove'
                    : 'put';
        gameAudio?.play(soundName);
    }

    function registerSpecialMoveEffect(position, cardValue) {
        const numericCardValue = Number(cardValue);
        if (!Number.isFinite(numericCardValue)) {
            return;
        }

        const effects = Array.isArray(gameState.specialMoveEffects)
            ? gameState.specialMoveEffects
            : [];
        gameState.specialMoveEffects = effects.filter(
            (effect) => !(effect.position === position && effect.cardValue === numericCardValue)
        );
        gameState.specialMoveEffects.push({
            position,
            cardValue: numericCardValue,
            startedAt: Date.now(),
            duration: SPECIAL_MOVE_EFFECT_DURATION,
        });
        needsRedraw = true;
    }

    function getSpecialMoveEffect(position, cardValue) {
        if (!Array.isArray(gameState.specialMoveEffects)) {
            return null;
        }

        const numericCardValue = Number(cardValue);
        const now = Date.now();
        gameState.specialMoveEffects = gameState.specialMoveEffects.filter(
            (effect) => now - effect.startedAt < effect.duration
        );

        return (
            gameState.specialMoveEffects.find(
                (effect) =>
                    effect.position === position &&
                    effect.cardValue === numericCardValue
            ) || null
        );
    }

    function renderSpecialMoveEffect(card, position) {
        const effect = getSpecialMoveEffect(position, card.value);
        if (!effect) {
            return;
        }

        const progress = Math.min(
            (Date.now() - effect.startedAt) / effect.duration,
            1
        );
        const alpha = 1 - progress;
        const expand = 8 + 8 * alpha;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(
            card.x - expand / 2,
            card.y - card.hoverOffset - expand / 2,
            card.width + expand,
            card.height + expand,
            card.radius + 4
        );
        ctx.fillStyle = 'rgba(255, 214, 64, ' + 0.18 * alpha + ')';
        ctx.shadowColor = 'rgba(255, 215, 0, ' + 0.95 * alpha + ')';
        ctx.shadowBlur = 28 * alpha;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 244, 179, ' + 0.95 * alpha + ')';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        if (alpha > 0) {
            needsRedraw = true;
        }
    }

    function isMyTurn() {
        return gameState.currentTurn === currentPlayer.id;
    }

    function setNextTurn() {
        const currentIndex = gameState.players.findIndex(
            (p) => p.id === gameState.currentTurn
        );
        let nextIndex = (currentIndex + 1) % gameState.players.length;
        gameState.currentTurn = gameState.players[nextIndex].id;
    }

    function loadAsset(url) {
        if (assetCache.has(url)) {
            return Promise.resolve(assetCache.get(url));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                assetCache.set(url, img);
                resolve(img);
            };
            img.onerror = (err) => {
                log('Error loading asset', { url, error: err });
                reject(err);
            };
            img.src = url;
        });
    }

    function connectWebSocket() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification(
                'No se puede conectar al servidor. Recarga la página.',
                true
            );
            updateConnectionStatus('Desconectado', true);
            return;
        }

        updateConnectionStatus('Conectando...');

        if (socket) {
            socket.onopen =
                socket.onmessage =
                socket.onclose =
                socket.onerror =
                null;
            if (
                [WebSocket.OPEN, WebSocket.CONNECTING].includes(
                    socket.readyState
                )
            ) {
                socket.close();
            }
        }

        socket = new WebSocket(
            `${WS_URL}?roomId=${roomId}&playerId=${currentPlayer.id}&playerName=${encodeURIComponent(currentPlayer.name)}`
        );

        socket.onopen = () => {
            clearTimeout(reconnectTimeout);
            reconnectAttempts = 0;
            updateConnectionStatus('Conectado');
            showNotification('Conectado al servidor');
            restoreGameState();

            clearInterval(pingInterval);
            pingInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(
                            JSON.stringify({
                                type: 'ping',
                                playerId: currentPlayer.id,
                                roomId,
                                timestamp: Date.now(),
                            })
                        );
                    } catch (error) {
                        log('Error enviando ping', error);
                    }
                }
            }, 15000);

            socket.send(
                JSON.stringify({
                    type: 'get_full_state',
                    playerId: currentPlayer.id,
                    roomId: roomId,
                    requireCurrentState: true,
                })
            );

            socket.send(
                JSON.stringify({
                    type: 'get_player_state',
                    playerId: currentPlayer.id,
                    roomId: roomId,
                })
            );
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
            log('Error en WebSocket', error);
            updateConnectionStatus('Error de conexión', true);
            connectionStatus = 'error';
        };

        socket.onmessage = (event) => {
            try {
                const now = Date.now();
                const message = validateMessage(JSON.parse(event.data));

                if (!message) return;

                if (message.errorCode === 'MISSING_REQUIRED_FIELDS') {
                    showNotification(`Error: ${message.message}`, true);
                    return;
                }

                if (message.type === 'player_state_update') {
                    handlePlayerStateUpdate(message);
                }

                if (message.type === 'pong') {
                    updateConnectionStatus('Conectado');
                    return;
                }

                // process all gs updates when throttle is 0
                if (
                    message.type === 'gs' &&
                    STATE_UPDATE_THROTTLE > 0 &&
                    now - lastStateUpdate < STATE_UPDATE_THROTTLE
                ) {
                    return;
                }

                switch (message.type) {
                    case 'full_state_update':
                        handleFullStateUpdate(message);
                        break;
                    case 'init_game':
                        handleInitGame(message);
                        break;
                    case 'gs':
                        handleGameStateUpdate(message);
                        break;
                    case 'game_started':
                        handleGameStarted(message);
                        break;
                    case 'your_cards':
                        updatePlayerCards(message.cards);
                        break;
                    case 'game_over':
                        handleGameOver(message.message, true);
                        break;
                    case 'notification':
                        showNotification(message.message, message.isError);
                        break;
                    case 'column_history':
                        updateColumnHistory(message);
                        break;
                    case 'column_history_update':
                        updateColumnHistoryUI(message.column, message.history);
                        break;
                    case 'card_played':
                        handleOpponentCardPlayed(message);
                        break;
                    case 'card_played_animated':
                        handleAnimatedCardPlay(message);
                        break;
                    case 'deck_empty':
                        handleDeckEmpty();
                        break;
                    case 'deck_updated':
                        handleDeckUpdated(message);
                        break;
                    case 'turn_changed':
                        handleTurnChanged(message);
                        break;
                    case 'deck_empty_state':
                        handleDeckEmptyState(message);
                        break;
                    case 'deck_empty_notification':
                        showNotification(message.message, message.isError);
                        break;
                    case 'move_undone':
                        handleMoveUndone(message);
                        break;
                    case 'room_reset':
                        resetGameState();
                        break;
                    case 'player_update':
                        handlePlayerUpdate(message);
                        break;
                    case 'emoji_reaction':
                        renderEmojiReaction(message);
                        break;
                    default:
                        log('Mensaje no reconocido:', message);
                }
            } catch (error) {
                log('Error procesando mensaje:', { error, data: event.data });
            }
        };
    }

    function validateMessage(message) {
        if (!message || typeof message !== 'object') return null;
        if (!message.type || typeof message.type !== 'string') return null;
        return message;
    }

    function handlePlayerStateUpdate(message) {
        const progressText = `${message.cardsPlayedThisTurn}/${message.minCardsRequired} carta(s) jugada(s)`;
        const progressPercentage =
            (message.cardsPlayedThisTurn / message.minCardsRequired) * 100;

        document.getElementById('progressText').textContent = progressText;
        document.getElementById('progressBar').style.width =
            `${progressPercentage}%`;

        if (message.players) {
            gameState.players = message.players;
            updatePlayersPanel();
        }
        gameState.currentTurn = message.currentTurn;
        updateGameInfo();
    }

    function handleGameStateUpdate(message) {
        lastStateUpdate = Date.now();
        updateGameState(message.s);
        updateGameInfo();
    }

    function handleGameStarted(message) {
        gameState.board = message.board || {
            ascending: [1, 1],
            descending: [100, 100],
        };
        gameState.currentTurn = message.currentTurn;
        gameState.remainingDeck = message.remainingDeck;
        gameState.initialCards = message.initialCards;
        gameState.gameStarted = true;

        if (gameState.players) {
            gameState.players.forEach((player) => {
                player.cardsPlayedThisTurn = 0;
            });
        }

        updateGameInfo();
        updatePlayersPanel();

        if (window.location.pathname.endsWith('sala.html')) {
            window.location.href = 'game.html';
        }
    }

    function updateColumnHistory(message) {
        gameState.columnHistory = {
            asc1: message.history.ascending1 || [1],
            asc2: message.history.ascending2 || [1],
            desc1: message.history.descending1 || [100],
            desc2: message.history.descending2 || [100],
        };
    }

    // Position the floating emoji messages list so it appears below the players panel
    function setupInfoPanelToggle() {
        const panel = document.querySelector('.info-panel');
        if (!panel || panel.dataset.toggleBound === 'true') {
            return;
        }

        const title = panel.querySelector('h3');
        const content = panel.querySelector('.panel-content');
        if (!title || !content) {
            return;
        }

        const header = document.createElement('div');
        header.className = 'info-panel-header';
        title.parentNode.insertBefore(header, title);
        header.appendChild(title);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'emoji-panel-toggle info-panel-toggle';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Minimizar informacion del juego');
        toggle.title = 'Minimizar informacion del juego';
        toggle.textContent = '−';
        header.appendChild(toggle);

        toggle.addEventListener('click', () => {
            const isCollapsed = panel.classList.toggle('is-collapsed');
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            toggle.setAttribute(
                'aria-label',
                isCollapsed
                    ? 'Mostrar informacion del juego'
                    : 'Minimizar informacion del juego'
            );
            toggle.title = isCollapsed
                ? 'Mostrar informacion del juego'
                : 'Minimizar informacion del juego';
            toggle.textContent = isCollapsed ? '\u2139' : '-';
            requestAnimationFrame(() => {
                applyHudPanelLayout();
                positionEmojiMessages();
            });
        });

        panel.addEventListener('transitionend', (event) => {
            applyHudPanelLayout();
            positionEmojiMessages();
        });

        panel.dataset.toggleBound = 'true';
    }
    function setupEmojiPanelToggle() {
        const panel = document.querySelector('.game-emoji-panel');
        if (!panel || panel.dataset.toggleBound === 'true') {
            return;
        }

        const title = panel.querySelector('h3');
        const buttons = panel.querySelector('.emoji-buttons');
        if (!title || !buttons) {
            return;
        }

        const header = document.createElement('div');
        header.className = 'emoji-panel-header';
        title.parentNode.insertBefore(header, title);
        header.appendChild(title);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'emoji-panel-toggle';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Minimizar reacciones rápidas');
        toggle.title = 'Minimizar reacciones rápidas';
        toggle.textContent = '−';
        header.appendChild(toggle);

        toggle.addEventListener('click', () => {
            const isCollapsed = panel.classList.toggle('is-collapsed');
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            toggle.setAttribute(
                'aria-label',
                isCollapsed
                    ? 'Mostrar reacciones rápidas'
                    : 'Minimizar reacciones rápidas'
            );
            toggle.title = isCollapsed
                ? 'Mostrar reacciones rápidas'
                : 'Minimizar reacciones rápidas';
            toggle.textContent = isCollapsed ? '\u{1F604}' : '-';
            requestAnimationFrame(() => {
                applyHudPanelLayout();
                positionEmojiMessages();
            });
        });

        panel.addEventListener('transitionend', (event) => {
            applyHudPanelLayout();
            positionEmojiMessages();
        });

        panel.dataset.toggleBound = 'true';
    }

    function updateEmojiPanelPosition() {
        const panel = document.querySelector('.game-emoji-panel');
        if (!panel) return;
        applyHudPanelLayout();
    }

    function applyHudPanelLayout() {
        const infoPanel = document.querySelector('.info-panel');
        const emojiPanel = document.querySelector('.game-emoji-panel');
        const playersPanel = document.getElementById('playersPanel');
        const margin = window.innerWidth <= 768 ? 15 : 20;
        const gap = 12;
        const availableWidth = Math.max(window.innerWidth - margin * 3, 260);
        const panelWidth = Math.min(
            380,
            Math.max(170, Math.floor(availableWidth / 2))
        );

        if (infoPanel) {
            infoPanel.style.position = 'fixed';
            infoPanel.style.top = `${margin}px`;
            infoPanel.style.left = `${margin}px`;
            infoPanel.style.right = 'auto';
            infoPanel.style.width = `${panelWidth}px`;
            infoPanel.style.maxWidth = `${panelWidth}px`;
        }

        if (playersPanel) {
            playersPanel.style.position = 'fixed';
            playersPanel.style.top = `${margin}px`;
            playersPanel.style.right = `${margin}px`;
            playersPanel.style.left = 'auto';
            playersPanel.style.width = `${panelWidth}px`;
            playersPanel.style.maxWidth = `${panelWidth}px`;
        }

        if (emojiPanel) {
            emojiPanel.style.position = 'fixed';
            emojiPanel.style.left = `${margin}px`;
            emojiPanel.style.right = 'auto';
            emojiPanel.style.width = `${panelWidth}px`;
            emojiPanel.style.maxWidth = `${panelWidth}px`;

            if (infoPanel) {
                const rect = infoPanel.getBoundingClientRect();
                emojiPanel.style.top = `${Math.round(rect.bottom + gap)}px`;
            } else {
                emojiPanel.style.top = `${margin}px`;
            }
        }
    }

    function setupHudLayoutObservers() {
        if (typeof ResizeObserver !== 'function') {
            return;
        }

        const panels = [
            document.querySelector('.info-panel'),
            document.querySelector('.game-emoji-panel'),
            document.getElementById('playersPanel'),
        ].filter(Boolean);

        panels.forEach((panel) => {
            if (panel.dataset.layoutObserved === 'true') {
                return;
            }

            const observer = new ResizeObserver(() => {
                requestAnimationFrame(() => {
                    applyHudPanelLayout();
                    positionEmojiMessages();
                });
            });

            observer.observe(panel);
            panel.dataset.layoutObserved = 'true';
        });
    }

    function positionEmojiMessages() {
        const msgs = document.getElementById('emojiMessages');
        const panel = document.getElementById('playersPanel');
        if (!msgs || !panel) return;
        const rect = panel.getBoundingClientRect();
        msgs.style.position = 'fixed';
        msgs.style.right = '20px';
        msgs.style.top = rect.bottom + 5 + 'px';
        // keep it above other UI
        msgs.style.zIndex = 21;
    }

    // Asegura que exista el contenedor de mensajes debajo de la lista de jugadores
    function ensureEmojiMessagesContainer() {
        let msgs = document.getElementById('emojiMessages');
        const panel = document.getElementById('playersPanel');
        if (!msgs) {
            msgs = document.createElement('ul');
            msgs.id = 'emojiMessages';
            msgs.className = 'emoji-messages';
            // insert the list *after* the players panel (not inside it)
            if (panel && panel.parentNode) {
                panel.parentNode.insertBefore(msgs, panel.nextSibling);
            } else {
                document.body.appendChild(msgs);
            }
            positionEmojiMessages();
        }
        return msgs;
    }

    // Muestra un mensaje con el emoji enviado por otro jugador
    function renderEmojiReaction(message) {
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

        const emojiSenderId = String(
            message.fromPlayerId ?? message.playerId ?? ''
        );
        if (emojiSenderId && emojiSenderId !== String(currentPlayer.id)) {
            gameAudio?.play('chatmessage');
        }

        const msgs = ensureEmojiMessagesContainer();
        if (!msgs) return;

        const item = document.createElement('li');
        item.className = 'emoji-message';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'emoji-message-name';
        nameSpan.textContent = message.fromPlayerName || 'Jugador';

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'emoji-message-emoji';
        emojiSpan.textContent = emojiChar;

        item.appendChild(nameSpan);
        item.appendChild(emojiSpan);

        while (msgs.children.length >= MAX_VISIBLE_EMOJI_REACTIONS) {
            msgs.removeChild(msgs.firstElementChild);
        }

        msgs.appendChild(item);
        msgs.style.display = 'block';
        positionEmojiMessages();

        setTimeout(() => {
            if (msgs.contains(item)) {
                msgs.removeChild(item);
            }
            if (msgs.children.length === 0) {
                msgs.style.display = 'none';
            }
        }, 3500); // mostrar 3.5 segundos
    }

    function handleDeckEmpty() {
        gameState.remainingDeck = 0;

        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');

        if (remainingDeckElement) {
            remainingDeckElement.textContent = '0';
        }

        if (progressTextElement) {
            progressTextElement.textContent = '0/1 carta(s) jugada(s)';
        }

        updateGameInfo(true);
    }

    function handleTurnChanged(message) {
        gameState.cardsPlayedThisTurn = [];
        gameState.currentTurn = message.newTurn;
        if (message.deckEmpty !== undefined) {
            gameState.remainingDeck =
                message.remainingDeck || gameState.remainingDeck;
            document.getElementById('remainingDeck').textContent =
                gameState.remainingDeck;
            const minCardsRequired = message.deckEmpty ? 1 : 2;
            document.getElementById('progressText').textContent =
                `0/${minCardsRequired} carta(s) jugada(s)`;
            document.getElementById('progressBar').style.width = '0%';
        }
        updatePlayerCards(gameState.yourCards.map((c) => c.value));
        if (message.playerName) {
            const notificationMsg =
                message.newTurn === currentPlayer.id
                    ? '¡Es tu turno!'
                    : `Turno de ${message.playerName}`;
            showNotification(notificationMsg);
        }

        if (
            message.newTurn === currentPlayer.id &&
            lastTurnSoundTurnId !== message.newTurn
        ) {
            gameAudio?.play('myturn');
            lastTurnSoundTurnId = message.newTurn;
        } else if (message.newTurn !== currentPlayer.id) {
            lastTurnSoundTurnId = null;
        }
    }

    function handleDeckEmptyState(message) {
        gameState.remainingDeck = message.remaining;
        document.getElementById('remainingDeck').textContent =
            message.remaining;
        const minCardsRequired = message.minCardsRequired || 1;
        document.getElementById('progressText').textContent =
            `0/${minCardsRequired} carta(s) jugada(s)`;
        document.getElementById('progressBar').style.width = '0%';
        updatePlayerCards(gameState.yourCards.map((c) => c.value));
        updateGameInfo();
    }

    function handlePlayerUpdate(message) {
        if (message.players) {
            gameState.players = message.players;
            updateGameInfo();
        }
    }

    function resetGameState() {
        gameState = {
            players: [],
            yourCards: [],
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: null,
            remainingDeck: 98,
            initialCards: 6,
            cardsPlayedThisTurn: [],
            animatingCards: [],
            columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] },
            specialMoveEffects: [],
        };

        updateGameInfo();
    }

    function restoreGameState() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            setTimeout(restoreGameState, 500);
            return;
        }

        socket.send(
            JSON.stringify({
                type: 'get_player_state',
                playerId: currentPlayer.id,
                roomId: roomId,
            })
        );
    }

    function updateConnectionStatus(status, isError = false) {
        connectionStatus = status;
        const statusElement =
            document.getElementById('connectionStatus') ||
            createConnectionStatusElement();
        statusElement.textContent = `Estado: ${status}`;
        statusElement.className = isError
            ? 'connection-error'
            : 'connection-status';
    }

    function createConnectionStatusElement() {
        const panelContent = document.querySelector('.panel-content');
        const statusElement = document.createElement('p');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        const remainingDeckElement =
            document.getElementById('remainingDeck').parentNode;
        remainingDeckElement.parentNode.insertBefore(
            statusElement,
            remainingDeckElement.nextSibling
        );
        return statusElement;
    }

    function handleFullStateUpdate(message) {
        if (!message.room || !message.gameState) return;

        if (message.history) {
            gameState.columnHistory = {
                asc1: message.history.ascending1 || [1],
                asc2: message.history.ascending2 || [1],
                desc1: message.history.descending1 || [100],
                desc2: message.history.descending2 || [100],
            };
        }

        gameState.board = message.gameState.board || gameState.board;
        gameState.currentTurn =
            message.gameState.currentTurn || gameState.currentTurn;
        gameState.remainingDeck =
            message.gameState.remainingDeck || gameState.remainingDeck;
        gameState.initialCards =
            message.gameState.initialCards || gameState.initialCards;
        gameState.players = message.room.players || gameState.players;

        updateGameInfo();
    }

    function handleInitGame(message) {
        // asegurarse de que el sessionStorage está sincronizado con el servidor
        // así cuando se reconecta el cliente obtiene el estado correcto de host
        if (message.isHost !== undefined) {
            sessionStorage.setItem('isHost', message.isHost ? 'true' : 'false');
        }

        gameState.currentTurn = message.gameState.currentTurn;
        gameState.board = message.gameState.board;
        gameState.remainingDeck = message.gameState.remainingDeck;
        gameState.initialCards = message.gameState.initialCards || 6;
        gameState.players = message.gameState.players || gameState.players;

        gameState.columnHistory = {
            asc1: message.history?.ascending1 || [1],
            asc2: message.history?.ascending2 || [1],
            desc1: message.history?.descending1 || [100],
            desc2: message.history?.descending2 || [100],
        };

        if (gameState.players) {
            gameState.players.forEach((player) => {
                player.cardsPlayedThisTurn = 0;
            });
        }

        if (message.gameState.gameStarted && message.yourCards) {
            updatePlayerCards(message.yourCards);
        }

        restoreGameState();
        updatePlayersPanel();
        updateGameInfo();
    }

    function showNotification(message, isError = false) {
        if (isError) {
            if (document.querySelector('.notification.error')) {
                return;
            }
            gameAudio?.play('error');
        } else if (document.querySelector('.notification.success')) {
            return;
        }
        const now = Date.now();
        if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) {
            return;
        }

        lastNotificationAt = now;
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.style.animation = 'notificationExit 0.15s forwards';
            setTimeout(() => existing.remove(), 300);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        notification.style.animation = 'notificationEnter 0.15s forwards';
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'notificationExit 0.15s forwards';
            setTimeout(() => notification.remove(), 300);
        }, isError ? ERROR_NOTIFICATION_DURATION_MS : 3000);
    }

    function showEmojiSendErrorNotification() {
        const now = Date.now();
        if (now - lastEmojiErrorNotificationAt < EMOJI_ERROR_COOLDOWN_MS) {
            return;
        }

        lastEmojiErrorNotificationAt = now;
        showNotification('No hay conexión para enviar reacción', true);
    }

    function showColumnHistory(columnId) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const modal = document.getElementById('historyModal');
        const backdrop = document.getElementById('modalBackdrop');
        const title = document.getElementById('historyColumnTitle');
        const container = document.getElementById('historyCardsContainer');

        const columnNames = {
            asc1: 'Pila Ascendente 1 (↑)',
            asc2: 'Pila Ascendente 2 (↑)',
            desc1: 'Pila Descendente 1 (↓)',
            desc2: 'Pila Descendente 2 (↓)',
        };

        title.textContent = columnNames[columnId];
        container.innerHTML = '';

        const history =
            gameState.columnHistory[columnId] ||
            (columnId.includes('asc') ? [1] : [100]);

        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
        canvas.style.pointerEvents = 'none';
    }

    function closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';
        canvas.style.pointerEvents = 'auto';
    }

    function getColumnPosition(position) {
        const index = ['asc1', 'asc2', 'desc1', 'desc2'].indexOf(position);
        return {
            x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * index,
            y: BOARD_POSITION.y,
        };
    }

    function animateInvalidCard(card) {
        if (!card) return;

        const shakeAmount = 8;
        const shakeDuration = 200;
        const startTime = Date.now();
        const originalX = card.x;
        const originalY = card.y;

        function shake() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / shakeDuration;

            if (progress >= 1) {
                card.shakeOffset = 0;
                card.x = originalX;
                card.y = originalY;
                markDirty(card.x, card.y, card.width, card.height);
                return;
            }

            card.shakeOffset =
                Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
            card.x =
                originalX +
                Math.sin(progress * Math.PI * 16) *
                shakeAmount *
                (1 - progress);
            markDirty(card.x, card.y, card.width, card.height);
            requestAnimationFrame(shake);
        }

        shake();
    }

    function resetCardsPlayedProgress() {
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent =
            '0/' + minCardsRequired + ' carta(s) jugada(s)';
        document.getElementById('progressBar').style.width = '0%';

        gameState.yourCards.forEach((card) => {
            card.isPlayedThisTurn = false;
            card.updateColor();
        });

        gameState.cardsPlayedThisTurn = [];
    }

    function handleMoveUndone(message) {
        if (message.playerId === currentPlayer.id) {
            const moveIndex = gameState.cardsPlayedThisTurn.findIndex(
                (move) =>
                    move.value === message.cardValue &&
                    move.position === message.position
            );

            if (moveIndex !== -1) {
                gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
            }

            updateStack(message.position, message.previousValue);

            const card = cardPool.get(message.cardValue, 0, 0, true, false);
            gameState.yourCards.push(card);
            updatePlayerCards(gameState.yourCards.map((c) => c.value));
        }
    }

    function handleGameOver(message, isError = false) {
        canvas.style.pointerEvents = 'none';
        endTurnButton.disabled = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const isVictory =
            !isError ||
            message.includes('Victoria') ||
            message.includes('ganan');

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';

        const title = isVictory ? '¡VICTORIA!' : '¡GAME OVER!';
        const titleColor = isVictory ? '#2ecc71' : '#e74c3c';

        gameAudio?.play(isVictory ? 'win' : 'gameover');

        gameOverDiv.innerHTML = `
        <h2 style="color: ${titleColor}">${title}</h2>
        <p>${message}</p>
        <div class="game-over-buttons">
            <button id="returnToRoom" class="game-over-btn" 
                    style="background-color: ${titleColor}">
                Volver a la Sala
            </button>
        </div>
    `;

        document.body.appendChild(backdrop);
        backdrop.appendChild(gameOverDiv);

        // Mostrar el backdrop con transición suave
        setTimeout(() => {
            backdrop.style.opacity = '1';
            gameOverDiv.style.transform = 'translateY(0)';
        }, 10);

        // Botón de retorno
        document
            .getElementById('returnToRoom')
            .addEventListener('click', async () => {
                gameAudio?.play('returnbutton');
                const button = document.getElementById('returnToRoom');
                button.disabled = true;
                button.textContent = 'Cargando...';

                resetGameState();

                socket.send(
                    JSON.stringify({
                        type: 'reset_room',
                        roomId: roomId,
                        playerId: currentPlayer.id,
                        resetHistory: true,
                    })
                );

                await new Promise((resolve) => setTimeout(resolve, 500));
                window.location.href = 'sala.html';
            });
    }

    function handleDeckUpdated(message) {
        gameState.remainingDeck = message.remaining;
        const isDeckEmpty = message.remaining === 0;

        const remainingDeckElement = document.getElementById('remainingDeck');
        if (remainingDeckElement) {
            remainingDeckElement.textContent = message.remaining;
        }

        updateGameInfo(isDeckEmpty);

        if (isDeckEmpty) {
            showNotification(
                '¡El mazo se ha agotado! Ahora solo necesitas jugar 1 carta por turno'
            );
        }
    }

    function updateGameState(newState) {
        if (!newState) return;

        if (newState.p) {
            const existingById = new Map(
                (gameState.players || []).map((p) => [p.id, p])
            );
            gameState.players = newState.p.map((player) => ({
                id: player.i,
                name: player.n || `Jugador_${player.i.slice(0, 4)}`,
                cardCount: player.c,
                isHost: player.h,
                cardsPlayedThisTurn: Number(player.s) || 0,
                totalCardsPlayed: Number(player.pt) || 0,
                avatarId:
                    player.a || existingById.get(player.i)?.avatarId || null,
                avatarUrl:
                    player.au || existingById.get(player.i)?.avatarUrl || null,
            }));
        }

        gameState.board = newState.b || gameState.board;
        gameState.currentTurn = newState.t || gameState.currentTurn;
        gameState.remainingDeck = newState.d || gameState.remainingDeck;
        gameState.initialCards = newState.i || gameState.initialCards;

        if (newState.y) {
            updatePlayerCards(newState.y);
        }

        updatePlayersPanel();
        updateGameInfo();
    }

    function updateGameInfo(deckEmpty = false) {
        const currentTurnElement = document.getElementById('currentTurn');
        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');
        const progressBarElement = document.getElementById('progressBar');

        if (
            !currentTurnElement ||
            !remainingDeckElement ||
            !progressTextElement ||
            !progressBarElement
        ) {
            setTimeout(() => updateGameInfo(deckEmpty), 100);
            return;
        }

        const currentPlayerObj = gameState.players.find(
            (p) => p.id === currentPlayer.id
        ) || {
            cardsPlayedThisTurn: 0,
            totalCardsPlayed: 0,
        };

        const minCardsRequired =
            deckEmpty || gameState.remainingDeck === 0 ? 1 : 2;
        const cardsPlayed = currentPlayerObj.cardsPlayedThisTurn || 0;

        currentTurnElement.textContent =
            gameState.currentTurn === currentPlayer.id
                ? 'Tu turno'
                : `Turno de ${gameState.players.find((p) => p.id === gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;

        if (endTurnButton) {
            endTurnButton.disabled = gameState.currentTurn !== currentPlayer.id;
            const remainingCards = minCardsRequired - cardsPlayed;
            endTurnButton.title =
                remainingCards > 0
                    ? `Necesitas jugar ${remainingCards} carta(s) más${deckEmpty ? ' (Mazo vacío)' : ''}`
                    : 'Puedes terminar tu turno';
            endTurnButton.classList.toggle(
                'is-ready',
                cardsPlayed >= minCardsRequired
            );
        }
    }

    function handleOpponentCardPlayed(message) {
        playBoardMoveSound(
            message.cardValue,
            message.position,
            message.previousValue,
            typeof message.isSpecialMove === 'boolean'
                ? message.isSpecialMove
                : null
        );
        if (message.isSpecialMove === true) {
            registerSpecialMoveEffect(message.position, message.cardValue);
        }
        if (message.playerId !== currentPlayer.id) {
            updateStack(message.position, message.cardValue);
            recordCardPlayed(
                message.cardValue,
                message.position,
                message.playerId,
                message.previousValue
            );
            addToHistory(message.position, message.cardValue);
            showNotification(
                `${message.playerName || 'Un jugador'} jugó un ${message.cardValue}`
            );
        }

        if (gameState.currentTurn === currentPlayer.id) {
            const currentPlayerObj = gameState.players.find(
                (p) => p.id === currentPlayer.id
            );
            if (currentPlayerObj) {
                currentPlayerObj.cardsPlayedThisTurn =
                    (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
                updateGameInfo();
            }
        }
    }

    function updatePlayerCards(cards) {
        const isYourTurn = isMyTurn();
        const deckEmpty = gameState.remainingDeck === 0;
        const startX =
            (canvas.width - cards.length * (CARD_WIDTH + CARD_SPACING)) / 2;
        const startY = PLAYER_CARDS_Y;

        const newCards = cards.map((cardValue, index) => {
            const existingCard = gameState.yourCards.find(
                (c) => c.value === cardValue && !c.isDragging
            );

            if (existingCard) {
                existingCard.x = startX + index * (CARD_WIDTH + CARD_SPACING);
                existingCard.y = startY;
                existingCard.isPlayable =
                    isYourTurn &&
                    (deckEmpty
                        ? cardValue === gameState.board.ascending[0] - 10 ||
                        cardValue === gameState.board.ascending[1] - 10 ||
                        cardValue === gameState.board.descending[0] + 10 ||
                        cardValue === gameState.board.descending[1] + 10 ||
                        cardValue > gameState.board.ascending[0] ||
                        cardValue > gameState.board.ascending[1] ||
                        cardValue < gameState.board.descending[0] ||
                        cardValue < gameState.board.descending[1]
                        : isValidMove(cardValue, 'asc1') ||
                        isValidMove(cardValue, 'asc2') ||
                        isValidMove(cardValue, 'desc1') ||
                        isValidMove(cardValue, 'desc2'));
                existingCard.isPlayedThisTurn =
                    gameState.cardsPlayedThisTurn.some(
                        (move) =>
                            move.value === cardValue &&
                            move.playerId === currentPlayer.id
                    );
                return existingCard;
            } else {
                return cardPool.get(
                    cardValue,
                    startX + index * (CARD_WIDTH + CARD_SPACING),
                    startY,
                    isYourTurn &&
                    (deckEmpty
                        ? cardValue === gameState.board.ascending[0] - 10 ||
                        cardValue === gameState.board.ascending[1] - 10 ||
                        cardValue ===
                        gameState.board.descending[0] + 10 ||
                        cardValue ===
                        gameState.board.descending[1] + 10 ||
                        cardValue > gameState.board.ascending[0] ||
                        cardValue > gameState.board.ascending[1] ||
                        cardValue < gameState.board.descending[0] ||
                        cardValue < gameState.board.descending[1]
                        : isValidMove(cardValue, 'asc1') ||
                        isValidMove(cardValue, 'asc2') ||
                        isValidMove(cardValue, 'desc1') ||
                        isValidMove(cardValue, 'desc2')),
                    gameState.cardsPlayedThisTurn.some(
                        (move) =>
                            move.value === cardValue &&
                            move.playerId === currentPlayer.id
                    )
                );
            }
        });

        gameState.yourCards = newCards;

        if (dragStartCard) {
            const dragCardIndex = gameState.yourCards.findIndex(
                (c) => c === dragStartCard
            );
            if (dragCardIndex === -1) {
                gameState.yourCards.push(dragStartCard);
            }
        }
    }

    function updateColumnHistoryUI(column, history) {
        if (!gameState.columnHistory[column]) {
            gameState.columnHistory[column] = column.includes('asc')
                ? [1]
                : [100];
        }
        gameState.columnHistory[column] = history;
    }

    function drawHistoryIcons() {
        if (!historyIcon.complete || historyIcon.naturalWidth === 0) return;

        const shouldAnimate = isMyTurn();
        const pulseProgress = shouldAnimate ? calculatePulseProgress() : 0;

        gameState.historyIconAreas = [];

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const baseX =
                BOARD_POSITION.x +
                (CARD_WIDTH + COLUMN_SPACING) * i +
                CARD_WIDTH / 2 -
                20;
            const baseY = HISTORY_ICON_Y;

            gameState.historyIconAreas.push({
                x: baseX,
                y: baseY,
                width: 40,
                height: 40,
                column: col,
            });

            const scale = shouldAnimate ? 1 + 0.2 * pulseProgress : 1;

            ctx.save();
            ctx.translate(baseX + 20, baseY + 20);
            ctx.scale(scale, scale);
            ctx.translate(-20, -20);
            ctx.drawImage(historyIcon, 0, 0, 40, 40);
            ctx.restore();
        });
    }

    function handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (gameState.historyIconAreas) {
            for (const area of gameState.historyIconAreas) {
                if (
                    x >= area.x &&
                    x <= area.x + area.width &&
                    y >= area.y &&
                    y <= area.y + area.height
                ) {
                    showColumnHistory(area.column);
                    return;
                }
            }
        }
    }

    function handleTouchAsClick(e) {
        e.preventDefault();
        if (e.touches && e.touches.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const fakeClick = new MouseEvent('click', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true,
                cancelable: true,
                view: window,
            });

            if (gameState.historyIconAreas) {
                for (const area of gameState.historyIconAreas) {
                    if (
                        x >= area.x &&
                        x <= area.x + area.width &&
                        y >= area.y &&
                        y <= area.y + area.height
                    ) {
                        showColumnHistory(area.column);
                        return;
                    }
                }
            }

            handleTouchStart(e);
        }
    }

    function calculatePulseProgress() {
        const now = Date.now();
        const timeSinceLastPulse =
            (now - historyIconsAnimation.lastPulseTime) %
            HISTORY_ICON_PULSE_INTERVAL;
        return isMyTurn() && timeSinceLastPulse < HISTORY_ICON_PULSE_DURATION
            ? Math.sin(
                (timeSinceLastPulse / HISTORY_ICON_PULSE_DURATION) * Math.PI
            )
            : 0;
    }

    function handleMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        startDrag(x, y);
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        startDrag(x, y);
    }

    function startDrag(x, y) {
        const clickedCard = gameState.yourCards.find((card) =>
            card.contains(x, y)
        );
        if (clickedCard && clickedCard.isPlayable && isMyTurn()) {
            dragStartCard = clickedCard;
            dragStartX = x;
            dragStartY = y;
            isDragging = true;
            dragStartCard.startDrag(x - dragStartCard.x, y - dragStartCard.y);
        }
    }

    function handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        updateDrag(x, y);
    }

    function handleTouchMove(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        updateDrag(x, y);
    }

    function updateDrag(x, y) {
        if (isDragging && dragStartCard) {
            dragStartCard.updateDragPosition(x, y);
        }
    }

    function handleMouseUp(e) {
        endDrag(e);
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        if (e.changedTouches.length > 0) {
            const fakeMouseEvent = new MouseEvent('mouseup', {
                clientX: e.changedTouches[0].clientX,
                clientY: e.changedTouches[0].clientY,
            });
            endDrag(fakeMouseEvent);
        }
    }

    function endDrag(e) {
        if (!isDragging || !dragStartCard) return;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e instanceof MouseEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.changedTouches?.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            resetCardPosition();
            return;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const targetColumn = getClickedColumn(x, y);
        if (targetColumn && isValidMove(dragStartCard.value, targetColumn)) {
            playCard(dragStartCard.value, targetColumn);
        } else {
            if (targetColumn) {
                animateInvalidCard(dragStartCard);
                showNotification('Movimiento no válido', true);
            }
            resetCardPosition();
        }

        if (dragStartCard) {
            dragStartCard.endDrag();
        }
        dragStartCard = null;
        isDragging = false;
    }

    function resetCardPosition() {
        if (!dragStartCard) return;

        let cardIndex = gameState.yourCards.findIndex(
            (c) => c === dragStartCard
        );
        if (cardIndex === -1) {
            gameState.yourCards.push(dragStartCard);
            cardIndex = gameState.yourCards.length - 1;
        }

        const startX =
            (canvas.width -
                gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING)) /
            2 +
            cardIndex * (CARD_WIDTH + CARD_SPACING);

        if (!dragStartCard) return;

        const animation = {
            card: dragStartCard,
            startTime: Date.now(),
            duration: 150,
            targetX: startX,
            targetY: PLAYER_CARDS_Y,
            fromX: dragStartCard.x,
            fromY: dragStartCard.y,
            onComplete: () => {
                if (dragStartCard) {
                    dragStartCard.x = startX;
                    dragStartCard.y = PLAYER_CARDS_Y;
                    dragStartCard.isDragging = false;
                }
                updatePlayerCards(gameState.yourCards.map((c) => c.value));
            },
        };

        gameState.animatingCards.push(animation);
    }

    function getClickedColumn(x, y) {
        if (y < BOARD_POSITION.y || y > BOARD_POSITION.y + CARD_HEIGHT)
            return null;

        const columns = [
            { x: BOARD_POSITION.x, id: 'asc1' },
            { x: BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, id: 'asc2' },
            {
                x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2,
                id: 'desc1',
            },
            {
                x: BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3,
                id: 'desc2',
            },
        ];

        const column = columns.find(
            (col) => x >= col.x && x <= col.x + CARD_WIDTH
        );
        return column ? column.id : null;
    }

    function playCard(cardValue, position) {
        if (!dragStartCard) return;

        const previousValue = getStackValue(position);

        updateStack(position, cardValue);

        const cardIndex = gameState.yourCards.findIndex(
            (c) => c === dragStartCard
        );
        if (cardIndex !== -1) {
            gameState.yourCards.splice(cardIndex, 1);
        }

        socket.send(
            JSON.stringify({
                type: 'play_card',
                playerId: currentPlayer.id,
                roomId: roomId,
                cardValue: cardValue,
                position: position,
                previousValue: previousValue,
                isFirstMove: gameState.cardsPlayedThisTurn.length === 0,
            })
        );

        updateGameInfo();
        updateCardsPlayedUI();
    }

    function updateCardsPlayedUI() {
        const currentPlayerCardsPlayed = gameState.cardsPlayedThisTurn.filter(
            (card) => card.playerId === currentPlayer.id
        ).length;

        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent =
            `${currentPlayerCardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;

        const progressPercentage = Math.min(
            (currentPlayerCardsPlayed / minCardsRequired) * 100,
            100
        );
        document.getElementById('progressBar').style.width =
            `${progressPercentage}%`;
    }

    function hasValidMoves(cards, board) {
        if (GAME_RULES && typeof GAME_RULES.getPlayableCards === 'function') {
            const values = cards.map((card) => card.value);
            return GAME_RULES.getPlayableCards(values, board).length > 0;
        }
        return cards.some((card) => {
            return ['asc1', 'asc2', 'desc1', 'desc2'].some((pos) => {
                const posValue = pos.includes('asc')
                    ? pos === 'asc1'
                        ? board.ascending[0]
                        : board.ascending[1]
                    : pos === 'desc1'
                        ? board.descending[0]
                        : board.descending[1];

                const isValid = pos.includes('asc')
                    ? card.value > posValue || card.value === posValue - 10
                    : card.value < posValue || card.value === posValue + 10;

                return isValid;
            });
        });
    }

    function endTurn() {
        const currentPlayerObj = gameState.players.find(
            (p) => p.id === currentPlayer.id
        );
        const cardsPlayed = currentPlayerObj?.cardsPlayedThisTurn || 0;
        const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;

        if (cardsPlayed < minCardsRequired) {
            const remainingCards = minCardsRequired - cardsPlayed;
            showNotification(
                `Necesitas jugar ${remainingCards} carta(s) más para terminar tu turno`,
                true
            );
            return;
        }

        gameState.yourCards.forEach((card) => {
            card.isPlayedThisTurn = false;
            card.updateColor();
        });

        gameAudio?.play('draw');

        socket.send(
            JSON.stringify({
                type: 'end_turn',
                playerId: currentPlayer.id,
                roomId: roomId,
            })
        );

        updateGameInfo();
    }

    function drawBoard() {
        ctx.clearRect(
            BOARD_POSITION.x - 30,
            BOARD_POSITION.y - 55,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 60,
            CARD_HEIGHT + 120
        );

        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.roundRect(
            BOARD_POSITION.x - 25,
            BOARD_POSITION.y - 50,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 50,
            CARD_HEIGHT + 110,
            15
        );
        ctx.fill();

        if (isDragging && dragStartCard) {
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = isValidMove(dragStartCard.value, col);
                const x = BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i;

                ctx.fillStyle = isValid
                    ? 'rgb(67, 64, 250)'
                    : 'rgb(248, 51, 51)';
                ctx.beginPath();
                ctx.roundRect(
                    x - 5,
                    BOARD_POSITION.y - 10,
                    CARD_WIDTH + 10,
                    CARD_HEIGHT + 20,
                    15
                );
                ctx.fill();
            });
        }

        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x =
                BOARD_POSITION.x +
                (CARD_WIDTH + COLUMN_SPACING) * i +
                CARD_WIDTH / 2;
            ctx.fillText(i < 2 ? '↑' : '↓', x, BOARD_POSITION.y - 25);
        });

        ctx.shadowColor = 'transparent';

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const isColumnAnimating = gameState.animatingCards.some(
                (anim) => anim.column === col
            );

            if (!isColumnAnimating) {
                const value =
                    i < 2
                        ? gameState.board.ascending[i % 2]
                        : gameState.board.descending[i % 2];
                const wasPlayedThisTurn = gameState.cardsPlayedThisTurn.some(
                    (move) => move.value === value && move.position === col
                );

                const card = cardPool.get(
                    value,
                    BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * i,
                    BOARD_POSITION.y,
                    false,
                    wasPlayedThisTurn
                );
                card.draw();
                renderSpecialMoveEffect(card, col);
            }
        });

        handleCardAnimations();
        drawHistoryIcons();

    }

    function drawPlayerCards() {
        const backgroundHeight = CARD_HEIGHT + 30;
        const backgroundWidth =
            gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING) + 40;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.roundRect(
            (canvas.width - backgroundWidth) / 2,
            PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        ctx.fill();
        markDirty(
            (canvas.width - backgroundWidth) / 2,
            PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight
        );

        gameState.yourCards.forEach((card, index) => {
            if (card && card !== dragStartCard) {
                card.x =
                    (canvas.width -
                        gameState.yourCards.length *
                        (CARD_WIDTH + CARD_SPACING)) /
                    2 +
                    index * (CARD_WIDTH + CARD_SPACING);
                card.y = PLAYER_CARDS_Y;
                card.draw();
            }
        });
    }

    function createPlayersPanel() {
        const panel = document.createElement('div');
        panel.id = 'playersPanel';
        panel.className = 'players-panel';
        document.body.appendChild(panel);
        return panel;
    }

    function updatePlayersPanel() {
        const panel =
            document.getElementById('playersPanel') || createPlayersPanel();
        const toggleLabel = isPlayersPanelCollapsed ? '\u{1F464}' : '-';
        const toggleTitle = isPlayersPanelCollapsed
            ? 'Mostrar jugadores'
            : 'Minimizar jugadores';

        panel.classList.toggle('is-collapsed', isPlayersPanelCollapsed);
        panel.innerHTML = `
            <div class="players-panel-header">
                <h3>Jugadores (${gameState.players.length})</h3>
                <button
                    type="button"
                    class="emoji-panel-toggle players-panel-toggle"
                    aria-expanded="${String(!isPlayersPanelCollapsed)}"
                    aria-label="${toggleTitle}"
                    title="${toggleTitle}"
                >${toggleLabel}</button>
            </div>
            <ul>
                ${gameState.players
                .map((player) => {
                    const displayName =
                        player.name || `Jugador_${player.id.slice(0, 4)}`;
                    const cardCount =
                        player.cardCount ||
                        (player.cards ? player.cards.length : 0);
                    const avatarSpan = getAvatarMarkup(
                        player.avatarId,
                        player.avatarUrl
                    );

                    return `
                        <li class="${player.id === currentPlayer.id ? 'you' : ''} 
                                   ${player.id === gameState.currentTurn ? 'current-turn' : ''}">
                            ${avatarSpan}<span class="player-name">${displayName}</span>
                            <span class="card-count">🃏 ${cardCount}</span>
                            ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                        </li>
                    `;
                })
                .join('')}
            </ul>
        `;

        const toggle = panel.querySelector('.players-panel-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                isPlayersPanelCollapsed = !isPlayersPanelCollapsed;
                updatePlayersPanel();
            });
        }

        applyHudPanelLayout();
        setupHudLayoutObservers();
        ensureEmojiMessagesContainer();
        positionEmojiMessages();
    }

    function handleCardAnimations() {
        const now = Date.now();

        for (let i = gameState.animatingCards.length - 1; i >= 0; i--) {
            const anim = gameState.animatingCards[i];
            if (!anim.newCard || !anim.currentCard) {
                gameState.animatingCards.splice(i, 1);
                continue;
            }

            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            const easedProgress = progress * progress;

            anim.newCard.y =
                -CARD_HEIGHT + (anim.targetY - -CARD_HEIGHT) * easedProgress;

            ctx.save();

            anim.currentCard.draw();

            ctx.shadowColor = 'rgba(0, 100, 255, 0.7)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 5;
            anim.newCard.draw();
            renderSpecialMoveEffect(anim.newCard, anim.column);

            ctx.restore();

            if (progress === 1) {
                if (anim.onComplete) anim.onComplete();
                gameState.animatingCards.splice(i, 1);
                updateGameInfo();
            }
        }
    }

    function handleAnimatedCardPlay(message) {
        const position = message.position;
        const value = message.cardValue;
        const previousValue =
            message.previousValue ?? getStackValue(position);

        // update board immediately for everyone
        updateStack(position, value);
        playBoardMoveSound(
            value,
            position,
            previousValue,
            typeof message.isSpecialMove === 'boolean'
                ? message.isSpecialMove
                : null
        );
        if (message.isSpecialMove === true) {
            registerSpecialMoveEffect(position, value);
        }
        if (message.playerId !== currentPlayer.id && !isMyTurn()) {
            const targetPos = getColumnPosition(position);

            const animation = {
                newCard: cardPool.get(
                    value,
                    targetPos.x,
                    -CARD_HEIGHT,
                    false,
                    true
                ),
                currentCard: cardPool.get(
                    previousValue,
                    targetPos.x,
                    targetPos.y,
                    false,
                    false
                ),
                startTime: Date.now(),
                duration: 150,
                targetX: targetPos.x,
                targetY: targetPos.y,
                fromY: -CARD_HEIGHT,
                column: position,
                onComplete: () => {
                    showNotification(`${message.playerName} jugó un ${value}`);
                },
            };

            gameState.animatingCards.push(animation);
        } else {
            // Nueva verificación de condición de derrota local
            const minCardsRequired = gameState.remainingDeck > 0 ? 2 : 1;
            if (minCardsRequired === 2 && message.cardsPlayedThisTurn === 1) {
                const playableCards = gameState.yourCards.filter((card) => {
                    return ['asc1', 'asc2', 'desc1', 'desc2'].some((pos) => {
                        const posValue = pos.includes('asc')
                            ? pos === 'asc1'
                                ? gameState.board.ascending[0]
                                : gameState.board.ascending[1]
                            : pos === 'desc1'
                                ? gameState.board.descending[0]
                                : gameState.board.descending[1];

                        return pos.includes('asc')
                            ? card.value > posValue ||
                            card.value === posValue - 10
                            : card.value < posValue ||
                            card.value === posValue + 10;
                    });
                });

                if (playableCards.length === 0) {
                    // Mostrar mensaje de advertencia mientras el servidor procesa la condición
                    showNotification(
                        '¡No puedes jugar la segunda carta requerida!',
                        true
                    );
                }
            }
        }

        recordCardPlayed(value, position, message.playerId, previousValue);

        // Actualizar UI después de jugar carta
        updateGameInfo();
        updateCardsPlayedUI();
    }

    function gameLoop(timestamp) {
        if (timestamp - lastRenderTime < 1000 / TARGET_FPS) {
            animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        if (dirtyAreas.length > 0 || needsRedraw) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1a6b1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            clearDirtyAreas();
            needsRedraw = false;
        }

        drawBoard();
        drawHistoryIcons();
        handleCardAnimations();
        drawPlayerCards();

        if (isDragging && dragStartCard) {
            dragStartCard.draw();
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    }

    function cleanup() {
        // Clear game state
        gameState.animatingCards = [];
        animationQueue = [];
        dirtyAreas = [];

        // Clean up drag state
        if (dragStartCard) {
            dragStartCard.endDrag();
            dragStartCard = null;
        }
        isDragging = false;

        // Clear timers and animation frames
        clearInterval(historyIconsAnimation.interval);
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        cancelAnimationFrame(animationFrameId);

        // Close WebSocket properly
        if (socket) {
            socket.onopen =
                socket.onmessage =
                socket.onclose =
                socket.onerror =
                null;
            if (socket.readyState === WebSocket.OPEN) {
                socket.close(1000, 'Juego terminado');
            }
            socket = null;
        }

        // Remove canvas event listeners
        const events = {
            click: handleCanvasClick,
            mousedown: handleMouseDown,
            mousemove: handleMouseMove,
            mouseup: handleMouseUp,
            mouseleave: handleMouseUp,
            touchstart: handleTouchStart,
            touchmove: handleTouchMove,
            touchend: handleTouchEnd,
        };

        Object.entries(events).forEach(([event, handler]) => {
            canvas.removeEventListener(event, handler);
        });

        // Remove UI event listeners
        document
            .getElementById('endTurnBtn')
            ?.removeEventListener('click', endTurn);
        document
            .getElementById('modalBackdrop')
            ?.removeEventListener('click', closeHistoryModal);

        // Remove emoji button listeners
        if (emojiButtonsContainer) {
            emojiButtonsContainer.removeEventListener('click', (event) => { });
        }

        // Remove all temporary DOM elements
        document
            .querySelectorAll('.notification, .game-over-backdrop')
            .forEach((el) => el.remove());

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Clear memory caches
        assetCache.clear();
        cardPool.pool = [];
    }

    function initGame() {
        if (!canvas || !ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        // Mostrar la pantalla de carga
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.classList.remove('hidden');
        }
        gameAudio?.play('startbutton');

        Promise.all([
            loadAsset('/assets/cards-icon.png')
                .then((img) => {
                    if (img) historyIcon = img;
                })
                .catch((err) => {
                    log('Error loading history icon', err);
                    return null; // continuar aunque falle
                }),
        ])
            .then(() => {
                applyResponsiveCanvasSizing();

                canvas.addEventListener('click', handleCanvasClick);
                canvas.addEventListener('mousedown', handleMouseDown);
                canvas.addEventListener('mousemove', handleMouseMove);
                canvas.addEventListener('mouseup', handleMouseUp);
                canvas.addEventListener('mouseleave', handleMouseUp);

                canvas.addEventListener('touchstart', handleTouchAsClick, {
                    passive: false,
                });
                canvas.addEventListener('touchmove', handleTouchMove);
                canvas.addEventListener('touchend', handleTouchEnd);

                endTurnButton.addEventListener('click', endTurn);
                document
                    .getElementById('modalBackdrop')
                    .addEventListener('click', closeHistoryModal);
                window.addEventListener('beforeunload', cleanup);

                const controlsDiv = document.querySelector('.game-controls');
                if (controlsDiv) {
                    controlsDiv.style.bottom = `${canvas.height - BUTTONS_Y}px`;
                }

                historyIconsAnimation = {
                    interval: null,
                    lastPulseTime: Date.now(),
                    pulseDuration: 500,
                    pulseInterval: 20000,
                };

                setupInfoPanelToggle();
                setupEmojiPanelToggle();
                applyHudPanelLayout();
                setupHudLayoutObservers();
                updateEmojiPanelPosition();

                // configurar botones de emoji si existen
                if (emojiButtonsContainer) {
                    emojiButtonsContainer.addEventListener('click', (event) => {
                        const target = event.target;
                        if (!(target instanceof HTMLElement)) return;
                        const emojiCode = target.dataset.emoji;
                        if (!emojiCode) return;
                        if (!socket || socket.readyState !== WebSocket.OPEN) {
                            showEmojiSendErrorNotification();
                            return;
                        }

                        socket.send(
                            JSON.stringify({
                                type: 'emoji_reaction',
                                emoji: emojiCode,
                                roomId,
                                playerId: currentPlayer.id,
                            })
                        );
                    });
                }

                connectWebSocket();

                setTimeout(() => {
                    updatePlayersPanel();
                }, 1000);
                gameLoop();

                // Ocultar la pantalla de carga después de 5 segundos
                setTimeout(() => {
                    if (loadingScreen) {
                        loadingScreen.classList.add('hidden');
                    }
                }, 5000);
            })
            .catch((err) => {
                log('Error initializing game', err);
                showNotification(
                    'Error al cargar los recursos del juego',
                    true
                );
                // Ocultar pantalla de carga en caso de error
                if (loadingScreen) {
                    loadingScreen.classList.add('hidden');
                }
                // Intentar conectar de todas formas
                connectWebSocket();
            });
    }

    initGame();
});









