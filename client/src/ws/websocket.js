// src/ws/websocket.js
const WebSocket = require('ws');
const { pool } = require('../db');
const { allowedOrigins } = require('../config');
const { rooms, reverseRoomMap, boardHistory, wsRateLimit } = require('../state');
const { sanitizePlayerName, isValidRoomId, validatePlayCardPayload } = require('../utils/validation');
const { isWithinRateLimit } = require('../utils/rateLimit');
const { initializeDeck } = require('../utils/gameRules');
const {
    handlePlayCard,
    handleUndoMove,
    endTurn,
    startGame,
    getPlayerTurnCount,
    getTurnState,
    resetPlayerTurnState
} = require('../services/gameService');
const { safeSend, broadcastToRoom, sendGameState } = require('../services/communication');
const { flushSaveGameState } = require('../services/persistence');

function defaultHistory() {
    return {
        ascending1: [1],
        ascending2: [1],
        descending1: [100],
        descending2: [100]
    };
}

function parseWsMessage(message) {
    const rawMessage = typeof message === 'string' ? message : message.toString();
    if (rawMessage.length > 8 * 1024) {
        const error = new Error('Payload demasiado grande');
        error.code = 'PAYLOAD_TOO_LARGE';
        throw error;
    }

    try {
        return JSON.parse(rawMessage);
    } catch (error) {
        const parseError = new Error('JSON inválido');
        parseError.code = 'INVALID_JSON';
        throw parseError;
    }
}

