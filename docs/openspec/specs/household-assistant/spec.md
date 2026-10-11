---
status: draft
date: 2026-10-11
requires: [SPEC-0001]
---

# SPEC-0006: Household Assistant

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — accounts, API tokens, data store, security baseline

## Overview

The household's LLM agent (Hermes, running on the homelab's local model) helps without being trusted to act alone. It
writes the mascot's daily lines for each kid, turns messy messages (for example the son's soccer WhatsApp group) into
proposed calendar entries and to-dos, and can propose clean-ups of the shopping history. Everything it produces is a
proposal that a parent approves, or a mascot line that passes an approval policy, before any family member sees it.
SPEC-0002, SPEC-0003, SPEC-0004 and SPEC-0005 consume its approved output.

## Requirements

### Requirement: Local Model Only

All LLM processing for Haushelden MUST run on homelab hardware (the household's local model). Household data —
names, routines, to-dos, messages, purchase history — MUST NOT be sent to external LLM APIs.

#### Scenario: Generating lines

- **WHEN** the nightly mascot job runs
- **THEN** every model call goes to the local model endpoint and no request leaves the homelab

### Requirement: Scoped Assistant Identity

The assistant MUST use its own API identity that can read the data it needs and can create only `proposal` and
`mascot_line` records. It MUST NOT be able to create, change or delete members, routines, to-dos, events, shopping
items or settings directly.

#### Scenario: Direct write attempt

- **WHEN** the assistant's token tries to create a to-do
- **THEN** the server MUST reject it

### Requirement: Proposals Inbox

Parents MUST have a proposals inbox showing every pending proposal with its type (to-do, calendar event, shopping
merge), the proposed content, the source it came from, and accept / edit-then-accept / reject actions. Accepting MUST
create the target record in one transaction and mark the proposal accepted. Rejected and accepted proposals MUST be
kept for 90 days for review.

#### Scenario: Accepting a game

- **WHEN** a parent accepts the proposal "Auswärtsspiel Sa 10:30, Treffpunkt 9:45 Sportplatz"
- **THEN** the event is created (SPEC-0004) and the proposal shows as accepted

#### Scenario: Editing before accepting

- **WHEN** a parent changes the proposed time from 10:30 to 11:00 and accepts
- **THEN** the created event has 11:00 and the proposal records the edit

### Requirement: Message Ingestion

Parents MUST be able to send text (a forwarded chat excerpt or an exported chat) to the assistant from their phone in
at most two taps, for example through the iOS share sheet. The assistant MUST extract dates, times, places and things
to bring, and MUST turn them into proposals only — never into direct entries. If nothing actionable is found, the parent
MUST be told so.

#### Scenario: Trainer's message

- **WHEN** a parent shares "Samstag Spiel in Musterstadt, Abfahrt 9:15 am Sportplatz, bitte Trikot weiß mitbringen"
- **THEN** the inbox shows a proposed event for Saturday 9:15 and a proposed to-do "weißes Trikot einpacken" for Friday

#### Scenario: Chit-chat only

- **WHEN** the shared text contains no dates or tasks
- **THEN** no proposal is created and the parent sees "Nichts gefunden"

### Requirement: Mascot Line Generation

Every evening the assistant MUST write the next day's mascot lines for each kid: a greeting, per-task reactions,
completion lines and, when applicable, a streak line. It MUST use the next day's routine items, hobbies, the kid's
recent streak, the household's calendar and the local weather forecast as context. Lines MUST be German, at most
120 characters, praise effort and habits rather than the child, MUST NOT compare siblings, and MUST NOT promise rewards.

#### Scenario: Soccer day

- **WHEN** the son has soccer tomorrow and a 4-day streak
- **THEN** the generated lines include one that mentions packing the soccer bag and one that mentions the streak

### Requirement: Mascot Line Approval

Generated lines MUST reach a kid's board only after approval. Parents MUST be able to choose between manual approval
(review tomorrow's lines in the inbox) and automatic approval after an automated check that enforces the content rules
of "Mascot Line Generation". Lines failing the check MUST be dropped and the board falls back to the built-in pool
(SPEC-0002).

#### Scenario: Automatic approval rejects a line

- **WHEN** a generated line compares the son to his sister
- **THEN** the check drops it and it never appears on a board

### Requirement: Shopping Name Normalisation

The assistant MAY propose merging shopping history entries that name the same product ("Vollmilch", "Milch 3,5%" →
"Milch") and MAY propose an aisle order for a list. Merges MUST be proposals; accepting one MUST combine the purchase
histories so the rhythm (SPEC-0005) is recomputed from the union.

#### Scenario: Merge

- **WHEN** a parent accepts merging "Vollmilch" into "Milch"
- **THEN** one "Milch" entry remains with both purchase histories

### Requirement: Failure Isolation

If the assistant or the local model is unavailable, every other capability MUST keep working: boards use fallback
lines, lists and to-dos are unaffected, and pending ingestions are retried or reported as failed to the parent.

#### Scenario: Model offline at night

- **WHEN** the local model is unreachable during the nightly run
- **THEN** no lines are generated, tomorrow's boards use fallback lines, and the parents' inbox shows one notice

### Requirement: Audit Trail

Every assistant run MUST be logged with its type, start and end time, model used, number of proposals or lines
created, and any error, and the log MUST be visible to parents.

#### Scenario: Reviewing last night

- **WHEN** a parent opens the assistant log
- **THEN** they see last night's mascot run with the number of lines per kid and whether it succeeded

### Requirement: Error Handling Standards

All error-producing operations MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary (e.g., "failed to create user: database insert failed: connection refused")
- Sentinel errors MUST be defined for domain-specific failure modes that callers need to distinguish programmatically
- Silent error swallowing MUST NOT occur — every error MUST be either returned to the caller, logged with sufficient context, or explicitly handled with a documented reason for suppression
- Structured logging MUST be used for error reporting (key-value pairs, not string interpolation)

#### Scenario: Model returns invalid JSON

- **WHEN** the model's extraction output cannot be parsed
- **THEN** the run is retried once, then recorded as failed in the audit trail with the parse error, and the parent
  is told the message could not be processed

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements"
and applies here, with additions for the assistant's machine identity and inbound messages.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication", plus:

| Endpoint | Auth | Justification |
|----------|------|---------------|
| `GET/PATCH /api/proposals/*` (inbox, accept, reject) | Required (parent) | — |
| `POST /api/proposals`, `POST /api/mascot-lines` | Required (assistant token) | — |
| `POST /api/ingest` (shared text from a parent's phone) | Required (parent) | — |
| `GET /api/assistant/log` | Required (parent) | — |

The assistant token MUST be stored in the homelab secret store, MUST be rotatable, and MUST NOT be usable from browsers
(rejected when sent with an `Origin` header).

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting", plus: `POST /api/ingest` is limited to 20 requests per parent
per hour, and the assistant token to 500 writes per run.

### Security Headers

Per SPEC-0001 § "Security Requirements → Security Headers". No deviation in this capability.

### Request Body Size Limits

Per SPEC-0001 § "Security Requirements → Request Body Size Limits", except `POST /api/ingest`, which MAY accept up to
1 MB because exported chats are long text.

### CSRF Protection

Per SPEC-0001 § "Security Requirements → CSRF Protection" (header tokens, no auth cookies). No deviation in this capability.

### Redirect Validation

Per SPEC-0001 § "Security Requirements → Redirect Validation". This capability performs no redirects.

## Accessibility Requirements

This spec involves user-facing UI. The following are MANDATORY for every UI component this spec produces, per WCAG 2.1 AA:

- **WCAG 2.1 AA compliance** — the minimum conformance target
- **ARIA landmarks** — `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"` on page-structure elements
- **`aria-label` on icon-only controls** — every button or link with no visible text label
- **`aria-live` regions for dynamic content** — `polite` for routine updates, `assertive` for critical status changes (HTMX swaps, auto-refresh panels, real-time status)
- **Keyboard navigation** — logical tab order, Enter/Space activation, Escape to dismiss, arrow keys within composite widgets
- **Focus management in modals and dialogs** — trap focus while open, move focus to the first focusable element on open, return it to the trigger on close

The full checklist behind each line is the SDD plugin's `references/accessibility-requirements.md`; this section is the normative summary and is not expanded inline.
