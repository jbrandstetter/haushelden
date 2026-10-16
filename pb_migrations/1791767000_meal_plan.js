// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0009 REQ "Plan Entries", REQ "Dish Library", REQ "Thumbs Up and Down", Security Requirements
// "Authorisation" and "Input"; design "Kids propose, parents override, everyone votes"
//
// `dishes`: the family's own dishes (name, emoji, ingredients as one name per line, `last_planned`).
// `meal_plan`: one entry per day and slot (unique index), free-text `title` with an optional `dish` link, so a
// deleted dish leaves its entries behind as plain text. `meal_votes`: one thumbs up or down per entry and member
// (unique index); deleting an entry deletes its votes, which is how a parent replacing a child's proposal resets them.
// Days (`date`, `last_planned`) are household-day `YYYY-MM-DD` strings, never timestamps.
//
// Rules: parents and PIN sessions (both `parents` accounts) read and write everything, except that `added_by` never
// changes after creation and a vote always belongs to the acting parent. An enrolled device reads everything and,
// like the ticks of `routine_done`, writes only as a kid: it creates entries, dishes and votes naming a kid member
// and changes or deletes only records that kid-level member added. A parent's entry therefore cannot be touched
// from the family iPad. Which of the kids it is cannot be told apart on a shared device (ADR-0003); the screen
// only offers a child their own records.
//
// `added_by`, `cook` and `member` are not `required` relations: a required relation without cascade would stop a
// member from ever being removed, and a removed member's records stay behind (votes go with the member).

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const parent = '@request.auth.collectionName = "parents"';
    const device = '@request.auth.collectionName = "devices"';
    const parentOrDevice = `${parent} || ${device}`;
    const dayRe = "\\d{4}-\\d{2}-\\d{2}";
    // added_by is set on creation (a parent names themselves, a device names a kid) and never changes.
    const addedByKept = "(@request.body.added_by:isset = false || @request.body.added_by = added_by)";
    const addedByNamed = '@request.body.added_by:isset = true && @request.body.added_by != ""';
    const createRule =
      `(${parent} && ${addedByNamed} && @request.body.added_by = @request.auth.member) || ` +
      `(${device} && ${addedByNamed} && @request.body.added_by.role = "kid")`;
    const updateRule = `(${parent} && ${addedByKept}) || (${device} && added_by.role = "kid" && ${addedByKept})`;
    const deleteRule = `${parent} || (${device} && added_by.role = "kid")`;

    const dishes = new Collection({
      type: "base",
      name: "dishes",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule,
      updateRule,
      deleteRule,
      fields: [
        { name: "name", type: "text", required: true, min: 1, max: 80 },
        { name: "emoji", type: "text", max: 16 },
        // One ingredient name per line: at most 40 lines of 60 characters (checked by pb_hooks/mealplan.pb.js).
        { name: "ingredients", type: "text", max: 2500 },
        { name: "last_planned", type: "text", max: 10, pattern: `^(${dayRe})?$` },
        { name: "added_by", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX `idx_dishes_last_planned` ON `dishes` (`last_planned`)"],
    });
    app.save(dishes);

    const plan = new Collection({
      type: "base",
      name: "meal_plan",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule,
      updateRule,
      deleteRule,
      fields: [
        { name: "date", type: "text", required: true, min: 10, max: 10, pattern: `^${dayRe}$` },
        { name: "slot", type: "select", required: true, maxSelect: 1, values: ["lunch", "dinner"] },
        { name: "title", type: "text", required: true, min: 1, max: 80 },
        // Deleting the dish clears the link; the title stays (SPEC-0009 REQ "Dish Library").
        {
          name: "dish",
          type: "relation",
          collectionId: app.findCollectionByNameOrId("dishes").id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: "cook", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { name: "note", type: "text", max: 200 },
        { name: "added_by", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_meal_plan_slot` ON `meal_plan` (`date`, `slot`)",
        "CREATE INDEX `idx_meal_plan_dish` ON `meal_plan` (`dish`)",
      ],
    });
    app.save(plan);

    // A vote is the acting member's own: a parent's is bound to their member, a device's to a kid member.
    const voteCreate =
      `(${parent} && @request.body.member = @request.auth.member) || ` +
      `(${device} && @request.body.member:isset = true && @request.body.member.role = "kid")`;
    const voteOnlyValue = "@request.body.entry:isset = false && @request.body.member:isset = false";
    const votes = new Collection({
      type: "base",
      name: "meal_votes",
      listRule: parentOrDevice,
      viewRule: parentOrDevice,
      createRule: voteCreate,
      updateRule: `(${parent} && member = @request.auth.member && ${voteOnlyValue}) || (${device} && member.role = "kid" && ${voteOnlyValue})`,
      deleteRule: `(${parent} && member = @request.auth.member) || (${device} && member.role = "kid")`,
      fields: [
        {
          name: "entry",
          type: "relation",
          required: true,
          collectionId: app.findCollectionByNameOrId("meal_plan").id,
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
        { name: "value", type: "select", required: true, maxSelect: 1, values: ["up", "down"] },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_meal_votes_unique` ON `meal_votes` (`entry`, `member`)"],
    });
    app.save(votes);
  },
  (app) => {
    for (const name of ["meal_votes", "meal_plan", "dishes"]) app.delete(app.findCollectionByNameOrId(name));
  },
);
