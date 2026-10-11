---
status: draft
date: 2026-10-11
---

# SPEC-0001: Household Platform

## Overview

Haushelden is a family planner for one household: two parents and two children. Every other capability
(kids' routine board, parents' to-dos and areas, family calendar, shopping lists, household assistant) runs on the
shared foundation this spec defines: members and roles, how parents and kids get in, one shared and live-synced data
set, offline use on phones and tablets, self-hosting on the homelab node `pve1`, reachability from outside the house,
and backups.

The current prototype (`index.html`, GitHub Pages) keeps all data in each device's `localStorage`, so nothing is shared
between devices. Closing that gap is the purpose of this spec.

## Requirements

### Requirement: Household and Members

The system SHALL model exactly one household. A household MUST have one or more members. Each member MUST have a
role of `parent` or `kid`, a display name, an avatar (emoji) and a colour from the Catppuccin accent palette.
Only parents MAY create, edit or remove members. Member names MUST NOT appear in the application source code or the
public repository; they exist only in the household's data store.

#### Scenario: Parent adds a member

- **WHEN** a parent adds a member with role `kid`, name "Leo", avatar ⚽ and colour peach
- **THEN** the member appears on every device's "Wer bist du?" screen within the live-sync window

#### Scenario: Kid cannot manage members

- **WHEN** a kid session requests to rename or remove a member
- **THEN** the request MUST be rejected and the data MUST be unchanged

### Requirement: Parent Authentication

Each parent MUST have an individual account. Parents MUST authenticate with a passkey or a password of at least
12 characters before any parent capability is available. A parent session MUST remain valid on that device for at
most 30 days without activity and MUST be revocable by either parent.

#### Scenario: Parent signs in on a new phone

- **WHEN** a parent opens the app on a device that has never been used and signs in with their passkey
- **THEN** the parent's view opens and the session is listed under that parent's active sessions

#### Scenario: Revoking a lost phone

- **WHEN** a parent revokes the session of a lost device
- **THEN** every subsequent request from that device MUST be rejected with an authentication error

### Requirement: Kid Access on Enrolled Devices

