function parseWsMessage(message) {
    const rawMessage =
        typeof message === 'string' ? message : message.toString();
    if (rawMessage.length > 8 * 1024) {
        const error = new Error('Payload demasiado grande');
        error.code = 'PAYLOAD_TOO_LARGE';
        throw error;
    }

    try {
        const parsed = JSON.parse(rawMessage);
        if (!parsed.type || typeof parsed.type !== 'string') {
            const error = new Error('Mensaje debe contener un campo "type"');
            error.code = 'INVALID_MESSAGE_TYPE';
            throw error;
        }
        return parsed;
    } catch (error) {
        if (error.code === 'INVALID_MESSAGE_TYPE') throw error;
        const parseError = new Error('JSON inválido');
        parseError.code = 'INVALID_JSON';
        throw parseError;
    }
}

module.exports = { parseWsMessage };
