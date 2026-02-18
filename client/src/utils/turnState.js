// src/utils/turnState.js
function createTurnState() {
    return { count: 0, moves: [] };
}

function getTurnState(player) {
    if (!player.turnState || typeof player.turnState !== 'object') {
        if (Array.isArray(player.cardsPlayedThisTurn)) {
            player.turnState = {
                count: player.cardsPlayedThisTurn.length,
                moves: player.cardsPlayedThisTurn
            };
        } else {
            player.turnState = {
                count: Number(player.cardsPlayedThisTurn) || 0,
                moves: []
            };
        }
    }
    if (!Array.isArray(player.turnState.moves)) player.turnState.moves = [];
    player.turnState.count = Number(player.turnState.count) || 0;
    return player.turnState;
}

function getPlayerTurnCount(player) {
    return getTurnState(player).count;
}

function incrementPlayerTurnState(player, move) {
    const turnState = getTurnState(player);
    turnState.count += 1;
    if (move) turnState.moves.push(move);
}

function resetPlayerTurnState(player) {
    player.turnState = createTurnState();
}

module.exports = {
    createTurnState,
    getTurnState,
    getPlayerTurnCount,
    incrementPlayerTurnState,
    resetPlayerTurnState
};
