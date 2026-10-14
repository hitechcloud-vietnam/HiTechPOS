#!/usr/bin/env bash
# Restores ONE shop database from a backup run made by backup.sh.
#
#   restore-tenant.sh <shop> [--from <run|dir>] [--to-db <name>] [--drop] [--yes] [--dry-run]
#
#   <shop>        subdomain, tenant id or database name (hitech_t_<shop>)
#   --from        run name (20261014T190000Z) or run directory; default: newest complete run
#   --to-db       restore side by side into another database (default: the shop's own
#                 database, which needs --yes and replaces its collections)
#   --drop        with --to-db: allow overwriting collections that already exist there
#   --dry-run     check everything and let mongorestore do a dry run; writes nothing
#
# The archive is verified (SHA256SUMS + collection list) before anything is
# written. The control database (tenant record, secrets, plan) is never
# touched. Suspend the shop first when restoring in place
# (POST /api/admin/tenants/:id/suspend) and resume it afterwards.
#
# Exit codes: 0 ok, 1 restore or check failed, 3 target not empty, 64 usage,
# 69 missing tool, 75 locked.
set -Eeuo pipefail
umask 077
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"
export LOG_TAG=restore
CLI="$HERE/lib/cli.js"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
SHOP=""
FROM=""
TO_DB=""
DROP=0
YES=0
DRY=0
while [ $# -gt 0 ]; do
  case $1 in
    --from) [ $# -ge 2 ] || usage; FROM=$2; shift 2 ;;
    --from=*) FROM=${1#*=}; shift ;;
    --to-db) [ $# -ge 2 ] || usage; TO_DB=$2; shift 2 ;;
    --to-db=*) TO_DB=${1#*=}; shift ;;
    --drop) DROP=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [ -z "$SHOP" ] || usage; SHOP=$1; shift ;;
  esac
done
[ -n "$SHOP" ] || usage

load_config
take_lock
MONGORESTORE=$(find_tool mongorestore)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

"$NODE" "$CLI" find "$BACKUP_DIR" "$SHOP" ${FROM:+--from "$FROM"} > "$TMP/found.tsv"
IFS=$'\t' read -r RUN_DIR SRC_DB ARCHIVE SUBDOMAIN < "$TMP/found.tsv"
TARGET=${TO_DB:-$SRC_DB}
log "shop ${SUBDOMAIN:-?}: $SRC_DB from $(basename "$RUN_DIR") -> $TARGET"

if [ "$TARGET" = "$SRC_DB" ]; then
  [ "$YES" = 1 ] || [ "$DRY" = 1 ] || die 64 "restoring over the live database $SRC_DB replaces its collections; re-run with --yes (or use --to-db to restore side by side)"
  DROP=1
fi

"$NODE" "$CLI" verify "$RUN_DIR" --db "$SRC_DB"
check_args=()
[ "$DROP" = 1 ] && check_args+=(--drop)
"$NODE" "$CLI" target-check "$TARGET" "$SRC_DB" "${check_args[@]}"

write_tool_config "$BACKUP_TENANT_MONGO_URI" "$TMP/tenant.yaml"
args=(--config="$TMP/tenant.yaml" --archive="$ARCHIVE" --gzip --nsInclude="$SRC_DB.*" --stopOnError)
[ "$TARGET" != "$SRC_DB" ] && args+=(--nsFrom="$SRC_DB.*" --nsTo="$TARGET.*")
[ "$DROP" = 1 ] && args+=(--drop)
[ "$DRY" = 1 ] && args+=(--dryRun)

t0=$(date +%s)
if ! "$MONGORESTORE" "${args[@]}" ${MONGORESTORE_EXTRA_ARGS:-} 2> "$TMP/restore.err"; then
  log "ERROR mongorestore failed:"
  sed 's/^/    /' "$TMP/restore.err" | tail -n 20 >&2
  exit 1
fi
grep -E 'document\(s\) restored|finished restoring' "$TMP/restore.err" | tail -n 1 | sed 's/^[^	]*	/    /' >&2 || true
if [ "$DRY" = 1 ]; then
  log "dry run ok: nothing written"
  exit 0
fi
"$NODE" "$CLI" counts "$RUN_DIR" "$SRC_DB" "$TARGET"
log "done in $(( $(date +%s) - t0 ))s"
if [ "$TARGET" = "$SRC_DB" ]; then
  log "restored in place; resume the shop if it was suspended for the restore"
else
  log "restored side by side into $TARGET; drop it when finished (it is not served by the shard)"
fi