Kids MUST NOT need a password. A parent SHALL enroll a device (for example the kids' iPad) as a family device;
an enrolled device MAY open any kid profile without further authentication. A kid session MUST be limited to:
viewing and ticking off that kid's own routine items, viewing the household mascot's lines for that kid, and adding
items to shopping lists. Opening a parent view on an enrolled family device MUST require that parent to authenticate
or enter a parent PIN.

#### Scenario: Kid opens their board

- **WHEN** a kid taps their profile on an enrolled family iPad
- **THEN** their routine board opens without any credential prompt

#### Scenario: Kid tries the parent view

- **WHEN** a kid taps a parent profile on an enrolled family iPad
- **THEN** the app MUST ask for that parent's PIN or passkey before showing any parent data

#### Scenario: Unenrolled device

- **WHEN** someone opens the app on a device that is neither enrolled nor signed in
- **THEN** only the sign-in screen is shown and no household data is returned by the server

### Requirement: Shared State and Live Sync

All household data MUST be stored once on the server and shared by every authorised device. A change made on one
online device MUST become visible on every other online device within 5 seconds without a manual refresh.

#### Scenario: Shopping item appears on the other phone

- **WHEN** one parent adds "Milch" to the Lebensmittel list while the other parent has the list open
- **THEN** "Milch" appears on the other parent's screen within 5 seconds

### Requirement: Offline Operation

The app MUST open and remain usable without a network connection, showing the last synced data. Tick-offs,
un-ticks, new to-dos and new shopping items made offline MUST be queued on the device and sent when the connection
returns. Tick-offs MUST be idempotent. When two devices changed the same field while one was offline, the later change
by server receipt time SHALL win, except that a shopping item marked bought MUST stay bought.

#### Scenario: Ticking off in the supermarket without signal

- **WHEN** a parent ticks off three items with no connection and the phone reconnects ten minutes later
- **THEN** all three items are marked bought on the server and on every other device, with their purchase dates
  recorded once each

### Requirement: Installable Web App

The app MUST be installable to the home screen on iOS/iPadOS 16.4+ and current Android and desktop browsers, and MUST
run full-screen when launched from there. After a new version is deployed, a device MUST load it on the next launch
while online; it MUST NOT keep serving a stale version from its cache when the network is available.

#### Scenario: Update after deploy

- **WHEN** a new version is deployed and a parent launches the home-screen app while online
- **THEN** the new version is shown on that launch

### Requirement: Self-Hosting on pve1

The server MUST run in its own LXC container on the homelab Proxmox node `pve1`, provisioned by Ansible from the hub
repository like the other containers. Household data MUST NOT be stored with third-party cloud services. The
container MUST be rebuildable from the playbook plus the latest backup.

#### Scenario: Rebuild after container loss

- **WHEN** the container is destroyed and the playbook is run followed by a restore of the latest backup
- **THEN** the household data, accounts and enrolled devices are back as of the backup time

### Requirement: Remote Access

Family phones MUST be able to use the app outside the home network. Remote access MUST NOT expose any endpoint that
returns household data without authentication, and MUST use TLS with a certificate trusted by stock iOS.

#### Scenario: Shopping away from home

- **WHEN** a parent opens the app on mobile data in a supermarket
- **THEN** the app loads and syncs exactly as it does on the home Wi-Fi

### Requirement: Backups

The household data store MUST be backed up at least daily to the homelab's existing backup target, with at least 14
daily versions retained. A restore MUST be tested at least once before the app replaces the prototype and after any
change to the storage format.

#### Scenario: Restore test

- **WHEN** a parent requests "restore yesterday's backup to a scratch container"
- **THEN** the scratch container serves yesterday's data and the live container is unaffected

### Requirement: Data Export and Prototype Import

Parents MUST be able to export all household data as one JSON file. The system SHOULD offer a one-time import of data
exported from the prototype (`haushelden.v1` localStorage format) so the family's set-up survives the switch.

#### Scenario: Export

- **WHEN** a parent taps "Export" in settings
- **THEN** a JSON file containing members, routines, to-dos, areas, lists, purchase history and settings is downloaded

### Requirement: Error Handling Standards

All error-producing operations MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary (e.g., "failed to create user: database insert failed: connection refused")
- Sentinel errors MUST be defined for domain-specific failure modes that callers need to distinguish programmatically
- Silent error swallowing MUST NOT occur — every error MUST be either returned to the caller, logged with sufficient context, or explicitly handled with a documented reason for suppression
- Structured logging MUST be used for error reporting (key-value pairs, not string interpolation)

#### Scenario: Sync write fails

- **WHEN** a queued offline change is rejected by the server
- **THEN** the device keeps the change queued, shows a non-blocking "nicht synchronisiert" hint, and the server logs
  the rejection with member, record and reason as structured fields

### Requirement: Database Operation Standards

All database operations MUST follow structured data access patterns:

- Transactions MUST be used for multi-step mutations that require atomicity
- Connection lifecycle MUST be explicitly managed — connections MUST be returned to the pool after use, with timeouts configured
- Query parameters MUST use parameterized queries — string interpolation in queries MUST NOT occur

#### Scenario: Finishing a shopping trip

- **WHEN** a parent taps "Einkauf fertig", which removes bought items and records their purchase dates
- **THEN** both changes are committed in one transaction, or neither is

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

This section is the security baseline for every Haushelden capability; SPEC-0002 to SPEC-0006 reference it instead of
restating it.

### Authentication

All endpoints MUST require authentication by default. Public (unauthenticated) endpoints MUST be explicitly listed with justification.

| Endpoint | Auth | Justification |
|----------|------|---------------|
| `GET /` and static app shell (HTML, JS, CSS, icons, manifest, service worker) | Public | The installed app must load to show the sign-in screen; the shell contains no household data |
| `POST /api/auth/parent` (passkey / password sign-in) | Public | Sign-in cannot require being signed in |
| `GET /health` | Public | Container health probe; returns only "ok" |
| `POST /api/devices/enroll` | Required (parent) | — |
| `GET/POST/PATCH/DELETE /api/members/*` | Required (parent) | — |
| `GET/POST/PATCH/DELETE /api/routines/*`, `/api/todos/*`, `/api/areas/*`, `/api/lists/*` | Required (parent; kid scope per capability spec) | — |
| `GET/POST/PATCH /api/shop/*` | Required (parent or kid on enrolled device) | — |
| `GET /api/realtime` (live-sync stream) | Required | — |
| `GET /api/export` | Required (parent) | — |

### Rate Limiting

Sign-in and PIN entry MUST be limited to 5 failed attempts per account per 15 minutes, after which further attempts are
rejected until the window passes. All other endpoints MUST be limited to 120 requests per minute per session, which is
well above normal family use and stops a runaway client loop.

### Security Headers

All HTTP responses MUST include the following security headers:

- `Content-Security-Policy`: `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'`
- `X-Frame-Options`: DENY
- `X-Content-Type-Options`: nosniff
- `Referrer-Policy`: strict-origin-when-cross-origin

### Request Body Size Limits

All endpoints that accept request bodies MUST enforce size limits. Request bodies MUST be bounded to prevent unbounded memory allocation.

Default limit: 64 KB. The prototype-import endpoint MAY accept up to 5 MB because a full export with purchase history
can exceed the default.

### CSRF Protection

State-changing endpoints (POST, PUT, PATCH, DELETE) MUST implement CSRF protection. Strategy: session tokens are sent
in an `Authorization` header, never as cookies, so cross-site requests cannot carry them; any cookie that is used MUST be
`SameSite=Strict`.

### Redirect Validation

Any endpoint that performs HTTP redirects with user-supplied URLs MUST validate the redirect target against an allowlist of permitted domains or paths. Open redirects MUST NOT be permitted. The only redirect in this system is
after sign-in, and it MUST target an in-app path (starting with `/#/`).

## Accessibility Requirements

This spec involves user-facing UI. The following are MANDATORY for every UI component this spec produces, per WCAG 2.1 AA:

- **WCAG 2.1 AA compliance** — the minimum conformance target
- **ARIA landmarks** — `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"` on page-structure elements
- **`aria-label` on icon-only controls** — every button or link with no visible text label
- **`aria-live` regions for dynamic content** — `polite` for routine updates, `assertive` for critical status changes (HTMX swaps, auto-refresh panels, real-time status)
- **Keyboard navigation** — logical tab order, Enter/Space activation, Escape to dismiss, arrow keys within composite widgets
- **Focus management in modals and dialogs** — trap focus while open, move focus to the first focusable element on open, return it to the trigger on close

The full checklist behind each line is the SDD plugin's `references/accessibility-requirements.md`; this section is the normative summary and is not expanded inline.
