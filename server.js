const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;
const CONNECTION_TIMEOUT = 10000;
const PING_INTERVAL = 30000;

const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.query('SELECT NOW()', (err) => {
    if (err) console.error('Error connecting to PostgreSQL:', err);
    else console.log('Connected to PostgreSQL database');
});

async function initializeDatabase() {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await pool.query('BEGIN');

            await pool.query(`
                CREATE TABLE IF NOT EXISTS rooms (
                    room_id VARCHAR(4) PRIMARY KEY,
                    game_state JSONB NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    is_active BOOLEAN DEFAULT TRUE
                );
                
                CREATE TABLE IF NOT EXISTS players (
                    player_id UUID PRIMARY KEY,
                    room_id VARCHAR(4) REFERENCES rooms(room_id) ON DELETE CASCADE,
                    name VARCHAR(20) NOT NULL,
                    is_host BOOLEAN DEFAULT FALSE,
                    is_connected BOOLEAN DEFAULT FALSE,
                    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    cards INTEGER[],
                    cards_played_this_turn JSONB,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS game_history (
                    id SERIAL PRIMARY KEY,
                    room_id VARCHAR(4) REFERENCES rooms(room_id) ON DELETE CASCADE,
                    event_type VARCHAR(50) NOT NULL,
                    event_data JSONB NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_players_connection ON players(is_connected, last_seen);
                CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
                CREATE INDEX IF NOT EXISTS idx_history_room ON game_history(room_id, created_at);
            `);

            await pool.query('COMMIT');
            console.log('Database initialized successfully');
            return;
        } catch (err) {
            await pool.query('ROLLBACK');
            retries++;
            console.error(`Database initialization attempt ${retries}/${maxRetries}:`, err);

            if (retries >= maxRetries) {
                console.error('Failed to initialize database after multiple attempts. Starting with basic functionality.');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 2000 * retries));
        }
    }
}

initializeDatabase();

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
        activeRooms: rooms.size,
        dbStatus: pool.totalCount > 0 ? 'connected' : 'disconnected'
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
const connectionHealth = new Map();

async function saveRoomState(roomId, gameState) {
    try {
        await pool.query(
            'INSERT INTO rooms (room_id, game_state, updated_at, last_activity, is_active, state_version) ' +
            'VALUES ($1, $2, NOW(), NOW(), TRUE, COALESCE((SELECT state_version FROM rooms WHERE room_id = $1), 0) + 1) ' +
            'ON CONFLICT (room_id) DO UPDATE SET game_state = $2, updated_at = NOW(), last_activity = NOW(), is_active = TRUE, state_version = rooms.state_version + 1',
            [roomId, gameState]
        );
    } catch (err) {
        console.error('Error saving room state:', err);
        throw err;
    }
}

async function updatePlayerConnection(playerId, isConnected) {
    try {
        await pool.query(
            'UPDATE players SET is_connected = $1, last_seen = NOW() WHERE player_id = $2',
            [isConnected, playerId]
        );
    } catch (err) {
        console.error('Error updating player connection:', err);
        throw err;
    }
}

async function getRoomState(roomId) {
    try {
        const res = await pool.query(
            'SELECT game_state, state_version FROM rooms WHERE room_id = $1 AND is_active = TRUE',
            [roomId]
        );
        return res.rows[0] || null;
    } catch (err) {
        console.error('Error getting room state:', err);
        throw err;
    }
}

async function checkAllDisconnected(roomId) {
    try {
        const res = await pool.query(
            'SELECT COUNT(*) FROM players WHERE room_id = $1 AND is_connected = TRUE',
            [roomId]
        );
        return parseInt(res.rows[0].count) === 0;
    } catch (err) {
        console.error('Error checking connections:', err);
        throw err;
    }
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
        })),
        v: room.gameState.stateVersion
    };
    safeSend(player.ws, {
        type: 'gs',
        s: state
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
        return safeSend(player.ws, {
            type: 'notification',
            message: 'Posición inválida',
            isError: true
        });
    }
    if (!player.cards.includes(msg.cardValue)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No tienes esa carta',
            isError: true
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
        return safeSend(player.ws, {
            type: 'notification',
            message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
            isError: true
        });
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
    room.gameState.stateVersion++;
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
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No hay jugadas para deshacer',
            isError: true
        });
    }
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
    player.cards.push(msg.cardValue);
    if (msg.position.includes('asc')) {
        const idx = msg.position === 'asc1' ? 0 : 1;
        room.gameState.board.ascending[idx] = lastMove.previousValue;
    } else {
        const idx = msg.position === 'desc1' ? 0 : 1;
        room.gameState.board.descending[idx] = lastMove.previousValue;
    }
    player.cardsPlayedThisTurn.splice(lastMoveIndex, 1);
    room.gameState.stateVersion++;
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
        return safeSend(player.ws, {
            type: 'notification',
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
            isError: true
        });
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
    room.gameState.stateVersion++;
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
    saveRoomState(reverseRoomMap.get(room), room.gameState);
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

