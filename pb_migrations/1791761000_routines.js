// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0002 REQ "Routine Items", REQ "Alternating Assignment"; SPEC-0001 design "Three principal types, rules per
// collection"
//
// `routines`: recurring items (chores, hobbies). Parents have full access; enrolled devices (the kids' boards) only
// read. A kid session therefore cannot change a routine's weekdays (SPEC-0002 "Kid cannot edit routines").
//
// `who` is the assignment: one specific member (`member`, a kid or a parent), both kids, kids alternating, or both
// parents. `days` are the weekdays it occurs on as strings "0".."6", Monday = 0 (the prototype's wd()), so the
// server validates them as a select.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const parentOrDevice = `${parent} || @request.auth.collectionName = "devices"`;

    const routines = new Collection({
      type: "base",
      name: "routines",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: parent,
      deleteRule: parent,
      fields: [
        { name: "emoji", type: "text", required: true, min: 1, max: 16 },
        { name: "title", type: "text", required: true, min: 1, max: 80 },
        { name: "hint", type: "text", max: 120 },
        // Optional time of day, "HH:MM" (24 h).
        { name: "time", type: "text", max: 5, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
        { name: "kind", type: "select", required: true, maxSelect: 1, values: ["chore", "hobby"] },
        {
          name: "days",
          type: "select",
          maxSelect: 7,
          values: ["0", "1", "2", "3", "4", "5", "6"],
        },
        {
          name: "who",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["member", "kids", "kids_alternating", "parents"],
        },
        // Only used when who = "member". Removing the member removes their own routines.
        { name: "member", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(routines);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("routines"));
  },
);
