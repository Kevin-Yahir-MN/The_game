const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración CORS
const allowedOrigins = [
    'https://the-game-2xks.onrender.com',
    'http://localhost:3000'
];

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

// WebSocket Server
const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            console.warn(`Origen bloqueado: ${info.origin}`);
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Almacenamiento de salas
const rooms = new Map();
const boardHistory = new Map();

// Inicializar mazo de cartas
function initializeDeck() {
    const deck = [];
    for (let i = 2; i < 100; i++) {
        deck.push(i);
    }
    return shuffleArray(deck);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Endpoints API
app.post('/create-room', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({
            success: false,
            message: 'Se requiere nombre de jugador'
        });
    }

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    const playerId = uuidv4();

    rooms.set(roomId, {
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
            board: {
                ascending: [1, 1],    // [asc1, asc2]
                descending: [100, 100] // [desc1, desc2]
            },
            currentTurn: playerId,
            gameStarted: false
        }
    });

    // Inicializar historial para esta sala
    boardHistory.set(roomId, {
        ascending1: [1],
        ascending2: [1],
        descending1: [100],
        descending2: [100]
    });

    res.json({
        success: true,
        roomId,
        playerId,
        playerName
    });
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
        return res.status(404).json({
            success: false,
            message: 'Sala no encontrada'
        });
    }

    const room = rooms.get(roomId);
    if (room.gameState.gameStarted) {
        return res.status(400).json({
            success: false,
            message: 'El juego ya ha comenzado en esta sala'
        });
    }

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

    res.json({
        success: true,
        playerId,
        playerName,
        host: room.players.find(p => p.isHost).name
    });
});

app.get('/room-info/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) {
        return res.status(404).json({
            success: false,
            message: 'Sala no encontrada'
        });
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
        currentTurn: room.gameState.currentTurn
    });
});

// WebSocket Logic
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');

    if (!roomId || !playerId || !rooms.has(roomId)) {
        return ws.close(1008, 'Datos inválidos');
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) return ws.close(1008, 'Jugador no registrado');

    // Actualizar conexión WebSocket del jugador
    player.ws = ws;
    console.log(`✔ ${player.name} conectado a sala ${roomId}`);

    // Notificar a todos los jugadores
    broadcastRoomUpdate(room);

    // Enviar estado inicial al jugador
    ws.send(JSON.stringify({
        type: 'init_game',
        playerId: player.id,
        roomId: roomId,
        isHost: player.isHost,
        gameState: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            gameStarted: room.gameState.gameStarted,
            remainingDeck: room.gameState.deck.length
        },
        isYourTurn: room.gameState.currentTurn === player.id
    }));

    // Si el juego ya empezó, enviar el estado completo
    if (room.gameState.gameStarted) {
        ws.send(JSON.stringify({
            type: 'game_state',
            state: {
                board: room.gameState.board,
                currentTurn: room.gameState.currentTurn,
                yourCards: player.cards,
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    cardCount: p.cards.length
                })),
                remainingDeck: room.gameState.deck.length,
                isYourTurn: room.gameState.currentTurn === player.id
            }
        }));
    }

    // Manejo de mensajes
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            handleGameMessage(room, player, msg);
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log(`✖ ${player.name} desconectado`);
        player.ws = null;
        broadcastRoomUpdate(room);

        // Si el host se desconecta, asignar nuevo host
        if (player.isHost && room.players.length > 1) {
            const newHost = room.players.find(p => p.id !== player.id);
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

// Game Logic
function handleGameMessage(room, player, msg) {
    switch (msg.type) {
        case 'start_game':
            if (player.isHost && !room.gameState.gameStarted) {
                startGame(room);
            }
            break;

        case 'play_card':
            if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
                if (!validPositions.includes(msg.position)) {
                    player.ws.send(JSON.stringify({
                        type: 'notification',
                        message: 'Posición inválida',
                        isError: true
                    }));
                    return;
                }

                if (!player.cards.includes(msg.cardValue)) {
                    player.ws.send(JSON.stringify({
                        type: 'notification',
                        message: 'No tienes esa carta',
                        isError: true
                    }));
                    return;
                }

                playCard(room, player, msg.cardValue, msg.position);
            }
            break;

        case 'return_card':
            if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                returnCard(room, player, msg.cardValue, msg.position);
            }
            break;

        case 'end_turn':
            if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                endTurn(room, player);
            }
            break;

        case 'get_game_state':
            if (room.gameState.gameStarted) {
                player.ws.send(JSON.stringify({
                    type: 'game_state',
                    state: {
                        board: room.gameState.board,
                        currentTurn: room.gameState.currentTurn,
                        yourCards: player.cards,
                        players: room.players.map(p => ({
                            id: p.id,
                            name: p.name,
                            cardCount: p.cards.length
                        })),
                        remainingDeck: room.gameState.deck.length,
                        isYourTurn: room.gameState.currentTurn === player.id
                    }
                }));
            }
            break;
    }
}

