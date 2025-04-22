const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;
const CONNECTION_TIMEOUT = 10000;
const PING_INTERVAL = 30000;
const AUTO_SAVE_INTERVAL = 30000;
const MAX_STATE_HISTORY = 5;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'active',
        timestamp: Date.now(),
        activeRooms: rooms.size
    });
});

const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

const rooms = new Map();
const reverseRoomMap = new Map();
const boardHistory = new Map();

async function backupSaveToFile(roomId, state) {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(backupDir, `${roomId}_${Date.now()}.json`), JSON.stringify(state));
}

async function saveGameState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const stateData = {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cards: p.cards,
            lastActivity: p.lastActivity,
            ws: null
        })),
        gameState: room.gameState,
        history: boardHistory.get(roomId),
        lastSaved: new Date().toISOString(),
        version: 2
    };

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO game_states (room_id, state_data, last_activity)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (room_id) 
                 DO UPDATE SET state_data = $2, last_activity = NOW()`,
                [roomId, JSON.stringify(stateData)]
            );
            await client.query(
                `INSERT INTO game_state_history (room_id, state_data, saved_at)
                 SELECT $1, $2, NOW()
                 WHERE (SELECT COUNT(*) FROM game_state_history WHERE room_id = $1) < $3`,
                [roomId, JSON.stringify(stateData), MAX_STATE_HISTORY]
            );
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        backupSaveToFile(roomId, stateData);
    }
}

async function loadGameState(roomId) {
    try {
        const { rows } = await pool.query(
            'SELECT state_data FROM game_states WHERE room_id = $1',
            [roomId]
        );
        if (rows.length === 0) return null;
        return JSON.parse(rows[0].state_data);
    } catch (err) {
        const backupDir = path.join(__dirname, 'backups');
        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir).filter(f => f.startsWith(roomId));
            if (files.length > 0) {
                const latest = files.sort().reverse()[0];
                return JSON.parse(fs.readFileSync(path.join(backupDir, latest)));
            }
        }
        return null;
    }
}

async function loadInitialState() {
    try {
        const { rows } = await pool.query(
            `SELECT room_id, state_data 
             FROM game_states 
             WHERE last_activity > NOW() - INTERVAL '24 hours'`
        );

        for (const row of rows) {
            try {
                const state = JSON.parse(row.state_data);
                const room = {
                    players: state.players,
                    gameState: state.gameState,
                    lastActivity: new Date(state.lastSaved).getTime() || Date.now()
                };
                rooms.set(row.room_id, room);
                reverseRoomMap.set(room, row.room_id);
                boardHistory.set(row.room_id, state.history || {
                    ascending1: [1], ascending2: [1],
                    descending1: [100], descending2: [100]
                });
            } catch (e) { }
        }
    } catch (err) { }
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

function safeSend(ws, message) {
    try {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    } catch (error) { }
}

function broadcastToRoom(room, message, options = {}) {
    const { includeGameState = false, skipPlayerId = null } = options;
    room.players.forEach(player => {
        if (player.id !== skipPlayerId && player.ws?.readyState === WebSocket.OPEN) {
            safeSend(player.ws, message);
            if (includeGameState) sendGameState(room, player);
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
    safeSend(player.ws, { type: 'gs', s: state });
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

function handlePlayCard(room, player, msg) {
    if (!validPositions.includes(msg.position)) {
        return safeSend(player.ws, { type: 'notification', message: 'Posición inválida', isError: true });
    }
    if (!player.cards.includes(msg.cardValue)) {
        return safeSend(player.ws, { type: 'notification', message: 'No tienes esa carta', isError: true });
    }
    const board = room.gameState.board;
    const targetIdx = msg.position.includes('asc') ? (msg.position === 'asc1' ? 0 : 1) : (msg.position === 'desc1' ? 0 : 1);
    const targetValue = msg.position.includes('asc') ? board.ascending[targetIdx] : board.descending[targetIdx];
    const isValid = msg.position.includes('asc') ? (msg.cardValue > targetValue || msg.cardValue === targetValue - 10) : (msg.cardValue < targetValue || msg.cardValue === targetValue + 10);
    if (!isValid) {
        return safeSend(player.ws, { type: 'notification', message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`, isError: true });
    }
    if (msg.position.includes('asc')) {
        board.ascending[targetIdx] = msg.cardValue;
    } else {
        board.descending[targetIdx] = msg.cardValue;
    }
    player.cards.splice(player.cards.indexOf(msg.cardValue), 1);
    player.cardsPlayedThisTurn.push({ value: msg.cardValue, position: msg.position, isPlayedThisTurn: true });
    broadcastToRoom(room, { type: 'card_played', cardValue: msg.cardValue, position: msg.position, playerId: player.id, playerName: player.name });
    updateBoardHistory(room, msg.position, msg.cardValue);
    broadcastGameState(room);
    checkGameStatus(room);
}

