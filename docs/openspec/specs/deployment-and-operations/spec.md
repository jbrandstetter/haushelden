---
status: draft
date: 2026-10-11
implements: [ADR-0001, ADR-0002, ADR-0004]
requires: [SPEC-0001]
---

# SPEC-0007: Deployment and Operations

## Graph Edges

- **Implements:** [ADR-0001](../../../adrs/ADR-0001-pocketbase-as-backend.md) — PocketBase as the household backend
- **Implements:** [ADR-0002](../../../adrs/ADR-0002-remote-access-via-reverse-proxy.md) — reverse proxy and configured hostname
- **Implements:** [ADR-0004](../../../adrs/ADR-0004-configuration-outside-public-repo.md) — configuration lives in the private homelab repository
- **Requires:** [SPEC-0001](../household-platform/spec.md) — the platform being deployed, its security baseline and backup requirement

## Overview

How Haushelden is laid out in this repository, configured, run locally, released, deployed into the homelab, exposed
through the reverse proxy, monitored, backed up and rolled back. This repository holds the application and names the
configuration keys; the values (hostnames, addresses, targets, secrets) live only in the private homelab
infrastructure repository (ADR-0004). All requirements are in scope for v1.

## Requirements

### Requirement: Repository Layout

The repository MUST keep the production application separate from the prototype: `app/` for the PWA served by
PocketBase, `pb_migrations/` for the schema as PocketBase migrations, `pb_hooks/` for server-side hooks and custom
routes, `docs/` for ADRs and specs, and `.env.example` listing every configuration key with placeholder values. The
prototype MUST stay at the repository root until v1 replaces it, so GitHub Pages keeps serving it.

#### Scenario: Fresh clone

- **WHEN** an implementer clones the repository
- **THEN** they find the prototype at the root, the v1 app in `app/`, and every configuration key in `.env.example`
  with a placeholder value

### Requirement: Configuration Keys

The application MUST read all deployment-specific values from environment variables (or an env file) with the keys
below, and MUST NOT contain real values for them anywhere in the repository, its examples or its history. Missing
required keys MUST stop startup with a message naming the key.

| Key | Required | Meaning |
|-----|----------|---------|
| `HH_PUBLIC_URL` | yes | Public base URL behind the reverse proxy (used for invite links and CORS) |
| `HH_MODE` | no (default `development`) | `development` or `production`; production mode enforces the required keys below and rejects values still starting with `change-me` |
| `HH_TZ` | no (default `Europe/Berlin`) | Household time zone (SPEC-0001 "Household Day and Time Zone") |
| `HH_DATA_DIR` | no (default `./pb_data`) | PocketBase data directory |
| `HH_LISTEN` | no (default `127.0.0.1:8090`) | Address PocketBase listens on |
| `HH_SETUP_TOKEN` | yes on a fresh install | One-time token for first-run setup (SPEC-0001) |
| `HH_BACKUP_TARGET` | yes in production | Where nightly backups are written (path or URL of the internal backup target) |
| `HH_BACKUP_RETENTION_DAYS` | no (default `14`) | Number of daily backups kept |
| `HH_PB_VERSION` | yes in production | Pinned PocketBase version |
| `HH_DEV_ADMIN_EMAIL`, `HH_DEV_ADMIN_PASSWORD` | development only | Fake local superuser created by the local start script and used by the seed script; ignored in production |
| `HH_CALDAV_URL`, `HH_CALDAV_USER`, `HH_CALDAV_PASSWORD` | later | Family calendar source (SPEC-0004, later) |
| `HH_ASSISTANT_TOKEN`, `HH_LLM_ENDPOINT` | later | Household assistant (SPEC-0006, later) |

#### Scenario: Missing public URL

- **WHEN** the server starts in production mode without `HH_PUBLIC_URL`
- **THEN** it exits with "missing configuration: HH_PUBLIC_URL"

#### Scenario: Example value left in place

- **WHEN** the server starts in production mode and a required key still has its `.env.example` placeholder (`change-me…`)
- **THEN** it exits with "placeholder configuration: {KEY} still has the example value"

#### Scenario: No real values in the repo

- **WHEN** the repository is searched for the household's real hostname, internal addresses or the backup target
- **THEN** no match is found

### Requirement: Local Development

An implementer MUST be able to run the full app on a laptop with one documented command, using a local PocketBase, the
committed migrations and hooks, and a seed script that creates a fake household (two parents, two kids, sample routines,
to-dos, areas, lists and purchase history) with obviously fake names. No homelab access MUST be needed for development.

#### Scenario: First run on a laptop

- **WHEN** an implementer copies `.env.example` to `.env`, runs the documented start command and the seed script
- **THEN** the app opens locally with the fake household and every v1 screen works

### Requirement: Release and Deploy

A release MUST be a git tag in this repository. Deployment MUST install the tagged `app/`, `pb_migrations/` and
`pb_hooks/` into the container, apply migrations, and restart PocketBase, driven by the provisioning code in the private
homelab repository. Deployment MUST take a backup immediately before applying migrations.

#### Scenario: Deploying a release

- **WHEN** the maintainer deploys tag `v1.0.1`
- **THEN** a pre-deploy backup exists, migrations are applied, the service restarts, and `/api/health` reports healthy