function startGame(room) {
    room.gameState.gameStarted = true;

    // Repartir cartas iniciales (6 por jugador)
    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < 6; i++) {
            if (room.gameState.deck.length > 0) {
                player.cards.push(room.gameState.deck.pop());
            }
        }
    });

    // El host juega primero
    room.gameState.currentTurn = room.players.find(p => p.isHost).id;

    // Notificar a todos que el juego ha comenzado
    broadcastToRoom(room, {
        type: 'game_started'
    });

    // Enviar estado inicial del juego
    broadcastGameState(room);
}

function playCard(room, player, cardValue, position) {
    const cardIndex = player.cards.indexOf(cardValue);
    if (cardIndex === -1) return;

    const board = room.gameState.board;
    let validMove = false;

    // Actualizar historial antes de cambiar el valor
    updateBoardHistory(room, position, board);

    if (position.includes('asc')) {
        const target = position === 'asc1' ? 0 : 1;
        const targetValue = board.ascending[target];
        if (cardValue > targetValue || cardValue === targetValue - 10) {
            board.ascending[target] = cardValue;
            validMove = true;
        }
    } else {
        const target = position === 'desc1' ? 0 : 1;
        const targetValue = board.descending[target];
        if (cardValue < targetValue || cardValue === targetValue + 10) {
            board.descending[target] = cardValue;
            validMove = true;
        }
    }

    if (validMove) {
        player.cards.splice(cardIndex, 1);
        player.cardsPlayedThisTurn.push({
            value: cardValue,
            position: position
        });

        checkGameStatus(room);
        broadcastGameState(room);
    } else {
        player.ws.send(JSON.stringify({
            type: 'notification',
            message: 'Movimiento inválido',
            isError: true
        }));
    }
}

function updateBoardHistory(room, position, board) {
    const roomId = Array.from(rooms.entries()).find(([id, r]) => r === room)[0];
    const history = boardHistory.get(roomId);
    let currentValue;

    if (position === 'asc1') currentValue = board.ascending[0];
    else if (position === 'asc2') currentValue = board.ascending[1];
    else if (position === 'desc1') currentValue = board.descending[0];
    else if (position === 'desc2') currentValue = board.descending[1];
    else return;

    // Solo agregar si el valor es diferente al último registrado
    const lastValue = getLastHistoryValue(history, position);
    if (currentValue !== lastValue) {
        if (position === 'asc1') history.ascending1.push(currentValue);
        else if (position === 'asc2') history.ascending2.push(currentValue);
        else if (position === 'desc1') history.descending1.push(currentValue);
        else if (position === 'desc2') history.descending2.push(currentValue);
    }
}

function getLastHistoryValue(history, position) {
    switch (position) {
        case 'asc1': return history.ascending1[history.ascending1.length - 1];
        case 'asc2': return history.ascending2[history.ascending2.length - 1];
        case 'desc1': return history.descending1[history.descending1.length - 1];
        case 'desc2': return history.descending2[history.descending2.length - 1];
        default: return null;
    }
}

function returnCard(room, player, cardValue, position) {
    const board = room.gameState.board;

    // Verificar que la carta está actualmente en la posición especificada
    let currentValue;
    if (position.includes('asc')) {
        const index = position === 'asc1' ? 0 : 1;
        currentValue = board.ascending[index];
    } else {
        const index = position === 'desc1' ? 0 : 1;
        currentValue = board.descending[index];
    }

    if (currentValue !== cardValue) {
        player.ws.send(JSON.stringify({
            type: 'notification',
            message: 'La carta ya no está en esa posición',
            isError: true
        }));
        return;
    }

    // Verificar que el jugador jugó esa carta este turno
    if (!player.cardsPlayedThisTurn.some(c => c.value === cardValue && c.position === position)) {
        player.ws.send(JSON.stringify({
            type: 'notification',
            message: 'No puedes devolver cartas que no hayas jugado este turno',
            isError: true
        }));
        return;
    }

    // Buscar el valor anterior en el historial
    const previousValue = findPreviousValue(room, position, cardValue);

    // Actualizar el tablero
    if (position.includes('asc')) {
        const index = position === 'asc1' ? 0 : 1;
        board.ascending[index] = previousValue || 1;
    } else {
        const index = position === 'desc1' ? 0 : 1;
        board.descending[index] = previousValue || 100;
    }

    // Devolver la carta al jugador
    player.cards.push(cardValue);

    // Eliminar de las cartas jugadas este turno
    player.cardsPlayedThisTurn = player.cardsPlayedThisTurn.filter(
        c => !(c.value === cardValue && c.position === position)
    );

    // Notificar a todos
    broadcastGameState(room);

    player.ws.send(JSON.stringify({
        type: 'card_returned',
        message: 'Carta devuelta a tu mano',
        cardValue: cardValue,
        position: position
    }));
}

