const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración
const PORT = process.env.PORT || 3000;
const allowedOrigins = [
    'https://the-game-2xks.onrender.com',
    'http://localhost:3000'
];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];

// Middleware CORS
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Estructuras de datos
const rooms = new Map();
const reverseRoomMap = new WeakMap();
const boardHistory = new Map();

// Funciones auxiliares
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
        }
    } catch (error) {
        console.error('Error enviando mensaje:', error);
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
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: p.id === room.gameState.currentTurn ?
                    p.cardsPlayedThisTurn.length : 0
            })),
            remainingDeck: room.gameState.deck.length,
            cardsPlayedThisTurn: player.id === room.gameState.currentTurn ?
                player.cardsPlayedThisTurn : []
        }
    });
}

function updateBoardHistory(room, position, newValue) {
    const roomId = reverseRoomMap.get(room);
    const history = boardHistory.get(roomId);
    const historyKey = {
        'asc1': 'ascending1',
        'asc2': 'ascending2',
        'desc1': 'descending1',
        'desc2': 'descending2'
    }[position];

    if (history[historyKey].slice(-1)[0] !== newValue) {
        history[historyKey].push(newValue);
    }
}

function getNextActivePlayerIndex(currentIndex, players) {
    for (let offset = 1; offset < players.length; offset++) {
        const nextIndex = (currentIndex + offset) % players.length;
        if (players[nextIndex].ws?.readyState === WebSocket.OPEN) {
            return nextIndex;
        }
    }
    return currentIndex;
}

// Función mejorada para cambiar de turno
function changeTurn(room) {
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);

    // Reiniciar contador del jugador actual
    room.players[currentIndex].cardsPlayedThisTurn = [];

    room.gameState.currentTurn = room.players[nextIndex].id;

    broadcastToRoom(room, {
        type: 'turn_changed',
        newPlayerId: room.players[nextIndex].id,
        previousPlayerId: room.players[currentIndex].id,
        cardsPlayedCount: 0
    }, { includeGameState: true });

    return room.players[nextIndex];
}

// Rutas API
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
            gameStarted: false
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
        currentTurn: room.gameState.currentTurn
    });
});

// WebSocket Handlers
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

    // Manejo de reconexión
    const response = {
        type: room.gameState.gameStarted ? 'reconnect_game' : 'init_game',
        playerId: player.id,
        roomId,
        isHost: player.isHost,
        gameState: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            remainingDeck: room.gameState.deck.length,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: p.id === room.gameState.currentTurn ?
                    p.cardsPlayedThisTurn.length : 0
            })),
            cardsPlayedThisTurn: player.id === room.gameState.currentTurn ?
                player.cardsPlayedThisTurn : []
        }
    };

    if (room.gameState.gameStarted) {
        response.yourCards = player.cards;
    }

    safeSend(ws, response);

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            switch (msg.type) {
                case 'start_game':
                    if (player.isHost && !room.gameState.gameStarted) startGame(room);
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

// Lógica del juego
function startGame(room) {
    if (room.players.length < 2) {
        return broadcastToRoom(room, {
            type: 'notification',
            message: 'Se necesitan al menos 2 jugadores para comenzar',
            isError: true
        });
    }

    room.gameState.gameStarted = true;
    const cardsToDeal = room.players.length <= 3 ? 6 : 5;

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < cardsToDeal && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
        player.cardsPlayedThisTurn = [];
    });

    broadcastToRoom(room, {
        type: 'game_started',
        state: {
            board: room.gameState.board,
            currentTurn: room.players[0].id,
            remainingDeck: room.gameState.deck.length,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.cards.length,
                cardsPlayedThisTurn: 0
            }))
        }
    });

    room.players.forEach(player => {
        safeSend(player.ws, { type: 'your_cards', cards: player.cards });
    });
}

