// src/http/routes.js
const { v4: uuidv4 } = require('uuid');
const { pool, withTransaction, generateUniqueRoomId } = require('../db');
const { rooms, reverseRoomMap, boardHistory } = require('../state');
const { sanitizePlayerName, isValidRoomId } = require('../utils/validation');
const { initializeDeck } = require('../utils/gameRules');
const { createTurnState } = require('../utils/turnState');
const { flushSaveGameState } = require('../services/persistence');
const { broadcastToRoom } = require('../services/communication');
const {
    getTokenFromRequest,
    registerUser,
    loginUser,
    createSession,
    getUserFromToken,
    deleteSession
} = require('../services/authService');

const MAX_PLAYERS_PER_ROOM = 6;

function hasContent(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

async function getAuthenticatedUser(req) {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    return getUserFromToken(token);
}

function registerHttpRoutes(app) {

    app.get('/health', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            status: 'ok',
            uptimeSeconds: Math.floor(process.uptime()),
            activeRooms: rooms.size,
            timestamp: new Date().toISOString()
        });
    });

    app.post('/auth/register', async (req, res) => {
        const { username, password, displayName } = req.body || {};

        if (!hasContent(username) || !hasContent(password) || !hasContent(displayName)) {
            return res.status(400).json({ success: false, message: 'Usuario, contraseña y nombre visible son obligatorios' });
        }

        try {
            const user = await registerUser({
                username,
                password,
                displayName
            });
            const token = await createSession(user.id);

            return res.status(201).json({
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name
                }
            });
        } catch (error) {
            if (error.code === 'USERNAME_EXISTS' || error.code === 'DISPLAY_NAME_EXISTS') {
                return res.status(409).json({ success: false, message: error.message });
            }

            if (error.code === '23505') {
                const message = String(error.constraint || '').includes('display_name')
                    ? 'El nombre visible ya está en uso'
                    : 'El nombre de usuario ya existe';
                return res.status(409).json({ success: false, message });
            }
            console.error('Error en registro:', error);
            return res.status(500).json({ success: false, message: 'Error interno al registrar usuario' });
        }
    });

    app.post('/auth/login', async (req, res) => {
        const { username, password } = req.body || {};

        if (!hasContent(username) || !hasContent(password)) {
            return res.status(400).json({ success: false, message: 'Usuario y contraseña son obligatorios' });
        }

        try {
            const user = await loginUser({ username, password });
            if (!user) {
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }

            const token = await createSession(user.id);
            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name
                }
            });
        } catch (error) {
            console.error('Error en login:', error);
            return res.status(500).json({ success: false, message: 'Error interno al iniciar sesión' });
        }
    });

    app.get('/auth/me', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res.status(401).json({ success: false, message: 'No autenticado' });
            }

            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name
                }
            });
        } catch (error) {
            console.error('Error en auth/me:', error);
            return res.status(500).json({ success: false, message: 'Error interno' });
        }
    });

    app.post('/auth/logout', async (req, res) => {
        try {
            const token = getTokenFromRequest(req);
            await deleteSession(token);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error en logout:', error);
            return res.status(500).json({ success: false, message: 'Error interno cerrando sesión' });
        }
    });

    app.post('/create-room', async (req, res) => {
        const authUser = await getAuthenticatedUser(req);
        const requestedName = sanitizePlayerName(req.body?.playerName);
        const playerName = requestedName || authUser?.display_name;

        if (!playerName) {
            return res.status(400).json({ success: false, message: 'Nombre de jugador inválido' });
        }

        const playerId = uuidv4();

        try {
            const roomId = await generateUniqueRoomId();
            await withTransaction(async (client) => {
                await client.query(`
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

                await client.query(`
                    INSERT INTO player_connections 
                    (player_id, room_id, last_ping, connection_status)
                    VALUES ($1, $2, NOW(), 'connected')
                `, [playerId, roomId]);
            });

            const room = {
                players: [{
                    id: playerId,
                    name: playerName,
                    isHost: true,
                    ws: null,
                    cards: [],
                    cardsPlayedThisTurn: 0,
                    turnState: createTurnState(),
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
            console.error('Error al crear sala:', error);
            res.status(500).json({ success: false, message: 'Error al crear sala' });
        }
    });

    app.post('/join-room', async (req, res) => {
        const authUser = await getAuthenticatedUser(req);
        const requestedName = sanitizePlayerName(req.body?.playerName);
        const playerName = requestedName || authUser?.display_name;
        const roomId = req.body?.roomId;

        if (!playerName || !isValidRoomId(roomId)) {
            return res.status(400).json({
                success: false,
                message: 'Nombre de jugador y código de sala válidos requeridos'
            });
        }

        try {
            const roomCheck = await pool.query('SELECT 1 FROM game_states WHERE room_id = $1', [roomId]);
            if (roomCheck.rowCount === 0) {
                return res.status(404).json({ success: false, message: 'Sala no encontrada' });
            }

            if (!rooms.has(roomId)) {
                return res.status(404).json({
                    success: false,
                    message: 'Sala no disponible'
                });
            }

            const room = rooms.get(roomId);
            if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
                return res.status(409).json({
                    success: false,
                    message: `La sala alcanzó el máximo de ${MAX_PLAYERS_PER_ROOM} jugadores`
                });
            }

            const playerId = uuidv4();

            await withTransaction(async (client) => {
                await client.query(`
                    INSERT INTO player_connections 
                    (player_id, room_id, last_ping, connection_status)
                    VALUES ($1, $2, NOW(), 'connected')
                    ON CONFLICT (player_id) 
                    DO UPDATE SET
                        room_id = $2,
                        last_ping = NOW(),
                        connection_status = 'connected'
                `, [playerId, roomId]);
            });

            const newPlayer = {
                id: playerId,
                name: playerName,
                isHost: false,
                ws: null,
                cards: [],
                cardsPlayedThisTurn: 0,
                turnState: createTurnState(),
                lastActivity: Date.now()
            };
            room.players.push(newPlayer);

            await flushSaveGameState(roomId);

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
            if (!playerId || !isValidRoomId(roomId)) {
                return res.status(400).json({ success: false, error: 'Datos de conexión inválidos' });
            }

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
        if (!isValidRoomId(roomId) || !rooms.has(roomId)) {
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
            if (!isValidRoomId(roomId)) {
                return res.status(400).json({ success: false, error: 'roomId inválido' });
            }
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
}

module.exports = { registerHttpRoutes };
