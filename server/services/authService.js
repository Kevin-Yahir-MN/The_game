const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool, withTransaction } = require('../db');
const {
    isValidUsername,
    isValidDisplayName,
    isValidPassword,
} = require('../utils/validation');
const redis = require('redis');
const {
    DEFAULT_AVATAR_ID,
    isValidAvatarId,
} = require('../../shared/avatars');

const TOKEN_TTL_DAYS = 30;

const redisUrl = process.env.REDIS_URL;
let redisClient = null;
let redisConnected = false;

if (redisUrl) {
    redisClient = redis.createClient({ url: redisUrl });
    redisClient
        .connect()
        .then(() => { redisConnected = true; })
        .catch((err) => console.error('Redis connection error:', err));
    redisClient.on('error', () => { redisConnected = false; });
}

function normalizeUsername(username) {
    if (typeof username !== 'string') return '';
    return username.trim().toLowerCase();
}

function normalizeDisplayName(name) {
    if (typeof name !== 'string') return '';
    return name.trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hashedPassword = crypto
        .scryptSync(password, salt, 64)
        .toString('hex');
    return `${salt}:${hashedPassword}`;
}

function verifyPassword(password, storedHash) {
    const [salt, key] = String(storedHash || '').split(':');
    if (!salt || !key) return false;

    const computed = crypto
        .scryptSync(String(password), salt, 64)
        .toString('hex');
    const keyBuffer = Buffer.from(key, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');

    if (keyBuffer.length !== computedBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, computedBuffer);
}

function generateSessionToken() {
    return crypto.randomBytes(48).toString('hex');
}

function getTokenFromRequest(req) {
    return req.cookies?.authToken || req.headers.authorization?.split(' ')[1];
}

async function registerUser({ username, password, displayName, avatarId }) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const normalizedAvatarId = isValidAvatarId(avatarId)
        ? avatarId
        : DEFAULT_AVATAR_ID;
    if (!isValidUsername(normalizedUsername)) {
        const error = new Error('Nombre de usuario inválido');
        error.code = 'INVALID_USERNAME';
        throw error;
    }
    if (!isValidDisplayName(normalizedDisplayName)) {
        const error = new Error('Nombre visible inválido');
        error.code = 'INVALID_DISPLAY_NAME';
        throw error;
    }
    if (!isValidPassword(password)) {
        const error = new Error('Contraseña inválida');
        error.code = 'INVALID_PASSWORD';
        throw error;
    }

    return withTransaction(async (client) => {
        const existingUsername = await client.query(
            'SELECT id FROM users WHERE username = $1',
            [normalizedUsername]
        );

        if (existingUsername.rowCount > 0) {
            const error = new Error('El nombre de usuario ya existe');
            error.code = 'USERNAME_EXISTS';
            throw error;
        }

        const existingDisplayName = await client.query(
            'SELECT id FROM users WHERE display_name = $1',
            [normalizedDisplayName]
        );

        if (existingDisplayName.rowCount > 0) {
            const error = new Error('El nombre visible ya está en uso');
            error.code = 'DISPLAY_NAME_EXISTS';
            throw error;
        }

        const passwordHash = hashPassword(password);
        const insertResult = await client.query(
            `INSERT INTO users (id, username, password_hash, display_name, avatar_id, avatar_url, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NULL, NOW(), NOW())
             RETURNING id, username, display_name, avatar_id, avatar_url, created_at`,
            [
                uuidv4(),
                normalizedUsername,
                passwordHash,
                normalizedDisplayName,
                normalizedAvatarId,
            ]
        );

        return insertResult.rows[0];
    });
}

async function loginUser({ username, password }) {
    const normalizedUsername = normalizeUsername(username);
    const result = await pool.query(
        `SELECT id, username, display_name, avatar_id, avatar_url, password_hash
         FROM users
         WHERE username = $1`,
        [normalizedUsername]
    );

    if (result.rowCount === 0) {
        return null;
    }

    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
        return null;
    }

    return {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        avatar_id: user.avatar_id,
        avatar_url: user.avatar_url,
    };
}

