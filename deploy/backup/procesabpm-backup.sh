#!/usr/bin/env bash
# Daily backup of the ProcesaBPM database to S3 (docs/operations/backups.md). Run by procesabpm-backup.timer, or by hand:
#   sudo deploy/backup/procesabpm-backup.sh
#
# What it does, in order (any failure stops it with exit code 1, and nothing is marked as done):
#   1. pg_dump -Fc of the database (custom format: compressed, restorable table by table) and pg_dumpall --globals-only
#      (the roles the policies and grants name), both from inside the Postgres container;
#   2. checks the dump reads back (pg_restore --list) and writes a SHA-256 of each file;
#   3. uploads them to s3://<bucket>/<prefix>/<year>/<month>/ with server-side encryption. The instance role only needs
#      s3:PutObject on that prefix: this script never lists, reads nor deletes in the bucket (retention is a lifecycle rule);
#   4. writes the marker file (time, object key, size) that deploy/verify.sh checks, and removes the local copies older than
#      the newest BACKUP_LOCAL_KEEP.
#
# Settings come from the environment (the systemd unit reads /etc/procesabpm/backup.env):
#   BACKUP_S3_URI          required: s3://bucket/prefix (no trailing slash)
#   AWS_REGION             required: the bucket's region
#   BACKUP_SSE             AES256 (default) or aws:kms
#   BACKUP_KMS_KEY_ID      the KMS key, with BACKUP_SSE=aws:kms
#   BACKUP_COMPOSE_DIR     where the compose file lives            (default /opt/procesabpm)
#   COMPOSE_FILE           the compose file                        (default docker-compose.prod.example.yml)
#   ENV_FILE               the deployment's .env, if any           (default .env)
#   BACKUP_DB_CONTAINER    the Postgres container; found with `docker compose ps -q postgres` when empty
#   BACKUP_DB_NAME         the database                            (default procesabpm)
#   BACKUP_LOCAL_DIR       where the files are written first       (default /var/backups/procesabpm)
#   BACKUP_LOCAL_KEEP      local backups to keep, for a quick restore (default 2)
#   BACKUP_MARKER          the marker file                         (default /var/lib/procesabpm-backup/last-success)
#   BACKUP_AWS_IMAGE       the aws-cli image used when `aws` is not installed (default amazon/aws-cli:2.38.1)
set -euo pipefail

: "${BACKUP_S3_URI:?set BACKUP_S3_URI=s3://bucket/prefix}"
: "${AWS_REGION:?set AWS_REGION to the bucket region}"
BACKUP_SSE=${BACKUP_SSE:-AES256}
BACKUP_COMPOSE_DIR=${BACKUP_COMPOSE_DIR:-/opt/procesabpm}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.example.yml}
ENV_FILE=${ENV_FILE:-.env}
BACKUP_DB_NAME=${BACKUP_DB_NAME:-procesabpm}
BACKUP_LOCAL_DIR=${BACKUP_LOCAL_DIR:-/var/backups/procesabpm}
BACKUP_LOCAL_KEEP=${BACKUP_LOCAL_KEEP:-2}
BACKUP_MARKER=${BACKUP_MARKER:-/var/lib/procesabpm-backup/last-success}
BACKUP_AWS_IMAGE=${BACKUP_AWS_IMAGE:-amazon/aws-cli:2.38.1}

case "$BACKUP_S3_URI" in s3://?*/?*) ;; *) echo "BACKUP_S3_URI must look like s3://bucket/prefix" >&2; exit 2 ;; esac
case "$BACKUP_SSE" in AES256) ;; aws:kms) : "${BACKUP_KMS_KEY_ID:?set BACKUP_KMS_KEY_ID with BACKUP_SSE=aws:kms}" ;; *) echo "BACKUP_SSE must be AES256 or aws:kms" >&2; exit 2 ;; esac

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

