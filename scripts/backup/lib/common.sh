# shellcheck shell=bash
# Shared by backup.sh and restore-tenant.sh. Sourced, not executed.

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOG_TAG:-backup}" "$*" >&2; }
die() { local code=$1; shift; log "ERROR $*"; exit "$code"; }

# KEY=VALUE files are read, never sourced: a Mongo URI such as
# ...?replicaSet=rs0&authSource=admin would run as shell code otherwise.
# Variables already in the environment win. With allowed keys given, only
# those are taken (used for control-plane.env, which holds unrelated secrets).
load_env_file() {
  local file=$1; shift
  [ -r "$file" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    [[ $line =~ ^[[:space:]]*# ]] && continue
    [[ $line =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key=${BASH_REMATCH[1]}
    val=${BASH_REMATCH[2]}
    val=${val%"${val##*[![:space:]]}"}
    if [[ $val =~ ^\"(.*)\"$ ]] || [[ $val =~ ^\'(.*)\'$ ]]; then val=${BASH_REMATCH[1]}; fi
    if [ $# -gt 0 ] && [[ " $* " != *" $key "* ]]; then continue; fi
    [ -n "${!key+x}" ] && continue
    export "$key=$val"
  done < "$file"
}

load_config() {
  load_env_file "${BACKUP_ENV_FILE:-/etc/hitechpos/backup.env}"
  # Fall back to the control plane's own connection settings.
  load_env_file "${BACKUP_CONTROL_ENV_FILE:-/etc/hitechpos/control-plane.env}" CONTROL_URI CONTROL_DB TENANT_MONGO_URI
  export BACKUP_MONGO_URI=${BACKUP_MONGO_URI:-${CONTROL_URI:-}}
  export BACKUP_TENANT_MONGO_URI=${BACKUP_TENANT_MONGO_URI:-${TENANT_MONGO_URI:-$BACKUP_MONGO_URI}}
  export CONTROL_DB=${CONTROL_DB:-hitechpos_control}
  BACKUP_DIR=${BACKUP_DIR:-/var/backups/hitechpos}
  [ -n "$BACKUP_MONGO_URI" ] || die 64 "BACKUP_MONGO_URI (or CONTROL_URI) is not set"
  NODE=${NODE:-node}
  command -v "$NODE" >/dev/null 2>&1 || die 69 "node not found (set NODE=/path/to/node)"
}

# Locates a MongoDB Database Tool: MONGO_TOOLS_DIR first, then PATH.
find_tool() {
  local name=$1
  if [ -n "${MONGO_TOOLS_DIR:-}" ] && [ -x "$MONGO_TOOLS_DIR/$name" ]; then printf '%s\n' "$MONGO_TOOLS_DIR/$name"; return 0; fi
  command -v "$name" 2>/dev/null && return 0
  die 69 "$name not found. Install MongoDB Database Tools (https://www.mongodb.com/try/download/database-tools, package mongodb-database-tools) or set MONGO_TOOLS_DIR"
}

# The URI goes to the tools in a 0600 YAML file (--config), never on the
# command line where `ps` would show the password.
write_tool_config() {
  local uri=$1 file=$2
  local quoted=${uri//\'/\'\'}
  ( umask 077; printf "uri: '%s'\n" "$quoted" > "$file" )
}

# One lock for backup and restore: a restore never races a dump or a prune
# deleting the run it reads. BACKUP_LOCK_WAIT seconds (default 0) to wait.
take_lock() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR" 2>/dev/null || true
  LOCK_FILE=${BACKUP_LOCK_FILE:-$BACKUP_DIR/.lock}
  exec 9>>"$LOCK_FILE"
  flock -w "${BACKUP_LOCK_WAIT:-0}" 9 || die 75 "another backup or restore holds $LOCK_FILE; not starting"
}
