# Deploy En VPS Debian Con Docker

Esta guia sirve para migrar el proyecto a un VPS con Debian usando Docker, con todo el proyecto dentro de la carpeta `/data/The_game`.

La IP publica definida para este despliegue es `http://45.82.72.43:3000/`.

## Resumen De La Arquitectura

El proyecto quedara asi:

- `app`: contenedor Node.js con Express y WebSocket
- `postgres`: base de datos principal para usuarios, partidas, amigos y sesiones
- `redis`: cache opcional usada por el backend
- `nginx`: reverse proxy publico por HTTP en el puerto `3000`
- `storage/uploads`: avatares e imagenes guardadas localmente en el VPS
- `storage/postgres`: datos persistentes de PostgreSQL
- `storage/redis`: persistencia de Redis
- `backups/`: respaldos de base de datos y archivos subidos

## Importante

Esta guia usa la IP publica `45.82.72.43` directamente sobre el puerto `3000`.

- la aplicacion correra por `http://45.82.72.43:3000`
- el WebSocket correra por `ws://45.82.72.43:3000`
- no se configurara dominio
- no se configurara HTTPS
- no se usara Let’s Encrypt

Si despues apuntas un dominio al VPS, convendra volver a una configuracion con HTTPS.

## Estructura Esperada En El VPS

Todo vivira dentro de `/data/The_game`:

```text
/data/
  The_game/
    .env
    Dockerfile
    docker-compose.yml
    nginx-hostinger.conf
    storage/
      postgres/
      redis/
      uploads/
    backups/
```

## Requisitos Previos

Necesitas:

- un VPS con Debian 12 o similar
- acceso SSH al VPS
- la IP publica `45.82.72.43`
- el proyecto disponible en Git o copiado manualmente
- puertos `22` y `3000` abiertos en el firewall del VPS

No hace falta abrir `80` ni `443` porque esta guia no usa HTTPS ni un proxy publico en esos puertos.

## Paso 1. Entrar Al VPS

Desde tu maquina local:

```bash
ssh root@45.82.72.43
```

## Paso 2. Actualizar El Sistema

```bash
apt update
apt upgrade -y
```

## Paso 3. Instalar Dependencias Base

```bash
apt install -y ca-certificates curl gnupg lsb-release git
```

`git` es opcional. Solo lo necesitas si vas a clonar el proyecto desde GitHub directamente en el VPS.

## Paso 4. Instalar Docker En Debian

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
docker --version
docker compose version
```

## Paso 5. Crear La Carpeta Base

```bash
mkdir -p /data
```

## Paso 6. Obtener El Proyecto

### Opcion A. Clonarlo Desde GitHub Publico

```bash
cd /data
git clone https://github.com/Kevin-Yahir-MN/The_game.git The_game
cd /data/The_game
```

### Opcion B. Copiarlo Manualmente

Tambien puedes subir la carpeta del proyecto por `scp`, SFTP o ZIP y dejarla en:

```bash
/data/The_game
```

## Paso 7. Crear El Archivo .env

```bash
cd /data/The_game
cp .env.vps.example .env
nano .env
```

Usa este contenido:

```env
DATABASE_URL=postgresql://thegame:TG_9vK_4mQ2_A7@postgres:5432/thegame
REDIS_URL=redis://redis:6379
DB_SSL=false
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=http://45.82.72.43:3000
DB_INIT_MAX_RETRIES=8
DB_INIT_RETRY_DELAY_MS=4000
DB_CONNECTION_TIMEOUT_MS=10000
LOG_LEVEL=info
AVATAR_MAX_BYTES=1048576
UPLOADS_DIR=uploads
POSTGRES_PASSWORD=TG_9vK_4mQ2_A7
```

### Notas Del .env

- `POSTGRES_PASSWORD` y la contraseña dentro de `DATABASE_URL` deben coincidir
- `DB_SSL=false` es correcto porque PostgreSQL vive dentro de Docker en el mismo VPS
- `ALLOWED_ORIGINS` debe quedar exactamente como `http://45.82.72.43:3000`

## Paso 8. Crear Carpetas Persistentes

```bash
cd /data/The_game
mkdir -p storage/postgres storage/redis storage/uploads backups
```

## Paso 9. Revisar Docker Compose

Antes de levantar el stack, confirma que estas ejecutando desde:

```bash
cd /data/The_game
```

Si tu `docker-compose.yml` usa rutas relativas para volumenes, se resolveran correctamente desde esta carpeta.

## Paso 10. Arrancar El Proyecto

```bash
cd /data/The_game
docker compose up -d --build
```

