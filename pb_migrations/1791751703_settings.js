// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0001 REQ "Household Settings",
// REQ "Household Day and Time Zone"
//
// `settings`: exactly one record (mascot choice, auto-refill switch, optional time zone override of HH_TZ).
// Parents edit it; devices only read it. The single-record rule is enforced by a unique index on a constant.

migrate(
  (app) => {
    const parent = '@request.auth.collectionName = "parents"';
    const parentOrDevice = `${parent} || @request.auth.collectionName = "devices"`;

    const settings = new Collection({
      type: "base",
      name: "settings",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: parent,
      deleteRule: null,
      fields: [
        // IANA zone name; empty means "use HH_TZ".
        { name: "tz", type: "text", max: 64, pattern: "^([A-Za-z_]+(/[A-Za-z0-9_+-]+)*)?$" },
        { name: "mascot", type: "json", maxSize: 2000 },
        { name: "auto_refill", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_settings_single` ON `settings` ((1))"],
    });
    app.save(settings);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("settings"));
  },
);
