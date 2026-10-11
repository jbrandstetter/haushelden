---
status: draft
date: 2026-10-11
implements: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
---

# SPEC-0001: Household Platform

## Graph Edges

- **Implements:** [ADR-0001](../../../adrs/ADR-0001-pocketbase-as-backend.md) — PocketBase as the household backend
- **Implements:** [ADR-0002](../../../adrs/ADR-0002-remote-access-via-reverse-proxy.md) — remote access via the homelab reverse proxy and a configured hostname
- **Implements:** [ADR-0003](../../../adrs/ADR-0003-kid-access-via-device-accounts.md) — kid access via enrolled device accounts
- **Implements:** [ADR-0004](../../../adrs/ADR-0004-configuration-outside-public-repo.md) — deployment addresses and secrets stay in the private homelab repository

## Overview

Haushelden is a family planner for one household: two parents and two children. Every other capability
(kids' routine board, parents' to-dos and areas, family calendar, shopping lists, household assistant) runs on the
shared foundation this spec defines: members and roles, how parents and kids get in, one shared and live-synced data
set, offline use on phones and tablets, self-hosting in the homelab, reachability from outside the house, and backups.
It also fixes the scope of the first production version.

The current prototype (`index.html`, GitHub Pages) keeps all data in each device's `localStorage`, so nothing is shared
between devices. Closing that gap is the purpose of this spec. Deployment and operations are specified in SPEC-0007.

## Requirements

### Requirement: Version 1 Scope

The first production version (v1) MUST implement the requirements listed as "v1" below and MUST NOT be blocked on the
ones listed as "later". A capability spec's Overview names its own exclusions. v1 is complete when every scenario of
every v1 requirement passes against the deployed system and the family has used it in parallel with the prototype for
one week without data loss.

| Spec | v1 | Later |
|------|----|-------|
| SPEC-0001 Household Platform | all requirements except "Prototype Import" | Prototype Import, passkeys |
| SPEC-0002 Kids' Routine Board | all; mascot uses the built-in line pool | assistant-generated lines |
| SPEC-0003 Parents' To-dos and Areas | all except "Reminders" and "Proposed To-dos" | Reminders, Proposed To-dos |
| SPEC-0004 Family Calendar | all except "External Family Calendar" | External Family Calendar |
| SPEC-0005 Shopping Lists | all | — |
| SPEC-0006 Household Assistant | — | all |
| SPEC-0007 Deployment and Operations | all | — |

#### Scenario: Building v1 without the assistant

- **WHEN** v1 is deployed with no household assistant running
- **THEN** every v1 scenario passes, kids' boards use the built-in mascot lines, and no screen shows an error about
  missing assistant data

### Requirement: Prototype as UI Reference

The prototype's screens, German copy, Catppuccin colours, tile and list layouts and interaction details (as of the
commit that introduced this requirement) MUST be treated as the reference for the v1 user interface. Deviations SHOULD
be limited to what server-backed data, authentication and accessibility require.

#### Scenario: Building the kid board

- **WHEN** an implementer builds the kid board for v1
- **THEN** it matches the prototype's layout, texts and animations unless a requirement in SPEC-0001 to SPEC-0005 says
  otherwise

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

### Requirement: First-Run Setup

On a fresh installation, the first parent account MUST be created only with the one-time setup token from the
deployment configuration (SPEC-0007); without it, the setup screen MUST refuse. The setup token MUST stop working once
the first parent exists. The first parent MUST then be able to invite the second parent with a single-use invite link
valid for 48 hours, and add the kids as members.

#### Scenario: First start

- **WHEN** a parent opens a fresh installation and enters the configured setup token, their name and a password
- **THEN** the household and their parent account are created and the setup token is invalid from then on

#### Scenario: Setup without token

- **WHEN** someone on the internet opens a fresh installation without the setup token
- **THEN** no account can be created

### Requirement: Parent Authentication

