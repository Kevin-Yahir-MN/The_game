// src/services/gameService.js
const WebSocket = require('ws');
const { withTransaction } = require('../db');
const { validPositions, reverseRoomMap, boardHistory } = require('../state');
const { getPlayableCards, isValidMove, canAnyPlayerPlay } = require('../utils/gameRules');
const {
    createTurnState,
    getTurnState,
    getPlayerTurnCount,
    incrementPlayerTurnState,
    resetPlayerTurnState
} = require('../utils/turnState');
const { broadcastToRoom, safeSend } = require('./communication');
const { scheduleSaveGameState, flushSaveGameState } = require('./persistence');

function updateBoardHistory(room, position, newValue) {
    const roomId = reverseRoomMap.get(room);
    if (!roomId) return;

    const history = boardHistory.get(roomId) || {
        ascending1: [1],
        ascending2: [1],
        descending1: [100],
        descending2: [100]
    };

    const historyKey = {
        asc1: 'ascending1',
        asc2: 'ascending2',
        desc1: 'descending1',
        desc2: 'descending2'
    }[position];

    if (history[historyKey].slice(-1)[0] !== newValue) {
        history[historyKey].push(newValue);
        boardHistory.set(roomId, history);

        broadcastToRoom(room, {
            type: 'column_history_update',
            column: position,
            history: history[historyKey]
        });

        scheduleSaveGameState(roomId);
    }
}

function checkGameStatus(room) {
    const allPlayersEmpty = room.players.every(p => p.cards.length === 0);
    const deckEmpty = room.gameState.deck.length === 0;

    if (allPlayersEmpty && deckEmpty) {
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'win',
            message: '¡Todos ganan! Todas las cartas jugadas.',
            reason: 'all_cards_played'
        });
        return;
    }

    const totalCardsInHand = room.players.reduce((sum, player) => sum + player.cards.length, 0);

    if (deckEmpty && totalCardsInHand <= 10 && !canAnyPlayerPlay(room)) {
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'win',
            message: '¡Victoria! Sin movimientos posibles y solo ' + totalCardsInHand + ' cartas restantes.',
            reason: 'low_remaining_cards'
        });
        return;
    }

    if (deckEmpty && totalCardsInHand > 10 && !canAnyPlayerPlay(room)) {
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'lose',
            message: '¡Derrota! Sin movimientos posibles y ' + totalCardsInHand + ' cartas restantes (más de 10).',
            reason: 'too_many_remaining_cards'
        });
    }
}

async function handlePlayCard(room, player, msg) {
    if (!validPositions.includes(msg.position)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'Posición inválida',
            isError: true
        });
    }

    if (!player.cards.includes(msg.cardValue)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No tienes esa carta',
            isError: true
        });
    }

    const board = room.gameState.board;
    const targetIdx = msg.position.includes('asc') ? (msg.position === 'asc1' ? 0 : 1) : (msg.position === 'desc1' ? 0 : 1);
    const { isValid, targetValue } = isValidMove(msg.cardValue, msg.position, board);

    if (!isValid) {
        return safeSend(player.ws, {
            type: 'invalid_move',
            message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
            isError: true
        });
    }

    const previousValue = targetValue;

    if (msg.position.includes('asc')) {
        board.ascending[targetIdx] = msg.cardValue;
    } else {
        board.descending[targetIdx] = msg.cardValue;
    }

    incrementPlayerTurnState(player, {
        value: msg.cardValue,
        position: msg.position,
        previousValue
    });
    player.cardsPlayedThisTurn = getPlayerTurnCount(player);
    player.totalCardsPlayed = (Number(player.totalCardsPlayed) || 0) + 1;
    player.cards = player.cards.filter(c => c !== msg.cardValue);

    if (room.gameState.deck.length > 0 && getPlayerTurnCount(player) === 1) {
        const playableCards = getPlayableCards(player.cards, room.gameState.board);
        if (playableCards.length === 0) {
            await flushSaveGameState(reverseRoomMap.get(room));
            return broadcastToRoom(room, {
                type: 'game_over',
                result: 'lose',
                message: `¡${player.name} no puede seguir jugando cartas!`,
                reason: 'min_cards_not_met'
            });
        }
    }

    updateBoardHistory(room, msg.position, msg.cardValue);

    const deckEmpty = room.gameState.deck.length === 0;

    broadcastToRoom(room, {
        type: 'card_played_animated',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: targetValue,
        persistColor: true,
        cardsPlayedThisTurn: getPlayerTurnCount(player),
        remainingDeck: room.gameState.deck.length,
        deckEmpty: deckEmpty
    }, { includeGameState: true });

    if (deckEmpty && room.gameState.deck.length === 0) {
        setTimeout(() => {
            broadcastToRoom(room, {
                type: 'deck_empty',
                roomId: reverseRoomMap.get(room),
                timestamp: Date.now()
            });
        }, 500);
    }

    scheduleSaveGameState(reverseRoomMap.get(room));
    checkGameStatus(room);
}

