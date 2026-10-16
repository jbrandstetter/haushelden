---
status: draft
date: 2026-10-16
implements: [ADR-0007]
requires: [SPEC-0001, SPEC-0005, SPEC-0008]
---

# SPEC-0009: Weekly Meal Plan

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — members, kid access, live sync, offline queue, security baseline
- **Requires:** [SPEC-0005](../shopping-lists/spec.md) — the grocery list that ingredients are added to
- **Requires:** [SPEC-0008](../app-shell-and-navigation/spec.md) — header navigation, route guard, help page
- **Implements:** [ADR-0007](../../../adrs/ADR-0007-server-side-auto-refill-and-purchase-rhythm.md) — server-side, idempotent list changes (the ingredient action follows the same rules as the refill)

## Overview

Kathrin wants to plan the family's meals for the week: what is cooked on which day, and what has to be bought for it.
The plan is a week grid with one entry per day and slot, filled from a small library of the family's own dishes or
typed freely. From the plan, the ingredients of the week MAY be put on the grocery list in one step. Everyone can see
the plan, including the kids ("Was gibt's heute?"); parents edit it.

**Not v1 of the meal plan**: recipes with steps or quantities, nutrition, an LLM that proposes a week (SPEC-0006 MAY
do that later by proposing entries), and showing meals in the family calendar.

## Requirements

### Requirement: Week View

The meal plan screen (`#/essen`) MUST show one week, Monday to Sunday, with a row per day and the slots "Mittagessen"
and "Abendessen". It MUST open on the current week, MUST highlight today, and MUST let the user move to the previous and
next week and back to the current one. A day or slot without an entry MUST be shown as empty and, for parents, as a place
to add one. The week is computed from dates; no week records exist.

#### Scenario: Opening the plan

- **WHEN** a parent opens "Essen" on a Wednesday
- **THEN** the current week is shown, Wednesday is highlighted, and empty slots offer to add a meal

### Requirement: Plan Entries

A parent MUST be able to set, change and clear the entry of a day and slot. An entry has a title, optionally a link to a
dish from the dish library, optionally the member who cooks, and optionally a short note. Typing a title that matches a
library dish MUST offer that dish; a title that matches nothing MUST be accepted as free text. One slot of one day MUST
hold at most one entry. Changes MUST sync live to the other devices and MUST work offline (SPEC-0001 Offline Operation).

#### Scenario: Plan a dinner

- **WHEN** a parent types "Spaghetti" for Thursday dinner and picks the dish from the suggestions
- **THEN** Thursday dinner shows "Spaghetti" with the dish's emoji on every device within the live-sync window

#### Scenario: One entry per slot

- **WHEN** a second entry is saved for Thursday dinner
- **THEN** it replaces the first; there is never more than one entry per day and slot

### Requirement: Dish Library

The household SHALL keep a library of dishes with a name, an emoji, an ingredient list (one ingredient per line, names
only) and the date it was last planned. Parents MUST be able to add, edit and delete dishes; deleting a dish MUST keep the
plan entries that used it as free text. Planning a dish MUST update its "last planned" date. The library MUST suggest
dishes that have not been planned for the longest time first and MUST show "zuletzt vor N Tagen".

#### Scenario: Rotation hint

- **WHEN** a parent opens the suggestions for an empty slot
- **THEN** dishes planned long ago, and never planned, are listed before dishes planned this week

### Requirement: Ingredients to the Shopping List

A parent MUST be able to add the ingredients of a day or of the whole displayed week to the grocery list with one
action. The server MUST add each ingredient as an open item by the same name rules as manual adding (SPEC-0005 "Adding
Items"): an ingredient that is already open or in the cart on that list MUST NOT be duplicated, and repeating the action
MUST NOT create further items. Each created item MUST record the meal it came from. The action MUST report how many items
were added and how many were already on the list. It MUST NOT record a purchase.

#### Scenario: Whole week

- **WHEN** the week contains two dishes that both need "Zwiebeln" and the list already has "Milch" open for another dish
- **THEN** "Zwiebeln" is added once, "Milch" is not added again, and the result says what was added and what was already there

#### Scenario: Repeat

- **WHEN** the same action runs again with no changes
- **THEN** nothing is added and the result reports zero new items

### Requirement: Copy and Clear

A parent MUST be able to copy a week's plan onto another week (default: the following week) and to clear a week. Copying
onto a week that already has entries MUST ask whether to replace or to fill only the empty slots, and MUST NOT delete
anything before the parent decided.

#### Scenario: Copy last week

- **WHEN** a parent copies last week to this week, which is empty
- **THEN** every entry appears on the same weekday of this week

### Requirement: What Is for Dinner Today

The kids' board and the profile chooser MUST show today's planned meals (when there are any) as a read-only line.
Kids MUST NOT be able to change the plan. Family devices MUST be able to read the plan (SPEC-0001 "Kid Access on
Enrolled Devices").

#### Scenario: Kid looks at the board

- **WHEN** a child opens the board on the family iPad and tonight's dinner is "Pizza"
- **THEN** the board shows "Heute: Pizza" and offers no way to edit it

### Requirement: Navigation and Help

"Essen" MUST be an entry in the header navigation for parent and PIN sessions and for family devices (SPEC-0008), the
route MUST be in the route guard's list, and the help page MUST describe the meal plan in the family's own words.

#### Scenario: Reachable from everywhere

- **WHEN** a parent is on any screen
- **THEN** the header offers "Essen" and it opens the current week

## Security Requirements

- **Authentication**: All meal plan routes require a session (parent, PIN or enrolled device). There is no public meal plan route.
- **Authorisation**: Parent and PIN sessions read and write plan entries and dishes; family devices read only. Enforced by
  collection rules, not by the UI (ADR-0003).
- **Rate limiting**: The ingredient action follows the existing `/api/hh/` limits.
- **Input**: Titles, notes and ingredient lines are plain text with length limits (title 80, note 200, ingredient 60
  characters, at most 40 ingredients per dish); they are rendered as text, never as HTML.
- **Data**: Contains nothing beyond what the household types; included in export and backup like all collections.
