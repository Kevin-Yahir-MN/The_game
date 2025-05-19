export class GameState {
    constructor() {
        this.players = [];
        this.yourCards = [];
        this.board = { ascending: [1, 1], descending: [100, 100] };
        this.cardPool = null;
        this.currentTurn = null;
        this.remainingDeck = 98;
        this.initialCards = 6;
        this.cardsPlayedThisTurn = [];
        this.animatingCards = [];
        this.columnHistory = { asc1: [1], asc2: [1], desc1: [100], desc2: [100] };
        this.boardCards = [];
        this.historyIconAreas = [];
    }

    setCardPool(cardPool) {
        this.cardPool = cardPool;
    }

    getStackValue(position) {
        const [stack, idx] = position.includes('asc')
            ? [this.board.ascending, position === 'asc1' ? 0 : 1]
            : [this.board.descending, position === 'desc1' ? 0 : 1];
        return stack[idx];
    }

    updateStack(position, value) {
        const [stack, idx] = position.includes('asc')
            ? [this.board.ascending, position === 'asc1' ? 0 : 1]
            : [this.board.descending, position === 'desc1' ? 0 : 1];
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
        const history = this.columnHistory[position] ||
            (position.includes('asc') ? [1] : [100]);
        if (history[history.length - 1] !== value) {
            history.push(value);
            this.columnHistory[position] = history;
        }
    }

    reset() {
        this.players = [];
        this.yourCards = [];
        this.board = { ascending: [1, 1], descending: [100, 100] };
        this.currentTurn = null;
        this.remainingDeck = 98;
        this.initialCards = 6;
        this.cardsPlayedThisTurn = [];
        this.animatingCards = [];
        this.columnHistory = { asc1: [1], asc2: [1], desc1: [100], desc2: [100] };
    }
}