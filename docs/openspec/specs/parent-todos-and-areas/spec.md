---
status: draft
date: 2026-10-11
requires: [SPEC-0001, SPEC-0002, SPEC-0006]
---

# SPEC-0003: Parents' To-dos and Areas of Responsibility

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — parent accounts, sync, security baseline
- **Requires:** [SPEC-0002](../kids-routine-board/spec.md) — routine items assigned to parents, kids' progress
- **Requires:** [SPEC-0006](../household-assistant/spec.md) — proposals inbox for assistant-created to-dos

## Overview

Each parent gets a personal view: their own to-dos and the ones shared with the other parent, the household's areas of
responsibility with a main contact each, their recurring chores for today, and a glance at the kids' progress. The
view has a list mode (this spec) and a calendar mode (SPEC-0004).

**v1 scope** (SPEC-0001 "Version 1 Scope"): everything except "Reminders" and "Proposed To-dos", which follow later.

## Requirements

### Requirement: To-dos

A to-do SHALL have a title, an assignee (one parent or both parents), an optional due date, an optional area, and a
completion date. Either parent MUST be able to create, edit, complete, un-complete and delete any to-do. Kids MUST NOT
be able to read or change to-dos.

#### Scenario: Shared to-do

- **WHEN** one parent creates "Elternabend in den Kalender eintragen" for both parents, due tomorrow
- **THEN** it appears under "Demnächst" in both parents' views

#### Scenario: Kid session

- **WHEN** a kid session requests the to-do list
- **THEN** the server MUST return no to-dos

### Requirement: Quick Add

The view MUST offer a single text field to add a to-do with one tap, plus one-tap choices for the due date (none,
today, tomorrow) and the assignee (me, the other parent, both). When an area is selected as a filter, a new to-do MUST
be assigned to that area.

#### Scenario: Adding while an area is selected

- **WHEN** a parent has the "Auto" area selected and adds "Winterreifen-Termin"
- **THEN** the new to-do belongs to "Auto"

### Requirement: List Grouping

The list MUST group open to-dos as: overdue, today, upcoming (sorted by due date), and someday (no due date). To-dos
completed today MUST remain visible in a "done today" group so they can be undone. Overdue to-dos MUST be visually
distinct and state how long they are overdue.

#### Scenario: Overdue

- **WHEN** a to-do was due two days ago and is not done
- **THEN** it appears under "Überfällig" marked "überfällig seit 2 Tagen"

### Requirement: Editing

Tapping a to-do MUST open an inline editor for title, due date (with shortcuts today, tomorrow, weekend, next week,
and a date picker), assignee and area, with a delete action. Shortcuts that resolve to the same date MUST be shown once.

#### Scenario: Next week on a Sunday

- **WHEN** the editor is opened on a Sunday
- **THEN** "Morgen" and "Nächste Woche" are not both shown for the same date

### Requirement: Areas of Responsibility

The household SHALL have a list of areas (emoji, name, owner). The owner MUST be one parent or unassigned. Parents MUST
be able to add, rename and delete areas and set owners; deleting an area MUST keep its to-dos, without an area. Each
parent's view MUST show all areas with owner and number of open to-dos, and MUST highlight the areas that parent owns.
Selecting an area MUST filter the to-do list (and the calendar, SPEC-0004) to that area until cleared.

#### Scenario: Assigning an owner

- **WHEN** a parent sets the owner of "Technik & Smart Home" to themself
- **THEN** that area card is highlighted in their view and shows their avatar in the other parent's view

#### Scenario: Unowned area

- **WHEN** an area has no owner
- **THEN** its card reads "Wer ist zuständig?"

### Requirement: Parents' Routines Today

Routine items assigned to a parent or to both parents (SPEC-0002) MUST appear in that parent's view under "Routine
heute" on their occurring days, tickable per parent and day.

#### Scenario: Bins

- **WHEN** "Mülltonnen rausstellen" is assigned to both parents on Mondays
- **THEN** on Mondays both parents see it under "Routine heute"

### Requirement: Kids' Progress Glance

The parent view MUST show each kid's progress for today (done / total) at the top, updating live.

#### Scenario: Homework done

- **WHEN** the son ticks "Hausaufgaben" on the iPad
- **THEN** his progress bar in both parents' views advances within the live-sync window

### Requirement: Reminders

Parents SHOULD receive a reminder for their to-dos due today and for overdue ones, once per day at a time each parent
chooses, through a channel that reaches a locked phone. A parent MUST be able to turn reminders off.

#### Scenario: Morning reminder

- **WHEN** a parent has two to-dos due today and reminders set to 07:30
- **THEN** at 07:30 they receive one reminder listing both

### Requirement: Proposed To-dos

To-dos created by the household assistant (SPEC-0006) MUST NOT appear in the lists until a parent approves them in the
proposals inbox.

#### Scenario: Assistant proposal

- **WHEN** the assistant proposes "Trikot waschen bis Samstag"
- **THEN** it appears only in the proposals inbox until a parent accepts it

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements"
and applies unchanged here.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication": every endpoint this capability uses is Auth: Required and
parent-only; kid sessions are refused. This capability adds no public endpoints.

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting". No deviation in this capability.

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
