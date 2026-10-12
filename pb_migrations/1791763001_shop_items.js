// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0005 REQ "Adding Items", REQ "Shopping Flow", SPEC-0001 design table "Three principal types, rules per
// collection" (shop_items: parent full; device read, create, update `bought` only)
//
// `shop_items`: one row per item on a list. `bought` is empty while the item is open and the household day
// (YYYY-MM-DD) once it is in the cart. `key` is the normalised name (trim, collapsed spaces, lower case) that the
// shopping hook maintains; a unique partial index on (list, key) among open items makes "no duplicates" hold even
// when two devices add the same name at the same moment. Hooks: pb_hooks/shopping.pb.js.

migrate(
  (app) => {
    const lists = app.findCollectionByNameOrId("lists");
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    const parentOrDevice = `${parent} || ${device}`;
    // A device may change the `bought` field and nothing else.
    const onlyBought = ["name", "list", "by", "auto", "key"]
      .map((f) => `@request.body.${f}:isset = false`)
      .join(" && ");

    const items = new Collection({
      type: "base",
      name: "shop_items",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      // A device adds an open, manual item and says who added it.
      createRule:
        `${parent} || (${device} && @request.body.by:isset = true && @request.body.by != "" ` +
        `&& (@request.body.bought:isset = false || @request.body.bought = "") ` +
        `&& (@request.body.auto:isset = false || @request.body.auto = false))`,
      updateRule: `${parent} || (${device} && ${onlyBought})`,
      deleteRule: parent,
      fields: [
        // Deleting a list deletes its items (SPEC-0005 REQ "Lists").
        {
          name: "list",
          type: "relation",
          required: true,
          collectionId: lists.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: "name", type: "text", required: true, min: 1, max: 80 },
        // Who added it. Not required: automatic items (refill story) have no member; a removed member clears it.
        { name: "by", type: "relation", collectionId: members.id, maxSelect: 1 },
        { name: "auto", type: "bool" },
        { name: "bought", type: "text", max: 10, pattern: "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$" },
        { name: "key", type: "text", hidden: true, max: 200 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_shop_items_open` ON `shop_items` (`list`, `key`) WHERE `bought` = '' AND `key` != ''",
        "CREATE INDEX `idx_shop_items_list` ON `shop_items` (`list`)",
      ],
    });
    app.save(items);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("shop_items"));
  },
);