function handleUndoMove(room, player, msg) {
    const turnState = getTurnState(player);
    if (turnState.moves.length === 0) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No hay jugadas para deshacer',
            isError: true
        });
    }

    const lastMoveIndex = turnState.moves.findIndex(
        move => move.value === msg.cardValue &&
            move.position === msg.position
    );

    if (lastMoveIndex === -1) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No se encontró la jugada para deshacer',
            isError: true
        });
    }

    const lastMove = turnState.moves[lastMoveIndex];

    player.cards.push(msg.cardValue);

    if (msg.position.includes('asc')) {
        const idx = msg.position === 'asc1' ? 0 : 1;
        room.gameState.board.ascending[idx] = lastMove.previousValue;
    } else {
        const idx = msg.position === 'desc1' ? 0 : 1;
        room.gameState.board.descending[idx] = lastMove.previousValue;
    }

    turnState.moves.splice(lastMoveIndex, 1);
    turnState.count = Math.max(0, turnState.count - 1);
    player.cardsPlayedThisTurn = turnState.count;

    broadcastToRoom(room, {
        type: 'move_undone',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: lastMove.previousValue
    }, { includeGameState: true });
}

async function endTurn(room, player) {
    const deckEmpty = room.gameState.deck.length === 0;
    const minCardsRequired = deckEmpty ? 1 : 2;
    const cardsPlayed = getPlayerTurnCount(player);

    if (!deckEmpty && cardsPlayed < minCardsRequired) {
        return safeSend(player.ws, {
            type: 'notification',
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
            isError: true
        });
    }

    if (!deckEmpty) {
        const targetCardCount = room.gameState.initialCards;
        const cardsToDraw = Math.min(
            targetCardCount - player.cards.length,
            room.gameState.deck.length
        );

        for (let i = 0; i < cardsToDraw; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
    }

    let nextIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    let nextPlayer;
    let attempts = 0;

    do {
        nextIndex = (nextIndex + 1) % room.players.length;
        nextPlayer = room.players[nextIndex];
        attempts++;

        if (attempts > room.players.length) {
            break;
        }

        if (!deckEmpty || getPlayableCards(nextPlayer.cards, room.gameState.board).length > 0) {
            break;
        }

    } while (true);

    room.gameState.currentTurn = nextPlayer.id;
    resetPlayerTurnState(player);
    player.cardsPlayedThisTurn = 0;

    if (!deckEmpty) {
        const playableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
        if (playableCards.length < minCardsRequired && nextPlayer.cards.length > 0) {
            await flushSaveGameState(reverseRoomMap.get(room));
            return broadcastToRoom(room, {
                type: 'game_over',
                result: 'lose',
                message: `¡${nextPlayer.name} no puede jugar el mínimo de ${minCardsRequired} carta(s) requerida(s)!`,
                reason: 'min_cards_not_met'
            });
        }
    }

    await flushSaveGameState(reverseRoomMap.get(room));

    broadcastToRoom(room, {
        type: 'turn_changed',
        newTurn: nextPlayer.id,
        previousPlayer: player.id,
        playerName: nextPlayer.name,
        cardsPlayedThisTurn: 0,
        minCardsRequired: minCardsRequired,
        remainingDeck: room.gameState.deck.length,
        deckEmpty: deckEmpty,
        skippedPlayers: attempts - 1
    }, { includeGameState: true });

    checkGameStatus(room);
}

async function startGame(room, initialCards = 6) {
    const roomId = reverseRoomMap.get(room);
    if (!roomId) throw new Error('Room ID no encontrado');

    try {
        await withTransaction(async (client) => {
            await client.query(`
                UPDATE game_states
                SET game_data = $1,
                    last_activity = NOW()
                WHERE room_id = $2
            `, [JSON.stringify({
                players: room.players,
                gameState: {
                    ...room.gameState,
                    gameStarted: true,
                    initialCards
                },
                history: boardHistory.get(roomId)
            }), roomId]);

            await Promise.all(room.players.map(player =>
                client.query(`
                    INSERT INTO player_connections 
                    (player_id, room_id, last_ping, connection_status)
                    VALUES ($1, $2, NOW(), $3)
                    ON CONFLICT (player_id) 
                    DO UPDATE SET
                        room_id = $2,
                        last_ping = NOW(),
                        connection_status = $3
                `, [
                    player.id,
                    roomId,
                    player.ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'
                ])
            ));
        });

        room.gameState.gameStarted = true;
        room.gameState.initialCards = initialCards;

        room.players.forEach(player => {
            player.cards = [];
            resetPlayerTurnState(player);
            player.cardsPlayedThisTurn = 0;
            for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
                player.cards.push(room.gameState.deck.pop());
            }
        });

        await flushSaveGameState(roomId);
        console.log('💾 Estado guardado al iniciar nueva partida');

        broadcastToRoom(room, {
            type: 'game_started',
            state: {
                board: room.gameState.board,
                currentTurn: room.players[0].id,
                remainingDeck: room.gameState.deck.length,
                initialCards: initialCards,
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    cardCount: p.cards.length,
                    cardsPlayedThisTurn: getPlayerTurnCount(p)
                }))
            }
        });

        room.players.forEach(player => {
            if (player.ws?.readyState === WebSocket.OPEN) {
                safeSend(player.ws, {
                    type: 'your_cards',
                    cards: player.cards,
                    playerName: player.name,
                    currentPlayerId: player.id
                });
            }
        });

    } catch (error) {
        console.error('Error al iniciar juego:', error);
        throw error;
    }
}

module.exports = {
    updateBoardHistory,
    checkGameStatus,
    handlePlayCard,
    handleUndoMove,
    endTurn,
    startGame,
    createTurnState,
    getTurnState,
    getPlayerTurnCount,
    resetPlayerTurnState
};
