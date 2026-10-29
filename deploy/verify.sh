#!/usr/bin/env bash
# Verifies a deployment (docs/despliegue.md §9). Run it on the server after every deployment, from the directory of the compose file:
#   deploy/verify.sh                 unit tests in a throwaway container, then the smoke test against the running stack
#   deploy/verify.sh --skip-unit     only the smoke test
#   deploy/verify.sh --skip-smoke    only the unit tests
#
# Afterwards it frees the disk every build fills: the unit test image goes away and the build cache older than 6 hours is
# pruned (left alone, the cache filled the 29 GB of the test server in three weeks). It never touches volumes or containers.
#
# The smoke test is `smoke.js` of the worker image: it drives the real API like a customer (administrator with MFA, organization,
# invitation e-mail through the worker and Mailpit, a published workflow, a ticket advanced and closed, a file through presigned
# URLs, a report) and removes everything it created. Every step prints OK or FAIL; the exit code is 1 if anything failed.
#
# Environment (all optional):
#   COMPOSE_FILE     compose file of the deployment            (default docker-compose.prod.example.yml)
#   ENV_FILE         the file with the deployment's secrets     (default .env; PLATFORM_DB_PASSWORD is read from it)
#   BASE_URL         where the API answers; inside the compose network by default. Use the public https address to test the
#                    reverse proxy too                         (default http://api:3000)
#   MAILPIT_URL      the mail catcher, as seen from the compose network (default http://mailpit:8025)
#   SMOKE_PLAN_CODE  plan of the smoke organization            (default professional)
#   TEST_IMAGE       tag of the unit test image                (default procesabpm-test-unit)
#   BACKUP_MARKER    the marker the daily backup leaves; older than BACKUP_MAX_AGE_HOURS (26) only warns
#                    (default /var/lib/procesabpm-backup/last-success)
#   WEB_URL          where the web answers; the web container from the host by default. Use the public https address to
#                    test the reverse proxy too                (default http://127.0.0.1:8080)
set -uo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.example.yml}
ENV_FILE=${ENV_FILE:-.env}
BASE_URL=${BASE_URL:-http://api:3000}
WEB_URL=${WEB_URL:-http://127.0.0.1:8080}
MAILPIT_URL=${MAILPIT_URL:-http://mailpit:8025}
TEST_IMAGE=${TEST_IMAGE:-procesabpm-test-unit}
BACKUP_MARKER=${BACKUP_MARKER:-/var/lib/procesabpm-backup/last-success}
BACKUP_MAX_AGE_HOURS=${BACKUP_MAX_AGE_HOURS:-26}
run_unit=1
run_smoke=1
for argument in "$@"; do
  case "$argument" in
    --skip-unit) run_unit=0 ;;
    --skip-smoke) run_smoke=0 ;;
    -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $argument (see --help)" >&2; exit 2 ;;
  esac
done

failed=0
section() { echo; echo "== $*"; }
result() { # name status
  if [ "$2" -eq 0 ]; then echo "OK    $1"; else echo "FAIL  $1"; failed=1; fi
}

compose() {
  if [ -f "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; else docker compose -f "$COMPOSE_FILE" "$@"; fi
}

if [ "$run_unit" -eq 1 ]; then
  section "Unit tests (shared and API) in a throwaway container, 2 GB of memory"
  docker build -f Dockerfile.test-unit -t "$TEST_IMAGE" . >/tmp/verify-unit-build.log 2>&1
  build_status=$?
  if [ "$build_status" -ne 0 ]; then
    tail -n 30 /tmp/verify-unit-build.log
    result "build the unit test image (full log: /tmp/verify-unit-build.log)" "$build_status"
  else
    docker run --rm --memory 2g --memory-swap 2g "$TEST_IMAGE"
    result "unit tests" $?
  fi
  # 1.7 GB rebuilt on every run: keeping it only takes disk.
  docker image rm "$TEST_IMAGE" >/dev/null 2>&1
fi

if [ "$run_smoke" -eq 1 ]; then
  section "Smoke test against $BASE_URL"
  if [ ! -f "$ENV_FILE" ]; then
    echo "The secrets file $ENV_FILE does not exist (set ENV_FILE): the smoke test needs PLATFORM_DB_PASSWORD." >&2
    result "read the secrets file" 1
  else
    # The password goes into the container by name, never on a command line (it would show in `ps`).
    PLATFORM_DB_PASSWORD=$(sed -n 's/^PLATFORM_DB_PASSWORD=//p' "$ENV_FILE" | tail -n 1)
    if [ -z "$PLATFORM_DB_PASSWORD" ]; then
      echo "PLATFORM_DB_PASSWORD is not set in $ENV_FILE." >&2
      result "read PLATFORM_DB_PASSWORD" 1
    else
      export SMOKE_DATABASE_URL="postgresql://procesabpm_platform:${PLATFORM_DB_PASSWORD}@postgres:5432/procesabpm"
      export BASE_URL MAILPIT_URL
      export SMOKE_PLAN_CODE=${SMOKE_PLAN_CODE:-professional}
      compose run --rm --no-deps -e SMOKE_DATABASE_URL -e BASE_URL -e MAILPIT_URL -e SMOKE_PLAN_CODE worker node smoke.js
      result "smoke test" $?
    fi
  fi
fi

if [ "$run_smoke" -eq 1 ]; then
  section "Web at $WEB_URL"
  index=$(curl -fsS --max-time 10 "$WEB_URL/" 2>&1)
  grep -q '<div id="root">' <<<"$index"
  result "the app's index.html" $?
  curl -fsS --max-time 10 "$WEB_URL/tickets/verify" 2>&1 | grep -q '<div id="root">'
  result "a route of the app opens the app" $?
  bundle=$(grep -o '/assets/[^"]*\.js' <<<"$index" | head -n 1)
  [ -n "$bundle" ] && curl -fsS --max-time 10 -o /dev/null "$WEB_URL$bundle"
  result "the app's bundle${bundle:+ ($bundle)}" $?
fi

section "Database backup"
# The server cannot read the bucket (its role only writes), so the backup leaves a marker after each upload. A stale or
# missing marker warns without failing the verification: the deployment itself may be fine.
if [ ! -f "$BACKUP_MARKER" ]; then
  echo "WARN  no backup recorded yet ($BACKUP_MARKER): see docs/operations/backups.md"
else
  age_hours=$(( ($(date +%s) - $(stat -c %Y "$BACKUP_MARKER")) / 3600 ))
  if [ "$age_hours" -ge "$BACKUP_MAX_AGE_HOURS" ]; then
    echo "WARN  the newest backup is ${age_hours} h old (more than ${BACKUP_MAX_AGE_HOURS} h): journalctl -u procesabpm-backup.service"
  else
    echo "OK    newest backup ${age_hours} h old: $(sed -n 's/^object=//p' "$BACKUP_MARKER")"
  fi
fi

section "Disk"
# A day of cache keeps the next deployment's build fast; what is older is the bulk of what fills the disk.
docker builder prune -f --filter until=6h >/dev/null 2>&1 || echo "Could not prune the build cache."
df -h / | tail -n 1

section "Result"
if [ "$failed" -eq 0 ]; then echo "VERIFICATION PASSED"; else echo "VERIFICATION FAILED"; fi
exit "$failed"
