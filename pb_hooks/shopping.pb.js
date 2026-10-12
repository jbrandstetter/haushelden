// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Adding Items" (no duplicates),
// REQ "Shopping Flow" (purchase recorded on tick, removed on same-day un-tick, kept on "Einkauf fertig"),
// SPEC-0001 REQ "Offline Operation" (bought stays bought), REQ "Database Operation Standards" (one transaction)
//
// Server-side rules for `shop_items`, in two layers:
//  - Request hooks (before the transaction) validate and answer in a friendly way: normalise the name, refuse a
//    second open item of the same name on a list (400, field `name`, code `duplicate_item`), refuse an invalid
//    tick day, report a replayed create as "id already exists" (the client treats that as done), and drop an
//    un-tick that comes from a stale copy (header X-HH-Seen).
//  - Model hooks run inside the transaction of the write, so the item change and its purchase row commit together
//    or not at all: tick records one purchase per list, name and day (a replay changes nothing); a same-day
//    un-tick removes it; the sticky-bought check is repeated against the row as it is inside the transaction;
//    deleting a bought item ("Einkauf fertig") makes sure its purchase exists.
// A unique partial index on open items (migration shop_items) is the backstop for two simultaneous adds.

// (Handlers run in isolated scopes: shared helpers live in lib/shopping.js.)

onRecordCreateRequest((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  const name = s.normalizeName(e.record.getString("name"));
  const key = s.nameKey(name);
  e.record.set("name", name);
  e.record.set("key", key);
  // A replayed create (its first response was lost) has the id of an existing item: "already exists".
  let exists = false;
  if (e.record.id) {
    try {
      e.app.findRecordById("shop_items", e.record.id);
      exists = true;
    } catch {
      exists = false;
    }
  }
  if (exists) throw s.invalid("id", "validation_not_unique", "Dieser Eintrag existiert schon.");
  const bought = e.record.getString("bought");
  if (bought !== "") {
    const problem = s.checkTickDay(bought, s.householdDay(e.app));
    if (problem) throw s.invalid("bought", "invalid_day", problem);
  } else if (key !== "" && s.findOpenDuplicate(e.app, e.record.getString("list"), key, e.record.id)) {
    throw s.invalid("name", "duplicate_item", s.DUPLICATE);
  }
  e.next();
}, "shop_items");

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  const original = e.record.original();
  const was = original.getString("bought");
  const name = s.normalizeName(e.record.getString("name"));
  e.record.set("name", name);
  e.record.set("key", s.nameKey(name));

  // The device un-ticked from a copy that is no longer current: someone changed the item since. Bought stays.
  const seen = (e.requestInfo().headers || {})["x_hh_seen"];
  if (seen && was !== "" && e.record.getString("bought") === "" && seen !== original.getString("updated")) {
    e.record.set("bought", was);
  }

  const bought = e.record.getString("bought");
  if (was === "" && bought !== "") {
    const problem = s.checkTickDay(bought, s.householdDay(e.app));
    if (problem) throw s.invalid("bought", "invalid_day", problem);
  }
  if (
    bought === "" &&
    s.findOpenDuplicate(e.app, e.record.getString("list"), e.record.getString("key"), e.record.id)
  ) {
    throw s.invalid("name", "duplicate_item", s.DUPLICATE);
  }
  e.next();
}, "shop_items");

onRecordCreate((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  e.next();
  if (e.record.getString("bought") !== "") s.ensurePurchase(e.app, e.record);
}, "shop_items");

onRecordUpdate((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  // Sticky bought, judged against the row as it is now (inside the transaction), not as the request loaded it:
  // once bought, only a deliberate un-tick of an unchanged row may reopen the item, and the day never moves.
  const original = e.record.original();
  const fresh = e.app.findRecordById("shop_items", e.record.id);
  const current = fresh.getString("bought");
  const changedMeanwhile = fresh.getString("updated") !== original.getString("updated");
  let next = e.record.getString("bought");
  if (current !== "" && next !== current && !(next === "" && !changedMeanwhile)) next = current;
  e.record.set("bought", next);

  e.next();

  if (next !== "") s.ensurePurchase(e.app, e.record); // a tick, or a replayed tick: one purchase either way
  if (current !== "" && next === "" && current === s.householdDay(e.app)) {
    s.removePurchase(e.app, e.record, current);
  }
}, "shop_items");

onRecordDelete((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  if (e.record.getString("bought") !== "") {
    // (not while the whole list is being deleted: its purchases go with it)
    let listExists = true;
    try {
      e.app.findRecordById("lists", e.record.getString("list"));
    } catch {
      listExists = false;
    }
    if (listExists) s.ensurePurchase(e.app, e.record);
  }
  e.next();
}, "shop_items");
