// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Shopping Flow",
// SPEC-0001 design table "Three principal types, rules per collection" (purchases: parent read and delete,
// written by the hook only)
//
// `purchases`: MINIMAL shape owned by the shopping-flow story. One row means "this item was bought on this
// household day"; at most one per list, normalised name and day (unique index). Written only by the hook in
// pb_hooks/shopping.pb.js (no create or update rule: API clients cannot write it). The purchase-history story
// extends this collection (rhythm, auto-refill, learned overview, reset); it is not implemented here.
//   list  -> lists (cascade)    name -> latest spelling    key -> normalised name    day -> YYYY-MM-DD
//   item  -> id of the shop_items record that caused it (plain text: the item is deleted at "Einkauf fertig")

migrate(
  (app) => {
    const lists = app.findCollectionByNameOrId("lists");
    const parent = '@request.auth.collectionName = "parents"';

    const purchases = new Collection({
      type: "base",
      name: "purchases",
      listRule: parent,
      viewRule: parent,
      createRule: null,
      updateRule: null,
      deleteRule: parent,
      fields: [
        {
          name: "list",
          type: "relation",
          required: true,
          collectionId: lists.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: "name", type: "text", required: true, min: 1, max: 80 },
        { name: "key", type: "text", required: true, min: 1, max: 200 },
        { name: "day", type: "text", required: true, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
        { name: "item", type: "text", max: 15 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_purchases_day` ON `purchases` (`list`, `key`, `day`)"],
    });
    app.save(purchases);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("purchases"));
  },
);
