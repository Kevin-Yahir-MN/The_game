function createDefaultHistory() {
    return {
        ascending1: [1],
        ascending2: [1],
        descending1: [100],
        descending2: [100],
    };
}

function normalizeHistory(history) {
    const base = createDefaultHistory();
    if (!history || typeof history !== 'object') return base;

    const normalized = { ...base };
    Object.keys(base).forEach((key) => {
        const value = history[key];
        if (Array.isArray(value) && value.length > 0) {
            normalized[key] = value;
        }
    });

    return normalized;
}

const HISTORY_COLUMN_MAP = {
    asc1: 'ascending1',
    asc2: 'ascending2',
    desc1: 'descending1',
    desc2: 'descending2',
};

module.exports = {
    createDefaultHistory,
    normalizeHistory,
    HISTORY_COLUMN_MAP,
};
