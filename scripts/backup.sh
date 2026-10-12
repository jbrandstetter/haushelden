#!/usr/bin/env bash
# Governing: ADR-0001 (PocketBase stores data in SQLite), ADR-0004 (no real values in this repository),
# SPEC-0007 REQ "Backup and Restore", REQ "Error Handling Standards", SPEC-0001 REQ "Backups"
#
# Writes one consistent snapshot of the data directory to $HH_BACKUP_TARGET and deletes snapshots older than
# $HH_BACKUP_RETENTION_DAYS. The databases are copied with the SQLite online backup (never a plain copy of a
# live database file), the snapshot is verified, and it appears in the target only when complete.
#
# Config keys: HH_BACKUP_TARGET (directory, required), HH_DATA_DIR (default ./pb_data),
# HH_BACKUP_RETENTION_DAYS (default 14). Needs the sqlite3 command line tool.
# Output: one key=value line per event on stdout (info) or stderr (error), UTC timestamps. Exit 0 on success.
set -uo pipefail

log() { # level message [key=value ...]
  local level="$1" msg="$2" out=2
  shift 2
  [ "$level" = info ] && out=1
  printf 'ts=%s level=%s component=backup msg="%s"' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$msg"
  for kv in "$@"; do printf ' %s' "$kv"; done
  printf '\n'
} >&"$out"

fail() { # message [key=value ...]
  local msg="$1"
  shift
  log error "$msg" "$@"
  exit 1
}

data_dir="${HH_DATA_DIR:-./pb_data}"
target="${HH_BACKUP_TARGET:-}"
retention="${HH_BACKUP_RETENTION_DAYS:-14}"

# Only the key is logged, never its value: the target may contain credentials (SPEC-0007 Error Handling).
case "$target" in
  "" | change-me*) fail "backup target not configured" key=HH_BACKUP_TARGET ;;
  *://*) fail "backup target must be a directory path" key=HH_BACKUP_TARGET ;;
esac
case "$retention" in
  "" | *[!0-9]* | 0) fail "retention must be a positive number of days" key=HH_BACKUP_RETENTION_DAYS ;;
esac
command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 command not found" tool=sqlite3
[ -f "$data_dir/data.db" ] || fail "no database in the data directory" key=HH_DATA_DIR

mkdir -p "$target" 2>/dev/null || fail "backup target is not writable" key=HH_BACKUP_TARGET
stage="$(mktemp -d "$target/.staging.XXXXXX" 2>/dev/null)" || fail "backup target is not writable" key=HH_BACKUP_TARGET
trap 'rm -rf "$stage"' EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="haushelden-$stamp.tar.gz"
mkdir "$stage/data"

for db in data.db auxiliary.db; do
  [ -f "$data_dir/$db" ] || continue
  sqlite3 "$data_dir/$db" ".timeout 10000" ".backup '$stage/data/$db'" 2>/dev/null ||
    fail "sqlite online backup failed" db="$db"
  check="$(sqlite3 "$stage/data/$db" "PRAGMA integrity_check;" 2>/dev/null)"
  [ "$check" = ok ] || fail "snapshot failed its integrity check" db="$db"
done
# Uploaded files (PocketBase file fields). Not consistent with the DB to the millisecond, but append-only.
[ -d "$data_dir/storage" ] && cp -R "$data_dir/storage" "$stage/data/storage"

tar -C "$stage/data" -czf "$stage/$name" . 2>/dev/null || fail "writing the snapshot archive failed"
mv "$stage/$name" "$target/$name" 2>/dev/null || fail "backup target is not writable" key=HH_BACKUP_TARGET
bytes="$(wc -c <"$target/$name" | tr -d ' ')"
log info "backup written" file="$name" bytes="$bytes"

# Prune by age; only files this script created are ever considered.
pruned=0
while IFS= read -r old; do
  rm -f "$old" && pruned=$((pruned + 1))
done < <(find "$target" -maxdepth 1 -type f -name 'haushelden-*.tar.gz' -mtime +"$retention")
log info "retention applied" pruned="$pruned" retention_days="$retention"
