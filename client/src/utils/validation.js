// src/utils/validation.js
const { PLAYER_NAME_REGEX, ROOM_ID_REGEX } = require('../config');

function sanitizePlayerName(input) {
    if (typeof input !== 'string') return '';
    const value = input.trim();
    return PLAYER_NAME_REGEX.test(value) ? value : '';
}

function isValidRoomId(roomId) {
    return typeof roomId === 'string' && ROOM_ID_REGEX.test(roomId);
}

function validatePlayCardPayload(msg) {
    const requiredFields = ['cardValue', 'position', 'playerId', 'roomId'];
    const missingFields = requiredFields.filter(field => msg[field] === undefined || msg[field] === null);
    return { missingFields, isValid: missingFields.length === 0 };
}

module.exports = {
    sanitizePlayerName,
    isValidRoomId,
    validatePlayCardPayload
};
