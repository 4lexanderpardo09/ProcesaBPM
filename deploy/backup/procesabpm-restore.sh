#!/usr/bin/env bash
# Restores a ProcesaBPM backup (docs/operations/backups.md). By default into a scratch database next to the real one, for the
# restore drill; the real database only with --into-production and the typed confirmation.
#
#   deploy/backup/procesabpm-restore.sh <file.dump> [--database NAME]       restore into NAME (default procesabpm_restore_drill)
#   deploy/backup/procesabpm-restore.sh <file.dump> --into-production       replace the database the app uses (stop the app first)
#
# <file.dump> is a local file: a copy this server kept (/var/backups/procesabpm) or one downloaded from the bucket with your own
# credentials (the server's role cannot read the bucket, on purpose). Its .sha256 is checked when it sits next to it. The
# roles (the .globals.sql of the same backup) must exist in the cluster: on a new server, load that file first (see the doc).
#
# Afterwards it prints what the restored database holds (tenants, users, tickets, last migration) to compare with the source.
# Same container settings as the backup script: BACKUP_DB_CONTAINER, or BACKUP_COMPOSE_DIR / COMPOSE_FILE / ENV_FILE.
set -euo pipefail

usage() { sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

file=""
database=procesabpm_restore_drill
production=0
while [ $# -gt 0 ]; do
  case "$1" in
    --database) database=${2:?--database needs a name}; shift 2 ;;
    --into-production) production=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    *) file=$1; shift ;;
  esac
done
[ -n "$file" ] || { usage >&2; exit 2; }
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 2; }
[[ "$database" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "The database name may only have lowercase letters, digits and _" >&2; exit 2; }

BACKUP_COMPOSE_DIR=${BACKUP_COMPOSE_DIR:-/opt/procesabpm}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.example.yml}
ENV_FILE=${ENV_FILE:-.env}
PRODUCTION_DB=${BACKUP_DB_NAME:-procesabpm}

if [ "$production" -eq 1 ]; then
  database=$PRODUCTION_DB
  echo "This REPLACES the database '$database' with $file. Stop the api and the worker first."
  read -r -p "Type the database name to go on: " typed
  [ "$typed" = "$database" ] || { echo "Cancelled."; exit 1; }
elif [ "$database" = "$PRODUCTION_DB" ]; then
  echo "To restore into '$PRODUCTION_DB' use --into-production." >&2
  exit 2
fi

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256") || { echo "The checksum does not match: the file is damaged." >&2; exit 1; }
fi

if [ -n "${BACKUP_DB_CONTAINER:-}" ]; then
  container=$BACKUP_DB_CONTAINER
else
  env_args=()
  [ -f "$BACKUP_COMPOSE_DIR/$ENV_FILE" ] && env_args=(--env-file "$BACKUP_COMPOSE_DIR/$ENV_FILE")
  container=$(cd "$BACKUP_COMPOSE_DIR" && docker compose "${env_args[@]}" -f "$COMPOSE_FILE" ps -q postgres)
fi
[ -n "$container" ] || { echo "The Postgres container is not running" >&2; exit 1; }

psql_as_owner() { docker exec -i "$container" sh -c 'exec psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -X -q "$@"' sh "$@"; }

echo "Restoring into '$database'…"
psql_as_owner -d postgres -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" -c "CREATE DATABASE \"$database\""
# --exit-on-error: a partial restore is worse than none. Owners and grants come back as dumped (the roles must exist).
docker exec -i "$container" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$database" <"$file"

echo "Restored. What it holds:"
psql_as_owner -d "$database" -A -F ' ' -t <<'SQL'
SET row_security = off;
SELECT 'tenants', count(*) FROM tenants
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'tickets', count(*) FROM tickets;
SQL
if [ "$(psql_as_owner -d "$database" -A -t -c "SELECT to_regclass('_prisma_migrations') IS NOT NULL")" = t ]; then
  psql_as_owner -d "$database" -A -F ' ' -t -c "SELECT 'last_migration', max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
fi
