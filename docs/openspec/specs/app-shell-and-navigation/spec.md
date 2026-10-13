---
status: draft
date: 2026-10-13
implements: [ADR-0008]
requires: [SPEC-0001]
---

# SPEC-0008: App Shell and Navigation

## Graph Edges

- **Implements:** [ADR-0008](../../../adrs/ADR-0008-navigation-derived-from-the-session.md) — navigation derived from the session, rendered once by the shell
- **Requires:** [SPEC-0001](../household-platform/spec.md) — session kinds (parent, PIN, family device), installable app, security baseline

## Overview

How a person finds their way around Haushelden: what the app shows first, which entries the header navigation offers to
whom, how screens link back, and how the app keeps a family device away from parent-only screens. It is a v1
requirement of the platform (SPEC-0001 "Version 1 Scope") and was specified after the first build, when it turned out that
every feature screen existed but no story owned the way between them.

## Requirements

### Requirement: Start Page by Session

The app MUST choose its start page from the session. A signed-out visitor MUST see the sign-in screen (or one of the
other public screens: first-run setup, invite acceptance, the help page). A signed-in session of any kind that opens the start address
(`#/` or no hash) MUST be taken to "Wer bist du?". The shell's placeholder start page MUST NOT be reachable by a
signed-in session.

#### Scenario: Parent opens the app

- **WHEN** a signed-in parent opens `http://<host>/` or `#/`
- **THEN** "Wer bist du?" is shown

#### Scenario: Signed out

- **WHEN** someone without a session opens any address other than the sign-in, setup or invite screens
- **THEN** the sign-in screen is shown

### Requirement: Header Navigation

Every screen MUST show the same navigation bar in the page header, built from the session kind:

- signed out: the brand link, which leads to the sign-in screen, and "Hilfe";
- parent session or parent PIN session: "Wer bist du?", "Aufgaben" (the parents' view), "Einkauf" (the shopping list for
  the signed-in member), "Einstellungen" and "Hilfe";
- plain family device: "Wer bist du?", "Einkauf" and "Hilfe" only; parent entries MUST NOT be offered.

