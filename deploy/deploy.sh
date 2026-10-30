#!/usr/bin/env bash
# Deploys one release on the server (docs/despliegue.md §13): the images CI built and pushed to the registry for a commit.
# The Deploy workflow runs it through AWS Systems Manager after CI passes on main; it can also be run by hand:
#   deploy/deploy.sh <full commit sha>
#
# It never builds: it checks out the commit (for the compose file and the scripts), pulls its images, upgrades in the
# documented order (the old worker stops before the migrations run), and verifies. If the verification fails it goes back
# to the previous release (the migrations stay: they are written to be compatible with the previous code). On success it
# frees the disk: images no container uses (the registry keeps every recent release) and any build cache.
#
# Environment (all optional): COMPOSE_FILE (docker-compose.prod.example.yml), ENV_FILE (.env, which must hold
# IMAGE_PREFIX, the registry, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/).
set -euo pipefail

cd "$(dirname "$0")/.."
release=${1:-}
if [[ ! $release =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy/deploy.sh <full commit sha>" >&2
  exit 2
fi
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.example.yml}
ENV_FILE=${ENV_FILE:-.env}
STATE_DIR=.deploy
IMAGES=(migrate api worker web landing)

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || { echo "Another deployment is running." >&2; exit 3; }

prefix=$(sed -n 's/^IMAGE_PREFIX=//p' "$ENV_FILE" | tail -n 1)
if [ -z "$prefix" ]; then
  echo "IMAGE_PREFIX is not set in $ENV_FILE: the registry the images come from (docs/despliegue.md §13)." >&2
  exit 2
fi
previous=$(cat "$STATE_DIR/current" 2>/dev/null || true)

section() { echo; echo "== $*"; }
compose() { IMAGE_TAG=$tag docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Checks out a release and starts its images, in the upgrade order of the compose file.
start() {
  tag=$1
  section "Code at ${tag:0:7}"
  git fetch -q origin
  git checkout -q --detach "$tag"
  section "Images ${tag:0:7}"
  compose pull --quiet "${IMAGES[@]}"
  section "Upgrade"
  compose stop worker
  compose run --rm migrate
  compose up -d --no-build --remove-orphans
  wait_healthy
}

# The API answers its health check some seconds after it starts (start period 30 s): verifying before that fails a good release.
wait_healthy() {
  local container
  container=$(compose ps -q api)
  for _ in $(seq 1 60); do
    [ "$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null)" = healthy ] && return 0
    sleep 3
  done
  echo "The API did not report healthy within 3 minutes." >&2
  return 1
}

verify() {
  IMAGE_TAG=$1 COMPOSE_FILE=$COMPOSE_FILE ENV_FILE=$ENV_FILE deploy/verify.sh --skip-unit
}

start "$release"
if ! verify "$release"; then
  if [ -z "$previous" ] || [ "$previous" = "$release" ]; then
    echo "VERIFICATION FAILED and there is no previous release to go back to." >&2
    exit 1
  fi
  section "Going back to ${previous:0:7}"
  start "$previous"
  verify "$previous" || echo "The previous release does not verify either: look at it by hand." >&2
  echo "DEPLOYMENT FAILED: ${release:0:7} did not verify; ${previous:0:7} is running again." >&2
  exit 1
fi

# The tag the compose file falls back to, so a manual `docker compose up -d` runs this release instead of building one.
for image in "${IMAGES[@]}"; do docker tag "${prefix}procesabpm-${image}:${release}" "${prefix}procesabpm-${image}:latest"; done
echo "$release" >"$STATE_DIR/current"
echo "$(date -u +%FT%TZ) $release" >>"$STATE_DIR/history"

section "Disk"
docker image prune -af >/dev/null
docker builder prune -af >/dev/null 2>&1 || true
df -h / | tail -n 1
echo
echo "DEPLOYED ${release:0:7}"
