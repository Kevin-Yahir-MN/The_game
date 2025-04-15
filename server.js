const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const allowedOrigins = ['https://the-game-2xks.onrender.com'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;

app.use(compression());
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const rooms = new Map();
const reverseRoomMap = new Map();
const boardHistory = new Map();
const sseConnections = new Map();

setInterval(() => {
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
            reverseRoomMap.delete(room);
            boardHistory.delete(roomId);
            sseConnections.delete(roomId);
        }
    }
}, ROOM_CLEANUP_INTERVAL);

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

function broadcastToRoom(room, message, options = {}) {
    const roomId = reverseRoomMap.get(room);
    const connections = sseConnections.get(roomId);
    if (!connections) return;

    const { skipPlayerId = null } = options;

    connections.forEach((res, playerId) => {
        if (playerId !== skipPlayerId) {
            res.write(`data: ${JSON.stringify(message)}\n\n`);
        }
    });
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
            s: p.cardsPlayedThisTurn.length
        }))
    };

    const connections = sseConnections.get(reverseRoomMap.get(room));
    if (connections && connections.get(player.id)) {
        connections.get(player.id).write(`data: ${JSON.stringify({ type: 'gs', s: state })}\n\n`);
    }
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

function getPlayableCards(playerCards, board) {
    return playerCards.filter(card => {
        return (card > board.ascending[0] || card === board.ascending[0] - 10) ||
            (card > board.ascending[1] || card === board.ascending[1] - 10) ||
            (card < board.descending[0] || card === board.descending[0] + 10) ||
            (card < board.descending[1] || card === board.descending[1] + 10);
    });
}

function handlePlayCard(room, player, msg) {
    if (!validPositions.includes(msg.position)) {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: 'Posición inválida',
                isError: true
            })}\n\n`);
        }
        return;
    }

    if (!player.cards.includes(msg.cardValue)) {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: 'No tienes esa carta',
                isError: true
            })}\n\n`);
        }
        return;
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
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
                isError: true
            })}\n\n`);
        }
        return;
    }

    if (msg.position.includes('asc')) {
        board.ascending[targetIdx] = msg.cardValue;
    } else {
        board.descending[targetIdx] = msg.cardValue;
    }

    player.cards.splice(player.cards.indexOf(msg.cardValue), 1);
    player.cardsPlayedThisTurn.push({
        value: msg.cardValue,
        position: msg.position,
        isPlayedThisTurn: true
    });

    broadcastToRoom(room, {
        type: 'card_played',
        cardValue: msg.cardValue,
        position: msg.position,
        playerId: player.id,
        playerName: player.name
    });

    updateBoardHistory(room, msg.position, msg.cardValue);
    broadcastGameState(room);
    checkGameStatus(room);
}

function handleUndoMove(room, player, msg) {
    if (player.cardsPlayedThisTurn.length === 0) {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: 'No hay jugadas para deshacer',
                isError: true
            })}\n\n`);
        }
        return;
    }

    const lastMoveIndex = player.cardsPlayedThisTurn.findIndex(
        move => move.value === msg.cardValue &&
            move.position === msg.position
    );

    if (lastMoveIndex === -1) {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: 'No se encontró la jugada para deshacer',
                isError: true
            })}\n\n`);
        }
        return;
    }

    const lastMove = player.cardsPlayedThisTurn[lastMoveIndex];

    player.cards.push(msg.cardValue);

    if (msg.position.includes('asc')) {
        const idx = msg.position === 'asc1' ? 0 : 1;
        room.gameState.board.ascending[idx] = lastMove.previousValue;
    } else {
        const idx = msg.position === 'desc1' ? 0 : 1;
        room.gameState.board.descending[idx] = lastMove.previousValue;
    }

    player.cardsPlayedThisTurn.splice(lastMoveIndex, 1);

    broadcastToRoom(room, {
        type: 'move_undone',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: lastMove.previousValue
    }, { includeGameState: true });
}

function endTurn(room, player) {
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'notification',
                message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
                isError: true
            })}\n\n`);
        }
        return;
    }

    const targetCardCount = room.gameState.initialCards;
    const cardsToDraw = Math.min(
        targetCardCount - player.cards.length,
        room.gameState.deck.length
    );

    for (let i = 0; i < cardsToDraw; i++) {
        player.cards.push(room.gameState.deck.pop());
    }

    if (room.gameState.deck.length === 0) {
        broadcastToRoom(room, {
            type: 'notification',
            message: '¡El mazo se ha agotado!',
            isError: false
        });
    }

    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);
    const nextPlayer = room.players[nextIndex];
    room.gameState.currentTurn = nextPlayer.id;

    const playableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
    const requiredCards = room.gameState.deck.length > 0 ? 2 : 1;

    if (playableCards.length < requiredCards && nextPlayer.cards.length > 0) {
        return broadcastToRoom(room, {
            type: 'game_over',
            result: 'lose',
            message: `¡${nextPlayer.name} no puede jugar el mínimo de ${requiredCards} carta(s) requerida(s)!`,
            reason: 'min_cards_not_met'
        });
    }

    player.cardsPlayedThisTurn = [];
    broadcastGameState(room);

    broadcastToRoom(room, {
        type: 'turn_changed',
        newTurn: nextPlayer.id,
        previousPlayer: player.id,
        playerName: nextPlayer.name,
        cardsPlayedThisTurn: 0,
        minCardsRequired: requiredCards
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
            message: '¡Todos ganan! Todas las cartas jugadas.',
            reason: 'all_cards_played'
        });
    }
}

