const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración CORS
const allowedOrigins = [
    'https://the-game-2xks.onrender.com',
    'http://localhost:3000'
];

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

// WebSocket Server
const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            console.warn(`Origen bloqueado: ${info.origin}`);
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Almacenamiento de salas
const rooms = new Map();

// Endpoints API
app.post('/create-room', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ success: false, message: 'Nombre requerido' });

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    rooms.set(roomId, {
        players: [{ id: uuidv4(), name: playerName, isHost: true, ws: null }],
        gameState: null
    });

    res.json({
        success: true,
        roomId,
        playerName
    });
});

app.post('/join-room', (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) return res.status(400).json({ success: false, message: 'Datos incompletos' });
    if (!rooms.has(roomId)) return res.status(404).json({ success: false, message: 'Sala no encontrada' });

    const room = rooms.get(roomId);
    const newPlayer = { id: uuidv4(), name: playerName, isHost: false, ws: null };
    room.players.push(newPlayer);

    res.json({
        success: true,
        host: room.players.find(p => p.isHost).name
    });
});

app.get('/room-info/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) return res.status(404).json({ success: false });

    const room = rooms.get(roomId);
    res.json({
        success: true,
        players: room.players.map(p => p.name),
        host: room.players.find(p => p.isHost).name
    });
});

// WebSocket Logic
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerName = params.get('playerName');

    if (!roomId || !playerName || !rooms.has(roomId)) {
        return ws.close(1008, 'Datos inválidos');
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.name === playerName);
    if (!player) return ws.close(1008, 'Jugador no registrado');

    player.ws = ws;
    console.log(`✔ ${playerName} conectado a sala ${roomId}`);

    // Notificar a todos de la nueva conexión
    broadcastToRoom(roomId, {
        type: 'player_joined',
        playerName,
        players: room.players.map(p => p.name)
    });

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'start_game' && player.isHost) {
                broadcastToRoom(roomId, { type: 'game_started' });
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        room.players = room.players.filter(p => p.name !== playerName);
        console.log(`✖ ${playerName} desconectado`);

        broadcastToRoom(roomId, {
            type: 'player_left',
            playerName,
            players: room.players.map(p => p.name)
        });
    });
});

// Helper functions
function broadcastToRoom(roomId, message) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});