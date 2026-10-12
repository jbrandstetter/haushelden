# Operations runbook

Governing: SPEC-0007 (REQ "Release and Deploy", "Container", "Backup and Restore", "Upgrades and Rollback",
"Logging"), SPEC-0001 (REQ "Self-Hosting", "Backups"), ADR-0004.

This repository holds the scripts and templates. The container, the provisioning code, the real values (paths,
hosts, secrets) and the monitoring live in the private homelab repository. This page names configuration
**keys** only (see `.env.example` and `deploy/haushelden.env.example`).

## What is where

| File                                                   | Purpose                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `scripts/backup.sh`                                    | Consistent snapshot to `HH_BACKUP_TARGET`, prunes by age     |
| `scripts/restore.sh`                                   | Restores a snapshot into a data directory                    |
| `scripts/deploy.sh`                                    | Installs a tagged release (backup, migrate, restart, health) |
| `deploy/haushelden.service`                            | systemd unit template (unprivileged user, restart in 3 s)    |
| `deploy/haushelden-backup.service` / `.timer`          | Nightly backup templates                                     |
| `deploy/journald-haushelden.conf`                      | 14-day journal retention                                     |
| `pb_hooks/request-log.pb.js`, `pb_hooks/lib/log.js`    | Structured request log                                       |

## Container

PocketBase runs as its own non-root service user, started by systemd from `deploy/haushelden.service`
(`Restart=always`, `RestartSec=3`, so a crashed process is back within 10 seconds and systemd records the exit in
the journal). It fits in 1 vCPU, 512 MB RAM and 4 GB disk. Exactly one PocketBase binary, the version in
`HH_PB_VERSION`, is installed (`scripts/pb-download.sh` verifies its checksum).

## Backups

`scripts/backup.sh` (run nightly by `deploy/haushelden-backup.timer`):

- copies `data.db` and `auxiliary.db` with the SQLite online backup (`sqlite3 .backup`), never a plain file copy,
  so a running server never produces a torn snapshot, and checks each copy with `PRAGMA integrity_check`;
- adds the `storage/` directory (uploaded files) and writes `haushelden-<UTC time>.tar.gz` to `HH_BACKUP_TARGET`
  (a directory path; the file appears only when complete);
- deletes `haushelden-*.tar.gz` older than `HH_BACKUP_RETENTION_DAYS` (default 14; SPEC-0001 wants at least 14);
- on failure (target unwritable, database missing) exits non-zero and logs one `level=error` line naming the key
  (for example `key=HH_BACKUP_TARGET`), never its value. The failed systemd unit and the monitoring alert for a
  stale backup (no new snapshot within 36 hours) are the signals; the alert itself is configured privately.

Requires the `sqlite3` command line tool in the container.

## Restore

1. Pick the snapshot (`haushelden-<time>.tar.gz`) in the backup target.
2. Stop the service if you restore over live data: `systemctl stop haushelden`.
3. `scripts/restore.sh <snapshot> <data-dir>`. It refuses a non-empty data directory. With `--force` it moves the
   existing files to `<data-dir>.before-restore-<UTC time>` (nothing is deleted) and restores.
4. Start the service and check `/api/health`; sign in and look at the data.

**Restore test (scratch).** Required before go-live, after each PocketBase upgrade and after each
schema-changing release. In a scratch container (or any scratch directory) run
`scripts/restore.sh <snapshot> <scratch-data-dir>`, start PocketBase against it on another port with the same
`pb_migrations`, `pb_hooks` and the pinned binary, and confirm yesterday's data is served. The live container is not
touched. `test/ops.test.js` automates this round trip against a throwaway PocketBase on every CI run.

**Rebuild after loss.** Provision a new container from the private repository, install the pinned version, run
`scripts/restore.sh` with the latest snapshot into the data directory, start the service. Accounts and enrolled
devices come back as of the backup time.

## Release and deploy

A release is a git tag (`vMAJOR.MINOR.PATCH`) on `main` after CI is green. There is no build step.

On the container, from the private provisioning code (or by hand), with the `HH_*` keys listed at the top of
`scripts/deploy.sh` in the environment:

```
git -C "$HH_SRC_DIR" fetch --tags
scripts/deploy.sh v1.0.1
```

`deploy.sh` takes a **pre-deploy backup first** (and aborts without changing anything if that fails), stops the
service, installs `app/`, `pb_migrations/` and `pb_hooks/` from the tag, applies migrations
(`pocketbase migrate up`), starts the service and polls `/api/health` for 30 seconds. Every step is logged as a
key=value line. A non-zero exit means the deploy needs attention; the pre-deploy backup is the newest snapshot in
the backup target.

## Rollback

- **Release without a migration:** `scripts/deploy.sh <previous tag>`.
- **Release with a migration** (or any doubt about the data): stop the service, redeploy the previous tag's files
  (`scripts/deploy.sh <previous tag>` would take a new backup of the already migrated data; if the migration is not
  reversible that is still fine, the restore below replaces it), then restore the pre-deploy backup:
  `scripts/restore.sh <pre-deploy snapshot> <data-dir> --force`, start the service, check `/api/health`. The
  household loses at most the changes made since that deploy. Choose the pre-deploy snapshot by its time (just
  before the `deploy started` log line).
- Destructive migrations are avoided; where one is unavoidable, the pre-deploy backup is the only way back, so
  verify it with a scratch restore before deploying.

## PocketBase upgrade

1. Read the PocketBase release notes for every version between the current and the target (breaking changes,
   migration notes).
2. In a scratch container: set `HH_PB_VERSION` to the target, `scripts/pb-download.sh`, restore the latest snapshot
   with `scripts/restore.sh`, start it with the committed `pb_migrations` and `pb_hooks`, run the test suite
   (`npm test`, `npm run test:rules`, `npm run smoke`) and click through sign-in and the kid board.
3. In the private repository change `HH_PB_VERSION` and re-provision: the pinned version is the only one
   installed. Take a manual backup first (`scripts/backup.sh`), then restart the service.
4. Repeat the scratch restore test with a snapshot written by the new version.
5. Rollback: reinstall the previous `HH_PB_VERSION` binary and restore the pre-upgrade snapshot (a newer
   PocketBase may have migrated its system tables).

## Logging

- The server writes one `key=value` line per API request to stdout (`pb_hooks/request-log.pb.js`), which systemd
  stores in the journal: `ts` (UTC, ISO 8601), `level`, `msg`, method, path, principal type, client address,
  status, duration. The static app files and `/api/health` are not logged.
- A failed sign-in logs `msg="sign-in failed"` with `auth_collection`, `client`, `status` and `reason`. Passwords,
  PINs, tokens, device secrets, request bodies and query strings are never written (the helper
  `pb_hooks/lib/log.js` redacts sensitive keys and `test/log.test.js` checks it).
- Rejected sync writes are logged by `pb_hooks/sync-log.pb.js` (PocketBase's own logger).
- Retention is 14 days: `deploy/journald-haushelden.conf` sets `MaxRetentionSec=14day` for the journal, and the
  hook sets PocketBase's own request log (in the admin UI) to 14 days.
- Note: the leading timestamp that PocketBase's process logger prepends to hook output uses the container's time
  zone; the `ts=` field inside the line is always UTC.
- Nothing is sent to a third party.
