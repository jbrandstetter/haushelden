// Governing: SPEC-0007 REQ "Local Development" (seed), SPEC-0005 REQ "Purchase History and Rhythm", ADR-0004
// The dev-only fake purchase history: a fresh database (migrations only) has none, the seed adds it, the learned
// numbers come out as documented in the seed file, and a refill puts the due fake items on the lists.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");
const { history } = require("../../scripts/seed/learning.js");
const rhythm = require("../../app/js/rhythm.js");

let pb;
const all = async (collection) =>
  (await pb.api("GET", `/api/collections/${collection}/records?perPage=500`, { token: pb.superToken })).data
    .items;

before(async () => {
  pb = await startPocketBase();
});
after(async () => {
  if (pb) await pb.stop();
});

describe("learning seed (dev only)", () => {
  it("production starts without any purchase history: the migrations create none", async () => {
    assert.equal((await all("purchases")).length, 0);
  });

  it("the seed adds fake history with Test- names only, and the rhythms match the seed's notes", async () => {
    await runSeed({
      base: pb.base,
      email: "root@example.test",
      password: "change-me-test-only",
      secrets: fixtures.defaultSecrets,
      log: () => {},
    });
    const rows = await all("purchases");
    assert.ok(rows.length >= history.reduce((n, h) => n + h[2].length, 0));
    for (const row of rows) assert.match(row.name, /^Test-/);
    const learned = rhythm.learn(rows);
    const byName = Object.fromEntries(learned.map((e) => [e.name, e.rhythm]));
    assert.equal(byName["Test-Milch"], 5);
    assert.equal(byName["Test-Kaffee"], 7);
    assert.equal(byName["Test-Shampoo"], 35);
  });

  it("a refill after seeding adds the due fake items (not those already open or in the cart)", async () => {
    const token = await parentToken();
    for (const list of await all("lists")) {
      const res = await pb.api("POST", "/api/hh/refill", { token, body: { list: list.id } });
      assert.equal(res.status, 200);
    }
    const names = (await all("shop_items"))
      .filter((i) => i.auto)
      .map((i) => i.name)
      .sort();
    // Test-Milch, Test-Brot and Test-Zahnpasta are already open, Test-Eier is in the cart, Test-Butter is not due yet.
    assert.deepEqual(names, ["Test-Kaffee", "Test-Shampoo"]);
  });
});

async function parentToken() {
  return pb.signIn("parents", fixtures.parents[0].email, fixtures.defaultSecrets.parentPassword);
}
