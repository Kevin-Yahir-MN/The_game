const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { PORT, allowedOrigins } = require('./server/config.js');
const {
    pool,
    initializeDatabase,
    cleanupOldGames,
    isTransientConnectionError,
} = require('./server/db.js');
const { registerHttpRoutes } = require('./server/http/routes.js');
const { restoreActiveGames } = require('./server/services/persistence.js');
const { setupWebSocket } = require('./server/ws/websocket.js');
const {
    cleanupExpiredSessions,
} = require('./server/services/authService.js');
const logger = require('./server/utils/logger.js');

let hasInitialized = false;

const app = express();
const server = http.createServer(app);

// Render and similar hosts sit behind a single reverse proxy, so trust the first hop for IP-based rate limiting.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            },
        },
    })
);
app.use(cookieParser());
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'client')));
app.use('/assets', express.static(path.join(__dirname, 'client/assets')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

const uploadsRoot =
    process.env.UPLOADS_DIR
        ? path.resolve(__dirname, process.env.UPLOADS_DIR)
        : path.join(__dirname, 'uploads');
const uploadsAvatarsDir = path.join(uploadsRoot, 'avatars');
fs.mkdirSync(uploadsAvatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsRoot));

const pagesDir = path.join(__dirname, 'client/pages');
const assetsDir = path.join(__dirname, 'client/assets');

app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(pagesDir, 'index.html'));
});

app.get('/sala.html', (req, res) => {
    res.sendFile(path.join(pagesDir, 'sala.html'));
});

app.get('/game.html', (req, res) => {
    res.sendFile(path.join(pagesDir, 'game.html'));
});

app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.join(assetsDir, 'sitemap.xml'));
});

app.get('/google5bea87fead3cc824.html', (req, res) => {
    res.sendFile(path.join(assetsDir, 'google5bea87fead3cc824.html'));
});

app.get('/healthz', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('Healthcheck failed', error);
        res.status(503).json({ ok: false });
    }
});

// Rate limiting for HTTP routes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Specific rate limit for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 auth attempts per windowMs
    message: 'Too many authentication attempts, please try again later.',
});

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PATCH, OPTIONS'
        );
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization'
        );
    }

    if (req.method === 'OPTIONS') {
        if (origin && !allowedOrigins.includes(origin)) {
            return res.status(403).end();
        }
        return res.status(204).end();
    }

    next();
});

registerHttpRoutes(app, authLimiter);
setupWebSocket(server);

/**
 * Bootstrap database connection and initialize cleanup jobs
 */
async function bootstrapDatabase() {
    try {
        await initializeDatabase();

        if (!hasInitialized) {
            restoreActiveGames();
            setInterval(cleanupOldGames, 3600000);
            setInterval(cleanupExpiredSessions, 3600000);
            hasInitialized = true;
        }

        logger.info('Database ready');
    } catch (error) {
        const transient = isTransientConnectionError(error);
        logger.error('Error initializing server:', error);

        if (transient) {
            logger.warn('Transient DB connection error. Retrying in 30s...');
            setTimeout(bootstrapDatabase, 30000);
            return;
        }

        process.exit(1);
    }
}

bootstrapDatabase();

server.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
});
