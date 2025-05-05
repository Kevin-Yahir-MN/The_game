const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Pool } = require('pg');
const compression = require('compression');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com'];

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

const rooms = new Map();
const reverseRoomMap = new Map();
const boardHistory = new Map();
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

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

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_states (
                room_id VARCHAR(4) PRIMARY KEY,
                game_data JSONB NOT NULL,
                last_activity TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS player_connections (
                player_id UUID PRIMARY KEY,
                room_id VARCHAR(4) NOT NULL,
                last_ping TIMESTAMP NOT NULL,
                connection_status VARCHAR(20) NOT NULL,
                FOREIGN KEY (room_id) REFERENCES game_states(room_id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_player_room ON player_connections(room_id);
        `);
        console.log('✔ Tablas inicializadas correctamente');
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error);
        throw error;
    }
}

async function saveGameState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    try {
        const gameData = {
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cards: p.cards,
                isHost: p.isHost,
                connected: p.ws !== null
            })),
            gameState: {
                deck: room.gameState.deck,
                board: room.gameState.board,
                currentTurn: room.gameState.currentTurn,
                gameStarted: room.gameState.gameStarted,
                initialCards: room.gameState.initialCards
            },
            history: boardHistory.get(roomId) || {
                ascending1: [1],
                ascending2: [1],
                descending1: [100],
                descending2: [100]
            }
        };

        await pool.query(`
            INSERT INTO game_states 
            (room_id, game_data, last_activity) 
            VALUES ($1, $2, NOW())
            ON CONFLICT (room_id) 
            DO UPDATE SET 
                game_data = EXCLUDED.game_data,
                last_activity = NOW()
        `, [roomId, JSON.stringify(gameData)]);

        return true;
    } catch (error) {
        console.error(`Error al guardar estado para sala ${roomId}:`, error);
        throw error;
    }
}

async function restoreActiveGames() {
    try {
        console.log('⏳ Restaurando juegos activos con historial...');

        const { rows } = await pool.query(`
            SELECT room_id, game_data::text, last_activity 
            FROM game_states 
            WHERE last_activity > NOW() - INTERVAL '4 hours'
        `);

        for (const row of rows) {
            try {
                let gameData;
                try {
                    gameData = JSON.parse(row.game_data);
                } catch (e) {
                    console.error(`❌ Error parseando JSON para sala ${row.room_id}`);
                    continue;
                }

                if (!gameData.history) {
                    gameData.history = {
                        ascending1: [1],
                        ascending2: [1],
                        descending1: [100],
                        descending2: [100]
                    };
                }

                const room = {
                    players: gameData.players?.map(p => ({
                        ...p,
                        ws: null,
                        cards: p.cards || [],
                        cardsPlayedThisTurn: p.cardsPlayedThisTurn || [],
                        lastActivity: Date.now()
                    })) || [],
                    gameState: gameData.gameState || {
                        deck: initializeDeck(),
                        board: { ascending: [1, 1], descending: [100, 100] },
                        currentTurn: null,
                        gameStarted: false,
                        initialCards: 6
                    }
                };

                rooms.set(row.room_id, room);
                reverseRoomMap.set(room, row.room_id);
                boardHistory.set(row.room_id, gameData.history);

                console.log(`✅ Sala ${row.room_id} restaurada con historial`, gameData.history);
            } catch (error) {
                console.error(`❌ Error restaurando sala ${row.room_id}:`, error);
                await pool.query('DELETE FROM game_states WHERE room_id = $1', [row.room_id]);
            }
        }
    } catch (error) {
        console.error('Error al restaurar juegos activos:', error);
        setTimeout(restoreActiveGames, 30000);
    }
}

async function cleanupOldGames() {
    try {
        await pool.query(`
            DELETE FROM game_states 
            WHERE last_activity < NOW() - INTERVAL '4 hours'
        `);
    } catch (error) {
        console.error(error);
    }
}

function safeSend(ws, message) {
    try {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    } catch (error) {
        console.error(error);
    }
}

function broadcastToRoom(room, message, options = {}) {
    const { includeGameState = false, skipPlayerId = null } = options;

    room.players.forEach(player => {
        if (player.id !== skipPlayerId && player.ws?.readyState === WebSocket.OPEN) {
            const completeMessage = {
                ...message,
                timestamp: Date.now()
            };

            safeSend(player.ws, completeMessage);

            if (includeGameState) {
                sendGameState(room, player);
            }
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
            s: p.cardsPlayedThisTurn.length,
            pt: p.cardsPlayedThisTurn
        }))
    };

    safeSend(player.ws, {
        type: 'gs',
        s: state
    });
}

function updateBoardHistory(room, position, newValue) {
    const roomId = reverseRoomMap.get(room);
    if (!roomId) return;

    const history = boardHistory.get(roomId) || {
        ascending1: [1],
        ascending2: [1],
        descending1: [100],
        descending2: [100]
    };

    const historyKey = {
        'asc1': 'ascending1',
        'asc2': 'ascending2',
        'desc1': 'descending1',
        'desc2': 'descending2'
    }[position];

    if (history[historyKey].slice(-1)[0] !== newValue) {
        history[historyKey].push(newValue);
        boardHistory.set(roomId, history);

        broadcastToRoom(room, {
            type: 'column_history_update',
            column: position,
            history: history[historyKey]
        });

        saveGameState(roomId).catch(err =>
            console.error('Error al guardar historial:', err)
        );
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
    if (!playerCards || playerCards.length === 0) return [];

    return playerCards.filter(card => {
        const canPlayAsc1 = card > board.ascending[0] || card === board.ascending[0] - 10;
        const canPlayAsc2 = card > board.ascending[1] || card === board.ascending[1] - 10;
        const canPlayDesc1 = card < board.descending[0] || card === board.descending[0] + 10;
        const canPlayDesc2 = card < board.descending[1] || card === board.descending[1] + 10;

        return canPlayAsc1 || canPlayAsc2 || canPlayDesc1 || canPlayDesc2;
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
    const targetIdx = msg.position.includes('asc')
        ? (msg.position === 'asc1' ? 0 : 1)
        : (msg.position === 'desc1' ? 0 : 1);
    const targetValue = msg.position.includes('asc')
        ? board.ascending[targetIdx]
        : board.descending[targetIdx];

    const isValid = msg.position.includes('asc')
        ? (msg.cardValue > targetValue || msg.cardValue === targetValue - 10)
        : (msg.cardValue < targetValue || msg.cardValue === targetValue + 10);

    if (!isValid) {
        return safeSend(player.ws, {
            type: 'notification',
            message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
            isError: true
        });
    }

    const previousValue = targetValue;

    if (msg.position.includes('asc')) {
        board.ascending[targetIdx] = msg.cardValue;
    } else {
        board.descending[targetIdx] = msg.cardValue;
    }

    player.cards = player.cards.filter(c => c !== msg.cardValue);
    player.cardsPlayedThisTurn.push({
        value: msg.cardValue,
        position: msg.position,
        isPlayedThisTurn: true,
        previousValue
    });

    updateBoardHistory(room, msg.position, msg.cardValue);

    broadcastToRoom(room, {
        type: 'card_played_animated',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: targetValue,
        persistColor: true
    }, { includeGameState: true });

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

    broadcastToRoom(room, {
        type: 'move_undone',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: lastMove.previousValue
    }, { includeGameState: true });
}

async function endTurn(room, player) {
    const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;
    const cardsPlayed = player.cardsPlayedThisTurn.length;

    if (player.specialFlag === 'risky_first_move' && room.players.length === 1) {
        if (cardsPlayed < minCardsRequired) {
            broadcastToRoom(room, {
                type: 'game_over',
                result: 'lose',
                message: `¡No jugaste el mínimo de ${minCardsRequired} cartas requeridas!`,
                reason: 'failed_min_cards_after_risky_move'
            });
            return;
        }
        delete player.specialFlag;
    }

    if (cardsPlayed < minCardsRequired) {
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
        await saveGameState(reverseRoomMap.get(room));
        return broadcastToRoom(room, {
            type: 'game_over',
            result: 'lose',
            message: `¡${nextPlayer.name} no puede jugar el mínimo de ${requiredCards} carta(s) requerida(s)!`,
            reason: 'min_cards_not_met'
        });
    }

    player.cardsPlayedThisTurn = [];

    await saveGameState(reverseRoomMap.get(room));

    broadcastToRoom(room, {
        type: 'turn_changed',
        newTurn: nextPlayer.id,
        previousPlayer: player.id,
        playerName: nextPlayer.name,
        cardsPlayedThisTurn: 0,
        minCardsRequired: requiredCards
    }, { includeGameState: true });

    checkGameStatus(room);
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

function initializeDeck() {
    const deck = [];
    for (let i = 2; i < 100; i++) deck.push(i);

    deck.length = 20

    return shuffleArray(deck);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

app.post('/create-room', async (req, res) => {
    const { playerName } = req.body;

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    const playerId = uuidv4();

    try {
        await pool.query('BEGIN');

        await pool.query(`
            INSERT INTO game_states 
            (room_id, game_data, last_activity)
            VALUES ($1, $2, NOW())
        `, [roomId, JSON.stringify({
            players: [],
            gameState: {
                deck: initializeDeck(),
                board: { ascending: [1, 1], descending: [100, 100] },
                currentTurn: playerId,
                gameStarted: false,
                initialCards: 6
            },
            history: {
                ascending1: [1], ascending2: [1],
                descending1: [100], descending2: [100]
            }
        })]);

        await pool.query(`
            INSERT INTO player_connections 
            (player_id, room_id, last_ping, connection_status)
            VALUES ($1, $2, NOW(), 'connected')
        `, [playerId, roomId]);

        await pool.query('COMMIT');

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
            }
        };

        rooms.set(roomId, room);
        reverseRoomMap.set(room, roomId);
        boardHistory.set(roomId, {
            ascending1: [1], ascending2: [1],
            descending1: [100], descending2: [100]
        });

        res.json({ success: true, roomId, playerId, playerName });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error al crear sala:', error);
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

    try {
        await pool.query('BEGIN');

        const roomCheck = await pool.query(
            'SELECT 1 FROM game_states WHERE room_id = $1',
            [roomId]
        );

        if (roomCheck.rowCount === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Sala no encontrada'
            });
        }

        if (!rooms.has(roomId)) {
            await pool.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Sala no disponible'
            });
        }

        const room = rooms.get(roomId);
        const playerId = uuidv4();

        await pool.query(`
            INSERT INTO player_connections 
            (player_id, room_id, last_ping, connection_status)
            VALUES ($1, $2, NOW(), 'connected')
            ON CONFLICT (player_id) 
            DO UPDATE SET
                room_id = $2,
                last_ping = NOW(),
                connection_status = 'connected'
        `, [playerId, roomId]);

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

        await saveGameState(roomId);

        await pool.query('COMMIT');

        broadcastToRoom(room, {
            type: 'player_joined',
            playerId: playerId,
            playerName: playerName,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                cardCount: p.cards.length,
                connected: p.ws !== null
            }))
        });

        res.json({
            success: true,
            playerId,
            playerName,
            isHost: false,
            roomId
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error al unirse a sala:', error);

        if (error.code === '23503') {
            res.status(404).json({
                success: false,
                message: 'Sala no existe en la base de datos'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Error al unirse a sala',
                error: error.message
            });
        }
    }
});

app.post('/register-connection', async (req, res) => {
    try {
        const { playerId, roomId } = req.body;

        await pool.query(`
            INSERT INTO player_connections 
            (player_id, room_id, last_ping, connection_status)
            VALUES ($1, $2, NOW(), 'connected')
            ON CONFLICT (player_id) 
            DO UPDATE SET
                room_id = $2,
                last_ping = NOW(),
                connection_status = 'connected'
        `, [playerId, roomId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error en register-connection:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/room-info/:roomId', async (req, res) => {
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
            connected: p.ws !== null
        })),
        gameStarted: room.gameState.gameStarted,
        currentTurn: room.gameState.currentTurn,
        initialCards: room.gameState.initialCards
    });
});

app.get('/room-history/:roomId', async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const history = boardHistory.get(roomId) || {
            ascending1: [1],
            ascending2: [1],
            descending1: [100],
            descending2: [100]
        };

        res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function startGame(room, initialCards = 6) {
    const roomId = reverseRoomMap.get(room);
    if (!roomId) throw new Error('Room ID no encontrado');

    try {
        await pool.query('BEGIN');

        await pool.query(`
            UPDATE game_states
            SET game_data = $1,
                last_activity = NOW()
            WHERE room_id = $2
        `, [JSON.stringify({
            players: room.players,
            gameState: {
                ...room.gameState,
                gameStarted: true,
                initialCards
            },
            history: boardHistory.get(roomId)
        }), roomId]);

        await Promise.all(room.players.map(player =>
            pool.query(`
                INSERT INTO player_connections 
                (player_id, room_id, last_ping, connection_status)
                VALUES ($1, $2, NOW(), $3)
                ON CONFLICT (player_id) 
                DO UPDATE SET
                    room_id = $2,
                    last_ping = NOW(),
                    connection_status = $3
            `, [
                player.id,
                roomId,
                player.ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'
            ])
        ));

        await pool.query('COMMIT');

        room.gameState.gameStarted = true;
        room.gameState.initialCards = initialCards;

        room.players.forEach(player => {
            player.cards = [];
            for (let i = 0; i < initialCards && room.gameState.deck.length > 0; i++) {
                player.cards.push(room.gameState.deck.pop());
            }
        });

        await saveGameState(roomId);
        console.log(`💾 Estado guardado al iniciar nueva partida`);

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
            if (player.ws?.readyState === WebSocket.OPEN) {
                safeSend(player.ws, {
                    type: 'your_cards',
                    cards: player.cards,
                    playerName: player.name,
                    currentPlayerId: player.id
                });
            }
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error al iniciar juego:', error);
        throw error;
    }
}

const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];

const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

initializeDatabase().then(() => {
    restoreActiveGames();
    setInterval(cleanupOldGames, 3600000);
});

wss.on('connection', async (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');
    const playerName = params.get('playerName');

    if (!roomId || !playerId || !rooms.has(roomId)) {
        return ws.close(1008, 'Datos inválidos');
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.id === playerId);
    if (!player) return ws.close(1008, 'Jugador no registrado');

    try {
        await pool.query(`
            INSERT INTO player_connections 
            (player_id, room_id, last_ping, connection_status)
            VALUES ($1, $2, NOW(), 'connected')
            ON CONFLICT (player_id) 
            DO UPDATE SET 
                room_id = $2,
                last_ping = NOW(),
                connection_status = 'connected'
        `, [playerId, roomId]);
    } catch (error) {
        console.error('Error al actualizar player_connections:', error);
    }

    player.ws = ws;
    player.lastActivity = Date.now();
    if (playerName) player.name = decodeURIComponent(playerName);

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
        history: boardHistory.get(roomId) || {
            ascending1: [1],
            ascending2: [1],
            descending1: [100],
            descending2: [100]
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

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            player.lastActivity = Date.now();

            if (msg.type === 'ping') {
                await pool.query(`
                    UPDATE player_connections
                    SET last_ping = NOW()
                    WHERE player_id = $1
                `, [playerId]);
                return;
            }

            switch (msg.type) {
                case 'start_game':
                    if (player.isHost && !room.gameState.gameStarted) {
                        try {
                            const connectedPlayers = room.players.filter(p =>
                                p.ws?.readyState === WebSocket.OPEN
                            );

                            if (connectedPlayers.length < 1) {
                                throw new Error('Se necesita al menos 1 jugador conectado');
                            }

                            await pool.query('BEGIN');

                            await pool.query(`
                UPDATE game_states SET 
                game_data = $1,
                last_activity = NOW()
                WHERE room_id = $2
            `, [JSON.stringify({
                                players: room.players,
                                gameState: {
                                    ...room.gameState,
                                    gameStarted: true,
                                    initialCards: msg.initialCards
                                }
                            }), roomId]);

                            await pool.query('COMMIT');

                            room.gameState.gameStarted = true;
                            room.gameState.initialCards = msg.initialCards;

                            room.players.forEach(player => {
                                player.cards = [];
                                for (let i = 0; i < msg.initialCards && room.gameState.deck.length > 0; i++) {
                                    player.cards.push(room.gameState.deck.pop());
                                }
                            });

                            broadcastToRoom(room, {
                                type: 'game_started',
                                board: room.gameState.board,
                                currentTurn: room.players[0].id,
                                remainingDeck: room.gameState.deck.length,
                                initialCards: msg.initialCards
                            });

                        } catch (error) {
                            await pool.query('ROLLBACK');
                            console.error('Error al iniciar juego:', error);
                            safeSend(player.ws, {
                                type: 'notification',
                                message: 'Error al iniciar el juego: ' + error.message,
                                isError: true
                            });
                        }
                    }
                    break;
                case 'play_card':
                    if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                        const enhancedMsg = {
                            ...msg,
                            playerId: player.id,
                            playerName: player.name,
                            isPlayedThisTurn: true
                        };
                        handlePlayCard(room, player, enhancedMsg);
                    }
                    break;
                case 'end_turn':
                    if (player.id === room.gameState.currentTurn && room.gameState.gameStarted) {
                        await endTurn(room, player);
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
                case 'force_game_over':
                    if (rooms.has(msg.roomId)) {
                        const room = rooms.get(msg.roomId);
                        const player = room.players.find(p => p.id === msg.playerId);

                        if (player) {
                            broadcastToRoom(room, {
                                type: 'game_over',
                                result: 'lose',
                                message: '¡Juego terminado! No hay movimientos válidos disponibles.',
                                reason: msg.reason || 'no_valid_moves'
                            });
                        }
                    }
                    break;
                case 'check_solo_block':
                    if (rooms.has(msg.roomId)) {
                        const room = rooms.get(msg.roomId);
                        const player = room.players.find(p => p.id === msg.playerId);

                        if (player && room.players.length === 1) {
                            const minCardsRequired = room.gameState.deck.length > 0 ? 2 : 1;

                            if (msg.cardsRemaining < minCardsRequired) {
                                broadcastToRoom(room, {
                                    type: 'game_over',
                                    result: 'lose',
                                    message: `¡No puedes jugar el mínimo de ${minCardsRequired} carta(s) requerida(s)!`,
                                    reason: 'min_cards_not_met_solo'
                                });
                            }
                        }
                    }
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
                            initialCards: room.gameState.initialCards || 6
                        };

                        boardHistory.set(msg.roomId, {
                            ascending1: [1],
                            ascending2: [1],
                            descending1: [100],
                            descending2: [100]
                        });

                        room.players.forEach(player => {
                            player.cards = [];
                            player.cardsPlayedThisTurn = [];
                        });

                        await saveGameState(msg.roomId);

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
                case 'get_full_state':
                    if (rooms.has(msg.roomId)) {
                        const room = rooms.get(msg.roomId);
                        const player = room.players.find(p => p.id === msg.playerId);
                        if (player) {
                            const roomId = reverseRoomMap.get(room);
                            safeSend(player.ws, {
                                type: 'full_state_update',
                                room: {
                                    players: room.players.map(p => ({
                                        id: p.id,
                                        name: p.name,
                                        isHost: p.isHost,
                                        cards: p.cards,
                                        cardsPlayedThisTurn: p.cardsPlayedThisTurn
                                    })),
                                    gameStarted: room.gameState.gameStarted
                                },
                                gameState: {
                                    board: room.gameState.board,
                                    currentTurn: room.gameState.currentTurn,
                                    remainingDeck: 20,
                                    initialCards: room.gameState.initialCards,
                                    gameStarted: room.gameState.gameStarted
                                },
                                history: boardHistory.get(roomId)
                            });
                        }
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
        player.ws = null;
        try {
            await pool.query(`
                UPDATE player_connections
                SET connection_status = 'disconnected'
                WHERE player_id = $1
            `, [playerId]);
            await saveGameState(roomId);
            console.log(`💾 Estado guardado al desconectarse ${player.name}`);
        } catch (error) {
            console.error('Error al actualizar estado de conexión:', error);
        }

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
        saveGameState(roomId);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});