// src/services/persistence.js
const { pool } = require('../db');
const { rooms, reverseRoomMap, boardHistory, saveDebounceTimers } = require('../state');
const { getPlayerTurnCount, getTurnState } = require('../utils/turnState');
const { initializeDeck } = require('../utils/gameRules');

async function saveGameState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return false;

    try {
        const gameData = {
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cards: p.cards,
                isHost: p.isHost,
                connected: p.ws !== null,
                cardsPlayedThisTurn: getPlayerTurnCount(p),
                movesThisTurn: getTurnState(p).moves,
                totalCardsPlayed: Number(p.totalCardsPlayed) || 0,
                lastActivity: p.lastActivity
            })),
            gameState: {
                deck: room.gameState.deck,
                board: room.gameState.board,
                currentTurn: room.gameState.currentTurn,
                gameStarted: room.gameState.gameStarted,
                initialCards: room.gameState.initialCards
            },
            history: boardHistory.get(roomId)
        };

        const client = await pool.connect();
        try {
            const result = await client.query(`
                INSERT INTO game_states (room_id, game_data, last_activity)
                VALUES ($1, $2, NOW())
                ON CONFLICT (room_id) 
                DO UPDATE SET
                    game_data = EXCLUDED.game_data,
                    last_activity = NOW()
                RETURNING room_id
            `, [roomId, JSON.stringify(gameData)]);

            return result.rowCount > 0;
        } catch (error) {
            console.error(`Error al guardar estado para sala ${roomId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error(`Error al obtener conexión para sala ${roomId}:`, error);
        throw error;
    }
}

function scheduleSaveGameState(roomId, delay = 300) {
    clearTimeout(saveDebounceTimers.get(roomId));
    const timer = setTimeout(() => {
        saveDebounceTimers.delete(roomId);
        saveGameState(roomId).catch(err => console.error('Error en save debounced:', err));
    }, delay);
    saveDebounceTimers.set(roomId, timer);
}

function flushSaveGameState(roomId) {
    if (saveDebounceTimers.has(roomId)) {
        clearTimeout(saveDebounceTimers.get(roomId));
        saveDebounceTimers.delete(roomId);
    }
    return saveGameState(roomId);
}

async function restoreActiveGames() {
    try {
        console.log('⏳ Restaurando juegos activos con historial...');

        const { rows } = await pool.query(`
            SELECT room_id, game_data::text, last_activity 
            FROM game_states 
            WHERE last_activity > NOW() - INTERVAL '4 hours'
        `);

        for (const row of rows) {
            try {
                let gameData;
                try {
                    gameData = JSON.parse(row.game_data);
                } catch (e) {
                    console.error(`❌ Error parseando JSON para sala ${row.room_id}`);
                    continue;
                }

                if (!gameData.history) {
                    gameData.history = {
                        ascending1: [1],
                        ascending2: [1],
                        descending1: [100],
                        descending2: [100]
                    };
                }

                const room = {
                    players: gameData.players?.map(p => ({
                        ...p,
                        ws: null,
                        cards: p.cards || [],
                        cardsPlayedThisTurn: Number(p.cardsPlayedThisTurn) || 0,
                        turnState: {
                            count: Number(p.cardsPlayedThisTurn) || 0,
                            moves: Array.isArray(p.movesThisTurn) ? p.movesThisTurn : []
                        },
                        totalCardsPlayed: Number(p.totalCardsPlayed) || 0,
                        lastActivity: Date.now()
                    })) || [],
                    gameState: gameData.gameState || {
                        deck: initializeDeck(),
                        board: { ascending: [1, 1], descending: [100, 100] },
                        currentTurn: null,
                        gameStarted: false,
                        initialCards: 6
                    }
                };

                rooms.set(row.room_id, room);
                reverseRoomMap.set(room, row.room_id);
                boardHistory.set(row.room_id, gameData.history);

                console.log(`✅ Sala ${row.room_id} restaurada con historial`, gameData.history);
            } catch (error) {
                console.error(`❌ Error restaurando sala ${row.room_id}:`, error);
                await pool.query('DELETE FROM game_states WHERE room_id = $1', [row.room_id]);
            }
        }
    } catch (error) {
        console.error('Error al restaurar juegos activos:', error);
        setTimeout(restoreActiveGames, 30000);
    }
}

module.exports = {
    saveGameState,
    scheduleSaveGameState,
    flushSaveGameState,
    restoreActiveGames
};