### Requirement: Container

PocketBase MUST run as an unprivileged LXC in the homelab with its own non-root service user, managed by the init
system with automatic restart, and SHOULD fit in 1 vCPU, 512 MB RAM and 4 GB disk. The pinned PocketBase version
(`HH_PB_VERSION`) MUST be the only version installed.

#### Scenario: Crash

- **WHEN** the PocketBase process exits unexpectedly
- **THEN** it is restarted within 10 seconds and the event is logged

### Requirement: Reverse Proxy

The homelab reverse proxy MUST terminate TLS for `HH_PUBLIC_URL` with a certificate trusted by stock iOS, forward to
`HH_LISTEN`, pass realtime (server-sent events) without buffering, refuse the admin UI path `/_/` from outside the
LAN, enforce the body-size and auth rate limits of SPEC-0001, and add the SPEC-0001 security headers if PocketBase does
not. The proxy site MUST be defined in the private homelab repository.

#### Scenario: Live updates through the proxy

- **WHEN** two phones use the public hostname and one adds a shopping item
- **THEN** the other sees it within 5 seconds (no proxy buffering of the realtime stream)

#### Scenario: Admin UI blocked

- **WHEN** `/_/` is requested through the public hostname from outside the LAN
- **THEN** the proxy returns 403

### Requirement: Go-Live Checklist

The public hostname MUST NOT be published (DNS record, port forward) until all of these pass against the deployed
system: every household data endpoint returns 401 without a token; sign-in rate limiting triggers after 5 failures;
`/_/` is blocked from outside; the setup token is invalid after first-run setup; a restore test has succeeded; and an
iPhone on mobile data installs the PWA and syncs.

#### Scenario: Checklist incomplete

- **WHEN** the restore test has not been run
- **THEN** the hostname stays unpublished

### Requirement: Backup and Restore

A nightly job MUST write a consistent snapshot of the data directory (PocketBase backup or SQLite online backup, never a
plain copy of a live database file) to `HH_BACKUP_TARGET` and delete snapshots older than
`HH_BACKUP_RETENTION_DAYS`. A written restore procedure MUST exist in this repository and MUST be exercised before
go-live and after each PocketBase upgrade or schema-changing release.

#### Scenario: Nightly backup

- **WHEN** the nightly job runs
- **THEN** a new snapshot exists at the backup target and the oldest beyond retention is removed

### Requirement: Monitoring

The existing homelab monitoring MUST probe `/api/health` and alert the maintainer when it fails for 5 minutes, and MUST
alert when the latest backup is older than 36 hours.

#### Scenario: Backup job broken

- **WHEN** no backup has been written for 36 hours
- **THEN** the maintainer receives an alert

### Requirement: Upgrades and Rollback

PocketBase upgrades MUST be done by changing `HH_PB_VERSION`, after reading the release notes, with a restore test on a
scratch container first. Rolling back an application release MUST be possible by redeploying the previous tag; when the
release included a migration, rollback MUST restore the pre-deploy backup.

#### Scenario: Bad release

- **WHEN** release `v1.2.0` with a migration breaks the kid board
- **THEN** the maintainer redeploys `v1.1.x` and restores the pre-deploy backup, and the family loses at most the
  changes made since that deploy

### Requirement: Logging

The server MUST log in a structured format (key-value or JSON) with timestamps in UTC, MUST NOT log passwords, PINs,
tokens, device secrets or full request bodies, and MUST retain logs for 14 days.

#### Scenario: Failed sign-in

- **WHEN** a sign-in fails
- **THEN** the log records time, auth collection, client address and reason, but not the password

### Requirement: Error Handling Standards

All error-producing operations MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary (e.g., "failed to create user: database insert failed: connection refused")
- Sentinel errors MUST be defined for domain-specific failure modes that callers need to distinguish programmatically
- Silent error swallowing MUST NOT occur — every error MUST be either returned to the caller, logged with sufficient context, or explicitly handled with a documented reason for suppression
- Structured logging MUST be used for error reporting (key-value pairs, not string interpolation)

#### Scenario: Backup target unreachable

- **WHEN** the nightly job cannot write to the backup target
- **THEN** the job exits non-zero, logs the target key (not its value in plain text if it contains credentials) and the
  error, and the monitoring alert for stale backups fires within 36 hours

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements";
this spec adds where each control is enforced in the deployment.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication". Additionally the admin UI `/_/` MUST be reachable only from
the LAN, and the PocketBase superuser credentials MUST be stored only in the private homelab repository's vault.

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting", enforced in PocketBase and repeated at the reverse proxy.

### Security Headers

Per SPEC-0001 § "Security Requirements → Security Headers"; set by PocketBase or, failing that, by the reverse proxy.

### Request Body Size Limits

Per SPEC-0001 § "Security Requirements → Request Body Size Limits", enforced at the reverse proxy (64 KB default,
5 MB for the import route).

### CSRF Protection

Per SPEC-0001 § "Security Requirements → CSRF Protection". No deviation in this capability.

### Redirect Validation

Per SPEC-0001 § "Security Requirements → Redirect Validation". The reverse proxy MUST only redirect HTTP to HTTPS on
the same host.
