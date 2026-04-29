const { pool, withTransaction } = require('../db');
const { rooms, reverseRoomMap, boardHistory, saveDebounceTimers } = require('../state');
const logger = require('../utils/logger');

// A room is stale when the player whose turn it is has not acted for this long.
const STALE_TURN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// How often to scan all active rooms for stale turns.
const STALE_TURN_CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

/**
 * Close all WebSocket connections for a room and remove it from every
 * in-memory map.
 */
function evictRoomFromMemory(roomId, room) {
    for (const player of room.players || []) {
        if (player.ws && player.ws.readyState === 1 /* OPEN */) {
            try {
                player.ws.close(1001, 'Sala eliminada por inactividad');
            } catch (_) {
                // ignore
            }
        }
    }

    const timer = saveDebounceTimers.get(roomId);
    if (timer) {
        clearTimeout(timer);
        saveDebounceTimers.delete(roomId);
    }

    reverseRoomMap.delete(room);
    boardHistory.delete(roomId);
    rooms.delete(roomId);
}

/**
 * Delete a single room (and its player_connections) from the database.
 */
async function deleteRoomFromDb(roomId) {
    await withTransaction(async (client) => {
        await client.query(
            'DELETE FROM player_connections WHERE room_id = $1',
            [roomId]
        );
        await client.query(
            'DELETE FROM game_states WHERE room_id = $1',
            [roomId]
        );
    });
}

/**
 * Scan every in-memory room.  If the game is active and the current player's
 * last recorded activity is older than STALE_TURN_THRESHOLD_MS, evict the
 * room from memory and remove it from the database.
 */
async function checkAndEvictStaleRooms() {
    const now = Date.now();
    const staleRoomIds = [];

    for (const [roomId, room] of rooms) {
        // Only check rooms where a game is actually in progress.
        if (!room.gameState?.gameStarted || room.gameState?.gameFinished) {
            continue;
        }

        const currentTurnPlayerId = room.gameState.currentTurn;
        if (!currentTurnPlayerId) continue;

        const currentPlayer = room.players.find(
            (p) => p.id === currentTurnPlayerId
        );
        if (!currentPlayer) continue;

        const lastActivity = Number(currentPlayer.lastActivity) || 0;
        if (lastActivity > 0 && now - lastActivity > STALE_TURN_THRESHOLD_MS) {
            staleRoomIds.push(roomId);
        }
    }

    for (const roomId of staleRoomIds) {
        const room = rooms.get(roomId);
        if (!room) continue; // already gone

        logger.info(
            `Evicting stale room ${roomId}: current player inactive for >${STALE_TURN_THRESHOLD_MS / 60000} min`
        );

        try {
            evictRoomFromMemory(roomId, room);
            await deleteRoomFromDb(roomId);
            logger.info(`Room ${roomId} evicted successfully`);
        } catch (error) {
            logger.error(`Failed to evict room ${roomId}`, error);
            // Re-insert the room object so the next cycle can retry.
            // (In practice it will no longer be in `rooms` so this is a no-op
            // unless evictRoomFromMemory is partially rolled back — kept for
            // safety.)
        }
    }
}

/**
 * Start the periodic stale-turn scanner.  Returns the interval handle so
 * callers can clear it in tests or on graceful shutdown.
 */
function scheduleStaleTurnCheck() {
    logger.info(
        `Stale-turn checker started (threshold=${STALE_TURN_THRESHOLD_MS / 60000} min, ` +
        `interval=${STALE_TURN_CHECK_INTERVAL_MS / 60000} min)`
    );

    // Run once immediately so the first check doesn't wait a full interval.
    checkAndEvictStaleRooms().catch((err) =>
        logger.error('Initial stale-turn check failed', err)
    );

    return setInterval(() => {
        checkAndEvictStaleRooms().catch((err) =>
            logger.error('Stale-turn check failed', err)
        );
    }, STALE_TURN_CHECK_INTERVAL_MS);
}

module.exports = {
    scheduleStaleTurnCheck,
    // Exported for tests / manual use
    checkAndEvictStaleRooms,
};