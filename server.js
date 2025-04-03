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

// Endpoints API
app.post('/create-room', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ success: false, message: 'Nombre requerido' });

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    const hostId = uuidv4();

    rooms.set(roomId, {
        players: [{
            id: hostId,
            name: playerName,
            isHost: true,
            ws: null,
            cards: []
        }],
        gameState: {
            deck: initializeDeck(),
            board: {
                ascending: [1, 1],
                descending: [100, 100]
            },
            currentTurn: hostId,
            gameStarted: false
        }
    });

    res.json({
        success: true,
        roomId,
        playerId: hostId
    });
});

app.post('/join-room', (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) return res.status(400).json({ success: false, message: 'Datos incompletos' });
    if (!rooms.has(roomId)) return res.status(404).json({ success: false, message: 'Sala no encontrada' });

    const room = rooms.get(roomId);
    const playerId = uuidv4();
    const newPlayer = {
        id: playerId,
        name: playerName,
        isHost: false,
        ws: null,
        cards: []
    };

    room.players.push(newPlayer);

    res.json({
        success: true,
        playerId,
        host: room.players.find(p => p.isHost).name
    });
});

app.get('/room-info/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) return res.status(404).json({ success: false });

    const room = rooms.get(roomId);
    res.json({
        success: true,
        players: room.players.map(p => ({
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length
        })),
        gameStarted: room.gameState.gameStarted
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

    player.ws = ws;
    console.log(`✔ ${player.name} conectado a sala ${roomId}`);

    // Enviar estado inicial
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
            }))
        }
    }));

    // Notificar a todos de la nueva conexión
    broadcastRoomUpdate(room);

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            handleGameMessage(room, player, msg);
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        player.ws = null;
        console.log(`✖ ${player.name} desconectado`);
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
            if (player.id === room.gameState.currentTurn) {
                playCard(room, player, msg.card, msg.position);
            }
            break;

        case 'draw_card':
            if (player.id === room.gameState.currentTurn) {
                drawCard(room, player);
            }
            break;
    }
}

function startGame(room) {
    room.gameState.gameStarted = true;

    // Repartir cartas
    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < 6; i++) {
            if (room.gameState.deck.length > 0) {
                player.cards.push(room.gameState.deck.pop());
            }
        }
    });

    room.gameState.currentTurn = room.players[0].id;

    broadcastGameState(room);
}

function playCard(room, player, cardValue, position) {
    const cardIndex = player.cards.findIndex(c => c === cardValue);
    if (cardIndex === -1) return;

    const board = room.gameState.board;
    let validMove = false;

    if (position === 'asc1' || position === 'asc2') {
        const target = position === 'asc1' ? 0 : 1;
        if (cardValue > board.ascending[target] || cardValue === board.ascending[target] - 10) {
            board.ascending[target] = cardValue;
            validMove = true;
        }
    } else {
        const target = position === 'desc1' ? 0 : 1;
        if (cardValue < board.descending[target] || cardValue === board.descending[target] + 10) {
            board.descending[target] = cardValue;
            validMove = true;
        }
    }

    if (validMove) {
        player.cards.splice(cardIndex, 1);
        nextTurn(room);
    }
}

function drawCard(room, player) {
    if (room.gameState.deck.length > 0) {
        player.cards.push(room.gameState.deck.pop());
        nextTurn(room);
    }
}

function nextTurn(room) {
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.gameState.currentTurn = room.players[nextIndex].id;

    broadcastGameState(room);
}

// Helper functions
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
                    }))
                }
            }));
        }
    });
}

function broadcastRoomUpdate(room) {
    const roomInfo = {
        type: 'room_update',
        players: room.players.map(p => ({
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length,
            connected: p.ws !== null
        })),
        gameStarted: room.gameState.gameStarted
    };

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(roomInfo));
        }
    });
}

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

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});