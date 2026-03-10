function isTransientConnectionError(error) {
    if (!error) return false;

    const code = String(error.code || '').toUpperCase();
    const message = String(error.message || '').toLowerCase();
    const causeMessage = String(error.cause?.message || '').toLowerCase();

    return (
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ENETUNREACH' ||
        message.includes('connection timeout') ||
        message.includes('connection terminated') ||
        message.includes('terminating connection') ||
        causeMessage.includes('connection terminated') ||
        causeMessage.includes('connection timeout')
    );
}

module.exports = { isTransientConnectionError };
