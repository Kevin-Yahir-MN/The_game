const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');

const { PORT, allowedOrigins } = require('./client/src/config.js');
const { initializeDatabase, cleanupOldGames } = require('./client/src/db.js');
const { registerHttpRoutes } = require('./client/src/http/routes.js');
const { restoreActiveGames } = require('./client/src/services/persistence.js');
const { setupWebSocket } = require('./client/src/ws/websocket.js');

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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

initializeDatabase().then(() => {
    restoreActiveGames();
    setInterval(cleanupOldGames, 3600000);
}).catch((error) => {
    console.error('Error inicializando servidor:', error);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
