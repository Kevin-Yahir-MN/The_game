(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RATE_LIMIT = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function isWithinRateLimit(bucketMap, key, windowMs, maxEvents, now) {
        if (!bucketMap || !key) return true;
        const currentTime = Number.isFinite(now) ? now : Date.now();
        const bucket = bucketMap.get(key) || { start: currentTime, count: 0 };

        if (currentTime - bucket.start > windowMs) {
            bucket.start = currentTime;
            bucket.count = 0;
        }

        bucket.count += 1;
        bucketMap.set(key, bucket);
        return bucket.count <= maxEvents;
    }

    return { isWithinRateLimit };
});
