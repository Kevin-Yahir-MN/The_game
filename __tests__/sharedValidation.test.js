const {
    sanitizePlayerName,
    isValidRoomId,
    validatePlayCardPayload,
    isValidName,
    isValidRoomCode,
} = require('../shared/validation');

describe('Shared Validation', () => {
    test('sanitizePlayerName returns cleaned name or empty', () => {
        expect(sanitizePlayerName('Jugador 1')).toBe('Jugador 1');
        expect(sanitizePlayerName('Invalid@Name')).toBe('');
        expect(sanitizePlayerName('')).toBe('');
    });

    test('isValidRoomId validates 4-digit room ids', () => {
        expect(isValidRoomId('1234')).toBe(true);
        expect(isValidRoomId('123')).toBe(false);
        expect(isValidRoomId('abcd')).toBe(false);
    });

    test('isValidName mirrors sanitize rules', () => {
        expect(isValidName('Jugador_2')).toBe(true);
        expect(isValidName('A')).toBe(false);
        expect(isValidName('@@@')).toBe(false);
    });

    test('isValidRoomCode mirrors room id rules', () => {
        expect(isValidRoomCode('9999')).toBe(true);
        expect(isValidRoomCode('99')).toBe(false);
    });

    test('validatePlayCardPayload reports missing fields', () => {
        const { missingFields, isValid } = validatePlayCardPayload({
            cardValue: 10,
            position: 'asc1',
        });
        expect(isValid).toBe(false);
        expect(missingFields).toEqual(
            expect.arrayContaining(['playerId', 'roomId'])
        );
    });
});
