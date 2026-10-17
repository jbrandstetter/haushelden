---
status: draft
date: 2026-10-17
requires: [SPEC-0001, SPEC-0008, SPEC-0009]
---

# SPEC-0010: Family Cleaning Day

## Graph Edges

- **Requires:** [SPEC-0001](../household-platform/spec.md) — members, kid access on enrolled devices, live sync, offline queue, security baseline
- **Requires:** [SPEC-0008](../app-shell-and-navigation/spec.md) — header navigation, route guard, help page
- **Related:** [SPEC-0009](../meal-plan/spec.md) — the same "kids take part, parents override" model and the "today" line on the kid board

## Overview

Kathrin wants a family cleaning day (Putztag): one checklist for the whole household, with a share of the work for the
kids, for her and for Johannes. Everybody can see the whole list, so nobody wonders what the others are doing. Parents
assign the chores; each person ticks off their own. The app ships a standard set of chores in German (taken from the
checklist Kathrin sent: a kids' part, one part for each parent), parents can change that set and add their own, and
starting a cleaning day copies the set into a dated list.

A cleaning day is just a date that has chores; no further record exists. It is not a recurring routine (SPEC-0002) and not
a to-do (SPEC-0003): it is a one-off checklist that is started when the family decides to clean.

**Not in this spec**: recurrence ("every second Saturday"), points or rewards, reminders, photos, and a per-room view.

## Requirements

### Requirement: Cleaning Day List

The Putztag screen (`#/putztag`) MUST show the chores of one cleaning day to every signed-in session, parents, PIN
sessions and family devices alike. The list MUST be grouped by the person the chore is assigned to (kids first, then the
parents, then "Noch niemandem zugeteilt"), MUST show for each chore whether it is done and by whom, and MUST show the
progress of the day as a whole and per person ("5 von 12 erledigt"). The screen MUST open on today when today is a
cleaning day, otherwise on the next upcoming cleaning day, otherwise on the most recent one, and MUST let the user move
between the cleaning days that exist. Changes MUST sync live to the other devices and MUST work offline (SPEC-0001 Offline Operation).

#### Scenario: Everybody sees everything

- **WHEN** the daughter opens Putztag on the family iPad on a cleaning day
- **THEN** she sees the chores of her brother, of both parents and the unassigned ones, grouped by person, with the progress of the day

#### Scenario: Day to open on

- **WHEN** Putztag is opened on a Thursday and the only cleaning days are the Saturday after and one two weeks ago
- **THEN** the coming Saturday is shown

### Requirement: Ticking Off

A parent or PIN session MUST be able to tick off and un-tick any chore. A child on a family device MUST be able to tick
off and un-tick only the chores assigned to the profile chosen on that device; chores of other people, including the
parents, MUST be shown but MUST NOT be tickable. A ticked chore records who ticked it. Un-ticking MUST clear it. A chore
that is not assigned to anyone MUST be tickable by parents only.

#### Scenario: Kid ticks their own chore

- **WHEN** the son, chosen on the family iPad, taps one of his chores
- **THEN** it shows as done with his avatar on every device within the live-sync window

#### Scenario: Kid cannot tick someone else's chore

- **WHEN** the son taps a chore assigned to a parent or to his sister
- **THEN** nothing changes; those chores are shown without a tick control for him

#### Scenario: Parent ticks for a child

- **WHEN** a parent taps a chore assigned to a child
- **THEN** the chore is done and shows the parent as the one who ticked it

### Requirement: Standard Chores

The app MUST keep a set of standard chores (`chore_templates`), editable by parents only. A standard chore has a title,
who it is for ("Jedes Kind", one named member, or nobody yet) and how often it is due ("bei jedem Putztag", "alle 2
Wochen" or "monatlich"). When there are no standard chores yet, a parent MUST be offered the starter set (the checklist
Kathrin sent, translated into German: a part for each child, and two parts for the parents, which the parent maps to the two
parents), and the parent MUST be able to change, delete or add to it afterwards. Titles are plain text of at most 80 characters.

#### Scenario: First use

- **WHEN** a parent opens the standard chores for the first time and none exist
- **THEN** the app offers to take over the starter set and asks which parent gets which of the two parent parts

#### Scenario: Add a chore of our own

- **WHEN** a parent adds "Balkon kehren", for Julian, monthly
- **THEN** it is part of the standard chores and is added to every later cleaning day that is at least a month after the last time it was done

### Requirement: Starting a Cleaning Day

A parent MUST be able to start a cleaning day for a date (today or later; the form opens on the next Saturday). Starting
copies the standard chores into chores of that day: a chore "for each child" becomes one chore per child, a chore for a named
member is assigned to them, a chore for nobody is unassigned. A standard chore with an interval MUST be left out when it was
ticked on a cleaning day closer than its interval before the new one. Starting a day MUST NOT duplicate chores that already
exist for that date from the same standard chore and person, so starting a day twice only adds what is missing. Parents MUST
be able to delete a whole cleaning day after confirming.

#### Scenario: Start for Saturday

- **WHEN** a parent starts a cleaning day for Saturday with the starter set in place and two children
- **THEN** every kids' chore exists once per child, the parents' chores are assigned to the parents, and the day shows 0 of N done

#### Scenario: Monthly chore left out

- **WHEN** a day is started 14 days after a day on which the monthly "Staubsaugerfilter reinigen" was ticked
- **THEN** that chore is not on the new day

#### Scenario: Started twice

- **WHEN** a parent starts the same date twice
- **THEN** no chore appears twice

### Requirement: Assigning and Adding Chores

Parents MUST be able to assign a chore to any member or to nobody, to change the assignment later, to change the title, to add
a one-off chore to a cleaning day and to delete a chore. Reassigning a ticked chore MUST clear the tick. Children MUST NOT
assign, add, change or delete chores.

#### Scenario: Assign the open ones

- **WHEN** a parent assigns an unassigned chore to the daughter
- **THEN** it appears in her group on every device, and she can tick it

#### Scenario: One-off chore

- **WHEN** a parent adds "Garage kehren" to Saturday for Johannes
- **THEN** it appears in his group for that day only; the standard chores are unchanged

### Requirement: Cleaning Day on the Kid Board

On a day that has chores, the kid board and "Wer bist du?" MUST show a line "Putztag heute" with the progress of the day (on
the kid board: how many of that child's chores are still open) and a link to the screen. On a day without chores nothing is shown.

#### Scenario: Reminder on the board

- **WHEN** the son opens his board on a cleaning day and has 3 of 5 chores open
- **THEN** a line names the open chores count and links to Putztag

### Requirement: Navigation and Help

Putztag MUST be reachable from the header for parents, PIN sessions and family devices; the route MUST be in the route
guard's list of signed-in routes; the help page MUST describe it in the family's own words.

#### Scenario: Reachable from everywhere

- **WHEN** any signed-in session is on any screen
- **THEN** the header offers "Putztag"

## Security Requirements

- **Authentication**: All Putztag routes and collections require a session (parent, PIN or enrolled device). There is no public cleaning day route and no new HTTP route.
- **Authorisation**: Parent and PIN sessions read and write everything. Family devices read everything; they may change a
  chore only to tick it or un-tick it, only when it is assigned to a kid member, and the member recorded as having ticked it
  must be that assignee. They cannot create or delete chores or change titles, days, assignees or standard chores. Enforced by
  collection rules, not by the UI (ADR-0003). As with ticks and meal votes, the acting kid on a shared iPad is the profile
  chosen on it; the server cannot tell two children on one device apart.
- **Rate limiting**: No new route; the existing PocketBase and `/api/hh/` limits apply.
- **Input**: Titles are plain text of 1 to 80 characters, notes are not offered; days are `YYYY-MM-DD` and validated; intervals
  are whole numbers of days between 0 and 365. Everything is rendered as text, never as HTML.
- **Data**: Contains nothing beyond what the household types; included in export and backup like all collections.
