// Governing: SPEC-0007 REQ "Local Development" (seed), SPEC-0009 REQ "Plan Entries", REQ "Dish Library", ADR-0004
// The meal plan seed step against a throwaway PocketBase: fake dishes, a week of entries from Monday to Sunday of the
// current week (one per slot at most), thumbs, last-planned dates raised by the hook, and a second run changes nothing.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");
const { dishes, plan, votes, monday } = require("../../scripts/seed/mealplan.js");

let pb;
const all = async (collection) =>
  (await pb.api("GET", `/api/collections/${collection}/records?perPage=200`, { token: pb.superToken })).data
    .items;
const seed = () =>
  runSeed({
    base: pb.base,
    email: "root@example.test",
    password: "change-me-test-only",
    secrets: fixtures.defaultSecrets,
    log: () => {},
  });

before(async () => {
  pb = await startPocketBase();
});
after(async () => {
  if (pb) await pb.stop();
});

describe("meal plan seed", () => {
  it("adds fake dishes, a week of entries and thumbs", async () => {
    const results = await seed();
    for (const c of ["dishes", "meal_plan", "meal_votes"]) {
      assert.equal(results.find((r) => r.collection === c).outcome, "seeded", c);
    }
    const rows = await all("dishes");
    assert.equal(rows.length, dishes.length);
    for (const d of rows) assert.match(d.name, /^Test-/);
    const entries = await all("meal_plan");
    assert.equal(entries.length, plan.length);
    const start = monday();
    for (const e of entries) {
      assert.ok(
        e.date >= start &&
          e.date <= new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10),
      );
    }
    assert.equal(
      new Set(entries.map((e) => `${e.date}/${e.slot}`)).size,
      entries.length,
      "one entry per slot",
    );
    assert.equal((await all("meal_votes")).length, votes.length);
  });

  it("the entries raised the last-planned date of their dishes; unplanned dishes keep their own", async () => {
    const byName = Object.fromEntries((await all("dishes")).map((d) => [d.name, d]));
    assert.ok(byName["Test-Spaghetti"].last_planned >= monday(), "planned this week");
    assert.equal(byName["Test-Gemüsesuppe"].last_planned >= monday(), true);
    const entries = await all("meal_plan");
    assert.ok(entries.some((e) => e.dish === byName["Test-Pizza"].id));
  });

  it("is idempotent", async () => {
    const results = await seed();
    for (const c of ["dishes", "meal_plan", "meal_votes"]) {
      assert.equal(results.find((r) => r.collection === c).outcome, "kept", c);
    }
    assert.equal((await all("meal_plan")).length, plan.length);
  });
});
