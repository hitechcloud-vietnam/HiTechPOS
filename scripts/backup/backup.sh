#!/usr/bin/env bash
# HiTechPOS backup: one gzip mongodump archive per shop database plus the
# control database, in a timestamped run directory:
#
#   $BACKUP_DIR/20261014T190000Z/
#     manifest.json              shops, databases, expected collections, verification
#     hitechpos_control.archive.gz
#     hitech_t_<shop>.archive.gz ...
#     SHA256SUMS                 (sha256sum -c compatible)
#
# Steps: lock -> plan (list shops from the control DB) -> mongodump each DB ->
# verify every archive lists the expected collections -> publish the run ->
# optional upload (aws s3 / rclone) -> retention. A failed run is left as
# <run>.failed and the script exits non-zero.
#
# Configuration (environment, or KEY=VALUE lines in /etc/hitechpos/backup.env;
# CONTROL_URI/CONTROL_DB/TENANT_MONGO_URI are also read from
# /etc/hitechpos/control-plane.env): see docs/DEPLOYMENT.md "Sao lưu & khôi phục"
# and deploy/backup.env.example.
#
# Exit codes: 0 ok, 1 a database failed or verification failed, 2 upload
# failed (local backup is good), 64 configuration, 69 missing tool, 75 locked.
set -Eeuo pipefail
umask 077
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
export LOG_TAG=backup
CLI="$HERE/lib/cli.js"

usage() { echo "usage: $0 [--no-upload] [--no-prune]" >&2; exit 64; }
UPLOAD=1
PRUNE=1
for a in "$@"; do
  case $a in
    --no-upload) UPLOAD=0 ;;
    --no-prune) PRUNE=0 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

load_config
take_lock
MONGODUMP=$(find_tool mongodump)

if [ -n "${BACKUP_S3_URI:-}" ] && [ "$UPLOAD" = 1 ] && ! command -v aws >/dev/null 2>&1; then
  die 69 "BACKUP_S3_URI is set but the aws CLI is not installed"
fi
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && [ "$UPLOAD" = 1 ] && ! command -v rclone >/dev/null 2>&1; then
  die 69 "BACKUP_RCLONE_REMOTE is set but rclone is not installed"
fi

RUN=$(date -u +%Y%m%dT%H%M%SZ)
WORK="$BACKUP_DIR/$RUN.partial"
FINAL="$BACKUP_DIR/$RUN"
[ -e "$FINAL" ] && die 75 "$FINAL already exists"
mkdir -p "$WORK"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
fail_run() {
  trap - ERR
  [ -d "$WORK" ] && mv "$WORK" "$BACKUP_DIR/$RUN.failed"
  die 1 "run $RUN FAILED: $*; kept as $RUN.failed"
}
# set -E hands the trap to command substitutions too; act only in the main shell.
on_error() { [ "$BASHPID" = "$$" ] || return 0; fail_run "unexpected error at line $1"; }
trap 'on_error $LINENO' ERR

write_tool_config "$BACKUP_MONGO_URI" "$TMP/control.yaml"
write_tool_config "$BACKUP_TENANT_MONGO_URI" "$TMP/tenant.yaml"

started=$(date +%s)
tool_version=$("$MONGODUMP" --version 2>/dev/null || true)
tool_version=${tool_version%%$'\n'*}
log "run $RUN -> $BACKUP_DIR (mongodump ${tool_version##* })"
"$NODE" "$CLI" plan "$WORK" --name "$RUN" > "$TMP/plan.tsv" || fail_run "could not list the databases to back up"

failed=0
total=0
while IFS=$'\t' read -r kind db archive; do
  [ -n "$db" ] || continue
  total=$((total + 1))
  cfg="$TMP/tenant.yaml"
  [ "$kind" = control ] && cfg="$TMP/control.yaml"
  t0=$(date +%s)
  if "$MONGODUMP" --config="$cfg" --db="$db" --archive="$WORK/$archive" --gzip --quiet ${MONGODUMP_EXTRA_ARGS:-} 2> "$TMP/dump.err" && [ -s "$WORK/$archive" ]; then
    log "dumped $db ($(du -h "$WORK/$archive" | cut -f1), $(( $(date +%s) - t0 ))s)"
  else
    failed=$((failed + 1))
    rm -f "$WORK/$archive"
    log "ERROR mongodump failed for $db:"
    sed 's/^/    /' "$TMP/dump.err" | tail -n 20 >&2
  fi
done < "$TMP/plan.tsv"

verified=1
"$NODE" "$CLI" verify "$WORK" --write || verified=0

if [ "$failed" -gt 0 ] || [ "$verified" = 0 ]; then
  fail_run "$failed of $total dump(s) failed, verification $([ "$verified" = 1 ] && echo ok || echo failed)"
fi
mv "$WORK" "$FINAL"
trap - ERR
log "run $RUN complete: $total database(s), $(du -sh "$FINAL" | cut -f1), $(( $(date +%s) - started ))s"

status=0
if [ "$UPLOAD" = 1 ] && [ -n "${BACKUP_S3_URI:-}" ]; then
  dest="${BACKUP_S3_URI%/}/$RUN/"
  log "uploading to ${BACKUP_S3_URI%%://*}://… (aws s3)"
  if aws s3 cp --recursive --only-show-errors ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} ${BACKUP_S3_EXTRA_ARGS:-} "$FINAL" "$dest"; then
    log "uploaded $RUN"
  else
    log "ERROR upload to S3 failed; the local run $RUN is complete"
    status=2
  fi
fi
if [ "$UPLOAD" = 1 ] && [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  log "uploading with rclone"
  if rclone copy ${BACKUP_RCLONE_EXTRA_ARGS:-} "$FINAL" "${BACKUP_RCLONE_REMOTE%/}/$RUN"; then
    log "uploaded $RUN (rclone)"
  else
    log "ERROR rclone upload failed; the local run $RUN is complete"
    status=2
  fi
fi

if [ "$PRUNE" = 1 ]; then
  "$NODE" "$CLI" prune "$BACKUP_DIR" || { log "ERROR retention failed"; [ "$status" = 0 ] && status=1; }
fi
exit "$status"
