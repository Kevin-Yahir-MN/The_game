(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.APP_VALIDATION = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PLAYER_NAME_REGEX = /^[\p{L}\p{N}_\-\s]{2,24}$/u;
    const ROOM_ID_REGEX = /^\d{4}$/;
    const USERNAME_REGEX = /^[a-z0-9._-]{3,20}$/;
    const DISPLAY_NAME_REGEX = PLAYER_NAME_REGEX;
    const PASSWORD_MIN_LENGTH = 8;
    const PASSWORD_MAX_LENGTH = 64;
    const PASSWORD_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

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

    function isValidUsername(value) {
        if (!value || typeof value !== 'string') return false;
        return USERNAME_REGEX.test(value.trim().toLowerCase());
    }

    function isValidDisplayName(value) {
        if (!value || typeof value !== 'string') return false;
        return DISPLAY_NAME_REGEX.test(value.trim());
    }

    function isValidPassword(value) {
        if (typeof value !== 'string') return false;
        if (value.length < PASSWORD_MIN_LENGTH) return false;
        if (value.length > PASSWORD_MAX_LENGTH) return false;
        if (PASSWORD_CONTROL_CHARS.test(value)) return false;
        return true;
    }

    return {
        PLAYER_NAME_REGEX,
        ROOM_ID_REGEX,
        USERNAME_REGEX,
        DISPLAY_NAME_REGEX,
        PASSWORD_MIN_LENGTH,
        PASSWORD_MAX_LENGTH,
        sanitizePlayerName,
        isValidRoomId,
        validatePlayCardPayload,
        isValidName,
        isValidRoomCode,
        isValidUsername,
        isValidDisplayName,
        isValidPassword,
    };
});
