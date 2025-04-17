const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const rooms = new Map();
const reverseRoomMap = new Map();
const boardHistory = new Map();

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
        if (players[nextIndex].connected) {
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

function checkGameStatus(room) {
    const allPlayersEmpty = room.players.every(p => p.cards.length === 0);
    if (allPlayersEmpty && room.gameState.deck.length === 0) {
        room.gameState.gameOver = {
            result: 'win',
            message: '¡Victoria! Todas las cartas jugadas correctamente.'
        };
        return;
    }

    const nextPlayer = room.players.find(p => p.id === room.gameState.currentTurn);
    if (nextPlayer) {
        const playableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
        const minRequired = room.gameState.deck.length > 0 ? 2 : 1;

        if (playableCards.length < minRequired && nextPlayer.cards.length > 0) {
            room.gameState.gameOver = {
                result: 'lose',
                message: `¡Derrota! ${nextPlayer.name} no puede jugar el mínimo de ${minRequired} carta(s) requerida(s).`
            };
        }
    }
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
            connected: true,
            cards: [],
            cardsPlayedThisTurn: [],
            lastActivity: Date.now()
        }],
        gameState: {
            deck: initializeDeck(),
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: playerId,
            gameStarted: false,
            initialCards: 6,
            gameOver: null
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
        connected: true,
        cards: [],
        cardsPlayedThisTurn: [],
        lastActivity: Date.now()
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
    const now = Date.now();
    room.players.forEach(player => {
        player.connected = (now - player.lastActivity) < 30000;
    });

    res.json({
        success: true,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length,
            connected: p.connected
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards,
        gameOver: room.gameState.gameOver
    });
});

app.get('/game-state/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const playerId = req.query.playerId;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    player.lastActivity = Date.now();
    player.connected = true;

    const responseData = {
        success: true,
        state: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                cardCount: p.cards.length,
                connected: p.connected,
                cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
            })),
            yourCards: player.cards,
            remainingDeck: room.gameState.deck.length,
            initialCards: room.gameState.initialCards,
            gameOver: room.gameState.gameOver || null
        }
    };

    res.json(responseData);
});

app.get('/check-game-started/:roomId', (req, res) => {
    const roomId = req.params.roomId;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);

    res.json({
        success: true,
        gameStarted: room.gameState.gameStarted,
        currentPlayerId: room.gameState.currentTurn
    });
});

app.post('/start-game', (req, res) => {
    const { playerId, roomId, initialCards } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    if (!player.isHost) {
        return res.status(403).json({ success: false, message: 'Solo el host puede iniciar el juego' });
    }

    room.gameState = {
        deck: initializeDeck(),
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: room.players[0].id,
        gameStarted: true,
        initialCards: parseInt(initialCards) || 6,
        gameOver: null
    };

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < room.gameState.initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
    });

    boardHistory.set(roomId, {
        ascending1: [1], ascending2: [1],
        descending1: [100], descending2: [100]
    });

    room.lastActivity = Date.now();

    res.json({
        success: true,
        message: 'Juego iniciado correctamente',
        gameStarted: true
    });
});

app.post('/play-card', (req, res) => {
    const { playerId, roomId, cardValue, position } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    if (player.id !== room.gameState.currentTurn) {
        return res.status(400).json({
            success: false,
            message: 'No es tu turno'
        });
    }

    if (!validPositions.includes(position)) {
        return res.status(400).json({
            success: false,
            message: 'Posición inválida'
        });
    }

    const numericCardValue = parseInt(cardValue);
    if (!player.cards.includes(numericCardValue)) {
        return res.status(400).json({
            success: false,
            message: 'No tienes esa carta'
        });
    }

    const board = room.gameState.board;
    const targetIdx = position.includes('asc') ?
        (position === 'asc1' ? 0 : 1) :
        (position === 'desc1' ? 0 : 1);
    const targetValue = position.includes('asc') ?
        board.ascending[targetIdx] :
        board.descending[targetIdx];
    const isValid = position.includes('asc') ?
        (numericCardValue > targetValue || numericCardValue === targetValue - 10) :
        (numericCardValue < targetValue || numericCardValue === targetValue + 10);

    if (!isValid) {
        return res.status(400).json({
            success: false,
            message: `Movimiento inválido. La carta debe ${position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${position.includes('asc') ? targetValue - 10 : targetValue + 10}`
        });
    }

    if (position.includes('asc')) {
        board.ascending[targetIdx] = numericCardValue;
    } else {
        board.descending[targetIdx] = numericCardValue;
    }

    player.cards = player.cards.filter(c => c !== numericCardValue);
    player.cardsPlayedThisTurn.push({
        value: numericCardValue,
        position: position,
        previousValue: targetValue
    });

    updateBoardHistory(room, position, numericCardValue);
    checkGameStatus(room);

    res.json({
        success: true,
        notification: {
            message: `${player.name} jugó un ${numericCardValue} en ${position}`,
            isError: false
        }
    });
});

app.post('/end-turn', (req, res) => {
    const { playerId, roomId } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    if (player.id !== room.gameState.currentTurn) {
        return res.status(400).json({
            success: false,
            message: 'No es tu turno'
        });
    }

    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        return res.status(400).json({
            success: false,
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`
        });
    }

    const cardsToDraw = Math.min(
        room.gameState.initialCards - player.cards.length,
        room.gameState.deck.length
    );

    for (let i = 0; i < cardsToDraw; i++) {
        player.cards.push(room.gameState.deck.pop());
    }

    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);
    const nextPlayer = room.players[nextIndex];
    room.gameState.currentTurn = nextPlayer.id;

    const nextPlayerPlayableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
    const nextPlayerRequired = room.gameState.deck.length > 0 ? 2 : 1;

    if (nextPlayerPlayableCards.length < nextPlayerRequired && nextPlayer.cards.length > 0) {
        room.gameState.gameOver = {
            result: 'lose',
            message: `¡Derrota! ${nextPlayer.name} no puede jugar el mínimo de ${nextPlayerRequired} carta(s) requerida(s).`
        };
    }

    player.cardsPlayedThisTurn = [];
    checkGameStatus(room);

    res.json({
        success: true,
        nextPlayer: {
            id: nextPlayer.id,
            name: nextPlayer.name
        },
        minCardsRequired: nextPlayerRequired,
        gameOver: room.gameState.gameOver
    });
});

app.post('/new-game', (req, res) => {
    const { roomId, playerId } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
    }

    if (!player.isHost) {
        return res.status(403).json({ success: false, message: 'Solo el host puede iniciar un nuevo juego' });
    }

    room.gameState = {
        deck: initializeDeck(),
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: room.players[0].id,
        gameStarted: true,
        initialCards: room.gameState.initialCards,
        gameOver: null
    };

    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < room.gameState.initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
        player.cardsPlayedThisTurn = [];
    });

    res.json({
        success: true,
        message: 'Nuevo juego iniciado',
        state: {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            remainingDeck: room.gameState.deck.length
        }
    });
});

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
        }
    }
}, ROOM_CLEANUP_INTERVAL);

app.listen(PORT, () => {
    console.log(`🚀 Servidor HTTP (Polling) iniciado en puerto ${PORT}`);
});