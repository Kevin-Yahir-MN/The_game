// src/utils/rateLimit.js
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_EVENTS } = require('../config');
const { wsRateLimit } = require('../state');

function isWithinRateLimit(playerId) {
    const now = Date.now();
    const bucket = wsRateLimit.get(playerId) || { start: now, count: 0 };
    if (now - bucket.start > RATE_LIMIT_WINDOW_MS) {
        bucket.start = now;
        bucket.count = 0;
    }
    bucket.count += 1;
    wsRateLimit.set(playerId, bucket);
    return bucket.count <= RATE_LIMIT_MAX_EVENTS;
}

module.exports = { isWithinRateLimit };
