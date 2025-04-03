const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Almacenamiento de salas en memoria
const rooms = new Map();

app.use(express.json());
app.use(express.static('client'));

// Endpoint para crear sala
app.post('/create-room', (req, res) => {
    const { playerName } = req.body;

    if (!playerName) {
        return res.status(400).json({ success: false, message: 'Nombre de jugador requerido' });
    }

    const roomId = generateRoomId();
    const hostPlayer = {
        id: uuidv4(),
        name: playerName,
        isHost: true,
        ws: null
    };

    rooms.set(roomId, {
        players: [hostPlayer],
        gameState: null,
        host: hostPlayer.id
    });

    res.json({ success: true, roomId });
});

// Endpoint para unirse a sala
app.post('/join-room', (req, res) => {
    const { playerName, roomId } = req.body;

    if (!playerName || !roomId) {
        return res.status(400).json({ success: false, message: 'Nombre de jugador y código de sala requeridos' });
    }

    if (!rooms.has(roomId)) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    const room = rooms.get(roomId);
    const newPlayer = {
        id: uuidv4(),
        name: playerName,
        isHost: false,
        ws: null
    };

    room.players.push(newPlayer);

    res.json({ success: true });
});

// WebSocket connection
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const roomId = urlParams.get('roomId');
    const playerName = urlParams.get('playerName');

    if (!rooms.has(roomId)) {
        ws.close();
        return;
    }

    const room = rooms.get(roomId);
    const player = room.players.find(p => p.name === playerName);

    if (!player) {
        ws.close();
        return;
    }

    player.ws = ws;

    // Notificar a todos los jugadores de la sala
    broadcastToRoom(roomId, {
        type: 'player_joined',
        players: room.players.map(p => p.name)
    });

    ws.on('message', (message) => {
        handleClientMessage(roomId, player.id, message);
    });

    ws.on('close', () => {
        room.players = room.players.filter(p => p.id !== player.id);

        if (room.players.length === 0) {
            rooms.delete(roomId);
        } else if (player.id === room.host) {
            // Asignar nuevo host
            room.host = room.players[0].id;
            room.players[0].isHost = true;
        }

        broadcastToRoom(roomId, {
            type: 'player_left',
            playerName,
            players: room.players.map(p => p.name)
        });
    });
});

function handleClientMessage(roomId, playerId, message) {
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = JSON.parse(message);
    const player = room.players.find(p => p.id === playerId);

    switch (msg.type) {
        case 'card_played':
        case 'end_turn':
        case 'game_state':
            // Solo el host puede enviar actualizaciones del juego
            if (player.isHost) {
                broadcastToRoom(roomId, msg, playerId);
            }
            break;
        default:
            broadcastToRoom(roomId, msg, playerId);
    }
}

function broadcastToRoom(roomId, message, excludePlayerId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN &&
            player.id !== excludePlayerId) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

function generateRoomId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});