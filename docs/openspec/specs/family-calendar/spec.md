---
status: draft
date: 2026-10-11
requires: [SPEC-0001, SPEC-0002, SPEC-0003]
---

# SPEC-0004: Family Calendar

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — sync, security baseline, outbound access to the calendar source
- **Requires:** [SPEC-0002](../kids-routine-board/spec.md) — kids' hobbies and parents' routines as recurring entries
- **Requires:** [SPEC-0003](../parent-todos-and-areas/spec.md) — dated to-dos and the area filter

## Overview

The parents' view has a calendar mode next to the to-do list. It shows the whole family's month: dated to-dos, the
kids' hobbies, the parents' routines and, in production, the appointments from the family's shared iCloud calendar.
Selecting a day shows its agenda and lets a parent add a to-do for that day.

**v1 scope** (SPEC-0001 "Version 1 Scope"): everything except "External Family Calendar" (iCloud), which follows later.

## Requirements

### Requirement: Mode Switch

The parent view MUST offer a switch between list mode (SPEC-0003) and calendar mode. The choice SHOULD persist per
device.

#### Scenario: Switching

- **WHEN** a parent taps "Kalender"
- **THEN** the month view replaces the grouped list, and the quick-add field stays at the top

### Requirement: Month View

Calendar mode MUST show one month as a Monday-first grid. Each day MUST show its date and up to four coloured markers,
one per entry, in the colour of the member the entry belongs to. Today MUST be highlighted. Parents MUST be able to go
to the previous and next month and jump back to today.

#### Scenario: Busy Tuesday

- **WHEN** Tuesday has the son's soccer, the daughter's piano and a to-do for both parents
- **THEN** Tuesday shows a peach, a mauve and two parent-coloured markers

### Requirement: Day Agenda

Selecting a day MUST show its agenda below the grid: timed entries first in time order, then untimed entries, then
to-dos due that day. Each entry MUST show its emoji, title, owner and hint. To-dos in the agenda MUST be completable
and editable exactly as in list mode.

#### Scenario: Agenda order

- **WHEN** a day has "Klavierstunde" (no time), "Fußballtraining 17:00" and a to-do "Kinderarzt anrufen"
- **THEN** the agenda lists Fußballtraining, Klavierstunde, then the to-do

### Requirement: Entry Sources

The calendar MUST include: to-dos with that due date (SPEC-0003), kids' routine items of kind `hobby` (SPEC-0002), and
routine items assigned to parents. Kids' routine items of kind `chore` MUST NOT appear, to keep the calendar readable.
In production the calendar MUST also include events from the household's shared iCloud calendar.

#### Scenario: Chores stay out

- **WHEN** the kids have "Hausaufgaben" every weekday
- **THEN** no homework entries appear in the calendar

### Requirement: External Family Calendar

The server MUST read events from the configured shared iCloud calendar (CalDAV) at least every 15 minutes and show
them with their time, title and calendar colour. The app MUST NOT require iCloud credentials on family devices; the
server holds one app-specific password. Editing iCloud events from Haushelden is OPTIONAL in this version; events
proposed by the household assistant SHOULD be written to iCloud only after a parent approves them (SPEC-0006).

#### Scenario: Appointment from iCloud

- **WHEN** a parent adds "Zahnarzt 14:00" to the family calendar on the iPhone Calendar app
- **THEN** it appears in Haushelden's agenda for that day within 15 minutes

#### Scenario: iCloud unreachable

- **WHEN** the CalDAV fetch fails
- **THEN** the calendar keeps showing the last fetched events and marks them as possibly outdated

### Requirement: Adding on a Selected Day

In calendar mode, the quick-add field MUST create the to-do with the selected day as its due date and SHALL say so in
its placeholder.

#### Scenario: Add for Thursday

- **WHEN** a parent selects Thursday the 15th and adds "Geschenk kaufen"
- **THEN** the to-do is due on the 15th and appears in that day's agenda

### Requirement: Area Filter in Calendar

When an area is selected (SPEC-0003), the calendar MUST show only to-dos of that area and hide routine and external
entries.

#### Scenario: Only car things

- **WHEN** the "Auto" area is selected
- **THEN** only to-dos in "Auto" produce markers

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements"
and applies here, with one addition for the iCloud credential.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication": the calendar endpoints are Auth: Required and parent-only.
The iCloud app-specific password MUST be stored only on the server (encrypted at rest or in the homelab secret store)
and MUST never be sent to clients.

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting". Outbound CalDAV polling MUST NOT run more often than every
5 minutes.

### Security Headers

Per SPEC-0001 § "Security Requirements → Security Headers". No deviation in this capability.

### Request Body Size Limits

Per SPEC-0001 § "Security Requirements → Request Body Size Limits" (64 KB default). No deviation in this capability.

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