app.get('/sse', (req, res) => {
    const { roomId, playerId } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!sseConnections.has(roomId)) {
        sseConnections.set(roomId, new Map());
    }
    sseConnections.get(roomId).set(playerId, res);

    const heartbeat = setInterval(() => {
        res.write(':heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseConnections.get(roomId)?.delete(playerId);
    });
});

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
        cards: [],
        cardsPlayedThisTurn: [],
        lastActivity: Date.now()
    };

    room.players.push(newPlayer);
    res.json({ success: true, playerId, playerName });
});

app.get('/room-info/:roomId', (req, res) => {
    res.set('Cache-Control', 'public, max-age=5');
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
            connected: sseConnections.get(roomId)?.has(p.id) || false
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards
    });
});

app.post('/start-game', (req, res) => {
    const { roomId, playerId, initialCards } = req.body;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHost) {
        return res.status(403).json({ success: false, message: 'Solo el host puede iniciar el juego' });
    }

    startGame(room, initialCards);
    res.json({ success: true });
});

function startGame(room, initialCards = 6) {
    room.gameState.gameStarted = true;
    room.gameState.initialCards = initialCards;

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
    });

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
                cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
            }))
        }
    });

    room.players.forEach(player => {
        const connections = sseConnections.get(reverseRoomMap.get(room));
        if (connections && connections.get(player.id)) {
            connections.get(player.id).write(`data: ${JSON.stringify({
                type: 'your_cards',
                cards: player.cards,
                playerName: player.name,
                currentPlayerId: player.id
            })}\n\n`);
        }
    });
}

app.post('/play-card', (req, res) => {
    const { roomId, playerId, cardValue, position } = req.body;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    handlePlayCard(room, player, { cardValue, position });
    res.json({ success: true });
});

app.post('/end-turn', (req, res) => {
    const { roomId, playerId } = req.body;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    endTurn(room, player);
    res.json({ success: true });
});

app.post('/undo-move', (req, res) => {
    const { roomId, playerId, cardValue, position } = req.body;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    handleUndoMove(room, player, { cardValue, position });
    res.json({ success: true });
});

app.post('/update-player', (req, res) => {
    const { roomId, playerId, name } = req.body;
    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    player.name = name;
    broadcastToRoom(room, {
        type: 'player_update',
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length
        }))
    });

    res.json({ success: true });
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor SSE iniciado en puerto ${PORT}`);
});