The bar MUST be re-rendered whenever the page changes and whenever the session changes (sign-in, PIN entry, return to the
device's own session, sign-out), and it MUST be an accessible navigation landmark.

#### Scenario: Parent on the areas screen

- **WHEN** a signed-in parent opens `#/bereiche`
- **THEN** the bar shows the parent entries and "Hilfe" and marks "Einstellungen" as the current page

#### Scenario: Kids' iPad

- **WHEN** a family device without a parent session shows any screen
- **THEN** the bar offers "Wer bist du?", "Einkauf" and "Hilfe" and no entry to the parents' view or the settings

#### Scenario: PIN session ends

- **WHEN** a parent PIN session on a family device ends or is left with "Fertig"
- **THEN** the bar drops the parent entries without a page reload

### Requirement: Current Page Marking

The entry of the section the person is in MUST be marked as the current page (`aria-current="page"`, and visibly). The
settings sub-screens (routines, mascot, areas) belong to "Einstellungen", the help page to "Hilfe", the kid board and "Wer bist du?" to
"Wer bist du?", the learned overview and the shopping list to "Einkauf", and the parents' view to "Aufgaben".

#### Scenario: Learned overview

- **WHEN** a parent opens `#/gelernt`
- **THEN** "Einkauf" is marked as the current page

### Requirement: Every Navigation Target Exists

Every entry of the header navigation, and every link a screen offers, MUST lead to a route that exists in the app's route
list. An unknown address MUST show a "Seite nicht gefunden" message and MUST NOT leave a blank screen; the header
navigation stays available as the way out.

#### Scenario: Navigation test

- **WHEN** the entries for every session kind are checked against the route list
- **THEN** each target resolves to a screen

### Requirement: Parent-Only Screens on Family Devices

The routes of the parents' view, routines, mascot, areas, learned overview and settings are parent-only. A family-device
session that opens one of them MUST be sent to "Wer bist du?". This is a courtesy to avoid empty pages; the server rules
(SPEC-0001, ADR-0003) remain the authority and MUST refuse the data regardless of what the UI shows.

#### Scenario: Kid types a parent address

- **WHEN** a family device without a parent session opens `#/einstellungen`
- **THEN** "Wer bist du?" is shown, and a direct request for the parents' data through the API returns nothing

### Requirement: Legacy Parent Address

The address `#/ich/<member id>`, used by the prototype and by cached pages from before the navigation was added, MUST open
the parents' view for a signed-in session (a signed-out visitor signs in first).

#### Scenario: Old bookmark

- **WHEN** a signed-in parent opens `#/ich/<their member id>`
- **THEN** the parents' view opens

### Requirement: Way Back From Sub-Screens

Screens opened from the settings (routines, mascot, areas) MUST offer a back link to "Einstellungen". The kid board and the
shopping list MUST offer a way back to "Wer bist du?" (through the start address or the header navigation).

#### Scenario: Back from the areas editor

- **WHEN** a parent taps "Zurück" on the areas screen
- **THEN** the settings screen opens

### Requirement: Family Help Page

The app MUST have a help page for the family at `#/hilfe`, written in German, that anyone can open without signing in (for
example on a new device before the app is set up). It MUST be reachable from the header navigation for every visitor and from
a link on the sign-in screen. It MUST explain at least: what the app is, how to install it on an iPhone or iPad, how parents and
the kids' family device sign in (including the PIN), the kids' daily list, the parents' tasks and calendar, shopping, working
without internet, the settings, what to do when something does not work, privacy, and what does not work yet. Because it can be
opened by anyone who can reach the server, it MUST NOT contain addresses, host names, e-mail addresses, credentials or the names
of real people. It MUST work without data access and offline once the app has been loaded, and its sections MUST be operable
with the keyboard.

#### Scenario: New phone, not signed in

- **WHEN** someone opens the app on a phone that has never been used and taps "Hilfe"
- **THEN** the help page opens with the installation steps, without a sign-in prompt

#### Scenario: From the sign-in screen

- **WHEN** a parent is on the sign-in screen and wants to know how to install the app
- **THEN** a link on that screen opens the help page

#### Scenario: Nothing internal

- **WHEN** the help text is checked for addresses, host names, e-mail addresses, credentials and personal names
- **THEN** none are found

### Requirement: Selectable Text

Text on every screen MUST be selectable and copyable. Only controls and tap targets (buttons, kid tiles, profile cards, the
shopping entry button, check buttons) MAY switch text selection off.

#### Scenario: Copying a to-do title

- **WHEN** a parent selects the text of a to-do in the parents' view
- **THEN** the selection works and the text can be copied

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

The household security baseline is fixed once in [SPEC-0001](../household-platform/spec.md) § "Security Requirements"
and applies unchanged here.

### Authentication

Per SPEC-0001 § "Security Requirements → Authentication". The navigation and the route guard only decide what is shown;
every data request remains Auth: Required and is authorised by the server rules. This capability adds no endpoints.

### Rate Limiting

Per SPEC-0001 § "Security Requirements → Rate Limiting". No deviation in this capability.

### Security Headers

Per SPEC-0001 § "Security Requirements → Security Headers". No deviation in this capability.

### Request Body Size Limits

Per SPEC-0001 § "Security Requirements → Request Body Size Limits". This capability accepts no request bodies.

### CSRF Protection

Per SPEC-0001 § "Security Requirements → CSRF Protection". No deviation in this capability.

### Redirect Validation

Per SPEC-0001 § "Security Requirements → Redirect Validation". The guard's redirects are client-side and target only
in-app hash routes (`#/…`); user-supplied addresses are never used as redirect targets.

## Accessibility Requirements

This spec involves user-facing UI. The following are MANDATORY for every UI component this spec produces, per WCAG 2.1 AA:

- **WCAG 2.1 AA compliance** — the minimum conformance target
- **ARIA landmarks** — `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"` on page-structure elements
- **`aria-label` on icon-only controls** — every button or link with no visible text label
- **`aria-live` regions for dynamic content** — `polite` for routine updates, `assertive` for critical status changes (HTMX swaps, auto-refresh panels, real-time status)
- **Keyboard navigation** — logical tab order, Enter/Space activation, Escape to dismiss, arrow keys within composite widgets
- **Focus management in modals and dialogs** — trap focus while open, move focus to the first focusable element on open, return it to the trigger on close

The full checklist behind each line is the SDD plugin's `references/accessibility-requirements.md`; this section is the normative summary and is not expanded inline.
