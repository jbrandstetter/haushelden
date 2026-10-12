// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Automatic Refill" (server hook, runs
// daily and when a list is opened, so devices never create duplicate automatic items), REQ "Learned Overview"
// (parents reset the purchase history), SPEC-0001 Security Requirements (authenticated endpoints, body limits)
//
//  - hourly job: refills every list for the household day (idempotent; hourly instead of once at a fixed time so
//    the new household day is picked up whatever the zone; a daily run is a subset of it)
//  - POST /api/hh/refill {list}: the app calls it when a list is opened; parents and devices
//  - POST /api/hh/purchases/reset {list?}: parents only; deletes the purchase history (of one list or all)
//  - removing an automatic item without buying it defers it (see "Removal recognised as unbought" below)
//
// Removal recognised as unbought: deleting a shop_items row whose `auto` is true and `bought` is empty. Only
// parents can delete (rule); "Einkauf fertig" deletes ticked items (bought set) and a list deletion cascades
// without running this hook, so neither defers. (Handlers run in isolated scopes: helpers live in lib/.)

/* global BadRequestError, NotFoundError */

cronAdd("hh_auto_refill", "7 * * * *", () => {
  const s = require(`${__hooks}/lib/shopping.js`);
  const learning = require(`${__hooks}/lib/learning.js`);
  learning.refillAll($app, s.householdDay($app));
});

routerAdd(
  "POST",
  "/api/hh/refill",
  (e) => {
    const s = require(`${__hooks}/lib/shopping.js`);
    const learning = require(`${__hooks}/lib/learning.js`);
    const body = e.requestInfo().body || {};
    const listId = typeof body.list === "string" ? body.list : "";
    if (!/^[a-z0-9]{15}$/.test(listId)) throw new BadRequestError("Ungültige Liste.");
    try {
      e.app.findRecordById("lists", listId);
    } catch {
      throw new NotFoundError("Liste nicht gefunden.");
    }
    return e.json(200, { added: learning.refillList(e.app, listId, s.householdDay(e.app)) });
  },
  $apis.bodyLimit(1024),
  $apis.requireAuth("parents", "devices"),
);

routerAdd(
  "POST",
  "/api/hh/purchases/reset",
  (e) => {
    const learning = require(`${__hooks}/lib/learning.js`);
    const body = e.requestInfo().body || {};
    let listId = "";
    if (body.list !== undefined && body.list !== "") {
      listId = typeof body.list === "string" ? body.list : "";
      if (!/^[a-z0-9]{15}$/.test(listId)) throw new BadRequestError("Ungültige Liste.");
    }
    return e.json(200, { deleted: learning.resetHistory(e.app, listId) });
  },
  $apis.bodyLimit(1024),
  $apis.requireAuth("parents"),
);

// Registered after the shopping hooks' own delete handler; runs inside the delete's transaction.
onRecordDelete((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  const learning = require(`${__hooks}/lib/learning.js`);
  if (e.record.getBool("auto") && e.record.getString("bought") === "") {
    let listExists = true;
    try {
      e.app.findRecordById("lists", e.record.getString("list"));
    } catch {
      listExists = false;
    }
    if (listExists) learning.deferRemoved(e.app, e.record, s.householdDay(e.app));
  }
  e.next();
}, "shop_items");
