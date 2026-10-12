// Governing: SPEC-0007 REQ "Local Development"
//
// Ordered seed steps. A step is { collection, records(ctx) }. The seed script runs a step only when its
// collection exists in the local PocketBase and skips it (with a message) otherwise, so this list can name
// collections that later stories create. Add the record mapping for a collection here when its migration lands;
// `ctx.ids` holds the ids created by earlier steps (ctx.ids.members.papa, ...).

const fixtures = require("./fixtures.js");
<<<<<<< HEAD
const routines = require("./routines.js");
=======
const { pinFields } = require("./accounts.js"); // fake PIN for the seeded parents (accounts story)
>>>>>>> d5c401a (feat(accounts): /api/hh setup, invite, device enroll, PIN and revoke routes)

const steps = [
  {
    collection: "members",
    key: "key",
    records: ({ secrets }) =>
      fixtures.members.map(({ key, name, role, emoji, colour }) => ({
        key,
        name,
        role,
        emoji,
        colour,
        ...pinFields(role, secrets),
      })),
    // Maps an existing record back to its fixture key, so later steps still find ids on a re-run.
    identify: (record) => fixtures.members.find((m) => m.name === record.name)?.key,
  },
  {
    collection: "parents",
    key: "key",
    records: ({ ids, secrets }) =>
      fixtures.parents.map(({ key, email, member }) => ({
        key,
        email,
        password: secrets.parentPassword,
        passwordConfirm: secrets.parentPassword,
        emailVisibility: true,
        member: ids.members[member],
      })),
    identify: (record) => fixtures.parents.find((p) => p.email === record.email)?.key,
  },
  {
    collection: "devices",
    key: "key",
    records: ({ ids, secrets }) =>
      fixtures.devices.map(({ key, email, name, enrolledBy }) => ({
        key,
        email,
        name,
        password: secrets.deviceSecret,
        passwordConfirm: secrets.deviceSecret,
        enrolled_by: ids.parents[enrolledBy],
      })),
  },
  { collection: "settings", records: () => [{ ...fixtures.settings }] },
  { collection: "routines", records: ({ ids }) => routines.records(ids.members) },
  { collection: "todos", records: (ctx) => require("./todos.js").todoRecords(ctx) },
  // areas, lists, shop_items and purchases are added by the stories that create those
  // collections, using fixtures.routines / todos / areas / lists / purchases.
];

module.exports = { steps };
