---
status: draft
date: 2026-10-11
requires: [SPEC-0001]
---

# SPEC-0005: Shopping Lists

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — members, kid access, live sync, offline queue, security baseline

## Overview

The household keeps shared shopping lists — at least "Lebensmittel" (groceries) and "dm" (toiletries and household
goods from the dm drugstore). Everyone, kids included, can add items. Ticking an item while shopping records a purchase;
from those purchases the app learns how often each item is bought and puts items back on the list when they are due
again. An LLM MAY improve matching and sorting later (SPEC-0006), but the learning itself is deterministic.

**v1 scope** (SPEC-0001 "Version 1 Scope"): everything in this spec.

## Requirements

### Requirement: Lists

The household SHALL have one or more shopping lists, each with an emoji and a name. The defaults MUST be
"🛒 Lebensmittel" and "🧴 dm". Parents MUST be able to add, rename and delete lists; deleting a list MUST delete its
open items. The shopping screen MUST show one tab per list with its number of open items.

#### Scenario: Default lists

- **WHEN** a household is created
- **THEN** it has the lists "Lebensmittel" and "dm"

### Requirement: Adding Items

Any member, on any authorised device, MUST be able to add an item to any list by typing a name. Each item MUST record
who added it, and the list MUST show that member's avatar next to the item. Adding a name that is already open on the
same list (case- and whitespace-insensitive) MUST NOT create a duplicate.

#### Scenario: Kid adds an item

- **WHEN** the son adds "Gummibärchen" to Lebensmittel on the family iPad
- **THEN** it appears on both parents' phones within the live-sync window, marked with his avatar

#### Scenario: Duplicate

- **WHEN** "milch" is added while "Milch" is already open on Lebensmittel
- **THEN** no second item is created

### Requirement: Shopping Flow

Ticking an item MUST move it to an "in the cart" section and record a purchase for today; un-ticking it the same day
MUST remove that purchase again. A "finish shopping" action MUST remove all ticked items of the current list. Ticking
MUST work offline and sync later (SPEC-0001 Offline Operation).

#### Scenario: In the store

- **WHEN** a parent ticks Milch, Brot and Eier and taps "Einkauf fertig"
- **THEN** the three items leave the list and each has one purchase recorded for today

### Requirement: Purchase History and Rhythm

The system MUST keep, per list and per normalised item name, the dates of past purchases (at most one per day). From
at least two purchases it MUST derive the item's rhythm: the median of the most recent (up to five) intervals between
purchases, rounded to whole days, minimum one day. An item with fewer than two purchases MUST have no rhythm.

#### Scenario: Milk every five days

- **WHEN** Milch was bought on days 0, 4, 10, 15 and 20
- **THEN** its rhythm is 5 days (median of 4, 6, 5, 5)

### Requirement: Automatic Refill

When automatic refill is enabled (the default), every item whose rhythm says it is due — today is on or after the last
purchase plus the rhythm minus one day — and that is not already on the list or in the cart MUST be added to its list
automatically. Automatic items MUST be marked as such and MUST show the reason (rhythm and days since the last
purchase). Removing an automatic item without buying it MUST defer it by half its rhythm (rounded up). Parents MUST be
able to switch automatic refill off; then due items MUST be offered as suggestions instead.

#### Scenario: Milk comes back

- **WHEN** Milch has a 5-day rhythm and was last bought 4 days ago
- **THEN** Milch is on the Lebensmittel list, marked "✨ automatisch · etwa alle 5 Tage · zuletzt vor 4 Tagen"

#### Scenario: Not needed yet

- **WHEN** a parent removes the automatic "Shampoo" (rhythm 35 days) without buying it
- **THEN** Shampoo is not added again for 18 days

### Requirement: Suggestions While Typing

While a name is being typed, the screen MUST suggest previously bought items of the current list whose name contains
the typed text, ranking names that start with it first and then by number of purchases. Items already on the list or
in the cart MUST NOT be suggested. With an empty field the screen SHOULD show the most frequently bought items as
one-tap suggestions.

#### Scenario: Typing "Ka"

- **WHEN** a parent types "Ka" on Lebensmittel
- **THEN** "Kaffee" (bought 12×) is suggested, unless Kaffee is already on the list

### Requirement: Learned Overview

Parents MUST be able to see every learned item with its list, rhythm and number of purchases, and MUST be able to
reset the purchase history.

#### Scenario: Reviewing what was learned

- **WHEN** a parent opens the shopping settings
- **THEN** they see rows like "🛒 Milch — alle ~5 Tage — 6× gekauft"

### Requirement: Entry Points

The shopping screen MUST be reachable from the "Wer bist du?" screen, from every kid board, and from each parent view.
When opened from a profile, items added there MUST be attributed to that member.

#### Scenario: From the kid board

- **WHEN** the daughter opens the shopping list from her board and adds "Haargummis" to dm
- **THEN** the item shows her avatar

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements"
and applies unchanged here.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication": shopping endpoints are Auth: Required. Kid sessions MAY read
lists, add items and tick items; only parents MAY manage lists, toggle automatic refill or reset history. This
capability adds no public endpoints.

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting". No deviation in this capability.

### Security Headers

Per SPEC-0001 § "Security Requirements → Security Headers". No deviation in this capability.

### Request Body Size Limits

Per SPEC-0001 § "Security Requirements → Request Body Size Limits" (64 KB default). Item names MUST be at most 80
characters.

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
