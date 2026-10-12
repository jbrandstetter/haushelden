// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0003 REQ "Areas of Responsibility",
// SPEC-0001 design table "Three principal types, rules per collection" (`areas`: parents full, devices none)
//
// `areas`: the household's areas of responsibility (emoji, name, optional owner). The owner is one PARENT member
// or empty; the create/update rules refuse a kid or an unknown id. Parents have full access, devices and anonymous
// callers get nothing (null rules). Removing the owner member leaves the area behind, unowned (no cascade).
// The seven generic starter areas ship in this migration with no owner: owners are the family's decision.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const ownerOk = `(@request.body.owner:isset = false || @request.body.owner = "" || @request.body.owner.role = "parent")`;

    const areas = new Collection({
      type: "base",
      name: "areas",
      listRule: parent,
      viewRule: parent,
      createRule: `${parent} && ${ownerOk}`,
      updateRule: `${parent} && ${ownerOk}`,
      deleteRule: parent,
      fields: [
        { name: "emoji", type: "text", max: 16 },
        { name: "name", type: "text", required: true, min: 1, max: 80 },
        { name: "owner", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(areas);

    const starters = [
      ["🏠", "Haus & Garten"],
      ["🚗", "Auto"],
      ["💶", "Finanzen & Versicherungen"],
      ["🏫", "Schule & Kinder"],
      ["🩺", "Gesundheit & Ärzte"],
      ["🚙", "Hobbys & Fahrdienste"],
      ["🖥️", "Technik & Smart Home"],
    ];
    for (const [emoji, name] of starters) {
      const record = new Record(areas);
      record.set("emoji", emoji);
      record.set("name", name);
      app.save(record);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("areas"));
  },
);
