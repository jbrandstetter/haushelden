// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0001 REQ "Parent Authentication",
// REQ "Household and Members"
//
// `parents`: auth collection, e-mail + password (12 characters minimum), each linked 1:1 to a parent member.
// Accounts are created only by the server-side setup and invite routes (later stories), never through the
// collection API, so a signed-in parent cannot mint further accounts.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';

    const parents = new Collection({
      type: "auth",
      name: "parents",
      // Parents see each other; a parent changes only their own account.
      listRule: parent,
      viewRule: parent,
      createRule: null,
      updateRule: `${parent} && id = @request.auth.id`,
      deleteRule: null,
      passwordAuth: { enabled: true, identityFields: ["email"] },
      authToken: { duration: 60 * 60 * 24 * 30 },
      fields: [
        { name: "member", type: "relation", required: true, collectionId: members.id, maxSelect: 1 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_parents_member` ON `parents` (`member`)"],
    });
    // Auth collections ship with password, email and token fields; enforce the SPEC-0001 password length.
    // (the built-in password field only exists once the collection is saved)
    app.save(parents);
    const saved = app.findCollectionByNameOrId("parents");
    saved.fields.getByName("password").min = 12;
    app.save(saved);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("parents"));
  },
);
