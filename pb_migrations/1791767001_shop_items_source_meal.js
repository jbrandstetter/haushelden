// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0009 REQ "Ingredients to the Shopping List"
// (each created item records the meal it came from), SPEC-0005 REQ "Adding Items"
//
// shop_items.source_meal: the title of the meal (or the dish) whose ingredient list put the item there, shown
// under the item as "für <meal>". Plain text, not a relation, so it survives the meal being replaced or deleted.
// Only the server writes it (the meal plan route); like auto_rhythm and auto_last, devices may not set it.

/* global TextField */

migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("shop_items");
    items.fields.add(new TextField({ name: "source_meal", max: 80 }));
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    const serverOnly = ["auto_rhythm", "auto_last", "source_meal"]
      .map((f) => `@request.body.${f}:isset = false`)
      .join(" && ");
    items.createRule =
      `${parent} || (${device} && @request.body.by:isset = true && @request.body.by != "" ` +
      `&& (@request.body.bought:isset = false || @request.body.bought = "") ` +
      `&& (@request.body.auto:isset = false || @request.body.auto = false) && ${serverOnly})`;
    const onlyBought = ["name", "list", "by", "auto", "key", "auto_rhythm", "auto_last", "source_meal"]
      .map((f) => `@request.body.${f}:isset = false`)
      .join(" && ");
    items.updateRule = `${parent} || (${device} && ${onlyBought})`;
    app.save(items);
  },
  (app) => {
    const items = app.findCollectionByNameOrId("shop_items");
    items.fields.removeByName("source_meal");
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
);