app.post('/create-room', async (req, res) => {
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
            cardsPlayedThisTurn: [],
            lastActivity: Date.now()
        }],
        gameState: {
            deck: initializeDeck(),
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: playerId,
            gameStarted: false,
            initialCards: 6,
            stateVersion: 1
        }
    };
    rooms.set(roomId, room);
    reverseRoomMap.set(room, roomId);
    boardHistory.set(roomId, {
        ascending1: [1], ascending2: [1],
        descending1: [100], descending2: [100]
    });
    try {
        await pool.query('BEGIN');
        await pool.query(
            'INSERT INTO rooms (room_id, game_state, state_version) VALUES ($1, $2, 1)',
            [roomId, room.gameState]
        );
        await pool.query(
            'INSERT INTO players (player_id, room_id, name, is_host, is_connected, cards, cards_played_this_turn) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, roomId, playerName, true, false, [], []]
        );
        await pool.query('COMMIT');
        res.json({ success: true, roomId, playerId, playerName });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error creating room:', err);
        res.status(500).json({ success: false, message: 'Error al crear sala' });
    }
});

app.post('/join-room', async (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) {
        return res.status(400).json({
            success: false,
            message: 'Nombre de jugador y código de sala requeridos'
        });
    }
    if (!rooms.has(roomId)) {
        try {
            const roomRes = await pool.query(
                'SELECT game_state, state_version FROM rooms WHERE room_id = $1 AND is_active = TRUE',
                [roomId]
            );
            if (roomRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Sala no encontrada' });
            }
            const room = {
                players: [],
                gameState: {
                    ...roomRes.rows[0].game_state,
                    stateVersion: roomRes.rows[0].state_version
                }
            };
            rooms.set(roomId, room);
            reverseRoomMap.set(room, roomId);
            boardHistory.set(roomId, {
                ascending1: [1], ascending2: [1],
                descending1: [100], descending2: [100]
            });
        } catch (err) {
            console.error('Error checking room:', err);
            return res.status(500).json({ success: false, message: 'Error al verificar sala' });
        }
    }
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
    const room = rooms.get(roomId);
    room.players.push(newPlayer);
    try {
        await pool.query(
            'INSERT INTO players (player_id, room_id, name, is_host, is_connected, cards, cards_played_this_turn) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, roomId, playerName, false, false, [], []]
        );
        res.json({ success: true, playerId, playerName });
    } catch (err) {
        console.error('Error joining room:', err);
        res.status(500).json({ success: false, message: 'Error al unirse a sala' });
    }
});

app.get('/room-info/:roomId', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=5');
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) {
        try {
            const roomRes = await pool.query(
                'SELECT game_state, state_version FROM rooms WHERE room_id = $1 AND is_active = TRUE',
                [roomId]
            );
            if (roomRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Sala no encontrada' });
            }
            const playersRes = await pool.query(
                'SELECT player_id as id, name, is_host as isHost, is_connected as connected FROM players WHERE room_id = $1',
                [roomId]
            );
            return res.json({
                success: true,
                players: playersRes.rows,
                gameStarted: roomRes.rows[0].game_state.gameStarted,
                currentTurn: roomRes.rows[0].game_state.currentTurn,
                initialCards: roomRes.rows[0].game_state.initialCards,
                stateVersion: roomRes.rows[0].state_version
            });
        } catch (err) {
            console.error('Error getting room info:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener información de sala' });
        }
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
        initialCards: room.gameState.initialCards,
        stateVersion: room.gameState.stateVersion
    });
});

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

function startGame(room, initialCards = 6) {
    room.gameState.gameStarted = true;
    room.gameState.initialCards = initialCards;
    room.players.forEach(player => {
        player.cards = [];
        for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
            player.cards.push(room.gameState.deck.pop());
        }
    });
    room.gameState.stateVersion++;
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
            })),
            stateVersion: room.gameState.stateVersion
        }
    });
    room.players.forEach(player => {
        safeSend(player.ws, {
            type: 'your_cards',
            cards: player.cards,
            playerName: player.name,
            currentPlayerId: player.id
        });
    });
    saveRoomState(reverseRoomMap.get(room), room.gameState);
}

