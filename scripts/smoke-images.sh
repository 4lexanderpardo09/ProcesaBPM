#!/usr/bin/env bash
# Smoke test of the production images (docs/despliegue.md §9): migrates a fresh PostgreSQL, loads the catalog, starts the API
# and the worker with the hardening the guide recommends (read-only filesystem, no capabilities) and checks that the API is
# healthy and ready and that the worker stops cleanly on SIGTERM.
#   scripts/smoke-images.sh            uses procesabpm-api / -worker / -migrate (override with API_IMAGE, WORKER_IMAGE, MIGRATE_IMAGE)
set -euo pipefail

API_IMAGE=${API_IMAGE:-procesabpm-api}
WORKER_IMAGE=${WORKER_IMAGE:-procesabpm-worker}
MIGRATE_IMAGE=${MIGRATE_IMAGE:-procesabpm-migrate}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:18-alpine}
RUN=smoke-$$
NETWORK=$RUN

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for name in "$RUN-api" "$RUN-worker"; do
      echo "--- logs of $name" >&2
      docker logs "$name" 2>&1 | tail -n 40 >&2 || true
    done
  fi
  docker rm -f "$RUN-pg" "$RUN-api" "$RUN-worker" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# `grep -q` closes the pipe early, which pipefail would report as a failure: read the logs first.
logs_contain() { local logs; logs=$(docker logs "$1" 2>&1); grep -q -- "$2" <<<"$logs"; }
# Nest closes the application on SIGTERM and then re-raises the signal: exit code 143 (128 + 15) is a clean stop, 137 (killed) is not.
stopped_by_sigterm() {
  code=$(docker inspect -f '{{.State.ExitCode}}' "$1")
  [ "$code" = 0 ] || [ "$code" = 143 ] || fail "$1 did not stop on SIGTERM (exit code $code)"
}
step() { echo "==> $*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }

# The guide's recommendation for the long-running services.
HARDENING=(--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --init)
DB_HOST=$RUN-pg
url() { echo "postgresql://$1:$2@$DB_HOST:5432/procesabpm"; }

step "image contents"
for image in "$API_IMAGE" "$WORKER_IMAGE" "$MIGRATE_IMAGE"; do
  [ "$(docker run --rm --entrypoint id "$image" -u)" != "0" ] || fail "$image runs as root"
  # Our own files only: third-party packages ship whatever they ship.
  leftovers=$(docker run --rm --entrypoint find "$image" /app -path /app/node_modules -prune -o \( -name '.env*' -o -name '*.test.*' -o -name '*.spec.*' -o -name '.git' -o \( -name '*.ts' ! -name prisma.config.ts \) -o -name 'docs' \) -print)
  [ -z "$leftovers" ] || fail "$image contains files that must not ship: $leftovers"
done
docker run --rm --entrypoint test "$API_IMAGE" -f /app/assets/fonts/NotoSans-Regular.ttf || fail "the PDF fonts are not in the API image"
docker run --rm --entrypoint test "$WORKER_IMAGE" -f /app/assets/fonts/NotoSans-Bold.ttf || fail "the PDF fonts are not in the worker image"
docker run --rm --entrypoint test "$WORKER_IMAGE" -f /app/smoke.js || fail "smoke.js (deploy/verify.sh) is not in the worker image"

step "database"
docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB_HOST" --network "$NETWORK" -e POSTGRES_PASSWORD=owner -e POSTGRES_DB=procesabpm "$POSTGRES_IMAGE" >/dev/null
# The image starts a temporary server for its init scripts and then restarts: only a TCP connection means the real one is up.
for _ in $(seq 1 90); do docker exec "$DB_HOST" psql -h 127.0.0.1 -U postgres -d procesabpm -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
docker exec "$DB_HOST" psql -h 127.0.0.1 -U postgres -d procesabpm -c 'select 1' >/dev/null 2>&1 || fail "PostgreSQL did not start"

step "migrate (as the schema owner)"
docker run --rm --network "$NETWORK" "${HARDENING[@]}" -e "DATABASE_URL=$(url postgres owner)" "$MIGRATE_IMAGE"

step "login roles"
# The very file the deployment guide hands out; run twice to prove it is idempotent.
for _ in 1 2; do
  docker exec -i -e API_DB_PASSWORD=api -e WORKER_DB_PASSWORD=worker -e PLATFORM_DB_PASSWORD=platform "$DB_HOST" psql -U postgres -d procesabpm -v ON_ERROR_STOP=1 \
    <"$(dirname "$0")/../deploy/roles.sql" >/dev/null
done

step "global catalog (seed)"
for _ in 1 2; do  # the catalog loader must be safe to run on every deployment
  docker run --rm --network "$NETWORK" "${HARDENING[@]}" -e "DATABASE_URL=$(url procesabpm_platform platform)" "$MIGRATE_IMAGE" node seed/seed.js
done

COMMON_ENV=(-e LOG_LEVEL=info -e STORAGE_ENDPOINT=http://storage.invalid:8333 -e STORAGE_BUCKET=procesabpm -e STORAGE_ACCESS_KEY_ID=key -e STORAGE_SECRET_ACCESS_KEY=secret -e STORAGE_FORCE_PATH_STYLE=true)

step "api"
docker run -d --name "$RUN-api" --network "$NETWORK" "${HARDENING[@]}" "${COMMON_ENV[@]}" \
  -e "DATABASE_URL=$(url procesabpm_api api)" -e "PLATFORM_DATABASE_URL=$(url procesabpm_platform platform)" \
  -e JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  -e "MFA_ENCRYPTION_KEYS=smoke:$(head -c 32 /dev/urandom | base64)" -e REALTIME_ALLOWED_ORIGINS=https://app.example.com "$API_IMAGE" >/dev/null
probe() { docker exec "$RUN-api" node -e "fetch('http://127.0.0.1:3000/$1').then(async (r) => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); }, (e) => { console.error(e.message); process.exit(1); })"; }
for _ in $(seq 1 60); do probe ready >/dev/null 2>&1 && break; sleep 1; done
[[ "$(probe health)" == *'"ok"'* ]] || fail "/health did not answer ok"
[[ "$(probe ready)" == *'"ready"'* ]] || fail "/ready did not answer ready"
for _ in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$RUN-api")" = healthy ] && break; sleep 2; done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$RUN-api")" = healthy ] || fail "the API container never became healthy"

