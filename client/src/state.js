// src/state.js
const rooms = new Map();
const reverseRoomMap = new Map();
const boardHistory = new Map();
const saveDebounceTimers = new Map();
const wsRateLimit = new Map();

const validPositions = ['asc1', 'asc2', 'desc1', 'desc2'];

module.exports = {
    rooms,
    reverseRoomMap,
    boardHistory,
    saveDebounceTimers,
    wsRateLimit,
    validPositions
};
