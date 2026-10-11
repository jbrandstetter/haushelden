// Governing: ADR-0003 (kid access via device accounts), SPEC-0001 REQ "Device Enrollment and Removal",
// REQ "Kid Access on Enrolled Devices"
//
// `devices`: auth collection for enrolled family devices. The device holds a random secret (the password) that
// only the app knows. Records are created by the enrollment route (later story) on behalf of a signed-in parent;
// a parent lists and removes devices; removing a record invalidates its tokens.

migrate(
  (app) => {
    const parents = app.findCollectionByNameOrId("parents");
    const parent = '@request.auth.collectionName = "parents"';

    const devices = new Collection({
      type: "auth",
      name: "devices",
      listRule: parent,
      viewRule: parent,
      createRule: null,
      updateRule: null,
      deleteRule: parent,
      passwordAuth: { enabled: true, identityFields: ["email"] },
      fields: [
        { name: "name", type: "text", required: true, min: 1, max: 60 },
        { name: "last_seen", type: "date" },
        // Cleared (not cascaded) when the enrolling parent is removed: the device stays enrolled.
        { name: "enrolled_by", type: "relation", collectionId: parents.id, maxSelect: 1 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    // The secret is >= 32 random bytes (hex or base64), generated on the device.
    // (the built-in password field only exists once the collection is saved)
    app.save(devices);
    const saved = app.findCollectionByNameOrId("devices");
    saved.fields.getByName("password").min = 32;
    app.save(saved);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("devices"));
  },
);
