// src/config.js
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://the-game-2xks.onrender.com')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ROOM_ID_REGEX = /^\d{4}$/;
const PLAYER_NAME_REGEX = /^[\p{L}\p{N}_\- ]{2,24}$/u;

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_EVENTS = 30;

module.exports = {
    PORT,
    allowedOrigins,
    IS_PRODUCTION,
    ROOM_ID_REGEX,
    PLAYER_NAME_REGEX,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_EVENTS
};
