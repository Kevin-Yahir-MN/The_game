import { STATE_UPDATE_THROTTLE, HISTORY_ICON_PULSE_INTERVAL, HISTORY_ICON_PULSE_DURATION } from '../core/Constants.js';

export class MessageHandler {
    constructor(gameState, renderer, notificationManager, webSocketManager) {
        this.gameState = gameState;
        this.renderer = renderer;
        this.notificationManager = notificationManager;
        this.webSocketManager = webSocketManager;
        this.lastStateUpdate = 0;
    }

    handleMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (!message.type || typeof message.type !== 'string') return;

        if (message.errorCode === 'MISSING_REQUIRED_FIELDS') {
            this.notificationManager.showNotification(`Error: ${message.message}`, true);
            return;
        }

        const now = Date.now();
        if (message.type === 'gs' && now - this.lastStateUpdate < STATE_UPDATE_THROTTLE) {
            return;
        }

        switch (message.type) {
            case 'player_state_update': this.handlePlayerStateUpdate(message); break;
            case 'full_state_update': this.handleFullStateUpdate(message); break;
            case 'init_game': this.handleInitGame(message); break;
            case 'gs': this.handleGameStateUpdate(message); break;
            case 'game_started': this.handleGameStarted(message); break;
            case 'your_cards': this.updatePlayerCards(message.cards); break;
            case 'game_over': this.handleGameOver(message.message, true); break;
            case 'notification': this.notificationManager.showNotification(message.message, message.isError); break;
            case 'column_history': this.updateColumnHistory(message); break;
            case 'column_history_update': this.updateColumnHistoryUI(message.column, message.history); break;
            case 'card_played': this.handleOpponentCardPlayed(message); break;
            case 'card_played_animated': this.handleAnimatedCardPlay(message); break;
            case 'deck_empty': this.handleDeckEmpty(); break;
            case 'deck_updated': this.handleDeckUpdated(message); break;
            case 'turn_changed': this.handleTurnChanged(message); break;
            case 'deck_empty_state': this.handleDeckEmptyState(message); break;
            case 'deck_empty_notification': this.notificationManager.showNotification(message.message, message.isError); break;
            case 'move_undone': this.handleMoveUndone(message); break;
            case 'room_reset': this.resetGameState(); break;
            case 'player_update': this.handlePlayerUpdate(message); break;
            default: console.log('Mensaje no reconocido:', message);
        }
    }

    handlePlayerStateUpdate(message) {
        const progressText = `${message.cardsPlayedThisTurn}/${message.minCardsRequired} carta(s) jugada(s)`;
        const progressPercentage = (message.cardsPlayedThisTurn / message.minCardsRequired) * 100;

        document.getElementById('progressText').textContent = progressText;
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;

        if (message.players) {
            this.gameState.players = message.players;
            this.renderer.updatePlayersPanel();
        }
        this.gameState.currentTurn = message.currentTurn;
        this.renderer.updateGameInfo();
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

        this.renderer.updateGameInfo();
    }

    handleInitGame(message) {
        this.gameState.currentTurn = message.gameState.currentTurn;
        this.gameState.board = message.gameState.board;
        this.gameState.remainingDeck = message.gameState.remainingDeck;
        this.gameState.initialCards = message.gameState.initialCards || 6;

        this.gameState.columnHistory = {
            asc1: message.history?.ascending1 || [1],
            asc2: message.history?.ascending2 || [1],
            desc1: message.history?.descending1 || [100],
            desc2: message.history?.descending2 || [100]
        };

        if (this.gameState.players) {
            this.gameState.players.forEach(player => {
                player.cardsPlayedThisTurn = 0;
            });
        }

        if (message.gameState.gameStarted && message.yourCards) {
            this.updatePlayerCards(message.yourCards);
        }

        this.renderer.updatePlayersPanel();
        this.renderer.updateGameInfo();
    }

    handleGameStateUpdate(message) {
        this.lastStateUpdate = Date.now();
        this.updateGameState(message.s);
        this.renderer.updateGameInfo();
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

        this.renderer.updateGameInfo();
        this.renderer.updatePlayersPanel();
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
        document.getElementById('remainingDeck').textContent = '0';
        document.getElementById('progressText').textContent = '0/1 carta(s) jugada(s)';
        this.renderer.updateGameInfo(true);
    }

    handleTurnChanged(message) {
        this.gameState.cardsPlayedThisTurn = [];
        this.gameState.currentTurn = message.newTurn;
        if (message.deckEmpty !== undefined) {
            this.gameState.remainingDeck = message.remainingDeck || this.gameState.remainingDeck;
            document.getElementById('remainingDeck').textContent = this.gameState.remainingDeck;
            const minCardsRequired = message.deckEmpty ? 1 : 2;
            document.getElementById('progressText').textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
            document.getElementById('progressBar').style.width = '0%';
        }
        this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        if (message.playerName) {
            const notificationMsg = message.newTurn === this.gameState.currentPlayer.id
                ? '¡Es tu turno!'
                : `Turno de ${message.playerName}`;
            this.notificationManager.showNotification(notificationMsg);
        }
    }

    handleDeckEmptyState(message) {
        this.gameState.remainingDeck = message.remaining;
        document.getElementById('remainingDeck').textContent = message.remaining;
        const minCardsRequired = message.minCardsRequired || 1;
        document.getElementById('progressText').textContent = `0/${minCardsRequired} carta(s) jugada(s)`;
        document.getElementById('progressBar').style.width = '0%';
        this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        this.renderer.updateGameInfo();
    }

    handlePlayerUpdate(message) {
        if (message.players) {
            this.gameState.players = message.players;
            this.renderer.updateGameInfo();
        }
    }

    resetGameState() {
        this.gameState.reset();
        this.renderer.updateGameInfo();
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

        this.renderer.updatePlayersPanel();
        this.renderer.updateGameInfo();
    }

    handleOpponentCardPlayed(message) {
        if (message.playerId !== this.gameState.currentPlayer.id) {
            this.gameState.updateStack(message.position, message.cardValue);
            this.recordCardPlayed(message.cardValue, message.position, message.playerId, message.previousValue);
            this.gameState.addToHistory(message.position, message.cardValue);
            this.notificationManager.showNotification(`${message.playerName || 'Un jugador'} jugó un ${message.cardValue}`);
        }

        if (this.gameState.currentTurn === this.gameState.currentPlayer.id) {
            const currentPlayerObj = this.gameState.players.find(p => p.id === this.gameState.currentPlayer.id);
            if (currentPlayerObj) {
                currentPlayerObj.cardsPlayedThisTurn = (currentPlayerObj.cardsPlayedThisTurn || 0) + 1;
                this.renderer.updateGameInfo();
            }
        }
    }

    updatePlayerCards(cards) {
        const isYourTurn = this.gameState.currentTurn === this.gameState.currentPlayer.id;
        const deckEmpty = this.gameState.remainingDeck === 0;
        const startX = (this.gameState.canvas.width - (cards.length * (CARD_WIDTH + CARD_SPACING))) / 2;
        const startY = this.gameState.PLAYER_CARDS_Y;

        const newCards = cards.map((cardValue, index) => {
            const existingCard = this.gameState.yourCards.find(c =>
                c.value === cardValue && !c.isDragging
            );

            if (existingCard) {
                existingCard.x = startX + index * (CARD_WIDTH + CARD_SPACING);
                existingCard.y = startY;
                existingCard.isPlayable = isYourTurn && (
                    deckEmpty
                        ? (cardValue === this.gameState.board.ascending[0] - 10 ||
                            cardValue === this.gameState.board.ascending[1] - 10 ||
                            cardValue === this.gameState.board.descending[0] + 10 ||
                            cardValue === this.gameState.board.descending[1] + 10 ||
                            cardValue > this.gameState.board.ascending[0] ||
                            cardValue > this.gameState.board.ascending[1] ||
                            cardValue < this.gameState.board.descending[0] ||
                            cardValue < this.gameState.board.descending[1])
                        : (this.gameState.isValidMove(cardValue, 'asc1') ||
                            this.gameState.isValidMove(cardValue, 'asc2') ||
                            this.gameState.isValidMove(cardValue, 'desc1') ||
                            this.gameState.isValidMove(cardValue, 'desc2'))
                );
                existingCard.isPlayedThisTurn = this.gameState.cardsPlayedThisTurn.some(
                    move => move.value === cardValue && move.playerId === this.gameState.currentPlayer.id
                );
                return existingCard;
            } else {
                return this.gameState.cardPool.get(
                    cardValue,
                    startX + index * (CARD_WIDTH + CARD_SPACING),
                    startY,
                    isYourTurn && (
                        deckEmpty
                            ? (cardValue === this.gameState.board.ascending[0] - 10 ||
                                cardValue === this.gameState.board.ascending[1] - 10 ||
                                cardValue === this.gameState.board.descending[0] + 10 ||
                                cardValue === this.gameState.board.descending[1] + 10 ||
                                cardValue > this.gameState.board.ascending[0] ||
                                cardValue > this.gameState.board.ascending[1] ||
                                cardValue < this.gameState.board.descending[0] ||
                                cardValue < this.gameState.board.descending[1])
                            : (this.gameState.isValidMove(cardValue, 'asc1') ||
                                this.gameState.isValidMove(cardValue, 'asc2') ||
                                this.gameState.isValidMove(cardValue, 'desc1') ||
                                this.gameState.isValidMove(cardValue, 'desc2'))
                    ),
                    this.gameState.cardsPlayedThisTurn.some(
                        move => move.value === cardValue && move.playerId === this.gameState.currentPlayer.id
                    )
                );
            }
        });

        this.gameState.yourCards = newCards;
        this.renderer.markDirty(0, this.gameState.PLAYER_CARDS_Y - 50, this.gameState.canvas.width, 200);
    }

    updateColumnHistoryUI(column, history) {
        if (!this.gameState.columnHistory[column]) {
            this.gameState.columnHistory[column] = column.includes('asc') ? [1] : [100];
        }
        this.gameState.columnHistory[column] = history;
    }

    recordCardPlayed(cardValue, position, playerId, previousValue) {
        if (playerId !== this.gameState.currentPlayer.id) {
            this.gameState.cardsPlayedThisTurn.push({
                value: cardValue,
                position,
                playerId,
                previousValue
            });
        }
        this.renderer.updateGameInfo();
    }

    handleAnimatedCardPlay(message) {
        const position = message.position;
        const value = message.cardValue;
        const previousValue = this.gameState.getStackValue(position);

        if (message.playerId !== this.gameState.currentPlayer.id && !this.isMyTurn()) {
            const targetPos = this.gameState.getColumnPosition(position);

            const animation = {
                newCard: this.gameState.cardPool.get(value, targetPos.x, -CARD_HEIGHT, false, true),
                currentCard: this.gameState.cardPool.get(previousValue, targetPos.x, targetPos.y, false, false),
                startTime: Date.now(),
                duration: 300,
                targetX: targetPos.x,
                targetY: targetPos.y,
                fromY: -CARD_HEIGHT,
                column: position,
                onComplete: () => {
                    this.gameState.updateStack(position, value);
                    this.notificationManager.showNotification(`${message.playerName} jugó un ${value}`);
                }
            };

            this.gameState.animatingCards.push(animation);
        } else {
            this.gameState.updateStack(position, value);
        }

        this.recordCardPlayed(value, position, message.playerId, previousValue);
    }

    handleDeckUpdated(message) {
        this.gameState.remainingDeck = message.remaining;
        const isDeckEmpty = message.remaining === 0;

        document.getElementById('remainingDeck').textContent = message.remaining;
        this.renderer.updateGameInfo(isDeckEmpty);

        if (isDeckEmpty) {
            this.notificationManager.showNotification('¡El mazo se ha agotado! Ahora solo necesitas jugar 1 carta por turno');
        }
    }

    handleMoveUndone(message) {
        if (message.playerId === this.gameState.currentPlayer.id) {
            const moveIndex = this.gameState.cardsPlayedThisTurn.findIndex(
                move => move.value === message.cardValue && move.position === message.position
            );

            if (moveIndex !== -1) {
                this.gameState.cardsPlayedThisTurn.splice(moveIndex, 1);
            }

            this.gameState.updateStack(message.position, message.previousValue);

            const card = this.gameState.cardPool.get(message.cardValue, 0, 0, true, false);
            this.gameState.yourCards.push(card);
            this.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
        }
    }

    handleGameOver(message, isError = false) {
        this.gameState.canvas.style.pointerEvents = 'none';
        this.gameState.endTurnButton.disabled = true;
        this.notificationManager.showGameOver(message, isError);
    }

    isMyTurn() {
        return this.gameState.currentTurn === this.gameState.currentPlayer.id;
    }
}