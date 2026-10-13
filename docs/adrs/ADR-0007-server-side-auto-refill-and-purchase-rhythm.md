---
status: proposed
date: 2026-10-13
decision-makers: Johannes
extends: [ADR-0006]
governs: [SPEC-0005]
---

# ADR-0007: Purchase Rhythm as a Median, Auto-Refill on the Server

## Context and Problem Statement

The shopping lists should refill themselves with items that are bought regularly. The prototype learned on the device.
With shared lists on several devices, a device-side refill creates duplicate automatic items, and an LLM prediction is
not explainable and not necessary for a handful of staples. How is the rhythm computed and where does the refill run?

## Decision Drivers

* Each automatic item must be explainable ("etwa alle 5 Tage · zuletzt vor 4 Tagen")
* No duplicate automatic items however many devices are open
* Works offline in the app for reading; the refill itself needs no client
* Removing an item you do not need must teach the system "not yet", not "never"

## Considered Options

* Rhythm = rounded median of the last up to five purchase intervals; refill on the server (hourly job and when a list is opened)
* Rhythm on the device, refill on the device (the prototype)
* LLM-predicted purchase times

## Decision Outcome

Chosen option: "Median rhythm, server-side refill", because the median ignores one-off gaps such as holidays, the
reason is a single sentence, and a server job gives one consistent result for all devices.

Details as built:
- Rhythm: per list and normalised item name, purchase days with at most one per day; from at least two purchases,
  rhythm = round(median of the most recent ≤5 intervals), minimum 1 day. The function is pure and shared by client and
  hooks (`app/js/rhythm.js`).
- Due: today ≥ last purchase + rhythm − 1 day, and the item is not already open or in the cart on its list.
- The refill runs as an hourly idempotent job (`7 * * * *`, so the new household day is picked up whatever the time
  zone; a once-daily run would be a subset) and on `POST /api/hh/refill` when a list is opened (parents and devices).
- An automatic item is marked `auto` and shows its reason. Removing an unbought automatic item (only parents can
  delete) defers the item by ceil(rhythm / 2) days (`skip_until`, recognised inside the delete's own transaction).
  "Einkauf fertig" deletes ticked items and list deletion cascades; neither defers.
- `settings.auto_refill` switches the refill off; due items are then offered as suggestions.
- Typing suggestions rank previously bought names containing the text, prefix matches first, then by number of
  purchases, never items already open or in the cart.
- The learned overview (`#/gelernt`, parents) lists items with rhythm and purchase count; "reset purchase history" is a
  parent-only operation (`POST /api/hh/purchases/reset`). There is no demo history in production; the prototype's
  seeded demo data exists only in the dev seed.

### Consequences

* Good, because explainable and deterministic, and the same on every device
* Good, because it needs no model and no training
* Bad, because name normalisation is only case and whitespace; "Vollmilch" and "Milch" are different items until the
  assistant (SPEC-0006) proposes merges
* Bad, because an hourly job runs even when nothing changed (it is idempotent and cheap at household scale)

### Confirmation

Hook and rules tests: the spec example (purchases on days 0, 4, 10, 15, 20 give rhythm 5), due and not-due items,
deferral after an unbought removal, no duplicate open items, the settings switch, reset by parents only.

## Pros and Cons of the Options

### Median rhythm, server-side refill

* Good, because explainable, no duplicates, one source of truth
* Bad, because JS hooks plus a cron job to maintain

### Device-side learning (prototype)

* Good, because simplest, works fully offline
* Bad, because every open device would add the same automatic items to the shared list

### LLM prediction

* Good, because could infer synonyms and seasonality
* Bad, because not explainable per item, needs the network and the local model, no accuracy gain for a few staples

## Architecture Diagram

```mermaid
flowchart LR
  T[Tick on a device] --> H[Hook records purchase, ADR-0006]
  H --> P[(purchases)]
  CRON[hourly job :07] --> R[rhythm = median of last 5 intervals]
  OPEN["POST /api/hh/refill when a list opens"] --> R
  P --> R
  R -->|due and not on the list and not deferred| A[add item, auto=true with reason]
  RM[parent removes an unbought auto item] --> D[skip_until = today + ceil(rhythm/2)]
  D --> R
```

## More Information

Governs SPEC-0005 REQs "Purchase History and Rhythm", "Automatic Refill", "Suggestions While Typing" and "Learned
Overview". The history it learns from is written by ADR-0006's hooks.
