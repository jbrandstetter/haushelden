// Governing: SPEC-0007 REQ "Local Development" (seed script), SPEC-0001 REQ "Household and Members",
// ADR-0004 (fake data only)
//
// Runs the real seed script twice against a throwaway PocketBase: the fake household appears once and the
// second run changes nothing.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");
const { runSeed } = require("../../scripts/seed.js");
const fixtures = require("../../scripts/seed/fixtures.js");

let pb;
const secrets = fixtures.defaultSecrets;

async function count(collection) {
  const res = await pb.api("GET", `/api/collections/${collection}/records?perPage=1`, {
    token: pb.superToken,
  });
  return res.data.totalItems;
}

before(async () => {
  pb = await startPocketBase();
});
after(async () => {
  if (pb) await pb.stop();
});

describe("seed household", () => {
  it("creates the fake household on the first run", async () => {
    const results = await runSeed({
      base: pb.base,
      email: "root@example.test",
      password: "change-me-test-only",
      secrets,
      log: () => {},
    });
    const outcome = (c) => results.find((r) => r.collection === c).outcome;
    for (const c of ["members", "parents", "devices", "settings"]) assert.equal(outcome(c), "seeded", c);
    assert.equal(await count("members"), 4);
    assert.equal(await count("parents"), 2);
    assert.equal(await count("devices"), 1);
    assert.equal(await count("settings"), 1);
  });

  it("links each parent account to its parent member and the device to its enrolling parent", async () => {
    const list = await pb.api("GET", "/api/collections/parents/records?expand=member", {
      token: pb.superToken,
    });
    for (const p of list.data.items) assert.equal(p.expand.member.role, "parent");
    const devices = await pb.api("GET", "/api/collections/devices/records", { token: pb.superToken });
    assert.ok(list.data.items.some((p) => p.id === devices.data.items[0].enrolled_by));
  });

  it("seeded parent and device can sign in, and the device sees the kids", async () => {
    await pb.signIn("parents", fixtures.parents[0].email, secrets.parentPassword);
    const token = await pb.signIn("devices", fixtures.devices[0].email, secrets.deviceSecret);
    const members = await pb.api("GET", "/api/collections/members/records", { token });
    assert.equal(members.data.totalItems, 4);
    assert.deepEqual(
      members.data.items.map((m) => m.name).sort(),
      fixtures.members.map((m) => m.name).sort(),
    );
  });

  it("is idempotent: a second run keeps everything and duplicates nothing", async () => {
    const results = await runSeed({
      base: pb.base,
      email: "root@example.test",
      password: "change-me-test-only",
      secrets,
      log: () => {},
    });
    for (const c of ["members", "parents", "devices", "settings"]) {
      assert.equal(results.find((r) => r.collection === c).outcome, "kept", c);
    }
    assert.equal(await count("members"), 4);
    assert.equal(await count("parents"), 2);
    assert.equal(await count("devices"), 1);
    assert.equal(await count("settings"), 1);
  });

  it("recovers the id map when only a later collection is empty", async () => {
    const devices = await pb.api("GET", "/api/collections/devices/records", { token: pb.superToken });
    await pb.api("DELETE", `/api/collections/devices/records/${devices.data.items[0].id}`, {
      token: pb.superToken,
    });
    const results = await runSeed({
      base: pb.base,
      email: "root@example.test",
      password: "change-me-test-only",
      secrets,
      log: () => {},
    });
    assert.equal(results.find((r) => r.collection === "devices").outcome, "seeded");
    assert.equal(await count("devices"), 1);
    assert.equal(await count("members"), 4);
  });
});
