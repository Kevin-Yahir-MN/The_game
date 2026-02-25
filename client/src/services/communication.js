// src/services/communication.js
const WebSocket = require('ws');
const { getPlayerTurnCount } = require('../utils/turnState');

function safeSend(ws, message) {
    try {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    } catch (error) {
        console.error(error);
    }
}

function sendGameState(room, player) {
    player.lastActivity = Date.now();
    const state = {
        b: room.gameState.board,
        t: room.gameState.currentTurn,
        y: player.cards,
        i: room.gameState.initialCards,
        d: room.gameState.deck.length,
        p: room.players.map(p => ({
            i: p.id,
            n: p.name,
            h: p.isHost,
            c: p.cards.length,
            s: getPlayerTurnCount(p),
            pt: Number(p.totalCardsPlayed) || 0
        }))
    };

    safeSend(player.ws, {
        type: 'gs',
        s: state
    });
}

function broadcastToRoom(room, message, options = {}) {
    const { includeGameState = false, skipPlayerId = null } = options;

    if (includeGameState && message.remainingDeck == null) {
        message.remainingDeck = room.gameState.deck.length;
    }

    room.players.forEach(player => {
        if (player.id !== skipPlayerId && player.ws?.readyState === WebSocket.OPEN) {
            const completeMessage = {
                ...message,
                timestamp: Date.now()
            };

            safeSend(player.ws, completeMessage);

            if (includeGameState) {
                sendGameState(room, player);
            }
        }
    });
}

module.exports = {
    safeSend,
    sendGameState,
    broadcastToRoom
};
