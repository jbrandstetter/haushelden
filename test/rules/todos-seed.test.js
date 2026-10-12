// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only)
//
// The to-do seed step runs against a throwaway PocketBase, creates fake to-dos for one parent, the other and
// both, and a second run changes nothing.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");

let pb;
before(async () => {
  pb = await startPocketBase();
});
after(async () => {
  if (pb) await pb.stop();
});

const seed = () =>
  runSeed({
    base: pb.base,
    email: "root@example.test",
    password: "change-me-test-only",
    secrets: fixtures.defaultSecrets,
    log: () => {},
  });
const list = async () =>
  (await pb.api("GET", "/api/collections/todos/records?perPage=50", { token: pb.superToken })).data.items;

describe("seed to-dos", () => {
  it("creates fake to-dos for both parents, one parent and the other, and is idempotent", async () => {
    const first = await seed();
    assert.equal(first.find((r) => r.collection === "todos").outcome, "seeded");
    const items = await list();
    assert.ok(items.length >= 5);
    for (const t of items) assert.match(t.title, /^Test-/);
    assert.ok(items.some((t) => t.who === "parents"));
    assert.ok(
      items.some((t) => t.due && t.due < new Date().toISOString().slice(0, 10)),
      "an overdue one",
    );
    const second = await seed();
    assert.equal(second.find((r) => r.collection === "todos").outcome, "kept");
    assert.equal((await list()).length, items.length);
  });
});
