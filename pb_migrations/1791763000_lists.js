// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Lists", SPEC-0001 design table
// "Three principal types, rules per collection" (lists: parent full, device read)
//
// `lists`: the shopping lists. Parents add, rename and delete them; enrolled devices only read. The two default
// lists are inserted here so every household has them without depending on the setup route. Their ids are fixed
// so the tab order (by id when `created` ties) is stable: Lebensmittel first, dm second.

migrate(
  (app) => {
    const parent = '@request.auth.collectionName = "parents"';
    const parentOrDevice = `${parent} || @request.auth.collectionName = "devices"`;

    const lists = new Collection({
      type: "base",
      name: "lists",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: parent,
      deleteRule: parent,
      fields: [
        { name: "emoji", type: "text", required: true, min: 1, max: 16 },
        { name: "name", type: "text", required: true, min: 1, max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(lists);

    const saved = app.findCollectionByNameOrId("lists");
    for (const [id, emoji, name] of [
      ["list1food000001", "🛒", "Lebensmittel"],
      ["list2dm00000001", "🧴", "dm"],
    ]) {
      const record = new Record(saved);
      record.set("id", id);
      record.set("emoji", emoji);
      record.set("name", name);
      app.save(record);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("lists"));
  },
);
