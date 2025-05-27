export class GameCore {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.WS_URL = 'wss://the-game-2xks.onrender.com';
        this.STATE_UPDATE_THROTTLE = 200;
        this.TARGET_FPS = 60;
        this.MAX_RECONNECT_ATTEMPTS = 5;
        this.RECONNECT_BASE_DELAY = 2000;
        this.CARD_WIDTH = 80;
        this.CARD_HEIGHT = 120;
        this.COLUMN_SPACING = 60;
        this.CARD_SPACING = 15;
        this.HISTORY_ICON_PULSE_INTERVAL = 20000;
        this.HISTORY_ICON_PULSE_DURATION = 500;

        this.BOARD_POSITION = {
            x: this.canvas.width / 2 - (this.CARD_WIDTH * 4 + this.COLUMN_SPACING * 3) / 2,
            y: this.canvas.height * 0.3
        };
        this.PLAYER_CARDS_Y = this.canvas.height * 0.6;
        this.BUTTONS_Y = this.canvas.height * 0.85;
        this.HISTORY_ICON_Y = this.BOARD_POSITION.y + this.CARD_HEIGHT + 15;

        this.assetCache = new Map();
        this.historyIcon = new Image();
        this.historyIconsAnimation = { interval: null, lastPulseTime: Date.now(), isAnimating: false };
        this.animationFrameId = null;
        this.lastStateUpdate = 0;
        this.lastRenderTime = 0;
        this.reconnectAttempts = 0;
        this.reconnectTimeout = null;
        this.connectionStatus = 'disconnected';
        this.dragStartCard = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.isDragging = false;
        this.socket = null;
        this.animationQueue = [];
        this.dirtyAreas = [];
        this.needsRedraw = true;

        this.currentPlayer = {
            id: this.sanitizeInput(sessionStorage.getItem('playerId')),
            name: this.sanitizeInput(sessionStorage.getItem('playerName')),
            isHost: sessionStorage.getItem('isHost') === 'true'
        };

        this.roomId = this.sanitizeInput(sessionStorage.getItem('roomId'));
        if (!this.roomId) {
            window.location.href = 'sala.html';
            return;
        }

        this.gameState = {
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
            historyIconAreas: []
        };

        this.cardPool = {
            pool: [],
            get: (value, x, y, isPlayable, isPlayedThisTurn) => {
                if (this.pool.length > 0) {
                    const card = this.pool.pop();
                    card.value = value;
                    card.x = x;
                    card.y = y;
                    card.isPlayable = isPlayable;
                    card.isPlayedThisTurn = isPlayedThisTurn;
                    return card;
                }
                // La clase Card se inyectará desde game-main.js
                return new this.Card(value, x, y, isPlayable, isPlayedThisTurn);
            },
            release: (card) => {
                this.pool.push(card);
            }
        };
    }

    sanitizeInput(input) {
        return input ? input.replace(/[^a-zA-Z0-9-_]/g, '') : '';
    }

    log(message, data) {
        console.log(`[${new Date().toISOString()}] ${message}`, data);
    }

    markDirty(x, y, width, height) {
        this.dirtyAreas.push({ x, y, width, height });
        this.needsRedraw = true;
    }

    clearDirtyAreas() {
        this.dirtyAreas = [];
    }

    getStackValue(position) {
        const [stack, idx] = position.includes('asc')
            ? [this.gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [this.gameState.board.descending, position === 'desc1' ? 0 : 1];
        return stack[idx];
    }

    updateStack(position, value) {
        const [stack, idx] = position.includes('asc')
            ? [this.gameState.board.ascending, position === 'asc1' ? 0 : 1]
            : [this.gameState.board.descending, position === 'desc1' ? 0 : 1];
        stack[idx] = value;
    }

    isValidMove(cardValue, position) {
        const currentValue = this.getStackValue(position);
        const isAscending = position.includes('asc');
        const exactDifference = isAscending
            ? cardValue === currentValue - 10
            : cardValue === currentValue + 10;
        const normalMove = isAscending
            ? cardValue > currentValue
            : cardValue < currentValue;
        return exactDifference || normalMove;
    }

    addToHistory(position, value) {
        const history = this.gameState.columnHistory[position] ||
            (position.includes('asc') ? [1] : [100]);
        if (history[history.length - 1] !== value) {
            history.push(value);
            this.gameState.columnHistory[position] = history;
        }
    }

    recordCardPlayed(cardValue, position, playerId, previousValue) {
        if (playerId !== this.currentPlayer.id) {
            this.gameState.cardsPlayedThisTurn.push({
                value: cardValue,
                position,
                playerId,
                previousValue
            });
        }
        this.updateGameInfo();
    }

    isMyTurn() {
        return this.gameState.currentTurn === this.currentPlayer.id;
    }

    setNextTurn() {
        const currentIndex = this.gameState.players.findIndex(p => p.id === this.gameState.currentTurn);
        let nextIndex = (currentIndex + 1) % this.gameState.players.length;
        this.gameState.currentTurn = this.gameState.players[nextIndex].id;
    }

    getColumnPosition(position) {
        const index = ['asc1', 'asc2', 'desc1', 'desc2'].indexOf(position);
        return {
            x: this.BOARD_POSITION.x + (this.CARD_WIDTH + this.COLUMN_SPACING) * index,
            y: this.BOARD_POSITION.y
        };
    }

    hasValidMoves(cards, board) {
        return cards.some(card => {
            return ['asc1', 'asc2', 'desc1', 'desc2'].some(pos => {
                const posValue = pos.includes('asc')
                    ? (pos === 'asc1' ? board.ascending[0] : board.ascending[1])
                    : (pos === 'desc1' ? board.descending[0] : board.descending[1]);

                const isValid = pos.includes('asc')
                    ? (card.value > posValue || card.value === posValue - 10)
                    : (card.value < posValue || card.value === posValue + 10);

                return isValid;
            });
        });
    }

    getClickedColumn(x, y) {
        if (y < this.BOARD_POSITION.y || y > this.BOARD_POSITION.y + this.CARD_HEIGHT) return null;

        const columns = [
            { x: this.BOARD_POSITION.x, id: 'asc1' },
            { x: this.BOARD_POSITION.x + this.CARD_WIDTH + this.COLUMN_SPACING, id: 'asc2' },
            { x: this.BOARD_POSITION.x + (this.CARD_WIDTH + this.COLUMN_SPACING) * 2, id: 'desc1' },
            { x: this.BOARD_POSITION.x + (this.CARD_WIDTH + this.COLUMN_SPACING) * 3, id: 'desc2' }
        ];

        const column = columns.find(col => x >= col.x && x <= col.x + this.CARD_WIDTH);
        return column ? column.id : null;
    }
}