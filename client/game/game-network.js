import { GameCore } from './game-core.js';

export class GameNetwork {
    constructor(gameCore) {
        if (!gameCore || typeof gameCore.isMyTurn !== 'function') {
            throw new Error('GameCore inválido: falta método isMyTurn');
        }
        this.gameCore = gameCore;
        this.gameState = this.gameCore.gameState;
        this.handleTurnChanged = this.handleTurnChanged.bind(this);

    }

    connectWebSocket() {
        if (this.gameCore.reconnectAttempts >= this.gameCore.MAX_RECONNECT_ATTEMPTS) {
            this.showNotification('No se puede conectar al servidor. Recarga la página.', true);
            this.updateConnectionStatus('Desconectado', true);
            return;
        }

        this.updateConnectionStatus('Conectando...');

        if (this.gameCore.socket) {
            this.gameCore.socket.onopen = this.gameCore.socket.onmessage =
                this.gameCore.socket.onclose = this.gameCore.socket.onerror = null;
            if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.gameCore.socket.readyState)) {
                this.gameCore.socket.close();
            }
        }

        this.gameCore.socket = new WebSocket(`${this.gameCore.WS_URL}?roomId=${this.gameCore.roomId}&playerId=${this.gameCore.currentPlayer.id}`);
        this.gameCore.socket.onopen = () => {
            clearTimeout(this.gameCore.reconnectTimeout);
            this.gameCore.reconnectAttempts = 0;
            this.updateConnectionStatus('Conectado');
            this.showNotification('Conectado al servidor');
            this.gameCore.socket.send(JSON.stringify({
                type: 'get_full_state',
                playerId: this.gameCore.currentPlayer.id,
                roomId: this.gameCore.roomId,
                requireCurrentState: true
            }));

            this.gameCore.socket.send(JSON.stringify({
                type: 'get_game_state',
                playerId: this.gameCore.currentPlayer.id,
                roomId: this.gameCore.roomId
            }));
        };

        this.gameCore.socket.onclose = (event) => {
            if (!event.wasClean && this.gameCore.reconnectAttempts < this.gameCore.MAX_RECONNECT_ATTEMPTS) {
                this.gameCore.reconnectAttempts++;
                const delay = Math.min(this.gameCore.RECONNECT_BASE_DELAY * Math.pow(2, this.gameCore.reconnectAttempts - 1), 30000);
                this.gameCore.reconnectTimeout = setTimeout(() => this.connectWebSocket(), delay);
                this.updateConnectionStatus(`Reconectando (${this.gameCore.reconnectAttempts}/${this.gameCore.MAX_RECONNECT_ATTEMPTS})...`);
                this.gameCore.connectionStatus = 'reconnecting';
            } else {
                this.updateConnectionStatus('Desconectado', true);
                this.gameCore.connectionStatus = 'disconnected';
            }
        };

        this.gameCore.socket.onerror = (error) => {
            this.gameCore.log('Error en WebSocket', error);
            this.updateConnectionStatus('Error de conexión', true);
            this.gameCore.connectionStatus = 'error';
        };

        this.gameCore.socket.onmessage = (event) => {
            try {
                const now = Date.now();
                const message = JSON.parse(event.data);
                if (!this.validateMessage(message)) return;

                if (!this.gameCore.ui) {
                    console.warn('UI not initialized yet, skipping message:', message.type);
                    return;
                }

                if (!message) return;

                if (message.errorCode === 'MISSING_REQUIRED_FIELDS') {
                    this.showNotification(`Error: ${message.message}`, true);
                    return;
                }

                if (message.type === 'player_state_update') {
                    this.handlePlayerStateUpdate(message);
                }

                if (message.type === 'pong') {
                    this.updateConnectionStatus('Conectado');
                    return;
                }

                if (message.type === 'gs' && now - this.gameCore.lastStateUpdate < this.gameCore.STATE_UPDATE_THROTTLE) {
                    return;
                }

                switch (message.type) {
                    case 'full_state_update': this.handleFullStateUpdate(message); break;
                    case 'init_game': this.handleInitGame(message); break;
                    case 'gs': this.handleGameStateUpdate(message); break;
                    case 'game_started': this.handleGameStarted(message); break;
                    case 'your_cards': this.updatePlayerCards(message.cards); break;
                    case 'game_over': this.handleGameOver(message.message, true); break;
                    case 'notification': this.showNotification(message.message, message.isError); break;
                    case 'column_history': this.updateColumnHistory(message); break;
                    case 'column_history_update': this.updateColumnHistoryUI(message.column, message.history); break;
                    case 'card_played': this.handleOpponentCardPlayed(message); break;
                    case 'card_played_animated': this.handleAnimatedCardPlay(message); break;
                    case 'deck_empty': this.handleDeckEmpty(); break;
                    case 'deck_updated': this.handleDeckUpdated(message); break;
                    case 'turn_changed': this.handleTurnChanged(message); break;
                    case 'deck_empty_state': this.handleDeckEmptyState(message); break;
                    case 'deck_empty_notification': this.showNotification(message.message, message.isError); break;
                    case 'move_undone': this.handleMoveUndone(message); break;
                    case 'room_reset': this.resetGameState(); break;
                    case 'player_update': this.handlePlayerUpdate(message); break;
                    default: this.gameCore.log('Mensaje no reconocido:', message);
                }
            } catch (error) {
                this.gameCore.log('Error procesando mensaje:', { error, data: event.data });
            }
        };
    }

    validateMessage(message) {
        if (!message || typeof message !== 'object') return null;
        if (!message.type || typeof message.type !== 'string') return null;
        return message;
    }

    handlePlayerStateUpdate(message) {
        const progressText = `${message.cardsPlayedThisTurn}/${message.minCardsRequired} carta(s) jugada(s)`;
        const progressPercentage = (message.cardsPlayedThisTurn / message.minCardsRequired) * 100;

        document.getElementById('progressText').textContent = progressText;
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;

        if (message.players) {
            this.gameState.players = message.players;
            if (this.gameCore.ui?.updatePlayersPanel) {
                this.gameCore.ui.updatePlayersPanel();
            }
        }
        this.gameState.currentTurn = message.currentTurn;
        this.updateGameInfo();
    }

    handleGameStateUpdate(message) {
        this.gameCore.lastStateUpdate = Date.now();
        this.updateGameState(message.s);
        this.updateGameInfo();
    }

    handleGameStarted(message) {
        this.gameState.board = message.board || { ascending: [1, 1], descending: [100, 100] };
        this.gameState.currentTurn = message.currentTurn;
        this.gameState.remainingDeck = message.remainingDeck;
        this.gameState.initialCards = message.initialCards;
        this.gameState.gameStarted = true;

        if (this.gameState.players) {
            this.gameState.players.forEach(player => {
                player.cardsPlayedThisTurn = 0;
            });
        }

        this.updateGameInfo();
        if (this.gameCore.ui?.updatePlayersPanel) {
            this.gameCore.ui.updatePlayersPanel();
        }
        if (window.location.pathname.endsWith('sala.html')) {
            window.location.href = 'game.html';
        }
    }

    updateColumnHistory(message) {
        this.gameState.columnHistory = {
            asc1: message.history.ascending1 || [1],
            asc2: message.history.ascending2 || [1],
            desc1: message.history.descending1 || [100],
            desc2: message.history.descending2 || [100]
        };
    }

    handleDeckEmpty() {
        this.gameState.remainingDeck = 0;

        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');

        if (remainingDeckElement) {
            remainingDeckElement.textContent = '0';
        }

        if (progressTextElement) {
            progressTextElement.textContent = '0/1 carta(s) jugada(s)';
        }

        this.updateGameInfo(true);
    }

    handleTurnChanged(message) {
        // Ensure gameState exists
        if (!this.gameState) {
            console.error('Game state not initialized');
            return;
        }

        // Reset cards played this turn
        this.gameState.cardsPlayedThisTurn = [];
        this.gameState.currentTurn = message.newTurn;

        // Update deck status if provided
        if (message.deckEmpty !== undefined) {
            this.gameState.remainingDeck = message.remainingDeck || this.gameState.remainingDeck;
            const remainingDeckElement = document.getElementById('remainingDeck');
            if (remainingDeckElement) {
                remainingDeckElement.textContent = this.gameState.remainingDeck;
            }

            const minCardsRequired = message.deckEmpty ? 1 : 2;
            const progressTextElement = document.getElementById('progressText');
            const progressBarElement = document.getElementById('progressBar');

            if (progressTextElement) {
                progressTextElement.textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
            }
            if (progressBarElement) {
                progressBarElement.style.width = '0%';
            }
        }

        // Update player cards if they exist
        if (this.gameState.yourCards) {
            this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        }

        // Show notification if player name is provided
        if (message.playerName) {
            // Safely check if it's the current player's turn
            const isCurrentPlayerTurn = this.gameCore?.currentPlayer?.id === message.newTurn;
            const notificationMsg = isCurrentPlayerTurn
                ? '¡Es tu turno!'
                : `Turno de ${message.playerName}`;
            this.showNotification(notificationMsg);
        }
    }

    handleDeckEmptyState(message) {
        this.gameState.remainingDeck = message.remaining;
        document.getElementById('remainingDeck').textContent = message.remaining;
        const minCardsRequired = message.minCardsRequired || 1;
        document.getElementById('progressText').textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
        document.getElementById('progressBar').style.width = '0%';
        this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        this.updateGameInfo();
    }

    handlePlayerUpdate(message) {
        if (message.players) {
            this.gameState.players = message.players;
            this.updateGameInfo();
        }
    }

    resetGameState() {
        this.gameState = {
            players: [],
            yourCards: [],
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: null,
            remainingDeck: 98,
            initialCards: 6,
            cardsPlayedThisTurn: [],
            animatingCards: [],
            columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] }
        };

        this.updateGameInfo();
    }

    restoreGameState() {
        if (!this.gameCore.socket || this.gameCore.socket.readyState !== WebSocket.OPEN) {
            setTimeout(() => this.restoreGameState(), 500);
            return;
        }

        this.gameCore.socket.send(JSON.stringify({
            type: 'get_player_state',
            playerId: this.gameCore.currentPlayer.id,
            roomId: this.gameCore.roomId
        }));
    }

    updateConnectionStatus(status, isError = false) {
        this.gameCore.connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus') || this.createConnectionStatusElement();
        statusElement.textContent = `Estado: ${status}`;
        statusElement.className = isError ? 'connection-error' : 'connection-status';
    }

    createConnectionStatusElement() {
        const panelContent = document.querySelector('.panel-content');
        const statusElement = document.createElement('p');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        const remainingDeckElement = document.getElementById('remainingDeck').parentNode;
        remainingDeckElement.parentNode.insertBefore(statusElement, remainingDeckElement.nextSibling);
        return statusElement;
    }

    handleFullStateUpdate(message) {
        if (!message.room || !message.gameState) return;

        if (message.history) {
            this.gameState.columnHistory = {
                asc1: message.history.ascending1 || [1],
                asc2: message.history.ascending2 || [1],
                desc1: message.history.descending1 || [100],
                desc2: message.history.descending2 || [100]
            };
        }

        this.gameState.board = message.gameState.board || this.gameState.board;
        this.gameState.currentTurn = message.gameState.currentTurn || this.gameState.currentTurn;
        this.gameState.remainingDeck = message.gameState.remainingDeck || this.gameState.remainingDeck;
        this.gameState.initialCards = message.gameState.initialCards || this.gameState.initialCards;
        this.gameState.players = message.room.players || this.gameState.players;

        if (this.gameCore.ui?.updatePlayersPanel) {
            this.gameCore.ui.updatePlayersPanel();
        }

        this.gameCore.ui.updatePlayersPanel();
        this.updateGameInfo();
    }

    handleInitGame(message) {
        // Asegurarse de que gameState existe
        this.gameState = this.gameState || {
            players: [],
            yourCards: [],
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: null,
            remainingDeck: 98,
            initialCards: 6,
            cardsPlayedThisTurn: [],
            animatingCards: [],
            columnHistory: { asc1: [1], asc2: [1], desc1: [100], desc2: [100] }
        };

        // Actualizar propiedades con valores del mensaje
        if (message.gameState) {
            this.gameState.currentTurn = message.gameState.currentTurn || null;
            this.gameState.board = message.gameState.board || this.gameState.board;
            this.gameState.remainingDeck = message.gameState.remainingDeck || 98;
            this.gameState.initialCards = message.gameState.initialCards || 6;
            this.gameState.gameStarted = message.gameState.gameStarted || false;
        }

        // Asegurar que players es un array
        this.gameState.players = message.players || [];

        // Historial de columnas
        this.gameState.columnHistory = {
            asc1: message.history?.ascending1 || [1],
            asc2: message.history?.ascending2 || [1],
            desc1: message.history?.descending1 || [100],
            desc2: message.history?.descending2 || [100]
        };

        // Actualizar cartas del jugador si el juego ha comenzado
        if (message.gameState?.gameStarted && message.yourCards) {
            this.updatePlayerCards(message.yourCards);
        }

        // Forzar actualización de la UI
        if (this.gameCore.ui?.updatePlayersPanel) {
            this.gameCore.ui.updatePlayersPanel();
        }
        this.updateGameInfo();
    }

    showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => existing.remove(), 300);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        notification.style.animation = 'notificationEnter 0.3s forwards';
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => notification.remove(), 300);
        }, isError || message.includes('GAME OVER') ? 3000 : 3000);
    }

    handleOpponentCardPlayed(message) {
        if (message.playerId !== this.currentPlayer.id) {
            this.updateStack(message.position, message.cardValue);
            this.recordCardPlayed(message.cardValue, message.position, message.playerId, message.previousValue);
            this.addToHistory(message.position, message.cardValue);
            this.showNotification(`${message.playerName || 'Un jugador'} jugó un ${message.cardValue}`);
        }

        if (this.gameState.currentTurn === this.currentPlayer.id) {
            const currentPlayerObj = this.gameState.players.find(p => p.id === this.currentPlayer.id);
            if (currentPlayerObj) {
                currentPlayerObj.cardsPlayedThisTurn = (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
                this.updateGameInfo();
            }
        }
    }

    updatePlayerCards(cards) {
        if (!cards || !Array.isArray(cards)) return;

        const isYourTurn = this.gameCore.isMyTurn();
        const deckEmpty = this.gameState.remainingDeck === 0;
        const startX = (this.gameCore.canvas.width - (cards.length * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING))) / 2;

        this.gameState.yourCards = cards.map((cardValue, index) => {
            return this.gameCore.cardPool.get(
                cardValue,
                startX + index * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING),
                this.gameCore.PLAYER_CARDS_Y,
                isYourTurn && this.canPlayCard(cardValue, deckEmpty),
                false
            );
        });
    }

    canPlayCard(cardValue, deckEmpty) {
        if (!this.gameState.board) return false;

        const { ascending, descending } = this.gameState.board;
        return deckEmpty ?
            (cardValue === ascending[0] - 10 || cardValue === ascending[1] - 10 ||
                cardValue === descending[0] + 10 || cardValue === descending[1] + 10 ||
                cardValue > ascending[0] || cardValue > ascending[1] ||
                cardValue < descending[0] || cardValue < descending[1]) :
            (this.gameCore.isValidMove(cardValue, 'asc1') || this.gameCore.isValidMove(cardValue, 'asc2') ||
                this.gameCore.isValidMove(cardValue, 'desc1') || this.gameCore.isValidMove(cardValue, 'desc2'));
    }


    updateColumnHistoryUI(column, history) {
        if (!this.gameState.columnHistory[column]) {
            this.gameState.columnHistory[column] = column.includes('asc') ? [1] : [100];
        }
        this.gameState.columnHistory[column] = history;
    }

    handleAnimatedCardPlay(message) {
        const position = message.position;
        const value = message.cardValue;
        const previousValue = this.getStackValue(position);

        if (message.playerId !== this.currentPlayer.id && !this.isMyTurn()) {
            const targetPos = this.getColumnPosition(position);

            const animation = {
                newCard: this.cardPool.get(value, targetPos.x, -this.CARD_HEIGHT, false, true),
                currentCard: this.cardPool.get(previousValue, targetPos.x, targetPos.y, false, false),
                startTime: Date.now(),
                duration: 300,
                targetX: targetPos.x,
                targetY: targetPos.y,
                fromY: -this.CARD_HEIGHT,
                column: position,
                onComplete: () => {
                    this.updateStack(position, value);
                    this.showNotification(`${message.playerName} jugó un ${value}`);
                }
            };

            this.gameState.animatingCards.push(animation);
        } else {
            this.updateStack(position, value);

            const minCardsRequired = this.gameState.remainingDeck > 0 ? 2 : 1;
            if (minCardsRequired === 2 && message.cardsPlayedThisTurn === 1) {
                const playableCards = this.gameState.yourCards.filter(card => {
                    return ['asc1', 'asc2', 'desc1', 'desc2'].some(pos => {
                        const posValue = pos.includes('asc')
                            ? (pos === 'asc1' ? this.gameState.board.ascending[0] : this.gameState.board.ascending[1])
                            : (pos === 'desc1' ? this.gameState.board.descending[0] : this.gameState.board.descending[1]);

                        return pos.includes('asc')
                            ? (card.value > posValue || card.value === posValue - 10)
                            : (card.value < posValue || card.value === posValue + 10);
                    });
                });

                if (playableCards.length === 0) {
                    this.showNotification('¡No puedes jugar la segunda carta requerida!', true);
                }
            }
        }

        this.recordCardPlayed(value, position, message.playerId, previousValue);
        this.updateGameInfo();
        this.updateCardsPlayedUI();
    }

    handleDeckUpdated(message) {
        this.gameState.remainingDeck = message.remaining;
        const isDeckEmpty = message.remaining === 0;

        const remainingDeckElement = document.getElementById('remainingDeck');
        if (remainingDeckElement) {
            remainingDeckElement.textContent = message.remaining;
        }

        this.updateGameInfo(isDeckEmpty);

        if (isDeckEmpty) {
            this.showNotification('¡El mazo se ha agotado! Ahora solo necesitas jugar 1 carta por turno');
        }
    }

    updateGameState(newState) {
        if (!newState) return;

        if (newState.p) {
            this.gameState.players = newState.p.map(player => ({
                id: player.i,
                name: player.n || `Jugador_${player.i.slice(0, 4)}`,
                cardCount: player.c,
                isHost: player.h,
                cardsPlayedThisTurn: Number(player.s) || 0,
                totalCardsPlayed: Number(player.pt) || 0
            }));
        }

        this.gameState.board = newState.b || this.gameState.board;
        this.gameState.currentTurn = newState.t || this.gameState.currentTurn;
        this.gameState.remainingDeck = newState.d || this.gameState.remainingDeck;
        this.gameState.initialCards = newState.i || this.gameState.initialCards;

        if (newState.y) {
            this.updatePlayerCards(newState.y);
        }

        if (this.gameCore.ui?.updatePlayersPanel) {
            this.gameCore.ui.updatePlayersPanel();
        }
        this.updateGameInfo();
    }

    updateGameInfo(deckEmpty = false) {
        // Safely get all elements with null checks
        const currentTurnElement = document.getElementById('currentTurn');
        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');
        const progressBarElement = document.getElementById('progressBar');

        // If any element is missing, try again later
        if (!currentTurnElement || !remainingDeckElement ||
            !progressTextElement || !progressBarElement) {
            setTimeout(() => this.updateGameInfo(deckEmpty), 100);
            return;
        }

        // Verify gameState and players are defined
        if (!this.gameState || !this.gameState.players) {
            console.error('gameState not initialized correctly');
            return;
        }

        const currentPlayerObj = this.gameState.players.find(p => p.id === this.gameCore.currentPlayer.id) || {
            cardsPlayedThisTurn: 0,
            totalCardsPlayed: 0
        };

        const minCardsRequired = deckEmpty || this.gameState.remainingDeck === 0 ? 1 : 2;
        const cardsPlayed = currentPlayerObj.cardsPlayedThisTurn || 0;

        currentTurnElement.textContent = this.gameState.currentTurn === this.gameCore.currentPlayer.id
            ? 'Tu turno'
            : `Turno de ${this.gameState.players.find(p => p.id === this.gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = this.gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;
    }

    updateCardsPlayedUI() {
        const currentPlayerCardsPlayed = this.gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === this.currentPlayer.id
        ).length;

        const minCardsRequired = this.gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent =
            `${currentPlayerCardsPlayed + 1}/${minCardsRequired} carta(s) jugada(s)`;

        const progressPercentage = Math.min(((currentPlayerCardsPlayed + 1) / minCardsRequired) * 100, 100);
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;
    }

    handleMoveUndone(message) {
        if (message.playerId === this.currentPlayer.id) {
            const moveIndex = this.gameState.cardsPlayedThisTurn.findIndex(
                move => move.value === message.cardValue && move.position === message.position
            );

            if (moveIndex !== -1) {
                this.gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
            }

            this.updateStack(message.position, message.previousValue);

            const card = this.cardPool.get(message.cardValue, 0, 0, true, false);
            this.gameState.yourCards.push(card);
            this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        }
    }

    handleGameOver(message, isError = false) {
        this.canvas.style.pointerEvents = 'none';
        this.endTurnButton.disabled = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const isVictory = !isError || message.includes('Victoria') || message.includes('ganan');

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';

        const title = isVictory ? '¡VICTORIA!' : '¡GAME OVER!';
        const titleColor = isVictory ? '#2ecc71' : '#e74c3c';

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

        setTimeout(() => {
            backdrop.style.opacity = '1';
            gameOverDiv.style.transform = 'translateY(0)';
        }, 10);

        document.getElementById('returnToRoom').addEventListener('click', async () => {
            const button = document.getElementById('returnToRoom');
            button.disabled = true;
            button.textContent = 'Cargando...';

            this.resetGameState();

            this.gameCore.socket.send(JSON.stringify({
                type: 'reset_room',
                roomId: this.gameCore.roomId,
                playerId: this.gameCore.currentPlayer.id,
                resetHistory: true
            }));

            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.href = 'sala.html';
        });
    }
}