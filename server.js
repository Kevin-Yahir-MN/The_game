const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const allowedOrigins = ['https://the-game-2xks.onrender.com'];
const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];
const ROOM_CLEANUP_INTERVAL = 30 * 60 * 1000;
const CONNECTION_TIMEOUT = 10000;
const PING_INTERVAL = 30000;

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

const Room = sequelize.define('Room', {
    roomId: {
        type: DataTypes.STRING(4),
        primaryKey: true,
        allowNull: false
    },
    lastActivity: {
        type: DataTypes.DATE,
        allowNull: false
    }
});

const Player = sequelize.define('Player', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    isHost: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    cards: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: []
    },
    cardsPlayedThisTurn: {
        type: DataTypes.JSONB,
        defaultValue: []
    },
    lastActivity: {
        type: DataTypes.DATE,
        allowNull: false
    },
    wsConnected: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

const GameState = sequelize.define('GameState', {
    deck: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false
    },
    board: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    currentTurn: {
        type: DataTypes.UUID,
        allowNull: false
    },
    gameStarted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    initialCards: {
        type: DataTypes.INTEGER,
        defaultValue: 6
    }
});

const BoardHistory = sequelize.define('BoardHistory', {
    ascending1: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [1]
    },
    ascending2: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [1]
    },
    descending1: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [100]
    },
    descending2: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [100]
    }
});

Room.hasMany(Player);
Player.belongsTo(Room);
Room.hasOne(GameState);
GameState.belongsTo(Room);
Room.hasOne(BoardHistory);
BoardHistory.belongsTo(Room);

sequelize.sync();

app.use(compression());
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        if (!allowedOrigins.includes(info.origin)) {
            return done(false, 403, 'Origen no permitido');
        }
        done(true);
    }
});

async function initializeDeck() {
    const deck = [];
    for (let i = 2; i < 100; i++) deck.push(i);
    return shuffleArray(deck);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function safeSend(ws, message) {
    try {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    } catch (error) {
        console.error('Error enviando mensaje:', error);
    }
}

async function broadcastToRoom(roomId, message, options = {}) {
    const { includeGameState = false, skipPlayerId = null } = options;
    const room = await Room.findByPk(roomId, {
        include: [Player]
    });

    if (!room) return;

    for (const player of room.Players) {
        if (player.id !== skipPlayerId && player.wsConnected) {
            safeSend(player.ws, message);
            if (includeGameState) await sendGameState(roomId, player.id);
        }
    }
}

async function sendGameState(roomId, playerId) {
    const room = await Room.findByPk(roomId, {
        include: [Player, GameState]
    });

    if (!room) return;

    const player = room.Players.find(p => p.id === playerId);
    if (!player) return;

    player.lastActivity = new Date();
    await player.save();

    const state = {
        b: room.GameState.board,
        t: room.GameState.currentTurn,
        y: player.cards,
        i: room.GameState.initialCards,
        d: room.GameState.deck.length,
        p: room.Players.map(p => ({
            i: p.id,
            n: p.name,
            h: p.isHost,
            c: p.cards.length,
            s: p.cardsPlayedThisTurn.length
        }))
    };

    safeSend(player.ws, {
        type: 'gs',
        s: state
    });
}

async function updateBoardHistory(roomId, position, newValue) {
    const history = await BoardHistory.findOne({
        where: { RoomRoomId: roomId }
    });

    if (!history) return;

    const historyKey = {
        'asc1': 'ascending1',
        'asc2': 'ascending2',
        'desc1': 'descending1',
        'desc2': 'descending2'
    }[position];

    const currentHistory = history[historyKey];
    if (currentHistory.slice(-1)[0] !== newValue) {
        await history.update({
            [historyKey]: [...currentHistory, newValue]
        });
    }
}

async function getNextActivePlayerIndex(currentIndex, players) {
    for (let offset = 1; offset < players.length; offset++) {
        const nextIndex = (currentIndex + offset) % players.length;
        if (players[nextIndex].wsConnected) {
            return nextIndex;
        }
    }
    return currentIndex;
}

function getPlayableCards(playerCards, board) {
    return playerCards.filter(card => {
        return (card > board.ascending[0] || card === board.ascending[0] - 10) ||
            (card > board.ascending[1] || card === board.ascending[1] - 10) ||
            (card < board.descending[0] || card === board.descending[0] + 10) ||
            (card < board.descending[1] || card === board.descending[1] + 10);
    });
}

async function handlePlayCard(roomId, player, msg) {
    if (!validPositions.includes(msg.position)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'Posición inválida',
            isError: true
        });
    }

    if (!player.cards.includes(msg.cardValue)) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No tienes esa carta',
            isError: true
        });
    }

    const room = await Room.findByPk(roomId, {
        include: [GameState]
    });

    if (!room) return;

    const board = room.GameState.board;
    const targetIdx = msg.position.includes('asc') ?
        (msg.position === 'asc1' ? 0 : 1) :
        (msg.position === 'desc1' ? 0 : 1);

    const targetValue = msg.position.includes('asc') ?
        board.ascending[targetIdx] :
        board.descending[targetIdx];

    const isValid = msg.position.includes('asc') ?
        (msg.cardValue > targetValue || msg.cardValue === targetValue - 10) :
        (msg.cardValue < targetValue || msg.cardValue === targetValue + 10);

    if (!isValid) {
        return safeSend(player.ws, {
            type: 'notification',
            message: `Movimiento inválido. La carta debe ${msg.position.includes('asc') ? 'ser mayor' : 'ser menor'} que ${targetValue} o igual a ${msg.position.includes('asc') ? targetValue - 10 : targetValue + 10}`,
            isError: true
        });
    }

    const newBoard = JSON.parse(JSON.stringify(board));
    if (msg.position.includes('asc')) {
        newBoard.ascending[targetIdx] = msg.cardValue;
    } else {
        newBoard.descending[targetIdx] = msg.cardValue;
    }

    await GameState.update({
        board: newBoard
    }, {
        where: { RoomRoomId: roomId }
    });

    await Player.update({
        cards: player.cards.filter(c => c !== msg.cardValue),
        cardsPlayedThisTurn: [...player.cardsPlayedThisTurn, {
            value: msg.cardValue,
            position: msg.position,
            isPlayedThisTurn: true
        }]
    }, {
        where: { id: player.id }
    });

    await broadcastToRoom(roomId, {
        type: 'card_played',
        cardValue: msg.cardValue,
        position: msg.position,
        playerId: player.id,
        playerName: player.name
    });

    await updateBoardHistory(roomId, msg.position, msg.cardValue);
    await broadcastGameState(roomId);
    await checkGameStatus(roomId);
}