function findPreviousValue(room, position, currentValue) {
    const roomId = Array.from(rooms.entries()).find(([id, r]) => r === room)[0];
    const history = boardHistory.get(roomId);

    switch (position) {
        case 'asc1':
            const asc1Index = history.ascending1.indexOf(currentValue);
            return asc1Index > 0 ? history.ascending1[asc1Index - 1] : null;
        case 'asc2':
            const asc2Index = history.ascending2.indexOf(currentValue);
            return asc2Index > 0 ? history.ascending2[asc2Index - 1] : null;
        case 'desc1':
            const desc1Index = history.descending1.indexOf(currentValue);
            return desc1Index > 0 ? history.descending1[desc1Index - 1] : null;
        case 'desc2':
            const desc2Index = history.descending2.indexOf(currentValue);
            return desc2Index > 0 ? history.descending2[desc2Index - 1] : null;
        default:
            return null;
    }
}

function endTurn(room, player) {
    // Verificar mínimo de cartas jugadas
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        player.ws.send(JSON.stringify({
            type: 'notification',
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
            isError: true
        }));
        return;
    }

    // Robar cartas automáticamente
    if (player.cardsPlayedThisTurn.length > 0 && room.gameState.deck.length > 0) {
        const cardsToDraw = Math.min(player.cardsPlayedThisTurn.length, room.gameState.deck.length);
        for (let i = 0; i < cardsToDraw; i++) {
            player.cards.push(room.gameState.deck.pop());
        }

        // Si el mazo se acaba, notificar a todos
        if (room.gameState.deck.length === 0) {
            broadcastToRoom(room, {
                type: 'notification',
                message: '¡El mazo se ha agotado!',
                isError: false
            });
        }
    }

    // Pasar al siguiente turno
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    let nextIndex = (currentIndex + 1) % room.players.length;

    // Saltar jugadores desconectados
    while (nextIndex !== currentIndex && (!room.players[nextIndex].ws || room.players[nextIndex].ws.readyState !== WebSocket.OPEN)) {
        nextIndex = (nextIndex + 1) % room.players.length;
    }

    room.gameState.currentTurn = room.players[nextIndex].id;

    // Reiniciar contador de cartas jugadas
    player.cardsPlayedThisTurn = [];

    // Notificar cambio de turno
    broadcastToRoom(room, {
        type: 'notification',
        message: `Ahora es el turno de ${room.players[nextIndex].name}`,
        isError: false
    });

    broadcastGameState(room);
}

function checkGameStatus(room) {
    // Verificar si todos los jugadores se quedaron sin cartas y el mazo está vacío
    const allPlayersEmpty = room.players.every(p => p.cards.length === 0);

    if (allPlayersEmpty && room.gameState.deck.length === 0) {
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'win',
            message: '¡Todos ganan! Todas las cartas jugadas.'
        });

        // Limpiar la sala después de un tiempo
        setTimeout(() => {
            const roomId = Array.from(rooms.entries()).find(([id, r]) => r === room)[0];
            rooms.delete(roomId);
            boardHistory.delete(roomId);
        }, 30000);
    }
}

// Helper functions
function broadcastToRoom(room, message) {
    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            try {
                player.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`Error enviando mensaje a ${player.name}:`, error);
            }
        }
    });
}

function broadcastGameState(room) {
    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
                type: 'game_state',
                state: {
                    board: room.gameState.board,
                    currentTurn: room.gameState.currentTurn,
                    yourCards: player.cards,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        cardCount: p.cards.length
                    })),
                    remainingDeck: room.gameState.deck.length,
                    isYourTurn: room.gameState.currentTurn === player.id
                }
            }));
        }
    });
}

function broadcastRoomUpdate(room) {
    const roomInfo = {
        type: 'room_update',
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length,
            connected: p.ws !== null
        })),
        gameStarted: room.gameState.gameStarted
    };

    broadcastToRoom(room, roomInfo);
}

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});