Verifica:

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f nginx
curl http://127.0.0.1:3000/healthz
```

Si todo va bien:

- `app` debe quedar `healthy`
- `postgres` debe quedar activo
- `redis` debe quedar activo
- `nginx` debe servir por HTTP en el puerto `3000`

## Paso 11. Probar La App Desde La IP

Prueba en el navegador:

- `http://45.82.72.43:3000/`

Si no abre:

- revisa firewall
- revisa que Docker este levantado
- revisa `docker compose logs -f nginx`
- revisa `docker compose logs -f app`

## Paso 12. Verificaciones Funcionales

Prueba en el sitio real:

1. abrir la pagina principal
2. registrar un usuario
3. iniciar sesion
4. crear una sala
5. unirse a una sala desde otro navegador o dispositivo
6. jugar una partida
7. subir un avatar
8. cerrar sesion y volver a entrar

### Que deberias verificar

- que `auth/me` responda correctamente
- que el WebSocket conecte sobre `ws://45.82.72.43:3000`
- que la cookie de sesion funcione correctamente en HTTP
- que el avatar quede guardado en `storage/uploads/avatars`
- que `avatar_url` quede guardado en PostgreSQL

## Paso 13. Verificar La Base De Datos

Entrar a PostgreSQL:

```bash
cd /data/The_game
docker compose exec postgres psql -U thegame -d thegame
```

Comandos utiles:

```sql
\dt
SELECT id, username, display_name, avatar_url FROM users LIMIT 10;
SELECT * FROM schema_migrations ORDER BY version;
```

## Paso 14. Verificar Archivos De Avatares

```bash
cd /data/The_game
ls storage/uploads/avatars
```

Cuando un usuario sube avatar, deberias ver un archivo `.webp` por usuario.

## Paso 15. Activar Backups Del Proyecto

Prueba el script:

```bash
cd /data/The_game
sh scripts/backup-vps.sh
```

Esto generara:

- dump de PostgreSQL en `backups/postgres`
- comprimido de uploads en `backups/uploads`

Programa backup diario:

```bash
crontab -e
```

Agrega esta linea:

```cron
15 3 * * * cd /data/The_game && /bin/sh scripts/backup-vps.sh >> /var/log/the-game-backup.log 2>&1
```

## Paso 16. Si Quieres Migrar Datos Actuales

Si vienes de Neon y no quieres empezar desde cero:

1. exporta la base actual
2. importa el dump al Postgres del VPS
3. verifica la tabla `users`, `friends`, `game_states`, `user_sessions`

Ejemplo general de restauracion:

```bash
cat TU_BACKUP.dump | docker compose exec -T postgres pg_restore -U thegame -d thegame --clean --if-exists
```

### Migracion De Avatares Viejos

Si antes usabas Cloudinary:

- los avatares nuevos ya quedaran locales
- los avatares viejos pueden seguir apuntando a URLs remotas en `avatar_url`

Si quieres independizarte totalmente:

1. descarga las imagenes viejas
2. guardalas en `storage/uploads/avatars`
3. actualiza `avatar_url` en PostgreSQL a rutas locales tipo:

```text
/uploads/avatars/ID_DEL_USUARIO.webp
```

## Paso 17. Comandos Utiles

Ver servicios:

```bash
docker compose ps
```

Ver logs de la app:

```bash
docker compose logs -f app
```

Ver logs de Nginx:

```bash
docker compose logs -f nginx
```

Ver logs de Postgres:

```bash
docker compose logs -f postgres
```

Reiniciar stack:

```bash
docker compose restart
```

Reconstruir:

```bash
docker compose up -d --build
```

## Paso 18. Restaurar Backups

### Restaurar PostgreSQL

```bash
cd /data/The_game
cat backups/postgres/NOMBRE.dump | docker compose exec -T postgres pg_restore -U thegame -d thegame --clean --if-exists
```

### Restaurar Uploads

```bash
mkdir -p /data/The_game/storage/uploads
tar -xzf backups/uploads/NOMBRE.tar.gz -C /data/The_game/storage/uploads
```

## Paso 19. Checklist Final

No des por terminado el cambio hasta verificar:

- la IP `45.82.72.43` ya responde por HTTP en `:3000`
- login funciona
- registro funciona
- WebSocket funciona
- creacion de salas funciona
- subida de avatar funciona
- usuarios se guardan en PostgreSQL local
- archivos se guardan en `storage/uploads`
- backup manual funciona

## Estado Final Esperado

Al terminar correctamente, tu proyecto funcionara asi:

- `http://45.82.72.43:3000/` sirve la aplicacion
- `ws://45.82.72.43:3000` maneja tiempo real
- PostgreSQL local guarda usuarios y datos
- Redis local acelera lecturas cacheadas
- los avatares viven en el disco del VPS
- ya no dependes operativamente de Render, Neon ni Cloudinary
