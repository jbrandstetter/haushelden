// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Automatic Refill" (marked automatic
// items with their reason; deferral after an unbought removal), REQ "Purchase History and Rhythm"
//
// Extends the shopping collections for the purchase-history story. No data is created here: the production
// household starts with an empty purchase history (the prototype's demo history is never imported).
//  - purchases.skip_until: household day until which an automatic item is not added again. It is written only by
//    the hook (purchases have no create or update rule) on the latest purchase row of the item, so it stops
//    counting once the item is bought again.
//  - shop_items.auto_rhythm / auto_last: the reason shown on an automatic item (rhythm in days, day of the last
//    purchase when it was added). Only the server writes them; devices may not set them (rules below).

/* global TextField, NumberField */

migrate(
  (app) => {
    const purchases = app.findCollectionByNameOrId("purchases");
    purchases.fields.add(
      new TextField({ name: "skip_until", max: 10, pattern: "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$" }),
    );
    app.save(purchases);

    const items = app.findCollectionByNameOrId("shop_items");
    items.fields.add(new NumberField({ name: "auto_rhythm", min: 0, max: 3650, onlyInt: true }));
    items.fields.add(
      new TextField({ name: "auto_last", max: 10, pattern: "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$" }),
    );
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    const serverOnly = ["auto_rhythm", "auto_last"]
      .map((f) => `@request.body.${f}:isset = false`)
      .join(" && ");
    items.createRule =
      `${parent} || (${device} && @request.body.by:isset = true && @request.body.by != "" ` +
      `&& (@request.body.bought:isset = false || @request.body.bought = "") ` +
      `&& (@request.body.auto:isset = false || @request.body.auto = false) && ${serverOnly})`;
    const onlyBought = ["name", "list", "by", "auto", "key", "auto_rhythm", "auto_last"]
      .map((f) => `@request.body.${f}:isset = false`)
      .join(" && ");
    items.updateRule = `${parent} || (${device} && ${onlyBought})`;
    app.save(items);
  },
  (app) => {
    const purchases = app.findCollectionByNameOrId("purchases");
    purchases.fields.removeByName("skip_until");
    app.save(purchases);
    const items = app.findCollectionByNameOrId("shop_items");
    items.fields.removeByName("auto_rhythm");
    items.fields.removeByName("auto_last");
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    items.createRule =
      `${parent} || (${device} && @request.body.by:isset = true && @request.body.by != "" ` +
      `&& (@request.body.bought:isset = false || @request.body.bought = "") ` +
      `&& (@request.body.auto:isset = false || @request.body.auto = false))`;
    items.updateRule =
      `${parent} || (${device} && ` +
      ["name", "list", "by", "auto", "key"].map((f) => `@request.body.${f}:isset = false`).join(" && ") +
      ")";
    app.save(items);
  },
);
