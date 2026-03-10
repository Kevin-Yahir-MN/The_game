# The Game

A multiplayer card game built with Node.js, Express, WebSockets, and PostgreSQL.

## Features

- Real-time multiplayer gameplay
- User authentication and guest mode
- Friend system
- Persistent game state
- Rate limiting and security measures

## Setup

1. Install dependencies:

    ```bash
    npm install
    ```

2. Set up environment variables in `.env`:

    ```
    DATABASE_URL=postgresql://user:pass@localhost:5432/db
    REDIS_URL=redis://localhost:6379
    PORT=3000
    NODE_ENV=production
    ALLOWED_ORIGINS=https://yourdomain.com
    ```

3. Run the application:
    ```bash
    npm start
    ```

## API

### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `POST /auth/logout` - Logout
- `GET /auth/me` - Get current user

### Game

- `POST /create-room` - Create game room
- `POST /join-room` - Join room

## Development

- `npm run dev` - Start with nodemon
- `npm run lint` - Run ESLint
- `npm run format` - Format with Prettier
- `npm test` - Run tests
- `npm run migrate` - Run database migrations

## Migrations

This project uses SQL migrations stored in `server/migrations`.

How it works:
- Each `.sql` file is applied once and recorded in `schema_migrations`.
- Migrations run automatically during server startup.
- You can also run them manually with `npm run migrate`.

Guidelines:
- Add new migrations as new files with an incrementing prefix (e.g. `0005_feature.sql`).
- Never edit existing migration files that were already applied.

## Architecture

- **Server**: Express.js with WebSocket support
- **Database**: PostgreSQL with Sequelize
- **Cache**: Redis for performance
- **Security**: Helmet, rate limiting, httpOnly cookies
- **Logging**: Winston for structured logs
