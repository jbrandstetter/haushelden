// Governing: SPEC-0007 REQ "Local Development"
//
// Ordered seed steps. A step is { collection, records(ctx) }. The seed script runs a step only when its
// collection exists in the local PocketBase and skips it (with a message) otherwise, so this list can name
// collections that later stories create. Add the record mapping for a collection here when its migration lands;
// `ctx.ids` holds the ids created by earlier steps (ctx.ids.members.papa, ...).

const fixtures = require("./fixtures.js");

const steps = [
  {
    collection: "members",
    key: "key",
    records: () => fixtures.members.map((m) => ({ key: m.key, name: m.name, role: m.role })),
  },
  // routines, todos, areas, lists, shop_items and purchases are added by the stories that create those
  // collections, using fixtures.routines / todos / areas / lists / purchases.
];

module.exports = { steps };
