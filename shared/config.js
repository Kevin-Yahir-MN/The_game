(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.APP_SHARED_CONFIG = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    return {
        RATE_LIMIT_WINDOW_MS: 1000,
        RATE_LIMIT_MAX_EVENTS: 30,
    };
});
