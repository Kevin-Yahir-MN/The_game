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
            cardsPlayedThisTurn: 0
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
    const playerId = uuidv4();
    const newPlayer = {
        id: playerId,
        name: playerName,
        isHost: false,
        ws: null,
        cards: [],
        cardsPlayedThisTurn: 0
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
        }
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
                remainingDeck: room.gameState.deck.length
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
                        type: 'invalid_move',
                        reason: 'Posición inválida'
                    }));
                    return;
                }

                if (!player.cards.includes(msg.cardValue)) {
                    player.ws.send(JSON.stringify({
                        type: 'invalid_move',
                        reason: 'No tienes esa carta'
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
                endTurn(room, player, msg.cardsPlayed);
            }
            break;
    }
}

// Nueva función para devolver una carta
function returnCard(room, player, cardValue, position) {
    if (position.includes('asc')) {
        const index = position === 'asc1' ? 0 : 1;
        if (room.gameState.board.ascending[index] === cardValue) {
            room.gameState.board.ascending[index] = position === 'asc1' ? 1 : 1;
            player.cards.push(cardValue);
            player.cardsPlayedThisTurn--;
        }
    } else {
        const index = position === 'desc1' ? 0 : 1;
        if (room.gameState.board.descending[index] === cardValue) {
            room.gameState.board.descending[index] = position === 'desc1' ? 100 : 100;
            player.cards.push(cardValue);
            player.cardsPlayedThisTurn--;
        }
    }
    broadcastGameState(room);
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
    room.gameState.currentTurn = room.players[0].id;

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

    if (position.includes('asc')) {
        const target = position === 'asc1' ? 0 : 1;
        const targetValue = board.ascending[target];
        // Validar: carta > valor actual O carta = valor actual - 10
        if (cardValue > targetValue || cardValue === targetValue - 10) {
            board.ascending[target] = cardValue;
            validMove = true;
        } else {
            player.ws.send(JSON.stringify({
                type: 'invalid_move',
                reason: `En pilas ascendentes, la carta debe ser mayor que ${targetValue} o igual a ${targetValue - 10}`
            }));
        }
    } else {
        const target = position === 'desc1' ? 0 : 1;
        const targetValue = board.descending[target];
        // Validar: carta < valor actual O carta = valor actual + 10
        if (cardValue < targetValue || cardValue === targetValue + 10) {
            board.descending[target] = cardValue;
            validMove = true;
        } else {
            player.ws.send(JSON.stringify({
                type: 'invalid_move',
                reason: `En pilas descendentes, la carta debe ser menor que ${targetValue} o igual a ${targetValue + 10}`
            }));
        }
    }

    if (validMove) {
        player.cards.splice(cardIndex, 1);
        player.cardsPlayedThisTurn++;
        checkGameStatus(room);
        broadcastGameState(room);
    }
}

function returnCards(room, player, cards) {
    cards.forEach(cardInfo => {
        // Buscar la carta en el tablero y devolverla a la mano del jugador
        if (cardInfo.position.includes('asc')) {
            const index = cardInfo.position === 'asc1' ? 0 : 1;
            if (room.gameState.board.ascending[index] === cardInfo.value) {
                room.gameState.board.ascending[index] = cardInfo.position === 'asc1' ? 1 : 1;
                player.cards.push(cardInfo.value);
                player.cardsPlayedThisTurn--;
            }
        } else {
            const index = cardInfo.position === 'desc1' ? 0 : 1;
            if (room.gameState.board.descending[index] === cardInfo.value) {
                room.gameState.board.descending[index] = cardInfo.position === 'desc1' ? 100 : 100;
                player.cards.push(cardInfo.value);
                player.cardsPlayedThisTurn--;
            }
        }
    });
    broadcastGameState(room);
}

function endTurn(room, player, cardsPlayed) {
    // Verificar mínimo de cartas jugadas
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn < minCardsRequired) {
        player.ws.send(JSON.stringify({
            type: 'invalid_move',
            reason: `Debes jugar al menos ${minCardsRequired} cartas este turno`
        }));
        return;
    }

    // Robar cartas automáticamente
    if (player.cardsPlayedThisTurn > 0 && room.gameState.deck.length > 0) {
        const cardsToDraw = Math.min(player.cardsPlayedThisTurn, room.gameState.deck.length);
        for (let i = 0; i < cardsToDraw; i++) {
            player.cards.push(room.gameState.deck.pop());
        }

        // Si el mazo se acaba, notificar a todos
        if (room.gameState.deck.length === 0) {
            broadcastToRoom(room, {
                type: 'deck_empty'
            });
        }
    }

    // Pasar al siguiente turno
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.gameState.currentTurn = room.players[nextIndex].id;

    // Reiniciar contador de cartas jugadas
    player.cardsPlayedThisTurn = 0;

    broadcastGameState(room);
}

function checkGameStatus(room) {
    // Verificar si algún jugador se quedó sin cartas
    const playersWithCards = room.players.filter(p => p.cards.length > 0).length;

    if (playersWithCards === 0 && room.gameState.deck.length === 0) {
        // Todos ganan
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'win',
            message: '¡Todos ganan! Todas las cartas jugadas.'
        });
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
                    remainingDeck: room.gameState.deck.length
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