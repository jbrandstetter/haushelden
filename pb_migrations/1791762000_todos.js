// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0003 REQ "To-dos",
// SPEC-0001 design "Three principal types, rules per collection" (`todos`: parents full, devices none),
// REQ "Kid Access on Enrolled Devices" (Device reads to-dos: no records)
//
// `todos`: the parents' to-dos. `who` is one parent member id or the literal `parents` (both). `due` and `done`
// are household-day `YYYY-MM-DD` strings (empty = no due date / not done), never timestamps, so no time zone is
// involved on the server (SPEC-0001 "Day boundaries in household time"). `area` is a plain text id for now; the
// `areas` collection (SPEC-0003 "Areas of Responsibility") arrives with its own story, which turns this into a
// relation. Parents have full access; devices and anonymous callers get nothing (null rules; list rules that
// do not match return an empty list, the others are refused).

migrate(
  (app) => {
    const parent = '@request.auth.collectionName = "parents"';
    // `who` must be "parents" or the id of a parent member (not a kid, not a made-up id).
    const whoOk =
      '(@request.body.who:isset = false || @request.body.who = "parents" || ' +
      '(@collection.members:m.id ?= @request.body.who && @collection.members:m.role ?= "parent"))';
    const day = "^(\\d{4}-\\d{2}-\\d{2})?$";

    const todos = new Collection({
      type: "base",
      name: "todos",
      listRule: parent,
      viewRule: parent,
      createRule: `${parent} && ${whoOk}`,
      updateRule: `${parent} && ${whoOk}`,
      deleteRule: parent,
      fields: [
        { name: "title", type: "text", required: true, min: 1, max: 200 },
        { name: "who", type: "text", required: true, max: 15, pattern: "^([a-z0-9]{15}|parents)$" },
        { name: "due", type: "text", max: 10, pattern: day },
        { name: "area", type: "text", max: 15, pattern: "^([a-z0-9]{15})?$" },
        { name: "done", type: "text", max: 10, pattern: day },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX `idx_todos_due` ON `todos` (`due`)"],
    });
    app.save(todos);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("todos"));
  },
);
