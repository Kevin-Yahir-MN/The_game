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
    DB_SSL=false
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

## Docker / Hostinger VPS

This repo now includes a production-ready `Dockerfile`, `docker-compose.yml`, Nginx config, and a VPS backup script.

For a full command-by-command deployment guide, see `DEPLOY_HOSTINGER.md`.

Recommended flow for a Hostinger VPS:

1. Install Docker Engine and Docker Compose on the VPS.
2. Clone this repository on the VPS.
3. Create a production `.env` file based on `.env.example`.
4. Set at least:

   ```
   POSTGRES_PASSWORD=change_this_now
   ALLOWED_ORIGINS=https://yourdomain.com
   NODE_ENV=production
   LOG_LEVEL=info
   ```

5. Start the stack:

   ```bash
   docker compose up -d --build
   ```

6. Confirm the app is healthy:

   ```bash
   docker compose ps
   curl http://127.0.0.1/healthz
   ```

Notes:
- Nginx listens on port `80` and proxies to the app on the internal Docker network.
- The app runs on port `3000` only inside Docker.
- PostgreSQL, Redis, and uploaded avatars are stored in `./storage` on the VPS.
- DB migrations run automatically on app startup.
- `DB_SSL=false` is correct when using the bundled PostgreSQL container.
- If you later switch to a managed PostgreSQL provider, set `DATABASE_URL` to that service and change `DB_SSL=true` or `DB_SSL=strict`.
- Edit `nginx-hostinger.conf` if you need to change the production domain.
- For HTTPS, terminate TLS at Nginx or place a certificate-managed proxy in front of it.

## VPS Backups

The project includes `scripts/backup-vps.sh` to back up:
- PostgreSQL with `pg_dump`
- Uploaded avatars from `storage/uploads`

Run it manually:

```bash
sh scripts/backup-vps.sh
```

Keep backups for 14 days instead of 7:

```bash
RETENTION_DAYS=14 sh scripts/backup-vps.sh
```

Suggested cron on the VPS for a daily backup at 3:15 AM:

```cron
15 3 * * * cd /root/The_game && /bin/sh scripts/backup-vps.sh >> /var/log/the-game-backup.log 2>&1
```

Recommended backup strategy:
- Keep Hostinger VPS snapshots enabled.
- Keep the daily app-level backup script enabled.
- Copy the `backups/` folder to external storage regularly.

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