wss.on('connection', async (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');
    const playerName = params.get('playerName');
    const lastStateVersion = parseInt(params.get('lastState')) || 0;
    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
            ws.close(1008, 'Tiempo de conexión agotado');
        }
    }, CONNECTION_TIMEOUT);

    if (!roomId || !playerId) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Datos inválidos');
    }

    let room = rooms.get(roomId);
    if (!room) {
        try {
            const roomRes = await pool.query(
                'SELECT game_state, state_version FROM rooms WHERE room_id = $1 AND is_active = TRUE',
                [roomId]
            );
            if (roomRes.rows.length === 0) {
                clearTimeout(connectionTimeout);
                return ws.close(1008, 'Sala no encontrada');
            }
            room = {
                players: [],
                gameState: {
                    ...roomRes.rows[0].game_state,
                    stateVersion: roomRes.rows[0].state_version
                }
            };
            rooms.set(roomId, room);
            reverseRoomMap.set(room, roomId);
            boardHistory.set(roomId, {
                ascending1: [1], ascending2: [1],
                descending1: [100], descending2: [100]
            });
        } catch (err) {
            console.error('Error loading room:', err);
            clearTimeout(connectionTimeout);
            return ws.close(1008, 'Error al cargar sala');
        }
    }

    let player = room.players.find(p => p.id === playerId);
    if (!player) {
        try {
            const playerRes = await pool.query(
                'SELECT name, is_host as isHost FROM players WHERE player_id = $1 AND room_id = $2',
                [playerId, roomId]
            );
            if (playerRes.rows.length === 0) {
                clearTimeout(connectionTimeout);
                return ws.close(1008, 'Jugador no registrado');
            }
            player = {
                id: playerId,
                name: playerRes.rows[0].name,
                isHost: playerRes.rows[0].isHost,
                ws: null,
                cards: [],
                cardsPlayedThisTurn: [],
                lastActivity: Date.now()
            };
            room.players.push(player);
        } catch (err) {
            console.error('Error loading player:', err);
            clearTimeout(connectionTimeout);
            return ws.close(1008, 'Error al cargar jugador');
        }
    }

    if (player.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(player.ws.readyState)) {
        player.ws.close(1000, 'Nueva conexión establecida');
    }

    player.ws = ws;
    player.lastActivity = Date.now();
    connectionHealth.set(playerId, { lastPong: Date.now() });

    try {
        await updatePlayerConnection(playerId, true);
    } catch (err) {
        console.error('Error updating player connection:', err);
    }

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            safeSend(ws, { type: 'ping', timestamp: Date.now() });
        }
    }, PING_INTERVAL);

    const healthCheckInterval = setInterval(() => {
        const health = connectionHealth.get(playerId);
        if (health && Date.now() - health.lastPong > MAX_INACTIVE_TIME) {
            ws.close(1001, 'Inactividad prolongada');
        }
    }, HEALTH_CHECK_INTERVAL);

    if (lastStateVersion < room.gameState.stateVersion) {
        safeSend(ws, {
            type: 'state_update',
            state: room.gameState,
            fullSync: true
        });
    }

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            player.lastActivity = Date.now();

            if (msg.type === 'pong') {
                connectionHealth.set(playerId, { lastPong: Date.now() });
                return;
            }

            if (msg.type === 'sync_request') {
                if (msg.lastStateVersion < room.gameState.stateVersion) {
                    sendGameState(room, player);
                }
                return;
            }

            switch (msg.type) {
                case 'start_game':
                    if (player.isHost && !room.gameState.gameStarted) {
                        startGame(room, msg.initialCards);
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
                            initialCards: room.gameState.initialCards || 6,
                            stateVersion: room.gameState.stateVersion + 1
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
                case 'update_player':
                    const playerToUpdate = room.players.find(p => p.id === msg.playerId);
                    if (playerToUpdate) {
                        playerToUpdate.name = msg.name;
                        broadcastToRoom(room, {
                            type: 'player_update',
                            players: room.players.map(p => ({
                                id: p.id,
                                name: p.name,
                                isHost: p.isHost,
                                cardCount: p.cards.length
                            }))
                        });
                    }
                    break;
                default:
                    console.log('Tipo de mensaje no reconocido:', msg.type);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', async () => {
        clearInterval(pingInterval);
        clearInterval(healthCheckInterval);
        connectionHealth.delete(playerId);
        player.ws = null;

        try {
            await updatePlayerConnection(playerId, false);
        } catch (err) {
            console.error('Error updating player connection:', err);
        }

        try {
            const allDisconnected = await checkAllDisconnected(roomId);
            if (allDisconnected) {
                await pool.query(
                    'UPDATE rooms SET is_active = FALSE WHERE room_id = $1',
                    [roomId]
                );
            }
        } catch (err) {
            console.error('Error checking disconnections:', err);
        }

        if (player.isHost && room.players.length > 1) {
            const newHost = room.players.find(p => p.id !== player.id && p.ws?.readyState === WebSocket.OPEN);
            if (newHost) {
                newHost.isHost = true;
                try {
                    await pool.query(
                        'UPDATE players SET is_host = TRUE WHERE player_id = $1',
                        [newHost.id]
                    );
                } catch (err) {
                    console.error('Error updating host:', err);
                }
                broadcastToRoom(room, {
                    type: 'notification',
                    message: `${newHost.name} es ahora el host`,
                    isError: false
                });
            }
        }
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
        clearTimeout(connectionTimeout);
        clearInterval(pingInterval);
        clearInterval(healthCheckInterval);
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
            })),
            stateVersion: room.gameState.stateVersion
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

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});