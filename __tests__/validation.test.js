const {
    sanitizePlayerName,
    isValidRoomId,
} = require('../client/src/utils/validation');

describe('Validation Utils', () => {
    test('sanitizePlayerName should clean input', () => {
        expect(sanitizePlayerName('Valid Name')).toBe('Valid Name');
        expect(sanitizePlayerName('Invalid@Name')).toBe('');
        expect(sanitizePlayerName('')).toBe('');
    });

    test('isValidRoomId should validate 4-digit codes', () => {
        expect(isValidRoomId('1234')).toBe(true);
        expect(isValidRoomId('123')).toBe(false);
        expect(isValidRoomId('abcd')).toBe(false);
    });
});
