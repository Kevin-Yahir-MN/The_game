export class GameState {
    constructor() {
        this._cardPool = null;
        this.players = [];
        this.yourCards = [];
        this.board = { ascending: [1, 1], descending: [100, 100] };
        this.currentTurn = null;
        this.remainingDeck = 98;
        this.initialCards = 6;
        this.cardsPlayedThisTurn = [];
        this.animatingCards = [];
        this.columnHistory = { asc1: [1], asc2: [1], desc1: [100], desc2: [100] };
        this.currentPlayer = null;
        this.canvas = null;
        this.BOARD_POSITION = null;
        this.PLAYER_CARDS_Y = null;
    }

    get cardPool() {
        if (!this._cardPool) throw new Error('CardPool not initialized');
        return this._cardPool;
    }

    set cardPool(value) {
        if (!value) throw new Error('Invalid CardPool');
        this._cardPool = value;
    }
}