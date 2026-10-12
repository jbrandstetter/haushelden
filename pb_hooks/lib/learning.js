// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Automatic Refill", REQ "Purchase
// History and Rhythm", REQ "Learned Overview", SPEC-0001 REQ "Household Day and Time Zone"
//
// Server side of the shopping learning for pb_hooks/learning.pb.js: reads the purchases of a list, asks the shared
// pure module (app/js/rhythm.js, the same file the app uses; app/ and pb_hooks/ are installed side by side) what
// is due, and adds those items as automatic items. Everything takes the app (or transaction app) as an argument.
// Covered against a real PocketBase in test/rules/learning.test.js.

/* global __hooks, Record, $dbx */
const rhythm = require(`${__hooks}/../app/js/rhythm.js`);
const shopping = require(`${__hooks}/lib/shopping.js`);

/** Automatic refill is on unless a parent switched it off (no settings record yet means the default: on). */
function autoRefillEnabled(app) {
  try {
    const rows = app.findAllRecords("settings");
    return rows.length === 0 || rows[0].getBool("auto_refill");
  } catch {
    return true;
  }
}

function purchaseRows(app, listId) {
  return app.findAllRecords("purchases", $dbx.hashExp({ list: listId })).map((r) => ({
    list: r.getString("list"),
    key: r.getString("key"),
    name: r.getString("name"),
    day: r.getString("day"),
    skip_until: r.getString("skip_until"),
  }));
}

/** Learned entries of one list (see rhythm.learn). */
const learnedFor = (app, listId) => rhythm.learn(purchaseRows(app, listId));

/**
 * Adds every due item of the list that is not already open or in the cart, marked automatic, with the reason
 * data (auto_rhythm, auto_last). Returns the number of items added. Idempotent: running it again the same day
 * adds nothing, and two simultaneous runs cannot create a duplicate (unique index on open items; the loser's
 * insert fails and is ignored).
 */
function refillList(app, listId, today) {
  if (!autoRefillEnabled(app)) return 0;
  const taken = new Set(
    app.findAllRecords("shop_items", $dbx.hashExp({ list: listId })).map((r) => r.getString("key")),
  );
  const collection = app.findCollectionByNameOrId("shop_items");
  let added = 0;
  for (const entry of learnedFor(app, listId)) {
    if (taken.has(entry.key) || !rhythm.isDue(entry, today)) continue;
    const item = new Record(collection);
    item.set("list", listId);
    item.set("name", entry.name);
    item.set("key", entry.key);
    item.set("auto", true);
    item.set("bought", "");
    item.set("auto_rhythm", entry.rhythm);
    item.set("auto_last", entry.last);
    try {
      app.save(item);
      added++;
      taken.add(entry.key);
    } catch (err) {
      // Lost a race with another run: the item exists now, which is the goal.
      if (shopping.findOpenDuplicate(app, listId, entry.key, "") === null) throw err;
    }
  }
  return added;
}

/** Refills every list. Used by the hourly job, which makes the new household day take effect everywhere. */
function refillAll(app, today) {
  let added = 0;
  for (const list of app.findAllRecords("lists")) added += refillList(app, list.id, today);
  return added;
}

/**
 * An automatic item is being deleted without having been bought: defer it by half its rhythm. Stored as
 * skip_until on the latest purchase row of the item. Does nothing for manual or ticked items, or when there is no
 * history (anymore) to defer.
 */
function deferRemoved(app, item, today) {
  if (!item.getBool("auto") || item.getString("bought") !== "") return;
  const listId = item.getString("list");
  const key = item.getString("key") || shopping.nameKey(item.getString("name"));
  const rows = app.findAllRecords("purchases", $dbx.hashExp({ list: listId, key }));
  if (rows.length === 0) return;
  const entry = rhythm.learn(
    rows.map((r) => ({
      list: listId,
      key,
      name: r.getString("name"),
      day: r.getString("day"),
    })),
  )[0];
  if (!entry || entry.rhythm == null) return;
  const latest = rows.filter((r) => r.getString("day") === entry.last)[0];
  const until = rhythm.dayKey(rhythm.dayNumber(today) + rhythm.deferDays(entry.rhythm));
  latest.set("skip_until", until);
  app.save(latest);
}

/** Deletes every purchase (of one list when `listId` is given). Returns how many were removed. */
function resetHistory(app, listId) {
  let removed = 0;
  app.runInTransaction((tx) => {
    const rows = listId
      ? tx.findAllRecords("purchases", $dbx.hashExp({ list: listId }))
      : tx.findAllRecords("purchases");
    for (const row of rows) {
      tx.delete(row);
      removed++;
    }
  });
  return removed;
}

module.exports = { autoRefillEnabled, learnedFor, refillList, refillAll, deferRemoved, resetHistory };