db_container() {
  if [ -n "${BACKUP_DB_CONTAINER:-}" ]; then echo "$BACKUP_DB_CONTAINER"; return; fi
  local env_args=()
  [ -f "$BACKUP_COMPOSE_DIR/$ENV_FILE" ] && env_args=(--env-file "$BACKUP_COMPOSE_DIR/$ENV_FILE")
  (cd "$BACKUP_COMPOSE_DIR" && docker compose "${env_args[@]}" -f "$COMPOSE_FILE" ps -q postgres)
}

# The AWS CLI on the host, or the pinned image on the host network (so it reaches the instance role's credentials with the
# default IMDSv2 hop limit of 1). Only the backup directory is mounted, read-only. Off AWS (no instance role), the keys of
# a write-only IAM user in backup.env are passed through.
aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    aws "$@"
  else
    docker run --rm --network host -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
      -v "$BACKUP_LOCAL_DIR:$BACKUP_LOCAL_DIR:ro" "$BACKUP_AWS_IMAGE" "$@"
  fi
}

upload() { # local file, object key
  local sse_args=(--sse "$BACKUP_SSE")
  [ "$BACKUP_SSE" = aws:kms ] && sse_args+=(--sse-kms-key-id "$BACKUP_KMS_KEY_ID")
  aws_cli s3 cp "$1" "$BACKUP_S3_URI/$2" "${sse_args[@]}" --only-show-errors --no-progress
}

container=$(db_container)
[ -n "$container" ] || { echo "The Postgres container is not running" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_LOCAL_DIR" "$(dirname "$BACKUP_MARKER")"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$BACKUP_LOCAL_DIR/procesabpm-$stamp.dump"
globals="$BACKUP_LOCAL_DIR/procesabpm-$stamp.globals.sql"
trap 'rm -f "$dump.partial" "$globals.partial"' EXIT

log "dumping database $BACKUP_DB_NAME from container ${container:0:12}"
# The image's POSTGRES_USER is the cluster superuser: it reads every row, row-level security included.
docker exec -i "$container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc -Z 6' sh "$BACKUP_DB_NAME" >"$dump.partial"
docker exec -i "$container" sh -c 'exec pg_dumpall -U "$POSTGRES_USER" --globals-only' >"$globals.partial"

log "checking the dump reads back"
entries=$(docker exec -i "$container" pg_restore --list <"$dump.partial" | grep -cv '^;' || true)
[ "$entries" -gt 0 ] || { echo "The dump has no entries" >&2; exit 1; }
mv "$dump.partial" "$dump"
mv "$globals.partial" "$globals"
(cd "$BACKUP_LOCAL_DIR" && sha256sum "$(basename "$dump")" >"$dump.sha256" && sha256sum "$(basename "$globals")" >"$globals.sha256")

key_prefix="$(date -u +%Y)/$(date -u +%m)"
log "uploading to $BACKUP_S3_URI/$key_prefix/ ($(du -h "$dump" | cut -f1), $entries entries)"
for file in "$globals" "$globals.sha256" "$dump.sha256" "$dump"; do
  upload "$file" "$key_prefix/$(basename "$file")"
done

printf 'completed_at=%s\nobject=%s/%s/%s\nbytes=%s\nentries=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BACKUP_S3_URI" "$key_prefix" "$(basename "$dump")" "$(stat -c %s "$dump")" "$entries" >"$BACKUP_MARKER.tmp"
mv "$BACKUP_MARKER.tmp" "$BACKUP_MARKER"

# Local copies: the newest BACKUP_LOCAL_KEEP stay for a quick restore; the bucket keeps the history.
mapfile -t old < <(ls -1t "$BACKUP_LOCAL_DIR"/procesabpm-*.dump 2>/dev/null | tail -n +"$((BACKUP_LOCAL_KEEP + 1))")
for file in "${old[@]}"; do
  base=${file%.dump}
  rm -f "$file" "$file.sha256" "$base.globals.sql" "$base.globals.sql.sha256"
done
log "backup done: $BACKUP_S3_URI/$key_prefix/$(basename "$dump")"
