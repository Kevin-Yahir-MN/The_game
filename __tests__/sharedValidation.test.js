const {
    sanitizePlayerName,
    isValidRoomId,
    validatePlayCardPayload,
    isValidName,
    isValidRoomCode,
    isValidUsername,
    isValidDisplayName,
    isValidPassword,
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

    test('isValidUsername enforces basic username rules', () => {
        expect(isValidUsername('kevin_01')).toBe(true);
        expect(isValidUsername('KEVIN-01')).toBe(true);
        expect(isValidUsername('ab')).toBe(false);
        expect(isValidUsername('bad name')).toBe(false);
    });

    test('isValidDisplayName reuses player name rules', () => {
        expect(isValidDisplayName('Jugador_2')).toBe(true);
        expect(isValidDisplayName('A')).toBe(false);
        expect(isValidDisplayName('@@@')).toBe(false);
    });

    test('isValidPassword enforces length and no control chars', () => {
        expect(isValidPassword('12345678')).toBe(true);
        expect(isValidPassword('short')).toBe(false);
        expect(isValidPassword('validpassword'.repeat(6))).toBe(false);
        expect(isValidPassword('bad\u0000pass')).toBe(false);
    });
});
