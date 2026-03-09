// client/src/utils/serializers.js
const WebSocket = require('ws');
const { getPlayerTurnCount, getTurnState } = require('./turnState');

function toPersistedPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        userId: player.userId || null,
        cards: player.cards,
        isHost: player.isHost,
        connected: player.ws?.readyState === WebSocket.OPEN,
        cardsPlayedThisTurn: getPlayerTurnCount(player),
        movesThisTurn: getTurnState(player).moves,
        totalCardsPlayed: Number(player.totalCardsPlayed) || 0,
        lastActivity: player.lastActivity,
    };
}

module.exports = { toPersistedPlayer };