function handleUndoMove(room, player, msg) {
    if (player.cardsPlayedThisTurn.length === 0) {
        return safeSend(player.ws, { type: 'notification', message: 'No hay jugadas para deshacer', isError: true });
    }
    const lastMoveIndex = player.cardsPlayedThisTurn.findIndex(move => move.value === msg.cardValue && move.position === msg.position);
    if (lastMoveIndex === -1) {
        return safeSend(player.ws, { type: 'notification', message: 'No se encontró la jugada para deshacer', isError: true });
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
    broadcastToRoom(room, { type: 'move_undone', playerId: player.id, playerName: player.name, cardValue: msg.cardValue, position: msg.position, previousValue: lastMove.previousValue }, { includeGameState: true });
}

function endTurn(room, player) {
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        return safeSend(player.ws, { type: 'notification', message: `Debes jugar al menos ${minCardsRequired} cartas este turno`, isError: true });
    }
    const targetCardCount = room.gameState.initialCards;
    const cardsToDraw = Math.min(targetCardCount - player.cards.length, room.gameState.deck.length);
    for (let i = 0; i < cardsToDraw; i++) {
        player.cards.push(room.gameState.deck.pop());
    }
    if (room.gameState.deck.length === 0) {
        broadcastToRoom(room, { type: 'notification', message: '¡El mazo se ha agotado!', isError: false });
    }
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentTurn);
    const nextIndex = getNextActivePlayerIndex(currentIndex, room.players);
    const nextPlayer = room.players[nextIndex];
    room.gameState.currentTurn = nextPlayer.id;
    const playableCards = getPlayableCards(nextPlayer.cards, room.gameState.board);
    const requiredCards = room.gameState.deck.length > 0 ? 2 : 1;
    if (playableCards.length < requiredCards && nextPlayer.cards.length > 0) {
        return broadcastToRoom(room, { type: 'game_over', result: 'lose', message: `¡${nextPlayer.name} no puede jugar el mínimo de ${requiredCards} carta(s) requerida(s)!`, reason: 'min_cards_not_met' });
    }
    player.cardsPlayedThisTurn = [];
    broadcastGameState(room);
    broadcastToRoom(room, { type: 'turn_changed', newTurn: nextPlayer.id, previousPlayer: player.id, playerName: nextPlayer.name, cardsPlayedThisTurn: 0, minCardsRequired: requiredCards });
}

function broadcastGameState(room) {
    room.players.forEach(player => { sendGameState(room, player); });
}

function checkGameStatus(room) {
    const allPlayersEmpty = room.players.every(p => p.cards.length === 0);
    if (allPlayersEmpty && room.gameState.deck.length === 0) {
        broadcastToRoom(room, { type: 'game_over', result: 'win', message: '¡Todos ganan! Todas las cartas jugadas.', reason: 'all_cards_played' });
    }
}

app.post('/create-room', async (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ success: false, message: 'Se requiere nombre de jugador' });

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    const playerId = uuidv4();

    const room = {
        players: [{
            id: playerId,
            name: playerName,
            isHost: true,
            ws: null,
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
        },
        lastActivity: Date.now()
    };

    rooms.set(roomId, room);
    reverseRoomMap.set(room, roomId);
    boardHistory.set(roomId, { ascending1: [1], ascending2: [1], descending1: [100], descending2: [100] });

    await saveGameState(roomId);

    res.json({ success: true, roomId, playerId, playerName });
});

app.post('/join-room', async (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) return res.status(400).json({ success: false, message: 'Nombre de jugador y código de sala requeridos' });

    if (!rooms.has(roomId)) {
        const loadedRoom = await loadGameState(roomId);
        if (!loadedRoom) return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const playerId = uuidv4();

    const newPlayer = {
        id: playerId,
        name: playerName,
        isHost: false,
        ws: null,
        cards: [],
        cardsPlayedThisTurn: [],
        lastActivity: Date.now()
    };

    room.players.push(newPlayer);
    room.lastActivity = Date.now();
    await saveGameState(roomId);

    res.json({ success: true, playerId, playerName });
});

app.get('/room-state/:roomId', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT state_data FROM game_states WHERE room_id = $1', [req.params.roomId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Sala no encontrada' });
        const stateData = typeof rows[0].state_data === 'object' ? JSON.stringify(rows[0].state_data) : rows[0].state_data;
        res.json({ success: true, state: JSON.parse(stateData) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.get('/room-info/:roomId', (req, res) => {
    res.set('Cache-Control', 'public, max-age=5');
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) return res.status(404).json({ success: false, message: 'Sala no encontrada' });
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
        safeSend(player.ws, { type: 'your_cards', cards: player.cards, playerName: player.name, currentPlayerId: player.id });
    });
}