step "worker"
docker run -d --name "$RUN-worker" --network "$NETWORK" "${HARDENING[@]}" "${COMMON_ENV[@]}" \
  -e "WORKER_DATABASE_URL=$(url procesabpm_worker worker)" -e WEB_BASE_URL=https://app.example.com \
  -e OUTBOX_TOKEN_KEY=0123456789abcdef0123456789abcdef0123456789abcdef -e SMTP_HOST=smtp.invalid "$WORKER_IMAGE" >/dev/null
for _ in $(seq 1 60); do logs_contain "$RUN-worker" 'Worker started' && break; sleep 1; done
logs_contain "$RUN-worker" 'Worker started' || fail "the worker did not start"
docker stop --time 30 "$RUN-worker" >/dev/null
stopped_by_sigterm "$RUN-worker"
logs_contain "$RUN-worker" 'Worker stopped (SIGTERM)' || fail "the worker did not log an orderly shutdown"

step "api refuses to start without MFA_ENCRYPTION_KEYS"
missing_output="$(docker run --rm --network "$NETWORK" "${HARDENING[@]}" "${COMMON_ENV[@]}" \
  -e "DATABASE_URL=$(url procesabpm_api api)" -e "PLATFORM_DATABASE_URL=$(url procesabpm_platform platform)" \
  -e JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef -e REALTIME_ALLOWED_ORIGINS=https://app.example.com "$API_IMAGE" 2>&1 || true)"
[[ "$missing_output" == *"MFA_ENCRYPTION_KEYS is required"* ]] || fail "the API started (or failed for another reason) without MFA_ENCRYPTION_KEYS: $missing_output"

step "api shutdown"
docker stop --time 30 "$RUN-api" >/dev/null
stopped_by_sigterm "$RUN-api"

echo "All image checks passed."
