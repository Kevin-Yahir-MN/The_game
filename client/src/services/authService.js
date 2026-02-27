const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool, withTransaction } = require('../db');

const TOKEN_TTL_DAYS = 30;

function normalizeUsername(username) {
    if (typeof username !== 'string') return '';
    return username.trim().toLowerCase();
}

function normalizeDisplayName(name) {
    if (typeof name !== 'string') return '';
    return name.trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hashedPassword = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hashedPassword}`;
}

function verifyPassword(password, storedHash) {
    const [salt, key] = String(storedHash || '').split(':');
    if (!salt || !key) return false;

    const computed = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const keyBuffer = Buffer.from(key, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');

    if (keyBuffer.length !== computedBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, computedBuffer);
}

function generateSessionToken() {
    return crypto.randomBytes(48).toString('hex');
}

function getTokenFromRequest(req) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
}

async function registerUser({ username, password, displayName }) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedDisplayName = normalizeDisplayName(displayName);

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
            `INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             RETURNING id, username, display_name, created_at`,
            [uuidv4(), normalizedUsername, passwordHash, normalizedDisplayName]
        );

        return insertResult.rows[0];
    });
}

async function loginUser({ username, password }) {
    const normalizedUsername = normalizeUsername(username);
    const result = await pool.query(
        `SELECT id, username, display_name, password_hash
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
        display_name: user.display_name
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
        `SELECT u.id, u.username, u.display_name
         FROM user_sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > NOW()`,
        [token]
    );

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function getAccountById(userId) {
    const result = await pool.query(
        `SELECT id, username, display_name, games_played, wins, win_streak
         FROM users
         WHERE id = $1`,
        [userId]
    );

    return result.rowCount > 0 ? result.rows[0] : null;
}

async function updateDisplayName(userId, displayName) {
    const normalizedDisplayName = normalizeDisplayName(displayName);

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
             RETURNING id, username, display_name, games_played, wins, win_streak`,
            [normalizedDisplayName, userId]
        );

        return result.rowCount > 0 ? result.rows[0] : null;
    });
}

async function changePassword(userId, currentPassword, newPassword) {
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
}

async function recordUsersGameResult(userIds, didWin) {
    console.log('[AUTH] recordUsersGameResult called with userIds=' + JSON.stringify(userIds) + ', didWin=' + didWin);

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
    changePassword,
    recordUsersGameResult,
    deleteSession,
    cleanupExpiredSessions
};
