const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

function listMigrationFiles() {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((file) => /^\d+_.+\.sql$/i.test(file))
        .sort();
}

async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT UNIQUE NOT NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
    `);
}

async function getAppliedMigrations(client) {
    const result = await client.query(
        'SELECT filename FROM schema_migrations'
    );
    return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client, filename, sql) {
    await client.query('BEGIN');
    try {
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function runMigrations(pool) {
    const client = await pool.connect();
    try {
        await ensureMigrationsTable(client);
        const applied = await getAppliedMigrations(client);
        const files = listMigrationFiles();

        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = fs.readFileSync(
                path.join(MIGRATIONS_DIR, file),
                'utf8'
            );
            if (!sql.trim()) continue;
            await applyMigration(client, file, sql);
        }
    } finally {
        client.release();
    }
}

module.exports = { runMigrations };
