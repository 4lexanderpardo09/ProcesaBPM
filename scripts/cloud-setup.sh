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
# Images may ship another PostgreSQL (e.g. 16) whose cluster owns port 5432, and packages
# cannot start services without systemd. Make cluster 18/main the one on 5432 and start it.
PG_PORT=5432
for cluster in $(pg_lsclusters -h 2>/dev/null | awk '$1 != "18" { print $1 "/" $2 }'); do
  $SUDO pg_ctlcluster "${cluster%/*}" "${cluster#*/}" stop 2>/dev/null || true
  $SUDO pg_conftool "${cluster%/*}" "${cluster#*/}" set port 5499 2>/dev/null || true
done
if ! pg_lsclusters -h 2>/dev/null | awk '$1 == "18" && $2 == "main"' | grep -q .; then
  $SUDO pg_createcluster 18 main --port "$PG_PORT"
fi
$SUDO pg_conftool 18 main set port "$PG_PORT"
if pg_lsclusters -h | awk '$1 == "18" && $2 == "main" && $4 == "online"' | grep -q .; then
  $SUDO pg_ctlcluster 18 main restart
else
  $SUDO pg_ctlcluster 18 main start
fi
for _ in $(seq 1 30); do pg_isready -q -h localhost -p "$PG_PORT" && break; sleep 1; done
pg_isready -h localhost -p "$PG_PORT"
as_postgres "psql -q -p $PG_PORT -c \"ALTER USER postgres PASSWORD 'postgres';\""
pg_lsclusters

# --- Node + pnpm -----------------------------------------------------------------------
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 24 ]; then
  echo "WARNING: Node >= 24 is required (found: $(node --version 2>/dev/null || echo none))" >&2
fi
corepack enable >/dev/null 2>&1 || $SUDO corepack enable
corepack prepare pnpm@11.20.0 --activate >/dev/null

# --- SeaweedFS (S3-compatible storage for the integration tests) ----------------------
# MinIO stopped publishing images and binaries, and the sandbox has no Docker daemon, so SeaweedFS (the server the
# tests use with Docker too, image chrislusf/seaweedfs) is built from source with Go: a few minutes the first time,
# skipped when the binary exists. The tests need an S3 that honours `If-None-Match: *` on presigned PUTs.
SEAWEED_VERSION="4.48"
S3_PORT=8333
SEAWEED_BIN="$HOME/go/bin/weed"
if [ ! -x "$SEAWEED_BIN" ] && command -v go >/dev/null 2>&1; then
  seaweed_src="$(mktemp -d)"
  if git clone -q --depth 1 --branch "$SEAWEED_VERSION" https://github.com/seaweedfs/seaweedfs "$seaweed_src" \
     && (cd "$seaweed_src" && GOTOOLCHAIN=auto GOFLAGS=-mod=mod go build -o "$SEAWEED_BIN" ./weed); then :; else
    echo "WARNING: could not build SeaweedFS; the storage tests need TEST_S3_ENDPOINT or Docker" >&2
  fi
  rm -rf "$seaweed_src"
fi
if [ -x "$SEAWEED_BIN" ] && ! curl -s -o /dev/null "http://127.0.0.1:$S3_PORT/"; then
  mkdir -p /tmp/seaweed-data
  AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret nohup "$SEAWEED_BIN" mini -dir=/tmp/seaweed-data -s3.port="$S3_PORT" >/tmp/seaweed.log 2>&1 &
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$S3_PORT/" && break; sleep 1; done
fi
echo "S3 (SeaweedFS) on localhost:$S3_PORT. Run the API tests with: TEST_S3_ENDPOINT=http://127.0.0.1:$S3_PORT TEST_S3_ACCESS_KEY=testkey TEST_S3_SECRET_KEY=testsecret pnpm test"

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