async function hasActiveSession(userId) {
    // primero limpiar sesiones expiradas para evitar falsos positivos
    // esto es especialmente importante si el logout falló por error de red
    await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');

    const result = await pool.query(
        `SELECT 1 FROM user_sessions
         WHERE user_id = $1 AND expires_at > NOW()
         LIMIT 1`,
        [userId]
    );
    return result.rowCount > 0;
}

async function createSession(userId) {
    const token = generateSessionToken();
    const expiresAtQuery = `NOW() + INTERVAL '${TOKEN_TTL_DAYS} days'`;

    await pool.query(
        `INSERT INTO user_sessions (token, user_id, created_at, expires_at)
         VALUES ($1, $2, NOW(), ${expiresAtQuery})`,
        [token, userId]
    );

    return token;
}

async function getUserFromToken(token) {
    if (!token) return null;

    const result = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_id, u.avatar_url
         FROM user_sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > NOW()`,
        [token]
    );

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function getAccountById(userId) {
    const cacheKey = `user:${userId}`;
    if (redisConnected) {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            console.warn('Redis get error:', err);
        }
    }

    const result = await pool.query(
        `SELECT id, username, display_name, avatar_id, avatar_url, games_played, wins, win_streak, special_moves
         FROM users
         WHERE id = $1`,
        [userId]
    );

    if (result.rowCount > 0) {
        const account = result.rows[0];
        if (redisConnected) {
            try {
            await redisClient.setEx(cacheKey, 300, JSON.stringify(account)); // Cache for 5 minutes
            } catch (err) {
                console.warn('Redis set error:', err);
            }
        }
        return account;
    }

    return null;
}

async function updateDisplayName(userId, displayName) {
    const normalizedDisplayName = normalizeDisplayName(displayName);
    if (!isValidDisplayName(normalizedDisplayName)) {
        const error = new Error('Nombre visible inválido');
        error.code = 'INVALID_DISPLAY_NAME';
        throw error;
    }

    return withTransaction(async (client) => {
        const existing = await client.query(
            'SELECT id FROM users WHERE display_name = $1 AND id <> $2',
            [normalizedDisplayName, userId]
        );

        if (existing.rowCount > 0) {
            const error = new Error('El nombre visible ya está en uso');
            error.code = 'DISPLAY_NAME_EXISTS';
            throw error;
        }

        const result = await client.query(
            `UPDATE users
             SET display_name = $1,
                 updated_at = NOW()
             WHERE id = $2
             RETURNING id, username, display_name, avatar_id, avatar_url, games_played, wins, win_streak, special_moves`,
            [normalizedDisplayName, userId]
        );

        if (result.rowCount > 0) {
            if (redisConnected) {
                try {
                    await redisClient.del(`user:${userId}`);
                } catch (err) {
                    console.warn('Redis del error:', err);
                }
            }
        }

        return result.rowCount > 0 ? result.rows[0] : null;
    });
}

async function updateAvatar(userId, avatarId) {
    if (!isValidAvatarId(avatarId)) {
        const error = new Error('Avatar inválido');
        error.code = 'INVALID_AVATAR';
        throw error;
    }

    const result = await pool.query(
        `UPDATE users
         SET avatar_id = $1,
             avatar_url = NULL,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, username, display_name, avatar_id, avatar_url, games_played, wins, win_streak, special_moves`,
        [avatarId, userId]
    );

    if (result.rowCount > 0 && redisConnected) {
        try {
            await redisClient.del(`user:${userId}`);
        } catch (err) {
            console.warn('Redis del error:', err);
        }
    }

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function updateAvatarUrl(userId, avatarUrl) {
    if (!avatarUrl || typeof avatarUrl !== 'string') {
        const error = new Error('Avatar inválido');
        error.code = 'INVALID_AVATAR';
        throw error;
    }

    const result = await pool.query(
        `UPDATE users
         SET avatar_url = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, username, display_name, avatar_id, avatar_url, games_played, wins, win_streak, special_moves`,
        [avatarUrl, userId]
    );

    if (result.rowCount > 0 && redisConnected) {
        try {
            await redisClient.del(`user:${userId}`);
        } catch (err) {
            console.warn('Redis del error:', err);
        }
    }

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function clearAvatarUrl(userId) {
    const result = await pool.query(
        `UPDATE users
         SET avatar_url = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, display_name, avatar_id, avatar_url, games_played, wins, win_streak, special_moves`,
        [userId]
    );

    if (result.rowCount > 0 && redisConnected) {
        try {
            await redisClient.del(`user:${userId}`);
        } catch (err) {
            console.warn('Redis del error:', err);
        }
    }

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function changePassword(userId, currentPassword, newPassword) {
    if (!isValidPassword(newPassword)) {
        const error = new Error('Contraseña inválida');
        error.code = 'INVALID_PASSWORD';
        throw error;
    }

    const result = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
    );

    if (result.rowCount === 0) {
        const error = new Error('Usuario no encontrado');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }

    const storedHash = result.rows[0].password_hash;
    if (!verifyPassword(currentPassword, storedHash)) {
        const error = new Error('La contraseña actual es incorrecta');
        error.code = 'INVALID_CURRENT_PASSWORD';
        throw error;
    }

    const newHash = hashPassword(newPassword);
    await pool.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [newHash, userId]
    );

    if (redisConnected) {
        try {
            await redisClient.del(`user:${userId}`);
        } catch (err) {
            console.warn('Redis del error:', err);
        }
    }
}

async function incrementUserSpecialMoves(userId) {
    if (!userId) return;

    const result = await pool.query(
        `UPDATE users
         SET special_moves = special_moves + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, special_moves`,
        [userId]
    );

    if (result.rowCount > 0 && redisConnected) {
        try {
            await redisClient.del(`user:${userId}`);
        } catch (err) {
            console.warn('Redis del error:', err);
        }
    }
}

async function recordUsersGameResult(userIds, didWin) {
    console.log(
        '[AUTH] recordUsersGameResult called with userIds=' +
        JSON.stringify(userIds) +
        ', didWin=' +
        didWin
    );

    if (!Array.isArray(userIds) || userIds.length === 0) {
        console.warn('[AUTH] Invalid or empty userIds array');
        return;
    }

    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
        console.warn('[AUTH] No valid IDs after deduplication');
        return;
    }

    console.log('[AUTH] Updating stats for ' + uniqueIds.length + ' users');

    if (didWin) {
        const result = await pool.query(
            `UPDATE users
             SET games_played = games_played + 1,
                 wins = wins + 1,
                 win_streak = win_streak + 1,
                 updated_at = NOW()
             WHERE id = ANY($1::uuid[])
             RETURNING id, games_played, wins`,
            [uniqueIds]
        );
        console.log('[AUTH] Win updated for ' + result.rowCount + ' rows');
        // Invalidate cache
        if (redisConnected) {
            for (const id of uniqueIds) {
                try {
                    await redisClient.del(`user:${id}`);
                } catch (err) {
                    console.warn('Redis del error:', err);
                }
            }
        }
        return;
    }

    const result = await pool.query(
        `UPDATE users
         SET games_played = games_played + 1,
             win_streak = 0,
             updated_at = NOW()
         WHERE id = ANY($1::uuid[])
         RETURNING id, games_played`,
        [uniqueIds]
    );
    console.log('[AUTH] Loss updated for ' + result.rowCount + ' rows');
    // Invalidate cache
    if (redisConnected) {
        for (const id of uniqueIds) {
            try {
                await redisClient.del(`user:${id}`);
            } catch (err) {
                console.warn('Redis del error:', err);
            }
        }
    }
}

async function deleteSession(token) {
    if (!token) return;
    try {
        await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]);
    } catch (error) {
        console.error('Error deleting session:', error);
        throw error;
    }
}

async function cleanupExpiredSessions() {
    await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
}

module.exports = {
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
    incrementUserSpecialMoves,
    recordUsersGameResult,
    deleteSession,
    cleanupExpiredSessions,
};
