// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0001 REQ "First-Run Setup" (single-use invite
// link valid for 48 hours)
//
// `invites`: one record per invite link of the first parent for the second one. Only the SHA-256 of the token is
// stored (the token itself is shown once, in the invite link). No API rules: the collection is closed to every
// client and read and written only by the /api/hh/invite routes with server privileges.

migrate(
  (app) => {
    const parents = app.findCollectionByNameOrId("parents");
    const invites = new Collection({
      type: "base",
      name: "invites",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "token_hash", type: "text", required: true, max: 100 },
        { name: "created_by", type: "relation", collectionId: parents.id, maxSelect: 1, cascadeDelete: true },
        { name: "expires", type: "date", required: true },
        // Set when the invite was accepted; a used invite never works again.
        { name: "used", type: "date" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`)"],
    });
    app.save(invites);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("invites"));
  },
);
