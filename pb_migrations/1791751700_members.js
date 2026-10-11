// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "Household and Members"
//
// `members`: the people of the household. Parents manage them; enrolled devices (and parents) read them.
// Member names live only in the household's data store, never in this repository.

migrate(
  (app) => {
    const parent = '@request.auth.collectionName = "parents"';
    const parentOrDevice = `${parent} || @request.auth.collectionName = "devices"`;

    const members = new Collection({
      type: "base",
      name: "members",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: parent,
      deleteRule: parent,
      fields: [
        { name: "role", type: "select", required: true, maxSelect: 1, values: ["parent", "kid"] },
        { name: "name", type: "text", required: true, min: 1, max: 40 },
        // Avatar: an emoji, so a short text (a ZWJ sequence can span several code points).
        { name: "emoji", type: "text", required: true, min: 1, max: 16 },
        // Catppuccin accent palette.
        {
          name: "colour",
          type: "select",
          required: true,
          maxSelect: 1,
          values: [
            "rosewater",
            "flamingo",
            "pink",
            "mauve",
            "red",
            "maroon",
            "peach",
            "yellow",
            "green",
            "teal",
            "sky",
            "sapphire",
            "blue",
            "lavender",
          ],
        },
        // Hidden: never returned by the API and not usable in client filters (SPEC-0001 "Kid Access", PIN).
        { name: "pin_hash", type: "text", hidden: true, max: 200 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(members);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("members"));
  },
);
