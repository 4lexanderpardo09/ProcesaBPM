#!/bin/bash
# Prepares a fresh Linux sandbox (Claude Code on the web, CI without Docker) to work on
# ProcesaBPM: PostgreSQL 18 running locally, pnpm, dependencies and Prisma Client.
# Idempotent: safe to run on every session start.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then su -s /bin/bash postgres -c "$*"; else sudo -u postgres bash -c "$*"; fi
}

# --- PostgreSQL 18 (official PGDG packages) -------------------------------------------
if [ ! -x /usr/lib/postgresql/18/bin/postgres ]; then
  $SUDO apt-get update -y || echo "WARNING: apt-get update had errors; continuing" >&2
  $SUDO apt-get install -y curl ca-certificates gnupg
  $SUDO install -d /usr/share/postgresql-common/pgdg
  $SUDO curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y || echo "WARNING: apt-get update had errors; continuing" >&2
  $SUDO apt-get install -y postgresql-18
fi
$SUDO pg_ctlcluster 18 main start 2>/dev/null || true
as_postgres "psql -q -c \"ALTER USER postgres PASSWORD 'postgres';\""

# --- Node + pnpm -----------------------------------------------------------------------
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 24 ]; then
  echo "WARNING: Node >= 24 is required (found: $(node --version 2>/dev/null || echo none))" >&2
fi
corepack enable >/dev/null 2>&1 || $SUDO corepack enable
corepack prepare pnpm@11.20.0 --activate >/dev/null

# --- Project dependencies (only when run inside the repository) ------------------------
# Cloud environments run the setup script before the repository is available; in that
# case the agent installs dependencies at the start of the session (see CLAUDE.md).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$repo_root" ] && [ -f "$repo_root/pnpm-workspace.yaml" ]; then
  cd "$repo_root"
  pnpm install --frozen-lockfile
  pnpm --filter @procesabpm/db generate
fi

echo "ProcesaBPM sandbox ready: PostgreSQL 18 on localhost:5432 (postgres/postgres)."