wss.on('connection', async (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');
    const playerName = params.get('playerName');
    const isReconnect = params.get('reconnect') === 'true';

    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) ws.close(1008, 'Tiempo de conexión agotado');
    }, 10000);

    if (isReconnect) {
        try {
            let room = rooms.get(roomId);
            if (!room) {
                room = await loadGameState(roomId);
                if (!room) {
                    clearTimeout(connectionTimeout);
                    return ws.close(1008, 'Sala no encontrada');
                }
            }

            const player = room.players.find(p => p.id === playerId);
            if (!player) {
                clearTimeout(connectionTimeout);
                return ws.close(1008, 'Jugador no registrado');
            }

            if (player.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(player.ws.readyState)) {
                player.ws.close(1000, 'Nueva conexión establecida');
            }

            player.ws = ws;
            player.lastActivity = Date.now();
            room.lastActivity = Date.now();

            clearTimeout(connectionTimeout);
            const response = {
                type: 'reconnect_response',
                success: true,
                state: {
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
                        s: p.cardsPlayedThisTurn.length,
                        connected: !!p.ws && p.ws.readyState === WebSocket.OPEN
                    }))
                },
                message: 'Reconexión exitosa'
            };
            safeSend(ws, response);
            return;
        } catch (err) {
            ws.close(1011, 'Error interno del servidor');
        }
    }

    if (!roomId || !playerId || !rooms.has(roomId)) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Datos inválidos');
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);

    if (!player) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Jugador no registrado');
    }

    if (player.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(player.ws.readyState)) {
        player.ws.close(1000, 'Nueva conexión establecida');
    }

    player.ws = ws;
    player.lastActivity = Date.now();
    room.lastActivity = Date.now();

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) safeSend(ws, { type: 'ping' });
    }, 30000);

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            player.lastActivity = Date.now();
            room.lastActivity = Date.now();

            if (msg.type === 'ping') return safeSend(ws, { type: 'pong', timestamp: Date.now() });
            if (msg.type === 'reconnect_request') {
                const response = {
                    type: 'reconnect_response',
                    success: true,
                    state: {
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
                    }
                };
                return safeSend(ws, response);
            }
            if (msg.type === 'start_game' && player.isHost && !room.gameState.gameStarted) {
                startGame(room, msg.initialCards);
                await saveGameState(roomId);
            }
            if (msg.type === 'play_card' && player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                handlePlayCard(room, player, msg);
                await saveGameState(roomId);
            }
            if (msg.type === 'end_turn' && player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                endTurn(room, player);
                await saveGameState(roomId);
            }
            if (msg.type === 'undo_move' && player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                handleUndoMove(room, player, msg);
                await saveGameState(roomId);
            }
            if (msg.type === 'get_game_state' && room.gameState.gameStarted) sendGameState(room, player);
            if (msg.type === 'self_blocked' && rooms.has(msg.roomId)) {
                const room = rooms.get(msg.roomId);
                const player = room.players.find(p => p.id === msg.playerId);
                if (player) {
                    broadcastToRoom(room, { type: 'game_over', result: 'lose', message: `¡${player.name} se quedó sin movimientos posibles!`, reason: 'self_blocked' });
                    await saveGameState(roomId);
                }
            }
            if (msg.type === 'reset_room' && player.isHost && rooms.has(msg.roomId)) {
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
                broadcastToRoom(room, { type: 'room_reset', message: 'La sala ha sido reiniciada para una nueva partida' });
                await saveGameState(roomId);
            }
            if (msg.type === 'update_player') {
                const playerToUpdate = room.players.find(p => p.id === msg.playerId);
                if (playerToUpdate) {
                    playerToUpdate.name = msg.name;
                    broadcastToRoom(room, { type: 'player_update', players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, cardCount: p.cards.length })) });
                    await saveGameState(roomId);
                }
            }
        } catch (error) { }
    });

    ws.on('close', async () => {
        clearInterval(pingInterval);
        player.ws = null;
        await saveGameState(roomId);

        if (player.isHost && room.players.length > 1) {
            const newHost = room.players.find(p => p.id !== player.id && p.ws?.readyState === WebSocket.OPEN);
            if (newHost) {
                newHost.isHost = true;
                broadcastToRoom(room, { type: 'notification', message: `${newHost.name} es ahora el host`, isError: false });
                await saveGameState(roomId);
            }
        }
    });

    ws.on('error', (error) => {
        clearTimeout(connectionTimeout);
        clearInterval(pingInterval);
    });

    clearTimeout(connectionTimeout);
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
                cardCount: p.cards.length
            }))
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
});

setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, roomId) => {
        if (now - room.lastActivity > ROOM_CLEANUP_INTERVAL) {
            rooms.delete(roomId);
            reverseRoomMap.delete(room);
            boardHistory.delete(roomId);
        } else {
            saveGameState(roomId);
        }
    });
}, AUTO_SAVE_INTERVAL);

server.listen(PORT, async () => {
    await loadInitialState();
});