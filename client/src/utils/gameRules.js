// src/utils/gameRules.js
function getPlayableCards(playerCards, board) {
    if (!playerCards || playerCards.length === 0) return [];

    return playerCards.filter(card => {
        const canPlayAsc1 = card > board.ascending[0] || card === board.ascending[0] - 10;
        const canPlayAsc2 = card > board.ascending[1] || card === board.ascending[1] - 10;
        const canPlayDesc1 = card < board.descending[0] || card === board.descending[0] + 10;
        const canPlayDesc2 = card < board.descending[1] || card === board.descending[1] + 10;

        return canPlayAsc1 || canPlayAsc2 || canPlayDesc1 || canPlayDesc2;
    });
}

function isValidMove(cardValue, position, board) {
    const idx = position === 'asc1' || position === 'desc1' ? 0 : 1;
    const isAsc = position.includes('asc');
    const targetValue = isAsc ? board.ascending[idx] : board.descending[idx];
    const exactDifference = isAsc ? cardValue === targetValue - 10 : cardValue === targetValue + 10;
    const normalMove = isAsc ? cardValue > targetValue : cardValue < targetValue;
    return { isValid: exactDifference || normalMove, targetValue, exactDifference, normalMove };
}

function canAnyPlayerPlay(room) {
    return room.players.some(player => getPlayableCards(player.cards, room.gameState.board).length > 0);
}

function initializeDeck() {
    const deck = [];
    for (let i = 2; i < 100; i++) deck.push(i);
    return shuffleArray(deck);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = {
    getPlayableCards,
    isValidMove,
    canAnyPlayerPlay,
    initializeDeck,
    shuffleArray
};
