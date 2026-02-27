const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');

const { PORT, allowedOrigins } = require('./client/src/config.js');
const { initializeDatabase, cleanupOldGames, isTransientConnectionError } = require('./client/src/db.js');
const { registerHttpRoutes } = require('./client/src/http/routes.js');
const { restoreActiveGames } = require('./client/src/services/persistence.js');
const { setupWebSocket } = require('./client/src/ws/websocket.js');
const { cleanupExpiredSessions } = require('./client/src/services/authService.js');

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'client')));

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
        if (origin && !allowedOrigins.includes(origin)) {
            return res.status(403).end();
        }
        return res.status(204).end();
    }

    next();
});

registerHttpRoutes(app);
setupWebSocket(server);

let hasInitialized = false;

async function bootstrapDatabase() {
    try {
        await initializeDatabase();

        // eliminar cualquier sesión antigua que pudiera existir antes de
        // desplegar esta versión; esto resuelve el caso de usuarios previos
        // bloqueados por registros de sesión heredados.
        try {
            await pool.query('DELETE FROM user_sessions');
            console.log('🧹 Se han purgado todas las sesiones antiguas');
        } catch (err) {
            console.error('Error purgando sesiones al inicio:', err);
        }

        if (!hasInitialized) {
            restoreActiveGames();
            setInterval(cleanupOldGames, 3600000);
            setInterval(cleanupExpiredSessions, 3600000);
            hasInitialized = true;
        }

        console.log('✅ Base de datos lista');
    } catch (error) {
        const transient = isTransientConnectionError(error);
        console.error('Error inicializando servidor:', error);

        if (transient) {
            console.warn('⚠️ Error transitorio de conexión a BD. Se reintentará en 30s...');
            setTimeout(bootstrapDatabase, 30000);
            return;
        }

        process.exit(1);
    }
}

bootstrapDatabase();

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
