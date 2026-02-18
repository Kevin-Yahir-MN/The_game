const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');

const { PORT, allowedOrigins } = require('src/config,js');
const { initializeDatabase, cleanupOldGames } = require('./src/db.js');
const { registerHttpRoutes } = require('src/http/routes.js');
const { restoreActiveGames } = require('src/services/persistence.js');
const { setupWebSocket } = require('src/ws/websocket.js');

const app = express();
const server = http.createServer(app);

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

registerHttpRoutes(app);
setupWebSocket(server);

initializeDatabase().then(() => {
    restoreActiveGames();
    setInterval(cleanupOldGames, 3600000);
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
