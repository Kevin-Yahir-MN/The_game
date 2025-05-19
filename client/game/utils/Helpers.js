export function sanitizeInput(input) {
    return input ? input.replace(/[^a-zA-Z0-9-_]/g, '') : '';
}

export function log(message, data) {
    console.log(`[${new Date().toISOString()}] ${message}`, data);
}