// src/db.js
const { Pool } = require('pg');
const { IS_PRODUCTION } = require('./config');
const { isTransientConnectionError } = require('./utils/errors');
const { runMigrations } = require('./migrations');

const DB_INIT_MAX_RETRIES = Number(process.env.DB_INIT_MAX_RETRIES || 8);
const DB_INIT_RETRY_DELAY_MS = Number(
    process.env.DB_INIT_RETRY_DELAY_MS || 4000
);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        require: true,
        rejectUnauthorized: IS_PRODUCTION,
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: Number(
        process.env.DB_CONNECTION_TIMEOUT_MS || 10000
    ),
    keepAlive: true,
});

pool.on('error', (error) => {
    console.error('⚠️ Error inesperado en pool de PostgreSQL:', error.message);
});

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

async function initializeDatabase() {
    let attempt = 0;

    while (attempt < DB_INIT_MAX_RETRIES) {
        attempt++;

        try {
            await runMigrations(pool);
            console.log('✔ Tablas inicializadas correctamente');
            return;
        } catch (error) {
            const transient = isTransientConnectionError(error);
            const isLastAttempt = attempt >= DB_INIT_MAX_RETRIES;

            console.error(
                `❌ Error al inicializar base de datos (intento ${attempt}/${DB_INIT_MAX_RETRIES}):`,
                error.message || error
            );

            if (!transient || isLastAttempt) {
                throw error;
            }

            const delay = DB_INIT_RETRY_DELAY_MS * attempt;
            console.warn(
                `⏳ Reintentando inicialización de BD en ${delay}ms...`
            );
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
        const exists = await pool.query(
            'SELECT 1 FROM game_states WHERE room_id = $1',
            [roomId]
        );
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
    isTransientConnectionError,
};