function setupWebSocket(server) {
    const wss = new WebSocket.Server({
        server,
        maxPayload: 8 * 1024,
        verifyClient: (info, done) => {
            if (!allowedOrigins.includes(info.origin)) {
                return done(false, 403, 'Origen no permitido');
            }
            done(true);
        }
    });

    const heartbeatIntervalMs = 25000;
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            if (client.isAlive === false) {
                return client.terminate();
            }

            client.isAlive = false;
            client.ping();
        });
    }, heartbeatIntervalMs);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    wss.on('connection', async (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        const params = new URLSearchParams((req.url || '').split('?')[1] || '');
        const roomId = params.get('roomId');
        const playerId = params.get('playerId');
        const playerName = params.get('playerName');

        if (!isValidRoomId(roomId) || !playerId || !rooms.has(roomId)) {
            return ws.close(1008, 'Datos inválidos');
        }

        const room = rooms.get(roomId);
        const player = room.players.find(p => p.id === playerId);
        if (!player) return ws.close(1008, 'Jugador no registrado');

        try {
            await pool.query(`
                INSERT INTO player_connections 
                (player_id, room_id, last_ping, connection_status)
                VALUES ($1, $2, NOW(), 'connected')
                ON CONFLICT (player_id) 
                DO UPDATE SET 
                    room_id = $2,
                    last_ping = NOW(),
                    connection_status = 'connected'
            `, [playerId, roomId]);
        } catch (error) {
            console.error('Error al actualizar player_connections:', error);
        }

        player.ws = ws;
        player.lastActivity = Date.now();
        if (playerName) {
            const decodedName = sanitizePlayerName(decodeURIComponent(playerName));
            if (decodedName) player.name = decodedName;
        }

        const response = {
            type: 'init_game',
            playerId: player.id,
            playerName: player.name,
            roomId,
            isHost: player.isHost,
            gameState: {
                board: room.gameState.board,
                currentTurn: room.gameState.currentTurn,
                gameStarted: room.gameState.gameStarted,
                initialCards: room.gameState.initialCards,
                remainingDeck: room.gameState.deck.length,
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    cardCount: p.cards.length
                }))
            },
            history: boardHistory.get(roomId) || defaultHistory(),
            isYourTurn: room.gameState.currentTurn === player.id
        };

        if (room.gameState.gameStarted) {
            response.yourCards = player.cards;
            response.players = room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: getPlayerTurnCount(p)
            }));
        }

        safeSend(ws, response);

        ws.on('message', async (message) => {
            try {
                if (!isWithinRateLimit(playerId)) {
                    return safeSend(ws, {
                        type: 'notification',
                        message: 'Has excedido el límite de mensajes por segundo',
                        isError: true,
                        errorCode: 'RATE_LIMIT_EXCEEDED'
                    });
                }

                const msg = parseWsMessage(message);
                player.lastActivity = Date.now();

                if (msg.type === 'ping') {
                    await pool.query(`
                        UPDATE player_connections
                        SET last_ping = NOW()
                        WHERE player_id = $1
                    `, [playerId]);
                    return;
                }

                switch (msg.type) {
                    case 'deck_empty':
                        room.gameState.deck = [];
                        broadcastToRoom(room, {
                            type: 'game_state_update',
                            remainingDeck: 0,
                            minCardsRequired: 1
                        });
                        break;
                    case 'get_player_state':
                        safeSend(player.ws, {
                            type: 'player_state_update',
                            cardsPlayedThisTurn: getPlayerTurnCount(player),
                            totalCardsPlayed: player.totalCardsPlayed || 0,
                            minCardsRequired: room.gameState.deck.length > 0 ? 2 : 1,
                            currentTurn: room.gameState.currentTurn,
                            players: room.players.map(p => ({
                                id: p.id,
                                name: p.name,
                                isHost: p.isHost,
                                cardCount: p.cards?.length || 0,
                                cardsPlayedThisTurn: getPlayerTurnCount(p)
                            }))
                        });
                        break;
                    case 'start_game':
                        if (player.isHost && !room.gameState.gameStarted) {
                            try {
                                const connectedPlayers = room.players.filter(p =>
                                    p.ws?.readyState === WebSocket.OPEN
                                );

                                if (connectedPlayers.length < 1) {
                                    throw new Error('Se necesita al menos 1 jugador conectado');
                                }

                                const sanitizedInitialCards = Number(msg.initialCards);
                                const initialCards = Number.isInteger(sanitizedInitialCards) && sanitizedInitialCards >= 1 && sanitizedInitialCards <= 10
                                    ? sanitizedInitialCards
                                    : 6;
                                await startGame(room, initialCards);
                            } catch (error) {
                                console.error('Error al iniciar juego:', error);
                                safeSend(player.ws, {
                                    type: 'notification',
                                    message: 'Error al iniciar el juego: ' + error.message,
                                    isError: true
                                });
                            }
                        }
                        break;
                    case 'play_card':
                        if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                            const { missingFields, isValid } = validatePlayCardPayload(msg);

                            if (!isValid) {
                                return safeSend(player.ws, {
                                    type: 'notification',
                                    message: `Faltan campos requeridos: ${missingFields.join(', ')}`,
                                    isError: true,
                                    errorCode: 'MISSING_REQUIRED_FIELDS'
                                });
                            }

                            if (msg.roomId !== roomId) {
                                return safeSend(player.ws, {
                                    type: 'notification',
                                    message: 'Sala no válida',
                                    isError: true,
                                    errorCode: 'INVALID_ROOM'
                                });
                            }

                            const enhancedMsg = {
                                ...msg,
                                playerId: player.id,
                                playerName: player.name,
                                isPlayedThisTurn: true
                            };
                            await handlePlayCard(room, player, enhancedMsg);
                        }
                        break;
                    case 'end_turn':
                        if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                            await endTurn(room, player);
                        }
                        break;
                    case 'undo_move':
                        if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                            handleUndoMove(room, player, msg);
                        }
                        break;
                    case 'get_game_state':
                        if (room.gameState.gameStarted) sendGameState(room, player);
                        break;
                    case 'force_game_over':
                        broadcastToRoom(room, {
                            type: 'game_over',
                            result: 'lose',
                            message: '¡Juego terminado! No hay movimientos válidos disponibles.',
                            reason: msg.reason || 'no_valid_moves'
                        });
                        break;
                    case 'check_solo_block': {
                        if (room.players.length === 1) {
                            const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
                            const cardsRemaining = Number(msg.cardsRemaining);

                            if (Number.isFinite(cardsRemaining) && cardsRemaining < minCardsRequired) {
                                broadcastToRoom(room, {
                                    type: 'game_over',
                                    result: 'lose',
                                    message: `¡No puedes jugar el mínimo de ${minCardsRequired} carta(s) requerida(s)!`,
                                    reason: 'min_cards_not_met_solo'
                                });
                            }
                        }
                        break;
                    }
                    case 'self_blocked':
                        broadcastToRoom(room, {
                            type: 'game_over',
                            result: 'lose',
                            message: `¡${player.name} se quedó sin movimientos posibles!`,
                            reason: 'self_blocked'
                        });
                        break;
                    case 'reset_room':
                        if (player.isHost) {
                            room.gameState = {
                                deck: initializeDeck(),
                                board: { ascending: [1, 1], descending: [100, 100] },
                                currentTurn: room.players[0].id,
                                gameStarted: false,
                                initialCards: room.gameState.initialCards || 6
                            };

                            boardHistory.set(roomId, defaultHistory());

                            room.players.forEach(currentPlayer => {
                                currentPlayer.cards = [];
                                resetPlayerTurnState(currentPlayer);
                                currentPlayer.cardsPlayedThisTurn = 0;
                            });

                            await flushSaveGameState(roomId);

                            broadcastToRoom(room, {
                                type: 'room_reset',
                                message: 'La sala ha sido reiniciada para una nueva partida'
                            });
                        }
                        break;
                    case 'update_player': {
                        const sanitizedName = sanitizePlayerName(msg.name);
                        if (!sanitizedName) break;
                        player.name = sanitizedName;
                        broadcastToRoom(room, {
                            type: 'player_update',
                            players: room.players.map(p => ({
                                id: p.id,
                                name: p.name,
                                isHost: p.isHost,
                                cardCount: p.cards.length
                            }))
                        });
                        break;
                    }
                    case 'get_full_state': {
                        const currentRoomId = reverseRoomMap.get(room);
                        safeSend(player.ws, {
                            type: 'full_state_update',
                            room: {
                                players: room.players.map(p => ({
                                    id: p.id,
                                    name: p.name,
                                    isHost: p.isHost,
                                    cards: p.cards,
                                    cardsPlayedThisTurn: getPlayerTurnCount(p),
                                    movesThisTurn: getTurnState(p).moves,
                                    totalCardsPlayed: p.totalCardsPlayed || 0,
                                    lastActivity: p.lastActivity
                                })),
                                gameStarted: room.gameState.gameStarted
                            },
                            gameState: {
                                board: room.gameState.board,
                                currentTurn: room.gameState.currentTurn,
                                remainingDeck: room.gameState.deck.length,
                                initialCards: room.gameState.initialCards,
                                gameStarted: room.gameState.gameStarted
                            },
                            history: boardHistory.get(currentRoomId),
                            currentPlayerState: {
                                cardsPlayedThisTurn: getPlayerTurnCount(player),
                                minCardsRequired: room.gameState.deck.length > 0 ? 2 : 1
                            }
                        });
                        break;
                    }
                    default:
                        safeSend(player.ws, {
                            type: 'notification',
                            message: `Tipo de mensaje no reconocido: ${msg.type}`,
                            isError: true,
                            errorCode: 'UNKNOWN_MESSAGE_TYPE'
                        });
                }
            } catch (error) {
                if (error.code === 'PAYLOAD_TOO_LARGE') {
                    ws.close(1009, 'Payload demasiado grande');
                    return;
                }
                if (error.code === 'INVALID_JSON') {
                    safeSend(player.ws, {
                        type: 'notification',
                        message: 'Mensaje inválido: JSON malformado',
                        isError: true,
                        errorCode: 'INVALID_JSON'
                    });
                    return;
                }
                console.error('Error procesando mensaje:', error);
                safeSend(player.ws, {
                    type: 'notification',
                    message: 'Error interno procesando mensaje',
                    isError: true,
                    errorCode: 'INTERNAL_ERROR'
                });
            }
        });

        ws.on('close', async () => {
            player.ws = null;
            wsRateLimit.delete(playerId);
            try {
                await pool.query(`
                    UPDATE player_connections
                    SET connection_status = 'disconnected'
                    WHERE player_id = $1
                `, [playerId]);
                await flushSaveGameState(roomId);
                console.log(`💾 Estado guardado al desconectarse ${player.name}`);
            } catch (error) {
                console.error('Error al actualizar estado de conexión:', error);
            }

            if (player.isHost && room.players.length > 1) {
                const newHost = room.players.find(p => p.id !== player.id && p.ws?.readyState === WebSocket.OPEN);
                if (newHost) {
                    newHost.isHost = true;
                    broadcastToRoom(room, {
                        type: 'notification',
                        message: `${newHost.name} es ahora el host`,
                        isError: false
                    });
                }
            }
        });
    });

    return wss;
}

module.exports = { setupWebSocket };
