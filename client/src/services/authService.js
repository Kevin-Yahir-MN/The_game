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

async function deleteSession(token) {
    if (!token) return;
    await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]);
}

async function cleanupExpiredSessions() {
    await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
}

module.exports = {
    getTokenFromRequest,
    registerUser,
    loginUser,
    createSession,
    getUserFromToken,
    deleteSession,
    cleanupExpiredSessions
};
