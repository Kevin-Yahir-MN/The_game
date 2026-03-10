const { pool } = require('../server/db');
const { runMigrations } = require('../server/migrations');

async function main() {
    try {
        await runMigrations(pool);
        console.log('✔ Migraciones aplicadas correctamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error ejecutando migraciones:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
