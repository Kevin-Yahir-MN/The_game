#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
DB_BACKUP_DIR="$BACKUP_DIR/postgres"
UPLOADS_BACKUP_DIR="$BACKUP_DIR/uploads"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$DB_BACKUP_DIR" "$UPLOADS_BACKUP_DIR"

cd "$PROJECT_DIR"

docker compose exec -T postgres pg_dump -U thegame -d thegame -Fc \
    > "$DB_BACKUP_DIR/thegame-$TIMESTAMP.dump"

tar -czf "$UPLOADS_BACKUP_DIR/uploads-$TIMESTAMP.tar.gz" -C "$PROJECT_DIR/storage/uploads" .

find "$DB_BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
find "$UPLOADS_BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "Backups created in $BACKUP_DIR"
