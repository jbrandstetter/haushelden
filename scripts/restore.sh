#!/usr/bin/env bash
# Governing: ADR-0001, ADR-0004, SPEC-0007 REQ "Backup and Restore", REQ "Upgrades and Rollback",
# SPEC-0001 REQ "Backups", REQ "Self-Hosting" (rebuild from provisioning plus the latest backup)
#
# Usage: scripts/restore.sh <snapshot.tar.gz> <data-dir> [--force]
#
# Restores a snapshot written by scripts/backup.sh into <data-dir>. A data directory that already holds files
# is refused unless --force is given; with --force the existing files are moved to a sibling directory
# "<data-dir>.before-restore-<UTC time>" first, never deleted. Stop PocketBase before restoring over live data.
set -uo pipefail

log() {
  local level="$1" msg="$2" out=2
  shift 2
  [ "$level" = info ] && out=1
  printf 'ts=%s level=%s component=restore msg="%s"' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$msg"
  for kv in "$@"; do printf ' %s' "$kv"; done
  printf '\n'
} >&"$out"

snapshot="${1:-}"
dest="${2:-}"
force="${3:-}"
if [ -z "$snapshot" ] || [ -z "$dest" ] || { [ -n "$force" ] && [ "$force" != "--force" ]; }; then
  echo "usage: restore.sh <snapshot.tar.gz> <data-dir> [--force]" >&2
  exit 64
fi
[ -f "$snapshot" ] || { log error "snapshot not found"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { log error "sqlite3 command not found" tool=sqlite3; exit 1; }

if [ -d "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ] && [ "$force" != "--force" ]; then
  log error "data directory is not empty; refusing to overwrite (use --force)"
  exit 2
fi

parent="$(dirname "$dest")"
mkdir -p "$parent" || { log error "cannot create parent of data directory"; exit 1; }
stage="$(mktemp -d "$parent/.restore.XXXXXX")" || { log error "cannot create staging directory"; exit 1; }
trap 'rm -rf "$stage"' EXIT

tar -C "$stage" -xzf "$snapshot" 2>/dev/null || { log error "snapshot is not a readable archive"; exit 1; }
[ -f "$stage/data.db" ] || { log error "snapshot contains no data.db"; exit 1; }
for db in data.db auxiliary.db; do
  [ -f "$stage/$db" ] || continue
  [ "$(sqlite3 "$stage/$db" "PRAGMA integrity_check;" 2>/dev/null)" = ok ] || {
    log error "snapshot failed its integrity check" db="$db"
    exit 1
  }
done

mkdir -p "$dest"
if [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
  aside="$dest.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir "$aside" || { log error "cannot create the aside directory"; exit 1; }
  mv "$dest"/* "$dest"/.[!.]* "$aside"/ 2>/dev/null
  log info "existing data moved aside" aside="$(basename "$aside")"
fi
mv "$stage"/* "$dest"/ || { log error "moving the restored files failed"; exit 1; }
log info "restore complete"
