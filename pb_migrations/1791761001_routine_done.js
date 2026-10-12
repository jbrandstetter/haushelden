// Governing: ADR-0001 (rules are the security model), ADR-0003 (kid access via device accounts),
// SPEC-0002 REQ "Today Board" (ticks stored per member, per item, per day); SPEC-0001 design "Three principal types,
// rules per collection", "Day boundaries in household time"
//
// `routine_done`: one record per tick. `day` is the household date `YYYY-MM-DD` (never a timestamp), unique per
// routine and member. Parents have full access. An enrolled device may create and delete a tick only for a kid
// member (a kid cannot tick for a parent) and may read ticks; ticks are never edited.
//
// Rules cannot compare against the household date, so devices read every tick (the board's week strip needs the
// past days too); see the PR notes.

migrate(
  (app) => {
    const routines = app.findCollectionByNameOrId("routines");
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';

    const done = new Collection({
      type: "base",
      name: "routine_done",
      listRule: `${parent} || ${device}`,
      viewRule: `${parent} || ${device}`,
      createRule: `${parent} || (${device} && @request.body.member.role = "kid")`,
      updateRule: parent,
      deleteRule: `${parent} || (${device} && member.role = "kid")`,
      fields: [
        {
          name: "routine",
          type: "relation",
          required: true,
          collectionId: routines.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: "member",
          type: "relation",
          required: true,
          collectionId: members.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: "day", type: "text", required: true, min: 10, max: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_routine_done_unique` ON `routine_done` (`routine`, `member`, `day`)",
      ],
    });
    app.save(done);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("routine_done"));
  },
);
