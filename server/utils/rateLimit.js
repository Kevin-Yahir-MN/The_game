const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_EVENTS } = require('../config');
const { wsRateLimit } = require('../state');
const { isWithinRateLimit: sharedIsWithinRateLimit } = require('../../shared/rateLimit');

function isWithinRateLimit(playerId) {
    return sharedIsWithinRateLimit(
        wsRateLimit,
        playerId,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX_EVENTS
    );
}

module.exports = { isWithinRateLimit };