async function handleUndoMove(roomId, player, msg) {
    if (player.cardsPlayedThisTurn.length === 0) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No hay jugadas para deshacer',
            isError: true
        });
    }

    const lastMoveIndex = player.cardsPlayedThisTurn.findIndex(
        move => move.value === msg.cardValue &&
            move.position === msg.position
    );

    if (lastMoveIndex === -1) {
        return safeSend(player.ws, {
            type: 'notification',
            message: 'No se encontró la jugada para deshacer',
            isError: true
        });
    }

    const lastMove = player.cardsPlayedThisTurn[lastMoveIndex];
    const newCards = [...player.cards, msg.cardValue];
    const newMoves = [...player.cardsPlayedThisTurn];
    newMoves.splice(lastMoveIndex, 1);

    const room = await Room.findByPk(roomId, {
        include: [GameState]
    });

    if (!room) return;

    const newBoard = JSON.parse(JSON.stringify(room.GameState.board));
    if (msg.position.includes('asc')) {
        const idx = msg.position === 'asc1' ? 0 : 1;
        newBoard.ascending[idx] = lastMove.previousValue;
    } else {
        const idx = msg.position === 'desc1' ? 0 : 1;
        newBoard.descending[idx] = lastMove.previousValue;
    }

    await GameState.update({
        board: newBoard
    }, {
        where: { RoomRoomId: roomId }
    });

    await Player.update({
        cards: newCards,
        cardsPlayedThisTurn: newMoves
    }, {
        where: { id: player.id }
    });

    await broadcastToRoom(roomId, {
        type: 'move_undone',
        playerId: player.id,
        playerName: player.name,
        cardValue: msg.cardValue,
        position: msg.position,
        previousValue: lastMove.previousValue
    }, { includeGameState: true });
}

