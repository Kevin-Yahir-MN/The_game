const WebSocket = require('ws');
const { getPlayerTurnCount, getTurnState } = require('./turnState');

function toPersistedPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        userId: player.userId || null,
        avatarId: player.avatarId || null,
        avatarUrl: player.avatarUrl || null,
        cards: player.cards,
        isHost: player.isHost,
        connected: player.ws?.readyState === WebSocket.OPEN,
        movesThisTurn: getTurnState(player).moves,
        totalCardsPlayed: Number(player.totalCardsPlayed) || 0,
        specialMovesThisMatch: Number(player.specialMovesThisMatch) || 0,
        lastActivity: player.lastActivity,
    };
}

module.exports = { toPersistedPlayer };
