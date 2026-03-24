// src/http/routes.js
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { pool, withTransaction, generateUniqueRoomId } = require('../db');
const { rooms, reverseRoomMap, boardHistory } = require('../state');
const { sanitizePlayerName, isValidRoomId } = require('../utils/validation');
const { initializeDeck } = require('../utils/gameRules');
const { createTurnState } = require('../utils/turnState');
const friendService = require('../services/friendService');
const { createDefaultHistory, normalizeHistory } = require('../utils/history');
const { flushSaveGameState } = require('../services/persistence');
const { broadcastToRoom } = require('../services/communication');
const {
    getTokenFromRequest,
    registerUser,
    loginUser,
    createSession,
    hasActiveSession,
    getUserFromToken,
    getAccountById,
    updateDisplayName,
    updateAvatar,
    updateAvatarUrl,
    clearAvatarUrl,
    changePassword,
    deleteSession,
} = require('../services/authService');
const { DEFAULT_AVATAR_ID } = require('../../shared/avatars');

const MAX_PLAYERS_PER_ROOM = 6;
const uploadsRoot = process.env.UPLOADS_DIR
    ? path.resolve(__dirname, '../../', process.env.UPLOADS_DIR)
    : path.join(__dirname, '../../uploads');
const avatarsDir = path.join(uploadsRoot, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
const MAX_AVATAR_BYTES = Number(process.env.AVATAR_MAX_BYTES) || 1024 * 1024;
const AVATAR_SIZE_PX = 256;

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
        const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)
            ? ext
            : '.png';
        const userId = req.user?.id || 'user';
        cb(null, `${userId}_${Date.now()}${safeExt}`);
    },
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: MAX_AVATAR_BYTES },
    fileFilter: (req, file, cb) => {
        const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(
            file.mimetype
        );
        cb(ok ? null : new Error('INVALID_AVATAR_TYPE'), ok);
    },
});

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
            timestamp: new Date().toISOString(),
        });
    });

    const buildAuthCookieOptions = (req) => {
        const isHttps =
            req.secure || req.headers['x-forwarded-proto'] === 'https';
        const sameSite = isHttps ? 'none' : 'lax';
        return {
            httpOnly: true,
            secure: isHttps,
            sameSite,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        };
    };

    app.post('/auth/register', async (req, res) => {
        const { username, password, displayName, avatarId } = req.body || {};

        if (
            !hasContent(username) ||
            !hasContent(password) ||
            !hasContent(displayName)
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        'Usuario, contraseña y nombre visible son obligatorios',
                });
        }

        try {
            const user = await registerUser({
                username,
                password,
                displayName,
                avatarId,
            });
            const token = await createSession(user.id);

            res.cookie('authToken', token, buildAuthCookieOptions(req));

            return res.status(201).json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name,
                    avatarId: user.avatar_id,
                    avatarUrl: user.avatar_url,
                },
            });
        } catch (error) {
            if (
                error.code === 'USERNAME_EXISTS' ||
                error.code === 'DISPLAY_NAME_EXISTS'
            ) {
                return res
                    .status(409)
                    .json({ success: false, message: error.message });
            }
            if (
                error.code === 'INVALID_USERNAME' ||
                error.code === 'INVALID_DISPLAY_NAME' ||
                error.code === 'INVALID_PASSWORD'
            ) {
                return res
                    .status(400)
                    .json({ success: false, message: error.message });
            }

            if (error.code === '23505') {
                const message = String(error.constraint || '').includes(
                    'display_name'
                )
                    ? 'El nombre visible ya está en uso'
                    : 'El nombre de usuario ya existe';
                return res.status(409).json({ success: false, message });
            }
            console.error('Error en registro:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al registrar usuario',
                });
        }
    });

    app.post('/auth/login', async (req, res) => {
        const { username, password } = req.body || {};

        if (!hasContent(username) || !hasContent(password)) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: 'Usuario y contraseña son obligatorios',
                });
        }

        try {
            const user = await loginUser({ username, password });
            if (!user) {
                return res
                    .status(401)
                    .json({
                        success: false,
                        message: 'Usuario o contraseña incorrectos',
                    });
            }

            // verificar si el usuario ya tiene una sesión activa
            const hasSession = await hasActiveSession(user.id);
            if (hasSession) {
                return res.status(409).json({
                    success: false,
                    message:
                        'Este usuario ya se encuentra en sesión en otro dispositivo',
                });
            }

            const token = await createSession(user.id);
            res.cookie('authToken', token, buildAuthCookieOptions(req));
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name,
                    avatarId: user.avatar_id,
                    avatarUrl: user.avatar_url,
                },
            });
        } catch (error) {
            console.error('Error en login:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al iniciar sesión',
                });
        }
    });

    app.get('/auth/me', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.display_name,
                    avatarId: user.avatar_id,
                    avatarUrl: user.avatar_url,
                },
            });
        } catch (error) {
            console.error('Error en auth/me:', error);
            return res
                .status(500)
                .json({ success: false, message: 'Error interno' });
        }
    });

    app.post('/auth/logout', async (req, res) => {
        try {
            const token = getTokenFromRequest(req);
            // intentar obtener usuario para borrar todas sus sesiones
            const user = await getUserFromToken(token);
            if (user && user.id) {
                await pool.query(
                    'DELETE FROM user_sessions WHERE user_id = $1',
                    [user.id]
                );
            } else if (token) {
                await deleteSession(token);
            }
            const cookieOptions = buildAuthCookieOptions(req);
            res.clearCookie('authToken', {
                httpOnly: cookieOptions.httpOnly,
                secure: cookieOptions.secure,
                sameSite: cookieOptions.sameSite,
            });
            return res.json({ success: true });
        } catch (error) {
            console.error('Error en logout:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno cerrando sesión',
                });
        }
    });

    app.get('/auth/account', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            const account = await getAccountById(user.id);
            if (!account) {
                return res
                    .status(404)
                    .json({ success: false, message: 'Cuenta no encontrada' });
            }

            return res.json({
                success: true,
                account: {
                    id: account.id,
                    username: account.username,
                    displayName: account.display_name,
                    avatarId: account.avatar_id,
                    avatarUrl: account.avatar_url,
                    stats: {
                        gamesPlayed: Number(account.games_played) || 0,
                        wins: Number(account.wins) || 0,
                        winStreak: Number(account.win_streak) || 0,
                        specialMoves: Number(account.special_moves) || 0,
                    },
                },
            });
        } catch (error) {
            console.error('Error en auth/account:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno cargando cuenta',
                });
        }
    });

    app.patch('/auth/account', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            const { displayName, currentPassword, newPassword, avatarId } =
                req.body || {};
            let updatedAccount = null;

            if (hasContent(displayName)) {
                updatedAccount = await updateDisplayName(user.id, displayName);
            }

            if (hasContent(avatarId)) {
                updatedAccount = await updateAvatar(user.id, avatarId);
            }

            if (hasContent(currentPassword) || hasContent(newPassword)) {
                if (!hasContent(currentPassword) || !hasContent(newPassword)) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                'Para cambiar contraseña, envía contraseña actual y nueva',
                        });
                }
                await changePassword(user.id, currentPassword, newPassword);
            }

            const account = updatedAccount || (await getAccountById(user.id));
            if (!account) {
                return res
                    .status(404)
                    .json({ success: false, message: 'Cuenta no encontrada' });
            }

            return res.json({
                success: true,
                account: {
                    id: account.id,
                    username: account.username,
                    displayName: account.display_name,
                    avatarId: account.avatar_id,
                    avatarUrl: account.avatar_url,
                    stats: {
                        gamesPlayed: Number(account.games_played) || 0,
                        wins: Number(account.wins) || 0,
                        winStreak: Number(account.win_streak) || 0,
                        specialMoves: Number(account.special_moves) || 0,
                    },
                },
            });
        } catch (error) {
            if (error.code === 'DISPLAY_NAME_EXISTS') {
                return res
                    .status(409)
                    .json({ success: false, message: error.message });
            }
            if (
                error.code === 'INVALID_DISPLAY_NAME' ||
                error.code === 'INVALID_PASSWORD' ||
                error.code === 'INVALID_AVATAR'
            ) {
                return res
                    .status(400)
                    .json({ success: false, message: error.message });
            }
            if (error.code === 'INVALID_CURRENT_PASSWORD') {
                return res
                    .status(400)
                    .json({ success: false, message: error.message });
            }
            console.error('Error en PATCH auth/account:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno actualizando cuenta',
                });
        }
    });

    app.post('/auth/avatar/upload', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            req.user = user;

            avatarUpload.single('avatar')(req, res, async (err) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(413).json({
                            success: false,
                            message: 'El avatar supera el tamaño permitido',
                        });
                    }
                    if (err.message === 'INVALID_AVATAR_TYPE') {
                        return res.status(400).json({
                            success: false,
                            message: 'Tipo de archivo no permitido',
                        });
                    }
                    return res.status(400).json({
                        success: false,
                        message: 'Error subiendo avatar',
                    });
                }

                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        message: 'Archivo requerido',
                    });
                }

                const processedName = `${user.id}_${Date.now()}.webp`;
                const processedPath = path.join(avatarsDir, processedName);
                try {
                    await sharp(req.file.path)
                        .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover' })
                        .webp({ quality: 80 })
                        .toFile(processedPath);
                } finally {
                    fs.unlink(req.file.path, () => {});
                }

                const avatarUrl = `/uploads/avatars/${processedName}`;
                const previous = await getAccountById(user.id);
                const account = await updateAvatarUrl(user.id, avatarUrl);

                if (
                    previous?.avatar_url &&
                    previous.avatar_url.startsWith('/uploads/avatars/')
                ) {
                    const oldPath = path.join(
                        uploadsRoot,
                        previous.avatar_url.replace('/uploads/', '')
                    );
                    if (oldPath !== path.join(uploadsRoot, avatarUrl.replace('/uploads/', ''))) {
                        fs.unlink(oldPath, () => {});
                    }
                }

                return res.json({
                    success: true,
                    account: {
                        id: account.id,
                        username: account.username,
                        displayName: account.display_name,
                        avatarId: account.avatar_id,
                        avatarUrl: account.avatar_url,
                        stats: {
                            gamesPlayed: Number(account.games_played) || 0,
                            wins: Number(account.wins) || 0,
                            winStreak: Number(account.win_streak) || 0,
                            specialMoves: Number(account.special_moves) || 0,
                        },
                    },
                });
            });
        } catch (error) {
            console.error('Error subiendo avatar:', error);
            return res.status(500).json({
                success: false,
                message: 'Error interno subiendo avatar',
            });
        }
    });

    app.post('/auth/avatar/remove', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            const previous = await getAccountById(user.id);
            const account = await clearAvatarUrl(user.id);

            if (
                previous?.avatar_url &&
                previous.avatar_url.startsWith('/uploads/avatars/')
            ) {
                const oldPath = path.join(
                    uploadsRoot,
                    previous.avatar_url.replace('/uploads/', '')
                );
                fs.unlink(oldPath, () => {});
            }

            return res.json({
                success: true,
                account: {
                    id: account.id,
                    username: account.username,
                    displayName: account.display_name,
                    avatarId: account.avatar_id,
                    avatarUrl: account.avatar_url,
                    stats: {
                        gamesPlayed: Number(account.games_played) || 0,
                        wins: Number(account.wins) || 0,
                        winStreak: Number(account.win_streak) || 0,
                        specialMoves: Number(account.special_moves) || 0,
                    },
                },
            });
        } catch (error) {
            console.error('Error removiendo avatar:', error);
            return res.status(500).json({
                success: false,
                message: 'Error interno removiendo avatar',
            });
        }
    });

    // rutas de amigos
    app.get('/friends', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }
            const friends = await friendService.getFriends(user.id);
            return res.json({ success: true, friends });
        } catch (error) {
            console.error('Error obteniendo lista de amigos:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al cargar amigos',
                });
        }
    });

    app.post('/friends', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }
            const { friendId } = req.body || {};
            if (!friendId) {
                return res
                    .status(400)
                    .json({ success: false, message: 'friendId requerido' });
            }

            await friendService.addFriend(user.id, friendId);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error agregando amigo:', error);
            if (error.code === 'FRIEND_NOT_FOUND') {
                return res
                    .status(404)
                    .json({ success: false, message: 'Usuario no encontrado' });
            }
            if (error.code === 'ALREADY_FRIEND') {
                return res
                    .status(409)
                    .json({ success: false, message: 'Ya es tu amigo' });
            }
            if (error.code === 'SELF_FRIEND') {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message: 'No puedes agregarte a ti mismo',
                    });
            }
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al agregar amigo',
                });
        }
    });

    // eliminar amigo
    app.delete('/friends/:id', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }
            const friendId = req.params.id;
            if (!friendId) {
                return res
                    .status(400)
                    .json({ success: false, message: 'friendId requerido' });
            }

            await friendService.removeFriend(user.id, friendId);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error eliminando amigo:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al eliminar amigo',
                });
        }
    });

    // obtener información de cualquier usuario (para modal de amigos)
    app.get('/users/:id', async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) {
                return res
                    .status(401)
                    .json({ success: false, message: 'No autenticado' });
            }

            const account = await getAccountById(req.params.id);
            if (!account) {
                return res
                    .status(404)
                    .json({ success: false, message: 'Usuario no encontrado' });
            }

            return res.json({
                success: true,
                account: {
                    id: account.id,
                    username: account.username,
                    displayName: account.display_name,
                    avatarId: account.avatar_id,
                    avatarUrl: account.avatar_url,
                    stats: {
                        gamesPlayed: Number(account.games_played) || 0,
                        wins: Number(account.wins) || 0,
                        winStreak: Number(account.win_streak) || 0,
                        specialMoves: Number(account.special_moves) || 0,
                    },
                },
            });
        } catch (error) {
            console.error('Error obteniendo usuario:', error);
            return res
                .status(500)
                .json({
                    success: false,
                    message: 'Error interno al obtener usuario',
                });
        }
    });

    // continuar con rutas existentes
    app.post('/create-room', async (req, res) => {
        const authUser = await getAuthenticatedUser(req);
        console.log(
            '[ROUTES] create-room: authUserId=' +
            (authUser ? authUser.id : 'null')
        );
        const requestedName = sanitizePlayerName(req.body?.playerName);
        const playerName = requestedName || authUser?.display_name;
        const avatarId = authUser?.avatar_id || DEFAULT_AVATAR_ID;
        const avatarUrl = authUser?.avatar_url || null;

        if (!playerName) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: 'Nombre de jugador inválido',
                });
        }

        const playerId = uuidv4();

        try {
            const roomId = await generateUniqueRoomId();
            const initialDeck = initializeDeck();
            await withTransaction(async (client) => {
                await client.query(
                    `
                    INSERT INTO game_states 
                    (room_id, game_data, last_activity)
                    VALUES ($1, $2, NOW())
                `,
                    [
                        roomId,
                        JSON.stringify({
                            players: [],
                            gameState: {
                                deck: initialDeck,
                                board: {
                                    ascending: [1, 1],
                                    descending: [100, 100],
                                },
                                currentTurn: playerId,
                                gameStarted: false,
                                initialCards: 6,
                            },
                            history: createDefaultHistory(),
                        }),
                    ]
                );

                await client.query(
                    `
                    INSERT INTO player_connections 
                    (player_id, room_id, last_ping, connection_status)
                    VALUES ($1, $2, NOW(), 'connected')
                `,
                    [playerId, roomId]
                );
            });

            const room = {
                players: [
                    {
                        id: playerId,
                        name: playerName,
                        isHost: true,
                        userId: authUser?.id || null,
                        avatarId,
                        avatarUrl,
                        ws: null,
                        cards: [],
                        turnState: createTurnState(),
                        specialMovesThisMatch: 0,
                        lastActivity: Date.now(),
                    },
                ],
                gameState: {
                    deck: initialDeck,
                    board: { ascending: [1, 1], descending: [100, 100] },
                    currentTurn: playerId,
                    gameStarted: false,
                    initialCards: 6,
                },
                // el host original nunca cambia, incluso si se desconecta
                originalHostId: playerId,
                // flag used to suppress player removal during the brief
                // transition that occurs when a game resets and everyone
                // hops back to the lobby page
                resetting: false,
            };

            rooms.set(roomId, room);
            reverseRoomMap.set(room, roomId);
            boardHistory.set(roomId, createDefaultHistory());

            res.json({ success: true, roomId, playerId, playerName });
        } catch (error) {
            console.error('Error al crear sala:', error);
            res.status(500).json({
                success: false,
                message: 'Error al crear sala',
            });
        }
    });

    app.post('/join-room', async (req, res) => {
        const authUser = await getAuthenticatedUser(req);
        console.log(
            '[ROUTES] join-room: authUserId=' +
            (authUser ? authUser.id : 'null')
        );
        const requestedName = sanitizePlayerName(req.body?.playerName);
        const playerName = requestedName || authUser?.display_name;
        const avatarId = authUser?.avatar_id || DEFAULT_AVATAR_ID;
        const avatarUrl = authUser?.avatar_url || null;
        const roomId = req.body?.roomId;

        if (!playerName || !isValidRoomId(roomId)) {
            return res.status(400).json({
                success: false,
                message:
                    'Nombre de jugador y código de sala válidos requeridos',
            });
        }

        try {
            const roomCheck = await pool.query(
                'SELECT 1 FROM game_states WHERE room_id = $1',
                [roomId]
            );
            if (roomCheck.rowCount === 0) {
                return res
                    .status(404)
                    .json({ success: false, message: 'Sala no encontrada' });
            }

            if (!rooms.has(roomId)) {
                return res.status(404).json({
                    success: false,
                    message: 'Sala no disponible',
                });
            }

            const room = rooms.get(roomId);
            if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
                return res.status(409).json({
                    success: false,
                    message: `La sala alcanzó el máximo de ${MAX_PLAYERS_PER_ROOM} jugadores`,
                });
            }

            const playerId = uuidv4();

            await withTransaction(async (client) => {
                await client.query(
                    `
                    INSERT INTO player_connections 
                    (player_id, room_id, last_ping, connection_status)
                    VALUES ($1, $2, NOW(), 'connected')
                    ON CONFLICT (player_id) 
                    DO UPDATE SET
                        room_id = $2,
                        last_ping = NOW(),
                        connection_status = 'connected'
                `,
                    [playerId, roomId]
                );
            });

            const newPlayer = {
                id: playerId,
                name: playerName,
                isHost: false,
                userId: authUser?.id || null,
                avatarId,
                avatarUrl,
                ws: null,
                cards: [],
                turnState: createTurnState(),
                specialMovesThisMatch: 0,
                lastActivity: Date.now(),
            };
            room.players.push(newPlayer);

            await flushSaveGameState(roomId);

            broadcastToRoom(room, {
                type: 'player_joined',
                playerId: playerId,
                playerName: playerName,
                players: room.players.map((p) => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    cardCount: p.cards.length,
                    connected: p.ws !== null,
                    userId: p.userId || null,
                })),
            });

            res.json({
                success: true,
                playerId,
                playerName,
                isHost: false,
                roomId,
            });
        } catch (error) {
            console.error('Error al unirse a sala:', error);

            if (error.code === '23503') {
                res.status(404).json({
                    success: false,
                    message: 'Sala no existe en la base de datos',
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Error al unirse a sala',
                    error: error.message,
                });
            }
        }
    });

    app.post('/register-connection', async (req, res) => {
        try {
            const { playerId, roomId } = req.body;
            if (!playerId || !isValidRoomId(roomId)) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error: 'Datos de conexión inválidos',
                    });
            }

            await pool.query(
                `
                INSERT INTO player_connections 
                (player_id, room_id, last_ping, connection_status)
                VALUES ($1, $2, NOW(), 'connected')
                ON CONFLICT (player_id) 
                DO UPDATE SET
                    room_id = $2,
                    last_ping = NOW(),
                    connection_status = 'connected'
            `,
                [playerId, roomId]
            );

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
            return res
                .status(404)
                .json({ success: false, message: 'Sala no encontrada' });
        }

        const room = rooms.get(roomId);
        res.json({
            success: true,
            players: room.players.map((p) => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                cardCount: p.cards.length,
                connected: p.ws !== null,
                userId: p.userId || null,
                avatarId: p.avatarId || null,
                avatarUrl: p.avatarUrl || null,
            })),
            gameStarted: room.gameState.gameStarted,
            currentTurn: room.gameState.currentTurn,
            initialCards: room.gameState.initialCards,
        });
    });

    app.get('/room-history/:roomId', async (req, res) => {
        try {
            const roomId = req.params.roomId;
            if (!isValidRoomId(roomId)) {
                return res
                    .status(400)
                    .json({ success: false, error: 'roomId inválido' });
            }
            const history = normalizeHistory(boardHistory.get(roomId));

            res.json({
                success: true,
                history,
            });
        } catch (error) {
            console.error('Error al obtener historial:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
}

module.exports = { registerHttpRoutes };
