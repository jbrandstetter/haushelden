// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (no real names or values in the public repo)
//
// The fake household: two parents, two kids, sample routines, to-dos, areas, lists and purchase history.
// All names are obviously fake. Each entry maps to the collection of the same name (SPEC-0001 design); the
// story that creates a collection also adjusts the matching records here to its schema.

const members = [
  { key: "papa", name: "Test-Papa", role: "parent", emoji: "🧔", colour: "blue" },
  { key: "mama", name: "Test-Mama", role: "parent", emoji: "👩", colour: "pink" },
  { key: "kind1", name: "Test-Kind-1", role: "kid", emoji: "⚽", colour: "peach" },
  { key: "kind2", name: "Test-Kind-2", role: "kid", emoji: "🐴", colour: "mauve" },
];

// Parent accounts (SPEC-0001 "Parent Authentication"): fake addresses on the reserved .test domain. Passwords come
// from the environment (HH_DEV_PARENT_PASSWORD in .env) and fall back to a placeholder; they are local-only.
const parents = [
  { key: "papa", email: "test-papa@example.test", member: "papa" },
  { key: "mama", email: "test-mama@example.test", member: "mama" },
];

// One enrolled family device (ADR-0003). The secret comes from HH_DEV_DEVICE_SECRET (at least 32 characters).
const devices = [
  { key: "tablet", email: "test-tablet@example.test", name: "Test-Tablet", enrolledBy: "papa" },
];

const settings = { tz: "", mascot: { pet: "fox" }, auto_refill: true };

const defaultSecrets = {
  parentPassword: "change-me-dev-parent-password",
  deviceSecret: "change-me-dev-device-secret-0123456789",
  parentPin: "246810", // fake 6-digit PIN of the seeded parents (HH_DEV_PARENT_PIN)
};

const routines = [
  { title: "Zähne putzen", who: ["kind1", "kind2"] },
  { title: "Tasche packen", who: ["kind1"] },
  { title: "Zimmer aufräumen", who: ["kind2"] },
];

const todos = [
  { title: "Test-Aufgabe: Altglas wegbringen", who: "papa" },
  { title: "Test-Aufgabe: Geschenk besorgen", who: "mama" },
];

const areas = [
  { title: "Test-Bereich: Müll", owner: "papa" },
  { title: "Test-Bereich: Wäsche", owner: "mama" },
];

const lists = [{ title: "Lebensmittel" }, { title: "Drogerie" }];

const purchases = [
  { list: "Lebensmittel", item: "Test-Milch", times: 4 },
  { list: "Lebensmittel", item: "Test-Brot", times: 3 },
  { list: "Drogerie", item: "Test-Seife", times: 2 },
];

module.exports = {
  members,
  parents,
  devices,
  settings,
  defaultSecrets,
  routines,
  todos,
  areas,
  lists,
  purchases,
};
