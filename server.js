const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com', 'http://localhost:3000'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Enhanced CORS middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'X-Error-Message');
    }
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

const rooms = new Map();
const boardHistory = new Map();

// Room cleanup for inactive rooms
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
            console.log(`Room ${roomId} cleaned up due to inactivity`);
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

// Create room endpoint
app.post('/create-room', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({
            success: false,
            message: 'Player name is required',
            received: req.body
        });
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

    console.log(`Room ${roomId} created by ${playerName}`);
    res.json({
        success: true,
        roomId,
        playerId,
        playerName
    });
});

// Join room endpoint
app.post('/join-room', (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) {
        return res.status(400).json({
            success: false,
            message: 'Player name and room code are required',
            received: req.body
        });
    }

    if (!rooms.has(roomId)) {
        return res.status(404).json({
            success: false,
            message: 'Room not found',
            roomId
        });
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
    console.log(`Player ${playerName} joined room ${roomId}`);
    res.json({
        success: true,
        playerId,
        playerName
    });
});

// Get game state endpoint
app.get('/game-state/:roomId/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;

    if (!rooms.has(roomId)) {
        return res.status(404).json({
            error: 'Room not found',
            roomId
        });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({
            error: 'Player not found',
            playerId
        });
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

// Play card endpoint (improved)
app.post('/play-card', (req, res) => {
    try {
        console.log('Play-card request:', req.body);

        const { roomId, playerId, cardValue, position } = req.body;

        // Validate input
        if (!roomId || !playerId || cardValue === undefined || !position) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['roomId', 'playerId', 'cardValue', 'position'],
                received: Object.keys(req.body)
            });
        }

        if (!rooms.has(roomId)) {
            return res.status(404).json({
                success: false,
                error: 'Room not found',
                roomId
            });
        }

        const room = rooms.get(roomId);
        const player = room.players.find(p => p.id === playerId);

        if (!player) {
            return res.status(404).json({
                success: false,
                error: 'Player not found',
                playerId
            });
        }

        const numericCardValue = Number(cardValue);
        if (isNaN(numericCardValue)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid card value',
                cardValue
            });
        }

        if (!player.cards.includes(numericCardValue)) {
            return res.status(400).json({
                success: false,
                error: "You don't have this card",
                playerCards: player.cards,
                attemptedCard: numericCardValue
            });
        }

        if (!validPositions.includes(position)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid position',
                validPositions
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
                error: `Invalid move. Card must be ${position.includes('asc') ? 'higher' : 'lower'} than ${targetValue} or equal to ${position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
                cardValue: numericCardValue,
                targetValue,
                position
            });
        }

        // Update game state
        if (position.includes('asc')) {
            board.ascending[targetIdx] = numericCardValue;
        } else {
            board.descending[targetIdx] = numericCardValue;
        }

        player.cards = player.cards.filter(c => c !== numericCardValue);
        player.cardsPlayedThisTurn.push({
            value: numericCardValue,
            position,
            isPlayedThisTurn: true
        });

        updateBoardHistory(room, position, numericCardValue);
        player.lastActivity = Date.now();

        console.log(`Card played successfully by ${playerId} in room ${roomId}`);
        res.json({
            success: true,
            newBoard: board
        });

    } catch (error) {
        console.error('Error in /play-card:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// End turn endpoint
app.post('/end-turn', (req, res) => {
    try {
        const { roomId, playerId } = req.body;

        if (!roomId || !playerId) {
            return res.status(400).json({
                error: 'Room ID and player ID are required',
                received: req.body
            });
        }

        if (!rooms.has(roomId)) {
            return res.status(404).json({
                error: 'Room not found',
                roomId
            });
        }

        const room = rooms.get(roomId);
        const player = room.players.find(p => p.id === playerId);

        if (!player) {
            return res.status(404).json({
                error: 'Player not found',
                playerId
            });
        }

        if (room.gameState.currentTurn !== playerId) {
            return res.status(400).json({
                error: "It's not your turn"
            });
        }

        const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
        if (player.cardsPlayedThisTurn.length < minCardsRequired) {
            return res.status(400).json({
                error: `You must play at least ${minCardsRequired} cards this turn`,
                cardsPlayed: player.cardsPlayedThisTurn.length,
                required: minCardsRequired
            });
        }

        // Draw new cards
        const cardsToDraw = Math.min(
            room.gameState.initialCards - player.cards.length,
            room.gameState.deck.length
        );

        for (let i = 0; i < cardsToDraw; i++) {
            player.cards.push(room.gameState.deck.pop());
        }

        // Change turn
        const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
        const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);
        const nextPlayer = room.players[nextIndex];
        room.gameState.currentTurn = nextPlayer.id;

        // Check if next player can play
        const nextPlayerPlayableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
        const nextPlayerRequired = room.gameState.deck.length > 0 ? 2 : 1;

        if (nextPlayerPlayableCards.length < nextPlayerRequired && nextPlayer.cards.length > 0) {
            room.gameState.gameStarted = false;
            return res.json({
                gameOver: true,
                message: `${nextPlayer.name} can't play the required ${nextPlayerRequired} card(s)!`,
                result: 'lose'
            });
        }

        // Reset counters
        player.cardsPlayedThisTurn = [];
        player.lastActivity = Date.now();

        console.log(`Turn ended in room ${roomId}, next player: ${nextPlayer.name}`);
        res.json({
            success: true,
            newTurn: nextPlayer.id,
            playerName: nextPlayer.name
        });

    } catch (error) {
        console.error('Error in /end-turn:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Start game endpoint
app.post('/start-game', (req, res) => {
    const { roomId, playerId, initialCards } = req.body;

    if (!rooms.has(roomId)) {
        return res.status(404).json({
            error: 'Room not found',
            roomId
        });
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player || !player.isHost) {
        return res.status(403).json({
            error: 'Only the host can start the game',
            playerId
        });
    }

    if (room.gameState.gameStarted) {
        return res.status(400).json({
            error: 'Game has already started',
            roomId
        });
    }

    startGame(room, parseInt(initialCards) || 6);
    console.log(`Game started in room ${roomId} by ${player.name}`);
    res.json({
        success: true,
        initialCards: room.gameState.initialCards
    });
});

// Room info endpoint
app.get('/room-info/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) {
        return res.status(404).json({
            success: false,
            message: 'Room not found',
            roomId
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
            connected: p.lastActivity > Date.now() - 30000
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards
    });
});

// Helper functions
function getNextActivePlayerIndex(currentIndex, players) {
    for (let offset = 1; offset < players.length; offset++) {
        const nextIndex = (currentIndex + offset) % players.length;
        if (players[nextIndex].lastActivity > Date.now() - 30000) {
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

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});