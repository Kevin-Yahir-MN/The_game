// src/ws/websocket.js
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { allowedOrigins } = require('../config');
const { rooms, reverseRoomMap, boardHistory, wsRateLimit, emojiRateLimit } = require('../state');
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
    resetPlayerTurnState,
    finalizeGame
} = require('../services/gameService');
const { safeSend, broadcastToRoom, sendGameState } = require('../services/communication');
const { flushSaveGameState } = require('../services/persistence');
// necesitamos autenticación para conexiones de lobby
const { getUserFromToken } = require('../services/authService');

// mapa simple para clientes en el lobby (no en una sala)
const lobbyClients = new Map(); // key = userId or lobbyId -> { ws, userId, displayName }

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

function isTransientDbConnectionError(error) {
    if (!error) return false;
    const message = String(error.message || '').toLowerCase();
    const causeMessage = String(error.cause?.message || '').toLowerCase();

    return (
        message.includes('connection terminated') ||
        message.includes('connection timeout') ||
        causeMessage.includes('connection terminated') ||
        causeMessage.includes('connection timeout')
    );
}

async function safePersistOnDisconnect(roomId, playerId) {
    try {
        await pool.query(`
            UPDATE player_connections
            SET connection_status = 'disconnected'
            WHERE player_id = $1
        `, [playerId]);
    } catch (error) {
        if (isTransientDbConnectionError(error)) {
            console.warn('⚠️ No se pudo marcar desconexión (BD inactiva/transitoria).');
            return false;
        }
        throw error;
    }

    try {
        await flushSaveGameState(roomId);
        return true;
    } catch (error) {
        if (isTransientDbConnectionError(error)) {
            console.warn('⚠️ No se pudo guardar estado al desconectar (BD inactiva/transitoria).');
            return false;
        }
        throw error;
    }
}

const ALLOWED_EMOJI_REACTIONS = [
    'sad',
    'angry',
    'poop',
    'love',
    'wow',
    'middle',
    'cry',
    'proud',
    'angel',
    'demon',
    'sleep'
];
const EMOJI_WINDOW_MS = 10_000;
const EMOJI_MAX_PER_WINDOW = 3;

