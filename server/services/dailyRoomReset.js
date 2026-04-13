const { deleteAllRooms } = require('../db');
const { rooms, reverseRoomMap, boardHistory, saveDebounceTimers } = require('../state');
const logger = require('../utils/logger');

const DAILY_RESET_HOUR = Number(process.env.DAILY_ROOM_RESET_HOUR ?? 5);
const DAILY_RESET_MINUTE = Number(process.env.DAILY_ROOM_RESET_MINUTE ?? 0);

function getNextResetDelayMs(now = new Date()) {
    const next = new Date(now);
    next.setHours(DAILY_RESET_HOUR, DAILY_RESET_MINUTE, 0, 0);

    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now.getTime();
}

function clearInMemoryRooms() {
    for (const room of rooms.values()) {
        for (const player of room.players || []) {
            if (player.ws && player.ws.readyState === 1) {
                player.ws.close(1012, 'Reinicio diario de salas');
            }
        }
    }

    for (const timer of saveDebounceTimers.values()) {
        clearTimeout(timer);
    }

    rooms.clear();
    reverseRoomMap.clear();
    boardHistory.clear();
    saveDebounceTimers.clear();
}

async function runDailyRoomReset() {
    await deleteAllRooms();
    clearInMemoryRooms();
    logger.info('Daily room reset completed successfully');
}

function scheduleDailyRoomReset() {
    const delayMs = getNextResetDelayMs();
    logger.info(`Daily room reset scheduled in ${Math.round(delayMs / 1000)} seconds`);

    setTimeout(async () => {
        try {
            await runDailyRoomReset();
        } catch (error) {
            logger.error('Daily room reset failed', error);
        } finally {
            scheduleDailyRoomReset();
        }
    }, delayMs);
}

module.exports = {
    scheduleDailyRoomReset,
};
