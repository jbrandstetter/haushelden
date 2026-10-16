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
typed freely. From the plan, the ingredients of a dish, a day or the week MAY be put on the grocery list in one step.
Everyone can see the plan, including the kids ("Was gibt's heute?"). Kids MAY propose meals for empty slots, parents
can change or replace anything, and every member can give a meal a thumbs up or down.

**Not v1 of the meal plan**: breakfast, recipes with steps or quantities, nutrition, an LLM that proposes a week (SPEC-0006 MAY
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

Parents MUST be able to set, change and clear the entry of any day and slot. Kids MUST be able to add an entry to an
empty slot and to change or clear the entries they added themselves; they MUST NOT change or clear an entry a parent
added or an entry another child added. An entry records who added it and has a title, optionally a link to a
dish from the dish library, optionally the member who cooks, and optionally a short note. Typing a title that matches a
library dish MUST offer that dish; a title that matches nothing MUST be accepted as free text. One slot of one day MUST
hold at most one entry. Changes MUST sync live to the other devices and MUST work offline (SPEC-0001 Offline Operation).

#### Scenario: Plan a dinner

- **WHEN** a parent types "Spaghetti" for Thursday dinner and picks the dish from the suggestions
- **THEN** Thursday dinner shows "Spaghetti" with the dish's emoji on every device within the live-sync window

#### Scenario: Kid proposes a meal

- **WHEN** the son taps Friday dinner, which is empty, on the family iPad and enters "Pizza"
- **THEN** Friday dinner shows "Pizza" with his avatar on every device

#### Scenario: Parent overrides

- **WHEN** a parent replaces the son's "Pizza" with "Lasagne"
- **THEN** the slot shows "Lasagne" added by the parent; the son cannot change it, and the earlier votes on "Pizza" no longer apply

#### Scenario: One entry per slot

- **WHEN** a second entry is saved for Thursday dinner
- **THEN** it replaces the first; there is never more than one entry per day and slot

### Requirement: Dish Library

The household SHALL keep a library of dishes with a name, an emoji, an ingredient list (one ingredient per line, names
only) and the date it was last planned. Every member, kids included, MUST be able to add a dish and to edit the dishes
they added; parents MUST be able to add, edit and delete any dish; deleting a dish MUST keep the
plan entries that used it as free text. Planning a dish MUST update its "last planned" date. The library MUST suggest
dishes that have not been planned for the longest time first and MUST show "zuletzt vor N Tagen".

#### Scenario: Rotation hint

- **WHEN** a parent opens the suggestions for an empty slot
- **THEN** dishes planned long ago, and never planned, are listed before dishes planned this week

### Requirement: Thumbs Up and Down

Every member, including children on a family device and parents, MUST be able to give each plan entry one thumbs up or
one thumbs down, change it and take it back. A member has at most one vote per entry. The entry MUST show the number of
thumbs up and down and the avatars of who voted. A dish MUST show the tally of the votes on all its entries so that
favourites are visible in the library, and the rotation hint MUST NOT hide a dish because of thumbs down. Votes are
attributed to the member chosen on the device; a member MUST NOT be able to change another member's vote.

#### Scenario: Vote

- **WHEN** the daughter taps thumbs up on Thursday's "Spaghetti" and later taps it again
- **THEN** her thumbs up is counted once and the second tap removes it

#### Scenario: Change of mind

- **WHEN** she taps thumbs down on an entry she gave thumbs up
- **THEN** the vote becomes thumbs down; the entry never counts two votes from her

### Requirement: Ingredients to the Shopping List

A parent MUST be able to add the ingredients of a single dish, of a day or of the whole displayed week to the grocery
list with one action. A single dish MAY be chosen from the library without being in any week. The server MUST add each ingredient as an open item by the same name rules as manual adding (SPEC-0005 "Adding
Items"): an ingredient that is already open or in the cart on that list MUST NOT be duplicated, and repeating the action
MUST NOT create further items. Each created item MUST record the meal it came from. The action MUST report how many items
were added and how many were already on the list. It MUST NOT record a purchase.

#### Scenario: Whole week

- **WHEN** the week contains two dishes that both need "Zwiebeln" and the list already has "Milch" open for another dish
- **THEN** "Zwiebeln" is added once, "Milch" is not added again, and the result says what was added and what was already there

#### Scenario: Single dish

- **WHEN** a parent taps "Zutaten auf die Liste" on "Spaghetti" in the library
- **THEN** its ingredients that are not yet on the grocery list are added and the result says how many

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
The line MUST also show the thumbs. Kids MUST NOT be able to change a parent's entries. Family devices MUST be able to
read the plan and write the kid-level changes above (SPEC-0001 "Kid Access on Enrolled Devices").

#### Scenario: Kid looks at the board

- **WHEN** a child opens the board on the family iPad and tonight's dinner, planned by a parent, is "Pizza"
- **THEN** the board shows "Heute: Pizza" and offers thumbs up and down but no way to edit it

### Requirement: Navigation and Help

"Essen" MUST be an entry in the header navigation for parent and PIN sessions and for family devices (SPEC-0008), the
route MUST be in the route guard's list, and the help page MUST describe the meal plan in the family's own words.

#### Scenario: Reachable from everywhere

- **WHEN** a parent is on any screen
- **THEN** the header offers "Essen" and it opens the current week

## Security Requirements

- **Authentication**: All meal plan routes require a session (parent, PIN or enrolled device). There is no public meal plan route.
- **Authorisation**: Parent and PIN sessions read and write all plan entries, dishes and ingredient actions. Family devices
  read everything; they create entries only in empty slots, change or delete only entries and dishes whose adder is the
  acting member, and write only the acting member's own vote. The ingredient action is parents only. Enforced by
  collection rules, not by the UI (ADR-0003). As with ticking and shopping, the acting member on a family device is the
  profile chosen on it; the server cannot tell two children apart on one shared iPad.
- **Rate limiting**: The ingredient action follows the existing `/api/hh/` limits.
- **Input**: Titles, notes and ingredient lines are plain text with length limits (title 80, note 200, ingredient 60
  characters, at most 40 ingredients per dish); they are rendered as text, never as HTML.
- **Data**: Contains nothing beyond what the household types; included in export and backup like all collections.