async function endTurn(roomId, player) {
    const room = await Room.findByPk(roomId, {
        include: [GameState, Player]
    });

    if (!room) return;

    const gameState = room.GameState;
    const minCardsRequired = gameState.deck.length > 0 ? 2 : 1;

    if (player.cardsPlayedThisTurn.length < minCardsRequired) {
        return safeSend(player.ws, {
            type: 'notification',
            message: `Debes jugar al menos ${minCardsRequired} cartas este turno`,
            isError: true
        });
    }

    const targetCardCount = gameState.initialCards;
    const cardsToDraw = Math.min(
        targetCardCount - player.cards.length,
        gameState.deck.length
    );

    const newDeck = [...gameState.deck];
    const newCards = [...player.cards];

    for (let i = 0; i < cardsToDraw; i++) {
        newCards.push(newDeck.pop());
    }

    await GameState.update({
        deck: newDeck
    }, {
        where: { RoomRoomId: roomId }
    });

    await Player.update({
        cards: newCards,
        cardsPlayedThisTurn: []
    }, {
        where: { id: player.id }
    });

    if (newDeck.length === 0) {
        await broadcastToRoom(roomId, {
            type: 'notification',
            message: '¡El mazo se ha agotado!',
            isError: false
        });
    }

    const currentIndex = room.Players.findIndex(p => p.id === gameState.currentTurn);
    const nextIndex = await getNextActivePlayerIndex(currentIndex, room.Players);
    const nextPlayer = room.Players[nextIndex];

    await GameState.update({
        currentTurn: nextPlayer.id
    }, {
        where: { RoomRoomId: roomId }
    });

    const playableCards = getPlayableCards(nextPlayer.cards, gameState.board);
    const requiredCards = newDeck.length > 0 ? 2 : 1;

    if (playableCards.length < requiredCards && nextPlayer.cards.length > 0) {
        return await broadcastToRoom(roomId, {
            type: 'game_over',
            result: 'lose',
            message: `¡${nextPlayer.name} no puede jugar el mínimo de ${requiredCards} carta(s) requerida(s)!`,
            reason: 'min_cards_not_met'
        });
    }

    await broadcastGameState(roomId);
    await broadcastToRoom(roomId, {
        type: 'turn_changed',
        newTurn: nextPlayer.id,
        previousPlayer: player.id,
        playerName: nextPlayer.name,
        cardsPlayedThisTurn: 0,
        minCardsRequired: requiredCards
    });
}

async function broadcastGameState(roomId) {
    const room = await Room.findByPk(roomId, {
        include: [Player]
    });

    if (!room) return;

    for (const player of room.Players) {
        await sendGameState(roomId, player.id);
    }
}

async function checkGameStatus(roomId) {
    const room = await Room.findByPk(roomId, {
        include: [Player, GameState]
    });

    if (!room) return;

    const allPlayersEmpty = room.Players.every(p => p.cards.length === 0);
    if (allPlayersEmpty && room.GameState.deck.length === 0) {
        await broadcastToRoom(roomId, {
            type: 'game_over',
            result: 'win',
            message: '¡Todos ganan! Todas las cartas jugadas.',
            reason: 'all_cards_played'
        });
    }
}

app.post('/create-room', async (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).json({ success: false, message: 'Se requiere nombre de jugador' });
    }

    const transaction = await sequelize.transaction();
    try {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const playerId = uuidv4();

        const room = await Room.create({
            roomId,
            lastActivity: new Date()
        }, { transaction });

        await Player.create({
            id: playerId,
            name: playerName,
            isHost: true,
            lastActivity: new Date(),
            RoomRoomId: roomId
        }, { transaction });

        await GameState.create({
            deck: initializeDeck(),
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: playerId,
            gameStarted: false,
            initialCards: 6,
            RoomRoomId: roomId
        }, { transaction });

        await BoardHistory.create({
            ascending1: [1],
            ascending2: [1],
            descending1: [100],
            descending2: [100],
            RoomRoomId: roomId
        }, { transaction });

        await transaction.commit();

        res.json({ success: true, roomId, playerId, playerName });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ success: false, message: 'Error al crear sala' });
    }
});

