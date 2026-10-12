// Governing: SPEC-0007 REQ "Local Development" (seed), SPEC-0005 REQ "Lists", REQ "Shopping Flow", ADR-0004
// The shopping seed step against a throwaway PocketBase: fake items on the migration's default lists, the cart
// item has its purchase (recorded by the hook), and a second run changes nothing.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");
const { items } = require("../../scripts/seed/shopping.js");

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

describe("shopping seed", () => {
  it("adds the fake items to the default lists, attributed to the fake members", async () => {
    const results = await seed();
    assert.equal(results.find((r) => r.collection === "shop_items").outcome, "seeded");
    const rows = await all("shop_items");
    assert.equal(rows.length, items.length);
    const members = await all("members");
    for (const row of rows) {
      assert.match(row.name, /^Test-/);
      assert.ok(members.some((m) => m.id === row.by));
    }
    assert.equal((await all("lists")).length, 2, "the seed does not add lists: the migration owns them");
  });

  it("records the purchase of the item that is already in the cart", async () => {
    const purchases = await all("purchases");
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].name, "Test-Eier");
  });

  it("is idempotent", async () => {
    const results = await seed();
    assert.equal(results.find((r) => r.collection === "shop_items").outcome, "kept");
    assert.equal((await all("shop_items")).length, items.length);
  });
});
