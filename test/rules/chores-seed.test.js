// Governing: SPEC-0007 REQ "Local Development" (seed), SPEC-0010 REQ "Standard Chores", REQ "Starting a Cleaning Day", ADR-0004
// The cleaning day seed step against a throwaway PocketBase: the standard chores, one upcoming Saturday built from them
// (every kids' chore once per kid, the parents' chores assigned to the parents), some ticks recorded by the assignee,
// and a second run changes nothing.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");
const C = require("../../app/js/chores.js");
const { saturday } = require("../../scripts/seed/chores.js");

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

describe("cleaning day seed", () => {
  it("adds the standard chores and a cleaning day on the coming Saturday", async () => {
    const results = await seed();
    for (const c of ["chore_templates", "chores"])
      assert.equal(results.find((r) => r.collection === c).outcome, "seeded", c);
    const templates = await all("chore_templates");
    assert.equal(templates.length, C.starterTemplates().length);
    const members = await all("members");
    const kids = members.filter((m) => m.role === "kid");
    const chores = await all("chores");
    assert.ok(chores.length > 0);
    assert.ok(
      chores.every((c) => c.day === saturday()),
      "one cleaning day",
    );
    const kidsTemplates = templates.filter((t) => t.kids);
    assert.equal(
      chores.filter((c) => kids.some((k) => k.id === c.assignee)).length,
      kidsTemplates.length * kids.length,
    );
    assert.ok(
      chores.every((c) => c.assignee),
      "everything is assigned",
    );
  });

  it("some chores are ticked, each by its assignee", async () => {
    const done = (await all("chores")).filter((c) => c.done);
    assert.ok(done.length >= 3);
    for (const c of done) assert.equal(c.done_by, c.assignee);
  });

  it("a second run keeps what is there", async () => {
    const before = (await all("chores")).length;
    const results = await seed();
    for (const c of ["chore_templates", "chores"])
      assert.equal(results.find((r) => r.collection === c).outcome, "kept", c);
    assert.equal((await all("chores")).length, before);
  });
});