function handlePlayCard(room, player, msg) {
    // Verificar si la carta ya fue jugada este turno
    if (player.cardsPlayedThisTurn.some(move => move.value === msg.cardValue)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'Ya jugaste esta carta este turno',
            isError: true
        });
    }

    if (!validPositions.includes(msg.position)) {
        safeSend(player.ws, {
            type: 'notification',
            message: 'Posición inválida',
            isError: true
        });
        return safeSend(player.ws, {
            type: 'invalid_move',
            playerId: player.id
        });
    }

    if (!player.cards.includes(msg.cardValue)) {
        safeSend(player.ws, {
            type: 'notification',
            message: 'No tienes esa carta',
            isError: true
        });
        return safeSend(player.ws, {
            type: 'invalid_move',
            playerId: player.id
        });
    }

    const board = room.gameState.board;
    const targetIdx = msg.position.includes('asc') ?
        (msg.position === 'asc1' ? 0 : 1) :
        (msg.position === 'desc1' ? 0 : 1);
    const targetValue = msg.position.includes('asc') ?
        board.ascending[targetIdx] :
        board.descending[targetIdx];
    const isValid = msg.position.includes('asc') ?
        (msg.cardValue > targetValue || msg.cardValue === targetValue - 10) :
        (msg.cardValue < targetValue || msg.cardValue === targetValue + 10);

    if (!isValid) {
        safeSend(player.ws, {
            type: 'notification',
            message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
            isError: true
        });
        return safeSend(player.ws, {
            type: 'invalid_move',
            playerId: player.id
        });
    }

    // Guardar valor anterior para posible deshacer
    const previousValue = msg.position.includes('asc') ?
        board.ascending[targetIdx] :
        board.descending[targetIdx];

    // Actualizar el tablero
    if (msg.position.includes('asc')) {
        board.ascending[targetIdx] = msg.cardValue;
    } else {
        board.descending[targetIdx] = msg.cardValue;
    }

    // Eliminar carta de la mano del jugador
    player.cards.splice(player.cards.indexOf(msg.cardValue), 1);

    // Añadir al contador de cartas jugadas este turno
    player.cardsPlayedThisTurn.push({
        value: msg.cardValue,
        position: msg.position,
        previousValue
    });

    // Notificar a todos los jugadores
    broadcastToRoom(room, {
        type: 'card_played',
        cardValue: msg.cardValue,
        position: msg.position,
        playerId: player.id,
        playerName: player.name,
        cardsPlayedCount: player.cardsPlayedThisTurn.length
    });

    // Actualizar historial del tablero
    updateBoardHistory(room, msg.position, msg.cardValue);

    // Enviar estado actualizado a todos
    broadcastGameState(room);
    checkGameStatus(room);
}

function handleUndoMove(room, player, msg) {
    // Verificar que la última jugada fue de este jugador
    if (player.cardsPlayedThisTurn.length === 0) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No hay jugadas para deshacer',
            isError: true
        });
    }

    // Buscar la última jugada del jugador
    const lastMoveIndex = player.cardsPlayedThisTurn.findIndex(
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

    const lastMove = player.cardsPlayedThisTurn[lastMoveIndex];

    // Devolver la carta a la mano del jugador
    player.cards.push(msg.cardValue);

    // Restaurar el valor anterior en el tablero
    if (msg.position.includes('asc')) {
        const idx = msg.position === 'asc1' ? 0 : 1;
        room.gameState.board.ascending[idx] = lastMove.previousValue;
    } else {
        const idx = msg.position === 'desc1' ? 0 : 1;
        room.gameState.board.descending[idx] = lastMove.previousValue;
    }

    // Eliminar del contador de cartas jugadas
    player.cardsPlayedThisTurn.splice(lastMoveIndex, 1);

    // Notificar a todos los jugadores
    broadcastToRoom(room, {
        type: 'move_undone',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: lastMove.previousValue
    });

    // Enviar estado actualizado
    broadcastGameState(room);
}

function endTurn(room, player) {
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        return safeSend(player.ws, {
            type: 'notification',
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
            isError: true
        });
    }

    const targetCardCount = room.players.length <= 3 ? 6 : 5;
    if (player.cards.length < targetCardCount) {
        const cardsToDraw = Math.min(
            targetCardCount - player.cards.length,
            room.gameState.deck.length
        );
        for (let i = 0; i < cardsToDraw; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
    }

    const nextPlayer = changeTurn(room);
    broadcastToRoom(room, {
        type: 'notification',
        message: `Ahora es el turno de ${nextPlayer.name}`,
        isError: false
    });
}

function broadcastGameState(room) {
    room.players.forEach(player => {
        sendGameState(room, player);
    });
}

function checkGameStatus(room) {
    const allPlayersEmpty = room.players.every(p => p.cards.length === 0);
    if (allPlayersEmpty && room.gameState.deck.length === 0) {
        broadcastToRoom(room, {
            type: 'game_over',
            result: 'win',
            message: '¡Todos ganan! Todas las cartas jugadas.'
        });

        setTimeout(() => {
            const roomId = reverseRoomMap.get(room);
            rooms.delete(roomId);
            boardHistory.delete(roomId);
            reverseRoomMap.delete(room);
        }, 30000);
    }
}

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});