app.post('/join-room', async (req, res) => {
    const { playerName, roomId } = req.body;
    if (!playerName || !roomId) {
        return res.status(400).json({
            success: false,
            message: 'Nombre de jugador y código de sala requeridos'
        });
    }

    const transaction = await sequelize.transaction();
    try {
        const room = await Room.findByPk(roomId, { transaction });
        if (!room) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Sala no encontrada' });
        }

        const playerId = uuidv4();
        await Player.create({
            id: playerId,
            name: playerName,
            isHost: false,
            lastActivity: new Date(),
            RoomRoomId: roomId
        }, { transaction });

        await transaction.commit();

        res.json({ success: true, playerId, playerName });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ success: false, message: 'Error al unirse a sala' });
    }
});

app.get('/room-info/:roomId', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=5');
    const roomId = req.params.roomId;

    const room = await Room.findByPk(roomId, {
        include: [Player, GameState]
    });

    if (!room) {
        return res.status(404).json({ success: false, message: 'Sala no encontrada' });
    }

    res.json({
        success: true,
        players: room.Players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            cardCount: p.cards.length,
            connected: p.wsConnected
        })),
        gameStarted: room.GameState.gameStarted,
        currentTurn: room.GameState.currentTurn,
        initialCards: room.GameState.initialCards
    });
});

async function startGame(roomId, initialCards = 6) {
    const transaction = await sequelize.transaction();
    try {
        const room = await Room.findByPk(roomId, {
            include: [Player, GameState],
            transaction
        });

        if (!room) {
            await transaction.rollback();
            return;
        }

        const newDeck = initializeDeck();
        const playerUpdates = [];

        for (const player of room.Players) {
            const cards = [];
            for (let i = 0; i < initialCards && newDeck.length > 0; i++) {
                cards.push(newDeck.pop());
            }
            playerUpdates.push(
                Player.update({
                    cards,
                    cardsPlayedThisTurn: []
                }, {
                    where: { id: player.id },
                    transaction
                })
            );
        }

        await Promise.all([
            ...playerUpdates,
            GameState.update({
                deck: newDeck,
                gameStarted: true,
                initialCards,
                currentTurn: room.Players[0].id
            }, {
                where: { RoomRoomId: roomId },
                transaction
            })
        ]);

        await transaction.commit();

        await broadcastToRoom(roomId, {
            type: 'game_started',
            state: {
                board: room.GameState.board,
                currentTurn: room.Players[0].id,
                remainingDeck: newDeck.length,
                initialCards: initialCards,
                players: room.Players.map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    cardCount: p.cards.length,
                    cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
                }))
            }
        });

        for (const player of room.Players) {
            safeSend(player.ws, {
                type: 'your_cards',
                cards: player.cards,
                playerName: player.name,
                currentPlayerId: player.id
            });
        }
    } catch (error) {
        await transaction.rollback();
        console.error('Error al iniciar juego:', error);
    }
}