function checkEmojiRateLimit(playerId) {
    const now = Date.now();
    let history = emojiRateLimit.get(playerId) || [];
    history = history.filter(timestamp => now - timestamp < EMOJI_WINDOW_MS);

    if (history.length >= EMOJI_MAX_PER_WINDOW) {
        const oldest = history[0];
        const remainingMs = EMOJI_WINDOW_MS - (now - oldest);
        return {
            allowed: false,
            remainingMs
        };
    }

    history.push(now);
    emojiRateLimit.set(playerId, history);

    return {
        allowed: true,
        remainingMs: 0
    };
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
        const isLobby = params.get('lobby') === 'true';

        // lobby connection: sólo para recibir invitaciones y respuesta
        if (isLobby) {
            const token = params.get('token');
            let identity = null;
            if (token) {
                identity = await getUserFromToken(token);
            }
            let lobbyId;
            if (identity) {
                lobbyId = identity.id;
            } else {
                lobbyId = params.get('lobbyId') || uuidv4();
            }
            const display = identity ? identity.display_name : decodeURIComponent(params.get('displayName') || 'Invitado');
            lobbyClients.set(lobbyId, { ws, userId: identity ? identity.id : null, displayName: display });

            ws.on('close', () => {
                lobbyClients.delete(lobbyId);
            });

            ws.on('message', async (message) => {
                try {
                    const msg = parseWsMessage(message);
                    // manejar respuesta de invitación
                    if (msg.type === 'invite_response') {
                        const { inviterPlayerId, accepted, roomId: rId, fromUserId } = msg;
                        // buscar invitador dentro de las salas
                        for (const [rid, room] of rooms) {
                            const player = room.players.find(p => p.id === inviterPlayerId);
                            if (player && player.ws) {
                                safeSend(player.ws, {
                                    type: 'friend_invite_response',
                                    accepted,
                                    roomId: rId,
                                    fromUserId: fromUserId || lobbyId
                                });
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error procesando mensaje de lobby:', error);
                }
            });

            // no continuamos con el resto de la lógica de sala
            return;
        }

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
                    cardCount: p.cards.length,
                    connected: p.ws?.readyState === WebSocket.OPEN,
                    userId: p.userId || null
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
                isHost: p.isHost,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: getPlayerTurnCount(p),
                connected: p.ws?.readyState === WebSocket.OPEN,
                userId: p.userId || null
            }));
        }

        safeSend(ws, response);

        // Notificar a todos los jugadores que alguien se conectó
        broadcastToRoom(room, {
            type: 'room_update',
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                connected: p.ws?.readyState === WebSocket.OPEN,
                userId: p.userId || null
            }))
        });

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
                    try {
                        await pool.query(`
                            UPDATE player_connections
                            SET last_ping = NOW()
                            WHERE player_id = $1
                        `, [playerId]);
                    } catch (error) {
                        if (!isTransientDbConnectionError(error)) throw error;
                        console.warn('⚠️ Ping recibido, pero no se pudo actualizar last_ping por BD inactiva.');
                    }
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
                        finalizeGame(room, {
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
                                finalizeGame(room, {
                                    result: 'lose',
                                    message: `¡No puedes jugar el mínimo de ${minCardsRequired} carta(s) requerida(s)!`,
                                    reason: 'min_cards_not_met_solo'
                                });
                            }
                        }
                        break;
                    }
                    case 'self_blocked':
                        finalizeGame(room, {
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
                                initialCards: room.gameState.initialCards || 6,
                                gameFinished: false
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
                    case 'emoji_reaction': {
                        const code = typeof msg.emoji === 'string' ? msg.emoji.trim() : '';
                        if (!ALLOWED_EMOJI_REACTIONS.includes(code)) {
                            safeSend(player.ws, {
                                type: 'notification',
                                message: 'Reacción no permitida',
                                isError: true,
                                errorCode: 'INVALID_EMOJI_REACTION'
                            });
                            break;
                        }

                        const { allowed, remainingMs } = checkEmojiRateLimit(player.id);
                        if (!allowed) {
                            const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
                            safeSend(player.ws, {
                                type: 'notification',
                                message: `Has enviado demasiadas reacciones. Espera ${seconds} segundo(s) para enviar más emojis.`,
                                isError: true,
                                errorCode: 'EMOJI_RATE_LIMIT'
                            });
                            break;
                        }

                        broadcastToRoom(room, {
                            type: 'emoji_reaction',
                            emoji: code,
                            fromPlayerId: player.id,
                            fromPlayerName: player.name
                        });
                        break;
                    }
                    case 'invite_friend': {
                        // el cliente en sala solicita enviar invitación a amigo en lobby
                        const targetUserId = msg.targetUserId;
                        if (typeof targetUserId !== 'string') break;

                        if (!player.userId) {
                            safeSend(player.ws, {
                                type: 'notification',
                                message: 'Debes estar autenticado para invitar amigos',
                                isError: true
                            });
                            break;
                        }

                        // verificar relación de amistad
                        try {
                            const res = await pool.query(
                                'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2',
                                [player.userId, targetUserId]
                            );
                            if (res.rowCount === 0) {
                                safeSend(player.ws, {
                                    type: 'notification',
                                    message: 'Solo puedes invitar a tus amigos',
                                    isError: true
                                });
                                break;
                            }
                        } catch (dbErr) {
                            console.error('Error comprobando amistad:', dbErr);
                            // continuar, no bloqueamos invitación en caso de error de BD?
                        }

                        const target = lobbyClients.get(targetUserId);
                        if (target && target.ws && target.ws.readyState === WebSocket.OPEN) {
                            safeSend(target.ws, {
                                type: 'friend_invite',
                                fromUserId: player.userId || null,
                                fromDisplayName: player.name,
                                inviterPlayerId: player.id,
                                roomId
                            });
                        } else {
                            safeSend(player.ws, {
                                type: 'notification',
                                message: 'El usuario no está en el lobby o no disponible',
                                isError: true
                            });
                        }
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
            emojiRateLimit.delete(playerId);

            try {
                const persisted = await safePersistOnDisconnect(roomId, playerId);
                if (persisted) {
                    console.log(`💾 Estado guardado al desconectarse ${player.name}`);
                }
            } catch (error) {
                console.error('Error al actualizar estado de conexión:', error);
            }

            // Solo remover al jugador si la partida aún no ha comenzado
            // Si la partida ya comenzó, mantenerlo en la sala para que pueda reconectarse
            if (!room.gameState.gameStarted) {
                const playerIndex = room.players.findIndex(p => p.id === playerId);
                if (playerIndex !== -1) {
                    room.players.splice(playerIndex, 1);
                }

                // Notificar a todos que este jugador se desconectó (solo en pre-juego)
                broadcastToRoom(room, {
                    type: 'player_left',
                    playerId: playerId,
                    playerName: player.name,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        isHost: p.isHost,
                        connected: p.ws?.readyState === WebSocket.OPEN,
                        userId: p.userId || null
                    }))
                });
            }

            if (player.isHost && room.players.length > 0) {
                const newHost = room.players.find(p => p.ws?.readyState === WebSocket.OPEN);
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