Each parent MUST have an individual account. In v1, parents MUST authenticate with an e-mail address and a password of
at least 12 characters; passkeys MAY be added later. A parent session MUST remain valid on that device for at most
30 days without activity and MUST be revocable by either parent.

#### Scenario: Parent signs in on a new phone

- **WHEN** a parent opens the app on a device that has never been used and signs in
- **THEN** the parent's view opens and the session is listed under that parent's active sessions

#### Scenario: Revoking a lost phone

- **WHEN** a parent revokes the sessions of a lost phone
- **THEN** every subsequent request from that phone MUST be rejected with an authentication error

### Requirement: Device Enrollment and Removal

A signed-in parent MUST be able to enroll the current device as a family device (ADR-0003). Enrollment MUST create a
device account with a random secret of at least 32 bytes generated on the device and never shown to anyone. Parents
MUST see all enrolled devices with name and last use, and MUST be able to remove any of them; a removed device MUST
receive an authentication error on its next request.

#### Scenario: Enrolling the kids' iPad

- **WHEN** a parent signs in on the iPad and taps "Als Familiengerät einrichten" with the name "Kinder-iPad"
- **THEN** the iPad shows "Wer bist du?" from then on, even after the parent's own session ends

#### Scenario: Replaced iPad

- **WHEN** a parent removes "Kinder-iPad" from the device list
- **THEN** the old iPad shows the sign-in screen on its next request

### Requirement: Kid Access on Enrolled Devices

Kids MUST NOT need a password. An enrolled device MAY open any kid profile without further authentication. A request
made from a device account MUST be limited to: reading the household's members, routines and that day's ticks;
creating and deleting routine ticks for kid members; reading the mascot settings and lines; reading shopping lists and
adding, ticking and un-ticking shopping items. Opening a parent view on an enrolled device MUST require that parent's
6-digit PIN, which yields a parent session of at most 15 minutes.

#### Scenario: Kid opens their board

- **WHEN** a kid taps their profile on an enrolled family iPad
- **THEN** their routine board opens without any credential prompt

#### Scenario: Kid tries the parent view

- **WHEN** a kid taps a parent profile on an enrolled family iPad
- **THEN** the app MUST ask for that parent's PIN before showing any parent data

#### Scenario: Device reads to-dos

- **WHEN** a device account requests the to-do collection directly through the API
- **THEN** the server returns no records

#### Scenario: Unenrolled device

- **WHEN** someone opens the app on a device that is neither enrolled nor signed in
- **THEN** only the sign-in screen is shown and no household data is returned by the server

### Requirement: Household Settings

Parents MUST have a settings screen to manage members (name, avatar, colour, role), set their own PIN, see and remove
enrolled devices, see and revoke their own sessions, and export data. Capability settings (routines, mascot, areas,
lists) are specified in their own specs and SHOULD appear on the same screen.

#### Scenario: Changing a kid's colour

- **WHEN** a parent changes the daughter's colour to mauve in settings
- **THEN** her tiles, markers and avatar use mauve on every device within the live-sync window

### Requirement: Household Day and Time Zone

The household MUST have one configured time zone (default Europe/Berlin). "Today", weekdays, streaks, alternating
assignments, due dates and auto-refill MUST all be computed for the household time zone, regardless of a device's own
time-zone setting. A day MUST begin at 00:00 household time.

#### Scenario: Phone set to another time zone

- **WHEN** a parent's phone is set to UTC while travelling and it is 00:30 on Tuesday in Europe/Berlin
- **THEN** the app shows Tuesday's routines and to-dos

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

### Requirement: Self-Hosting

The server MUST run in its own LXC container in the homelab, provisioned from the private homelab infrastructure
repository (ADR-0004, SPEC-0007). Household data MUST NOT be stored with third-party cloud services. The container MUST
be rebuildable from the provisioning code plus the latest backup.

#### Scenario: Rebuild after container loss

- **WHEN** the container is destroyed and provisioning is run followed by a restore of the latest backup
- **THEN** the household data, accounts and enrolled devices are back as of the backup time

