(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.APP_VALIDATION = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PLAYER_NAME_REGEX = /^[\p{L}\p{N}_\-\s]{2,24}$/u;
    const ROOM_ID_REGEX = /^\d{4}$/;

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
        const missingFields = requiredFields.filter(
            (field) => msg[field] === undefined || msg[field] === null
        );
        return { missingFields, isValid: missingFields.length === 0 };
    }

    function isValidName(value) {
        if (!value || typeof value !== 'string') return false;
        return PLAYER_NAME_REGEX.test(value.trim());
    }

    function isValidRoomCode(value) {
        if (!value || typeof value !== 'string') return false;
        return ROOM_ID_REGEX.test(value.trim());
    }

    return {
        PLAYER_NAME_REGEX,
        ROOM_ID_REGEX,
        sanitizePlayerName,
        isValidRoomId,
        validatePlayCardPayload,
        isValidName,
        isValidRoomCode,
    };
});
