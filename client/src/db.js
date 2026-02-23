// src/db.js
const { Pool } = require('pg');
const { IS_PRODUCTION } = require('./config');

const DB_INIT_MAX_RETRIES = Number(process.env.DB_INIT_MAX_RETRIES || 8);
const DB_INIT_RETRY_DELAY_MS = Number(process.env.DB_INIT_RETRY_DELAY_MS || 4000);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        require: true,
        rejectUnauthorized: IS_PRODUCTION
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
    keepAlive: true
});

pool.on('error', (error) => {
    console.error('⚠️ Error inesperado en pool de PostgreSQL:', error.message);
});

function isTransientConnectionError(error) {
    if (!error) return false;

    const code = String(error.code || '').toUpperCase();
    const message = String(error.message || '').toLowerCase();
    const causeMessage = String(error.cause?.message || '').toLowerCase();

    return (
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ENETUNREACH' ||
        message.includes('connection timeout') ||
        message.includes('connection terminated') ||
        message.includes('terminating connection') ||
        causeMessage.includes('connection terminated') ||
        causeMessage.includes('connection timeout')
    );
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function ensureCascadeForeignKey() {
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'player_connections_room_id_fkey'
                  AND conrelid = 'player_connections'::regclass
            ) THEN
                ALTER TABLE player_connections
                DROP CONSTRAINT player_connections_room_id_fkey;
            END IF;

            ALTER TABLE player_connections
            ADD CONSTRAINT player_connections_room_id_fkey
            FOREIGN KEY (room_id)
            REFERENCES game_states(room_id)
            ON DELETE CASCADE;
        END $$;
    `);
}

async function runSchemaSetup() {
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
            connection_status VARCHAR(20) NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_player_room ON player_connections(room_id);

        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            token VARCHAR(128) PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMP NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
    `);

    await ensureCascadeForeignKey();

    await pool.query(`
        ALTER TABLE users
        ALTER COLUMN username TYPE TEXT,
        ALTER COLUMN display_name TYPE TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name_unique
        ON users (display_name);
    `);
}

async function initializeDatabase() {
    let attempt = 0;

    while (attempt < DB_INIT_MAX_RETRIES) {
        attempt++;

        try {
            await runSchemaSetup();
            console.log('✔ Tablas inicializadas correctamente');
            return;
        } catch (error) {
            const transient = isTransientConnectionError(error);
            const isLastAttempt = attempt >= DB_INIT_MAX_RETRIES;

            console.error(`❌ Error al inicializar base de datos (intento ${attempt}/${DB_INIT_MAX_RETRIES}):`, error.message || error);

            if (!transient || isLastAttempt) {
                throw error;
            }

            const delay = DB_INIT_RETRY_DELAY_MS * attempt;
            console.warn(`⏳ Reintentando inicialización de BD en ${delay}ms...`);
            await wait(delay);
        }
    }
}

async function cleanupOldGames() {
    try {
        await withTransaction(async (client) => {
            const staleRoomsQuery = `
                SELECT room_id
                FROM game_states
                WHERE last_activity < NOW() - INTERVAL '4 hours'
            `;
            const { rows } = await client.query(staleRoomsQuery);
            if (rows.length === 0) return;

            const roomIds = rows.map((row) => row.room_id);

            await client.query(
                'DELETE FROM player_connections WHERE room_id = ANY($1::varchar[])',
                [roomIds]
            );

            await client.query(
                'DELETE FROM game_states WHERE room_id = ANY($1::varchar[])',
                [roomIds]
            );
        });
    } catch (error) {
        console.error('Error limpiando partidas antiguas:', error);
    }
}

async function generateUniqueRoomId(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const exists = await pool.query('SELECT 1 FROM game_states WHERE room_id = $1', [roomId]);
        if (exists.rowCount === 0) return roomId;
    }
    throw new Error('No fue posible generar un roomId único');
}

module.exports = {
    pool,
    withTransaction,
    initializeDatabase,
    cleanupOldGames,
    generateUniqueRoomId,
    isTransientConnectionError
};