wss.on('connection', async (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const roomId = params.get('roomId');
    const playerId = params.get('playerId');
    const playerName = params.get('playerName');

    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
            ws.close(1008, 'Tiempo de conexión agotado');
        }
    }, CONNECTION_TIMEOUT);

    if (!roomId || !playerId) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Datos inválidos');
    }

    const room = await Room.findByPk(roomId, {
        include: [Player]
    });

    if (!room) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Sala no encontrada');
    }

    const player = room.Players.find(p => p.id === playerId);
    if (!player) {
        clearTimeout(connectionTimeout);
        return ws.close(1008, 'Jugador no registrado');
    }

    if (player.wsConnected) {
        safeSend(player.ws, JSON.stringify({
            type: 'notification',
            message: 'Se ha detectado una nueva conexión desde otro dispositivo',
            isError: true
        }));
        player.ws.close(1000, 'Nueva conexión establecida');
    }

    player.ws = ws;
    player.wsConnected = true;
    player.lastActivity = new Date();
    await player.save();

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            safeSend(ws, { type: 'ping' });
        }
    }, PING_INTERVAL);

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            player.lastActivity = new Date();
            await player.save();

            if (msg.type === 'ping') {
                return ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }

            switch (msg.type) {
                case 'start_game':
                    if (player.isHost && !room.GameState.gameStarted) {
                        await startGame(roomId, msg.initialCards);
                    }
                    break;

                case 'play_card':
                    if (player.id === room.GameState.currentTurn && room.GameState.gameStarted) {
                        await handlePlayCard(roomId, player, msg);
                    }
                    break;

                case 'end_turn':
                    if (player.id === room.GameState.currentTurn && room.GameState.gameStarted) {
                        await endTurn(roomId, player);
                    }
                    break;

                case 'undo_move':
                    if (player.id === room.GameState.currentTurn && room.GameState.gameStarted) {
                        await handleUndoMove(roomId, player, msg);
                    }
                    break;

                case 'get_game_state':
                    if (room.GameState.gameStarted) await sendGameState(roomId, player.id);
                    break;

                case 'self_blocked':
                    if (msg.roomId === roomId) {
                        await broadcastToRoom(roomId, {
                            type: 'game_over',
                            result: 'lose',
                            message: `¡${player.name} se quedó sin movimientos posibles!`,
                            reason: 'self_blocked'
                        });
                    }
                    break;

                case 'reset_room':
                    if (player.isHost) {
                        await resetRoom(roomId);
                    }
                    break;

                case 'update_player':
                    if (msg.playerId === player.id) {
                        await Player.update({
                            name: msg.name
                        }, {
                            where: { id: player.id }
                        });

                        await broadcastToRoom(roomId, {
                            type: 'player_update',
                            players: room.Players.map(p => ({
                                id: p.id,
                                name: p.name,
                                isHost: p.isHost,
                                cardCount: p.cards.length
                            }))
                        });
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
        }
    });

    ws.on('close', async () => {
        clearInterval(pingInterval);
        await Player.update({
            wsConnected: false
        }, {
            where: { id: playerId }
        });

        if (player.isHost) {
            const newHost = room.Players.find(p => p.id !== player.id && p.wsConnected);
            if (newHost) {
                await Player.update({
                    isHost: true
                }, {
                    where: { id: newHost.id }
                });

                await broadcastToRoom(roomId, {
                    type: 'notification',
                    message: `${newHost.name} es ahora el host`,
                    isError: false
                });
            }
        }
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
        clearTimeout(connectionTimeout);
        clearInterval(pingInterval);
    });

    clearTimeout(connectionTimeout);

    const response = {
        type: 'init_game',
        playerId: player.id,
        playerName: player.name,
        roomId,
        isHost: player.isHost,
        gameState: {
            board: room.GameState.board,
            currentTurn: room.GameState.currentTurn,
            gameStarted: room.GameState.gameStarted,
            initialCards: room.GameState.initialCards,
            remainingDeck: room.GameState.deck.length,
            players: room.Players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                cardCount: p.cards.length
            }))
        },
        isYourTurn: room.GameState.currentTurn === player.id
    };

    if (room.GameState.gameStarted) {
        response.yourCards = player.cards;
        response.players = room.Players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.cards.length,
            cardsPlayedThisTurn: p.cardsPlayedThisTurn.length
        }));
    }

    safeSend(ws, response);
});

async function resetRoom(roomId) {
    const transaction = await sequelize.transaction();
    try {
        const room = await Room.findByPk(roomId, {
            include: [GameState, Player],
            transaction
        });

        if (!room) {
            await transaction.rollback();
            return;
        }

        await GameState.update({
            deck: initializeDeck(),
            board: { ascending: [1, 1], descending: [100, 100] },
            currentTurn: room.Players[0].id,
            gameStarted: false
        }, {
            where: { RoomRoomId: roomId },
            transaction
        });

        await Player.update({
            cards: [],
            cardsPlayedThisTurn: []
        }, {
            where: { RoomRoomId: roomId },
            transaction
        });

        await BoardHistory.update({
            ascending1: [1],
            ascending2: [1],
            descending1: [100],
            descending2: [100]
        }, {
            where: { RoomRoomId: roomId },
            transaction
        });

        await transaction.commit();

        await broadcastToRoom(roomId, {
            type: 'room_reset',
            message: 'La sala ha sido reiniciada para una nueva partida'
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error al reiniciar sala:', error);
    }
}

setInterval(async () => {
    const now = new Date();
    const inactiveTime = new Date(now.getTime() - 3600000);

    const inactiveRooms = await Room.findAll({
        where: {
            lastActivity: {
                [Sequelize.Op.lt]: inactiveTime
            }
        },
        include: [Player]
    });

    for (const room of inactiveRooms) {
        const allInactive = room.Players.every(p => p.lastActivity < inactiveTime);
        if (allInactive) {
            await Room.destroy({
                where: { roomId: room.roomId }
            });
        }
    }
}, ROOM_CLEANUP_INTERVAL);

server.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Orígenes permitidos: ${allowedOrigins.join(', ')}`);
});