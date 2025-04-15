const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

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

const rooms = new Map();
const boardHistory = new Map();

// Limpieza periódica de salas inactivas
setInterval(cleanupInactiveRooms, ROOM_CLEANUP_INTERVAL);

function cleanupInactiveRooms() {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        let lastActivity = 0;
        room.players.forEach(player => {
            if (player.lastActivity > lastActivity) {
                lastActivity = player.lastActivity;
            }
        });

        if (now - lastActivity > 3600000) {
            rooms.delete(roomId);
            boardHistory.delete(roomId);
        }
    }
}

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

// Endpoints REST para reemplazar WebSocket

// Crear sala
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
            cards: [],
            cardsPlayedThisTurn: [],
            lastActivity: Date.now()
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
    boardHistory.set(roomId, {
        ascending1: [1], ascending2: [1],
        descending1: [100], descending2: [100]
    });

    res.json({ success: true, roomId, playerId, playerName });
});

// Unirse a sala
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
        cards: [],
        cardsPlayedThisTurn: [],
        lastActivity: Date.now()
    };

    room.players.push(newPlayer);
    res.json({ success: true, playerId, playerName });
});

// Obtener estado del juego (polling)
app.get('/game-state/:roomId/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ error: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

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
            s: p.cardsPlayedThisTurn.length
        }))
    };

    res.json({ state });
});

// Jugar carta
app.post('/play-card', (req, res) => {
    const { roomId, playerId, cardValue, position } = req.body;

    if (!roomId || !playerId || !cardValue || !position) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    if (!rooms.has(roomId)) {
        return res.status(404).json({ error: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    if (!validPositions.includes(position)) {
        return res.status(400).json({ error: 'Posición inválida' });
    }

    if (!player.cards.includes(cardValue)) {
        return res.status(400).json({ error: 'No tienes esa carta' });
    }

    const board = room.gameState.board;
    const targetIdx = position.includes('asc') ?
        (position === 'asc1' ? 0 : 1) :
        (position === 'desc1' ? 0 : 1);
    const targetValue = position.includes('asc') ?
        board.ascending[targetIdx] :
        board.descending[targetIdx];
    const isValid = position.includes('asc') ?
        (cardValue > targetValue || cardValue === targetValue - 10) :
        (cardValue < targetValue || cardValue === targetValue + 10);

    if (!isValid) {
        return res.status(400).json({
            error: `Movimiento inválido. La carta debe ${position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${position.includes('asc') ? targetValue - 10 : targetValue + 10}`
        });
    }

    // Actualizar tablero
    if (position.includes('asc')) {
        board.ascending[targetIdx] = cardValue;
    } else {
        board.descending[targetIdx] = cardValue;
    }

    // Actualizar jugador
    player.cards.splice(player.cards.indexOf(cardValue), 1);
    player.cardsPlayedThisTurn.push({
        value: cardValue,
        position,
        isPlayedThisTurn: true
    });

    // Actualizar historial
    updateBoardHistory(room, position, cardValue);

    player.lastActivity = Date.now();
    res.json({ success: true });
});

// Terminar turno
app.post('/end-turn', (req, res) => {
    const { roomId, playerId } = req.body;

    if (!roomId || !playerId) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    if (!rooms.has(roomId)) {
        return res.status(404).json({ error: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    if (room.gameState.currentTurn !== playerId) {
        return res.status(400).json({ error: 'No es tu turno' });
    }

    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        return res.status(400).json({
            error: `Debes jugar al menos ${minCardsRequired} cartas este turno`
        });
    }

    // Repartir nuevas cartas
    const cardsToDraw = Math.min(
        room.gameState.initialCards - player.cards.length,
        room.gameState.deck.length
    );

    for (let i = 0; i < cardsToDraw; i++) {
        player.cards.push(room.gameState.deck.pop());
    }

    // Cambiar turno
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);
    const nextPlayer = room.players[nextIndex];
    room.gameState.currentTurn = nextPlayer.id;

    // Verificar si el siguiente jugador puede jugar
    const nextPlayerPlayableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
    const nextPlayerRequired = room.gameState.deck.length > 0 ? 2 : 1;

    if (nextPlayerPlayableCards.length < nextPlayerRequired && nextPlayer.cards.length > 0) {
        // Fin del juego por no poder jugar
        room.gameState.gameStarted = false;
        return res.json({
            gameOver: true,
            message: `¡${nextPlayer.name} no puede jugar el mínimo de ${nextPlayerRequired} carta(s) requerida(s)!`,
            result: 'lose'
        });
    }

    // Reiniciar contadores
    player.cardsPlayedThisTurn = [];
    player.lastActivity = Date.now();

    res.json({
        success: true,
        newTurn: nextPlayer.id,
        playerName: nextPlayer.name
    });
});

// Iniciar juego (solo host)
app.post('/start-game', (req, res) => {
    const { roomId, playerId, initialCards } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ error: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player || !player.isHost) {
        return res.status(403).json({ error: 'Solo el host puede iniciar el juego' });
    }

    if (room.gameState.gameStarted) {
        return res.status(400).json({ error: 'El juego ya ha comenzado' });
    }

    startGame(room, parseInt(initialCards) || 6);
    res.json({ success: true });
});

// Funciones auxiliares (las mismas que antes)
function getNextActivePlayerIndex(currentIndex, players) {
    for (let offset = 1; offset < players.length; offset++) {
        const nextIndex = (currentIndex + offset) % players.length;
        if (players[nextIndex].lastActivity > Date.now() - 30000) { // Considerar activos últimos 30s
            return nextIndex;
        }
    }
    return currentIndex;
}

function getPlayableCards(playerCards, board) {
    return playerCards.filter(card => {
        return (card > board.ascending[0] || card === board.ascending[0] - 10) ||
            (card > board.ascending[1] || card === board.ascending[1] - 10) ||
            (card < board.descending[0] || card === board.descending[0] + 10) ||
            (card < board.descending[1] || card === board.descending[1] + 10);
    });
}

function startGame(room, initialCards = 6) {
    room.gameState.gameStarted = true;
    room.gameState.initialCards = initialCards;
    room.gameState.deck = initializeDeck();

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
        player.cardsPlayedThisTurn = [];
        player.lastActivity = Date.now();
    });
}

function updateBoardHistory(room, position, newValue) {
    const history = boardHistory.get(room);
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

// Info de sala
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
            connected: p.lastActivity > Date.now() - 30000 // Últimos 30s
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});