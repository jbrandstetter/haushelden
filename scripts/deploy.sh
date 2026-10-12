#!/usr/bin/env bash
# Governing: ADR-0002 (reverse proxy in front), ADR-0004 (no real values here), SPEC-0007 REQ "Release and Deploy",
# REQ "Upgrades and Rollback", REQ "Container", REQ "Error Handling Standards"
#
# Usage: scripts/deploy.sh <tag>      (for example v1.0.1)
#
# Installs a tagged release into the container: pre-deploy backup, stop, install app/ pb_migrations/ pb_hooks/
# from the tag, apply migrations, start, wait for /api/health. Run it as the service user (or root) on the
# container, from the private provisioning code. A release is a git tag; there is no build step.
#
# Config keys: HH_SRC_DIR (git checkout of this repository, tags fetched), HH_INSTALL_DIR (where app/,
# pb_migrations/, pb_hooks/ live), HH_PB_BIN (pinned PocketBase binary), HH_DATA_DIR, HH_BACKUP_TARGET,
# HH_BACKUP_RETENTION_DAYS, HH_HEALTH_URL (default http://127.0.0.1:8090/api/health), HH_SERVICE (default
# haushelden), HH_STOP_CMD / HH_START_CMD (default systemctl stop|start "$HH_SERVICE").
# A failed health check exits non-zero and leaves the pre-deploy backup in place: see docs/operations/runbook.md.
set -uo pipefail

log() {
  local level="$1" msg="$2" out=2
  shift 2
  [ "$level" = info ] && out=1
  printf 'ts=%s level=%s component=deploy msg="%s"' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$msg"
  for kv in "$@"; do printf ' %s' "$kv"; done
  printf '\n'
} >&"$out"
die() { log error "$@"; exit 1; }

tag="${1:-}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { echo "usage: deploy.sh <tag, e.g. v1.0.1>" >&2; exit 64; }
for key in HH_SRC_DIR HH_INSTALL_DIR HH_PB_BIN HH_DATA_DIR; do
  [ -n "${!key:-}" ] || die "missing configuration" key="$key"
done
service="${HH_SERVICE:-haushelden}"
health="${HH_HEALTH_URL:-http://127.0.0.1:8090/api/health}"
stop_cmd="${HH_STOP_CMD:-systemctl stop $service}"
start_cmd="${HH_START_CMD:-systemctl start $service}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

git -C "$HH_SRC_DIR" rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null || die "tag not found" tag="$tag"
log info "deploy started" tag="$tag"

# 1. Pre-deploy backup, immediately before anything changes (REQ "Release and Deploy").
"$here/backup.sh" || die "pre-deploy backup failed; nothing was changed" tag="$tag"

# 2. Stage the tagged files next to the install dir so a failure leaves the running install untouched.
stage="$(mktemp -d "$HH_INSTALL_DIR.stage.XXXXXX")" || die "cannot create staging directory"
trap 'rm -rf "$stage"' EXIT
git -C "$HH_SRC_DIR" archive "$tag" app pb_migrations pb_hooks | tar -x -C "$stage" || die "export of the tag failed" tag="$tag"

# 3. Stop, swap in the new files, migrate, start.
bash -c "$stop_cmd" || die "stopping the service failed" service="$service"
mkdir -p "$HH_INSTALL_DIR"
for part in app pb_migrations pb_hooks; do
  rm -rf "$HH_INSTALL_DIR/$part"
  mv "$stage/$part" "$HH_INSTALL_DIR/$part" || die "installing files failed" part="$part"
done
"$HH_PB_BIN" migrate up --dir="$HH_DATA_DIR" --migrationsDir="$HH_INSTALL_DIR/pb_migrations" ||
  die "applying migrations failed; restore the pre-deploy backup (runbook)" tag="$tag"
log info "migrations applied" tag="$tag"
bash -c "$start_cmd" || die "starting the service failed" service="$service"

# 4. Health check.
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "$health" 2>/dev/null; then
    log info "deploy finished, service healthy" tag="$tag"
    exit 0
  fi
  sleep 1
done
die "service did not report healthy within 30 seconds; consider rollback (runbook)" tag="$tag"
