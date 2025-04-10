const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
const HEARTBEAT_INTERVAL = 300000;
const allowedOrigins = [
    'https://the-game-2xks.onrender.com',
    'http://localhost:3000'
];

function log(level, message) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    if (levels[level] <= levels[LOG_LEVEL]) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

        if (level === 'error') {
            console.error(logMessage);
        } else if (level === 'warn') {
            console.warn(logMessage);
        } else {
            console.log(logMessage);
        }
    }
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            log('warn', `Origen bloqueado: ${info.origin}`);
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const rooms = new Map();
const reverseRoomMap = new WeakMap();
const boardHistory = new Map();
const connectedPlayers = new Set();

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

function safeSend(ws, message) {
    try {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            log('debug', `Mensaje enviado: ${message.type}`);
        }
    } catch (error) {
        log('error', `Error enviando mensaje: ${error}`);
    }
}

function broadcastToRoom(room, message, options = {}) {
    const { includeGameState = false } = options;
    room.players.forEach(player => {
        safeSend(player.ws, message);
        if (includeGameState) sendGameState(room, player);
    });
}

function sendGameState(room, player) {
    safeSend(player.ws, {
        type: 'game_state',
        state: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            yourCards: player.cards,
            initialCards: room.gameState.initialCards,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
            })),
            remainingDeck: room.gameState.deck.length,
            isYourTurn: room.gameState.currentTurn === player.id,
            isSoloGame: room.players.length === 1
        }
    });
}

function startGame(room, initialCards = 6) {
    if (room.players.length < 1) {
        log('warn', 'Intento de iniciar juego sin jugadores');
        return false;
    }

    room.gameState.gameStarted = true;
    room.gameState.initialCards = initialCards;
    room.gameState.currentTurn = room.players[0].id;

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
        player.cardsPlayedThisTurn = [];
    });

    log('info', `Juego iniciado en sala ${reverseRoomMap.get(room)} con ${room.players.length} jugador(es)`);
    return true;
}

app.post('/create-room', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({ success: false, message: 'Se requiere nombre de jugador' });
    }

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    const playerId = uuidv4();
    const room = {
        players: [{
            id: playerId,
            name: playerName,
            isHost: true,
            ws: null,
            cards: [],
            cardsPlayedThisTurn: []
        }],
        gameState: {
            deck: initializeDeck(),
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: playerId,
            gameStarted: false,
            initialCards: 6
        }
    };

    rooms.set(roomId, room);
    reverseRoomMap.set(room, roomId);
    boardHistory.set(roomId, {
        ascending1: [1], ascending2: [1],
        descending1: [100], descending2: [100]
    });

    res.json({ success: true, roomId, playerId, playerName });
});

app.post('/join-room', (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) {
        return res.status(400).json({
            success: false,
            message: 'Nombre de jugador y código de sala requeridos'
        });
    }

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const playerId = uuidv4();
    const newPlayer = {
        id: playerId,
        name: playerName,
        isHost: false,
        ws: null,
        cards: [],
        cardsPlayedThisTurn: []
    };

    room.players.push(newPlayer);
    res.json({ success: true, playerId, playerName });
});

app.get('/room-info/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    res.json({
        success: true,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length,
            connected: p.ws !== null
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards
    });
});

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');

    if (!roomId || !playerId || !rooms.has(roomId)) {
        log('warn', `Intento de conexión con datos inválidos`);
        return ws.close(1008, 'Datos inválidos');
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        log('warn', `Jugador no registrado`);
        return ws.close(1008, 'Jugador no registrado');
    }

    player.ws = ws;
    if (!connectedPlayers.has(playerId)) {
        log('info', `Jugador conectado: ${player.name}`);
        connectedPlayers.add(playerId);
    }

    const response = {
        type: 'init_game',
        playerId: player.id,
        roomId,
        isHost: player.isHost,
        gameState: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            gameStarted: room.gameState.gameStarted,
            initialCards: room.gameState.initialCards,
            remainingDeck: room.gameState.deck.length,
            isSoloGame: room.players.length === 1
        },
        isYourTurn: room.gameState.currentTurn === player.id
    };

    if (room.gameState.gameStarted) {
        response.yourCards = player.cards;
        response.players = room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.cards.length,
            cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
        }));
    }

    safeSend(ws, response);

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            switch (msg.type) {
                case 'start_game':
                    if (player.isHost && !room.gameState.gameStarted) {
                        const success = startGame(room, msg.initialCards);

                        if (success) {
                            broadcastToRoom(room, {
                                type: 'game_started',
                                state: {
                                    board: room.gameState.board,
                                    currentTurn: room.gameState.currentTurn,
                                    remainingDeck: room.gameState.deck.length,
                                    initialCards: msg.initialCards,
                                    players: room.players.map(p => ({
                                        id: p.id,
                                        name: p.name,
                                        cardCount: p.cards.length,
                                        cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
                                    })),
                                    isSoloGame: room.players.length === 1
                                }
                            });

                            room.players.forEach(p => {
                                if (p.ws?.readyState === WebSocket.OPEN) {
                                    safeSend(p.ws, {
                                        type: 'your_cards',
                                        cards: p.cards,
                                        isSoloGame: room.players.length === 1
                                    });
                                }
                            });
                        }
                    }
                    break;

                case 'play_card':
                    if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                        handlePlayCard(room, player, msg);
                    }
                    break;

                case 'end_turn':
                    if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                        endTurn(room, player);
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

                case 'self_blocked':
                    if (rooms.has(msg.roomId)) {
                        const room = rooms.get(msg.roomId);
                        const player = room.players.find(p => p.id === msg.playerId);

                        if (player) {
                            broadcastToRoom(room, {
                                type: 'game_over',
                                result: 'lose',
                                message: `¡${player.name} se quedó sin movimientos posibles!`,
                                reason: 'self_blocked'
                            });
                        }
                    }
                    break;

                case 'reset_room':
                    if (player.isHost && rooms.has(msg.roomId)) {
                        const room = rooms.get(msg.roomId);
                        room.gameState = {
                            deck: initializeDeck(),
                            board: { ascending: [1, 1], descending: [100, 100] },
                            currentTurn: room.players[0].id,
                            gameStarted: false,
                            initialCards: room.gameState.initialCards || 6
                        };

                        room.players.forEach(player => {
                            player.cards = [];
                            player.cardsPlayedThisTurn = [];
                        });

                        broadcastToRoom(room, {
                            type: 'room_reset',
                            message: 'La sala ha sido reiniciada para una nueva partida'
                        });
                    }
                    break;

                case 'heartbeat':
                    if (!msg.playerId || !msg.roomId) {
                        log('warn', 'Heartbeat inválido recibido', msg);
                        break;
                    }

                    const room = rooms.get(msg.roomId);
                    if (!room) {
                        log('warn', `Heartbeat para sala no encontrada: ${msg.roomId}`);
                        break;
                    }

                    const player = room.players.find(p => p.id === msg.playerId);
                    if (!player) {
                        log('warn', `Heartbeat de jugador no encontrado: ${msg.playerId}`);
                        break;
                    }

                    player.lastActivity = Date.now();
                    log('debug', `Heartbeat de ${player.name} (${msg.playerId}) en sala ${msg.roomId}`);
                    break;

                default:
                    console.log('Tipo de mensaje no reconocido:', msg.type);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log(`✖ ${player.name} desconectado`);
        player.ws = null;

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

server.listen(PORT, () => {
    log('info', `Servidor iniciado en puerto ${PORT}`);
    log('info', `Nivel de logs: ${LOG_LEVEL}`);
});