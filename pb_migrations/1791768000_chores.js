// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0010 REQ "Standard Chores", REQ "Starting a Cleaning Day", REQ "Ticking Off", REQ "Assigning and Adding Chores",
// Security Requirements "Authorisation" and "Input"; design "Rules: devices may only tick, and only as the assignee"
//
// `chore_templates`: the family's standard chores (title, for each child or one member, how often it is due).
// `chores`: the items of cleaning days. A cleaning day is a `day` (`YYYY-MM-DD`, a household day) that has chores; no
// record exists for the day itself. `template` links a chore to the standard chore it came from (cleared when that is
// deleted; the chore stays). `done` and `done_by` are kept consistent by pb_hooks/putztag.pb.js.
//
// Rules: parents and PIN sessions (both `parents` accounts) read and write everything. An enrolled device reads
// everything and may only tick or un-tick: it updates a chore whose assignee is a kid member, without touching `title`,
// `day`, `assignee` or `template`, and `done_by` is empty or the assignee. A device never creates or deletes anything.
// Which of the kids it is cannot be told apart on a shared device (ADR-0003); the screen only offers a child their own.
//
// `assignee`, `done_by` and `template` are not `required` relations: a required relation without cascade would stop a
// member from ever being removed. A removed member's chores stay behind, unassigned.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    const parentOrDevice = `${parent} || ${device}`;
    const dayRe = "\\d{4}-\\d{2}-\\d{2}";

    const templates = new Collection({
      type: "base",
      name: "chore_templates",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: parent,
      deleteRule: parent,
      fields: [
        { name: "title", type: "text", required: true, min: 1, max: 80 },
        // true = one chore per kid member when a day is started; else `assignee` (may be empty = nobody yet).
        { name: "kids", type: "bool" },
        { name: "assignee", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        // 0 = on every cleaning day; else not again until that many days after it was last done.
        { name: "every_days", type: "number", min: 0, max: 365, onlyInt: true },
        { name: "sort", type: "number", min: 0, max: 100000, onlyInt: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(templates);

    // A device may only tick: kid's chore, nothing but done / done_by in the body, done_by empty or the assignee.
    const deviceTick =
      `${device} && assignee.role = "kid" && ` +
      "@request.body.title:isset = false && @request.body.day:isset = false && " +
      "@request.body.assignee:isset = false && @request.body.template:isset = false && @request.body.sort:isset = false && " +
      '(@request.body.done_by:isset = false || @request.body.done_by = "" || @request.body.done_by = assignee)';
    // A parent names themselves or the assignee as the one who ticked.
    const parentTick =
      `${parent} && (@request.body.done_by:isset = false || @request.body.done_by = "" || ` +
      "@request.body.done_by = @request.auth.member || @request.body.done_by = assignee)";

    const chores = new Collection({
      type: "base",
      name: "chores",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: parent,
      updateRule: `(${parentTick}) || (${deviceTick})`,
      deleteRule: parent,
      fields: [
        { name: "day", type: "text", required: true, min: 10, max: 10, pattern: `^${dayRe}$` },
        { name: "title", type: "text", required: true, min: 1, max: 80 },
        { name: "assignee", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { name: "done", type: "bool" },
        { name: "done_by", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        {
          name: "template",
          type: "relation",
          collectionId: app.findCollectionByNameOrId("chore_templates").id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: "sort", type: "number", min: 0, max: 100000, onlyInt: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX `idx_chores_day` ON `chores` (`day`)",
        "CREATE INDEX `idx_chores_template` ON `chores` (`template`)",
      ],
    });
    app.save(chores);
  },
  (app) => {
    for (const name of ["chores", "chore_templates"]) app.delete(app.findCollectionByNameOrId(name));
  },
);
