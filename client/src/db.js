// src/db.js
const { Pool } = require('pg');
const { IS_PRODUCTION } = require('./config');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        require: true,
        rejectUnauthorized: IS_PRODUCTION
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

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
    generateUniqueRoomId
};