### Requirement: Remote Access

Family phones MUST be able to use the app outside the home network through the homelab reverse proxy on the configured
public hostname (ADR-0002), with no app or VPN to install. Remote access MUST NOT expose any endpoint that returns
household data without authentication, MUST NOT expose the PocketBase admin UI, and MUST use TLS with a certificate
trusted by stock iOS.

#### Scenario: Shopping away from home

- **WHEN** a parent opens the app on mobile data in a supermarket
- **THEN** the app loads and syncs exactly as it does on the home Wi-Fi

#### Scenario: Admin UI from outside

- **WHEN** someone requests the admin UI path through the public hostname
- **THEN** the reverse proxy refuses the request

### Requirement: Backups

The household data store MUST be backed up at least daily to the configured internal backup target, with at least 14
daily versions retained. A restore MUST be tested at least once before v1 replaces the prototype and after any change
to the storage format.

#### Scenario: Restore test

- **WHEN** the maintainer restores yesterday's backup into a scratch container
- **THEN** the scratch container serves yesterday's data and the live container is unaffected

### Requirement: Data Export

Parents MUST be able to export all household data as one JSON file.

#### Scenario: Export

- **WHEN** a parent taps "Export" in settings
- **THEN** a JSON file containing members, routines, to-dos, areas, lists, purchase history and settings is downloaded

### Requirement: Prototype Import

The system SHOULD offer a one-time import of data from the prototype (`haushelden.v1` localStorage format, exported by
an export button added to the prototype) so the family's set-up survives the switch. Demo purchase history MUST NOT be
imported.

#### Scenario: Importing the prototype set-up

- **WHEN** a parent imports a prototype export on a fresh installation
- **THEN** routines, areas and to-dos appear, and no demo purchase history is created

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

This section is the security baseline for every Haushelden capability; SPEC-0002 to SPEC-0007 reference it instead of
restating it. Paths are the application's own routes (PocketBase's standard API plus a few custom routes under
`/api/hh/`); hostnames are configuration (ADR-0004).

### Authentication

All endpoints MUST require authentication by default. Public (unauthenticated) endpoints MUST be explicitly listed with justification.

| Endpoint | Auth | Justification |
|----------|------|---------------|
| `GET /` and the static app shell (HTML, JS, CSS, icons, manifest, service worker) | Public | The installed app must load to show the sign-in screen; the shell contains no household data |
| `POST /api/collections/parents/auth-with-password` | Public | Parent sign-in cannot require being signed in |
| `POST /api/collections/devices/auth-with-password` | Public | An enrolled device signs in with its own secret |
| `POST /api/hh/setup` | Public, but requires the configured one-time setup token | Creates the first parent on a fresh installation; refused once a parent exists |
| `POST /api/hh/invite/accept` | Public, but requires a single-use invite token | Second parent creates their account from the invite link |
| `GET /api/health` | Public | Health probe for monitoring; returns no household data |
| `POST /api/hh/devices/enroll` | Required (parent) | — |
| `POST /api/hh/pin` (PIN → short parent session) | Required (device) | — |
| `POST /api/hh/invite` | Required (parent) | — |
| `GET /api/hh/export` | Required (parent) | — |
| `GET/POST/PATCH/DELETE /api/collections/{collection}/records*` for all household collections | Required; per-collection rules by role in the design | — |
| `GET /api/realtime` (live-sync stream) | Required | — |
| `/_/` (PocketBase admin UI) | Required (superuser), LAN only — blocked at the reverse proxy | — |

### Rate Limiting

Parent sign-in, device sign-in, PIN entry, setup and invite acceptance MUST be limited to 5 failed attempts per account
(or per client address for setup and invite) per 15 minutes, after which further attempts are rejected until the window
passes. All other endpoints MUST be limited to 120 requests per minute per session, which is well above normal family
use and stops a runaway client loop. The reverse proxy SHOULD apply the same limits as a second layer.

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
