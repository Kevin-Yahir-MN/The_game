const {
    getPlayableCards,
    isValidMove,
    initializeDeck,
} = require('../shared/gameRules');

describe('Shared Game Rules', () => {
    test('initializeDeck returns shuffled deck of 2..99', () => {
        const deck = initializeDeck();
        expect(deck.length).toBe(98);
        expect(deck).toEqual(expect.arrayContaining([2, 50, 99]));
        expect(deck).not.toContain(1);
        expect(deck).not.toContain(100);
        const unique = new Set(deck);
        expect(unique.size).toBe(98);
    });

    test('isValidMove respects ascending/descending and exact difference', () => {
        const board = { ascending: [10, 30], descending: [90, 70] };

        expect(isValidMove(11, 'asc1', board).isValid).toBe(true);
        expect(isValidMove(20, 'asc1', board).isValid).toBe(true);
        expect(isValidMove(5, 'asc1', board).isValid).toBe(false);
        expect(isValidMove(0, 'asc1', board).isValid).toBe(true);
        expect(isValidMove(0, 'desc1', board).isValid).toBe(true);

        expect(isValidMove(80, 'desc1', board).isValid).toBe(true);
        expect(isValidMove(100, 'desc1', board).isValid).toBe(true);
        expect(isValidMove(80, 'desc2', board).isValid).toBe(true);
        expect(isValidMove(60, 'desc2', board).isValid).toBe(true);

        expect(isValidMove(20, 'asc1', board).exactDifference).toBe(false);
        expect(isValidMove(0, 'asc1', board).exactDifference).toBe(true);
        expect(isValidMove(80, 'desc1', board).exactDifference).toBe(false);
        expect(isValidMove(100, 'desc1', board).exactDifference).toBe(true);
    });

    test('getPlayableCards filters playable values', () => {
        const board = { ascending: [10, 30], descending: [90, 70] };
        const playable = getPlayableCards([1, 5, 20, 80, 95], board);
        expect(playable).toEqual(expect.arrayContaining([20, 80]));
        expect(playable).toEqual(expect.arrayContaining([1, 5]));
    });
});
