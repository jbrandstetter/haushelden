// Governing: ADR-0001 (rules are the security model), ADR-0003 (kid access via device accounts),
// SPEC-0002 REQ "Routine Items" (Kid cannot edit routines), design table "Three principal types, rules per
// collection" (routines, routine_done)
//
// Exercises routines and routine_done as parent, device and anonymous against a real throwaway PocketBase,
// including the forbidden writes (a device editing a routine, a device ticking for a parent member).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";

let pb;
let su;
const tokens = { parent: "", device: "", anonymous: undefined };
const ids = {};

const rec = (collection, id = "") => `/api/collections/${collection}/records${id ? `/${id}` : ""}`;
const denied = (res, what) =>
  assert.ok(res.status >= 400, `${what}: expected an error, got HTTP ${res.status}`);
// A list rule that does not match answers 200 with no records, a view rule answers 404.
const hidden = (res, what) =>
  assert.ok(res.status >= 400 || res.data.totalItems === 0, `${what}: records leaked`);
async function superCreate(collection, body) {
  const res = await pb.api("POST", rec(collection), { token: su, body });
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;
const superCount = async (collection) =>
  (await pb.api("GET", `${rec(collection)}?perPage=1`, { token: su })).data.totalItems;
const routineBody = (over = {}) => ({
  emoji: "⚽",
  title: "Fußballtraining",
  hint: "",
  time: "17:00",
  kind: "hobby",
  days: ["1", "3"],
  who: "member",
  member: ids.kind1,
  ...over,
});

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;
  for (const [key, role, name] of [
    ["papa", "parent", "Test-Papa"],
    ["kind1", "kid", "Test-Kind-1"],
    ["kind2", "kid", "Test-Kind-2"],
  ]) {
    ids[key] = (await superCreate("members", { role, name, emoji: "🙂", colour: "blue" })).id;
  }
  await superCreate("parents", {
    email: "papa@example.test",
    password: PARENT_PW,
    passwordConfirm: PARENT_PW,
    member: ids.papa,
    emailVisibility: false,
  });
  await superCreate("devices", {
    email: "device-1@example.test",
    password: DEVICE_SECRET,
    passwordConfirm: DEVICE_SECRET,
    name: "Test-Tablet",
  });
  ids.routine = (await superCreate("routines", routineBody())).id;
  tokens.parent = await pb.signIn("parents", "papa@example.test", PARENT_PW);
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
});
after(async () => {
  if (pb) await pb.stop();
});

describe("routines", () => {
  it("parent: full access, with validation of weekdays, time, kind and assignment", async () => {
    const created = await pb.api("POST", rec("routines"), { token: tokens.parent, body: routineBody() });
    assert.equal(created.status, 200);
    assert.deepEqual(created.data.days, ["1", "3"]);
    const moved = await pb.api("PATCH", rec("routines", created.data.id), {
      token: tokens.parent,
      body: { days: ["2"] },
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.data.days, ["2"]);
    assert.equal(
      (await pb.api("DELETE", rec("routines", created.data.id), { token: tokens.parent })).status,
      204,
    );

    for (const body of [
      routineBody({ days: ["7"] }),
      routineBody({ time: "25:00" }),
      routineBody({ kind: "other" }),
      routineBody({ who: "everyone" }),
      routineBody({ title: "" }),
      routineBody({ hint: "x".repeat(121) }),
    ]) {
      denied(await pb.api("POST", rec("routines"), { token: tokens.parent, body }), JSON.stringify(body));
    }
    assert.equal(await superCount("routines"), 1);
  });

  it("device: reads routines but cannot create, edit or delete (Kid cannot edit routines)", async () => {
    const list = await pb.api("GET", rec("routines"), { token: tokens.device });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 1);
    assert.equal((await pb.api("GET", rec("routines", ids.routine), { token: tokens.device })).status, 200);

    denied(
      await pb.api("POST", rec("routines"), { token: tokens.device, body: routineBody() }),
      "device create",
    );
    denied(
      await pb.api("PATCH", rec("routines", ids.routine), { token: tokens.device, body: { days: ["0"] } }),
      "device edit weekdays",
    );
    denied(await pb.api("DELETE", rec("routines", ids.routine), { token: tokens.device }), "device delete");
    const after = await superGet("routines", ids.routine);
    assert.deepEqual(after.days, ["1", "3"]);
    assert.equal(await superCount("routines"), 1);
  });

  it("anonymous: nothing", async () => {
    hidden(await pb.api("GET", rec("routines")), "anonymous list");
    denied(await pb.api("GET", rec("routines", ids.routine)), "anonymous view");
    denied(await pb.api("POST", rec("routines"), { body: routineBody() }), "anonymous create");
    denied(await pb.api("PATCH", rec("routines", ids.routine), { body: { title: "x" } }), "anonymous edit");
    denied(await pb.api("DELETE", rec("routines", ids.routine)), "anonymous delete");
    assert.equal((await superGet("routines", ids.routine)).title, "Fußballtraining");
  });
});

describe("routine_done", () => {
  const tick = (member, day = "2026-10-13", routine = ids.routine) => ({ routine, member, day });

  it("device: ticks and unticks for a kid member, reads ticks", async () => {
    const created = await pb.api("POST", rec("routine_done"), {
      token: tokens.device,
      body: tick(ids.kind1),
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.day, "2026-10-13");
    const list = await pb.api("GET", rec("routine_done"), { token: tokens.device });
    assert.equal(list.data.totalItems, 1);
    assert.equal(
      (await pb.api("GET", rec("routine_done", created.data.id), { token: tokens.device })).status,
      200,
    );
    assert.equal(
      (await pb.api("DELETE", rec("routine_done", created.data.id), { token: tokens.device })).status,
      204,
    );
    assert.equal(await superCount("routine_done"), 0);
  });

  it("device: cannot tick for a parent member, nor edit a tick", async () => {
    denied(
      await pb.api("POST", rec("routine_done"), { token: tokens.device, body: tick(ids.papa) }),
      "tick for a parent",
    );
    assert.equal(await superCount("routine_done"), 0);

    const parentTick = await superCreate("routine_done", tick(ids.papa, "2026-10-14"));
    denied(
      await pb.api("DELETE", rec("routine_done", parentTick.id), { token: tokens.device }),
      "untick a parent's",
    );
    assert.equal(await superCount("routine_done"), 1);

    const kidTick = await superCreate("routine_done", tick(ids.kind1, "2026-10-14"));
    denied(
      await pb.api("PATCH", rec("routine_done", kidTick.id), {
        token: tokens.device,
        body: { day: "2026-10-15" },
      }),
      "edit a tick",
    );
    assert.equal((await superGet("routine_done", kidTick.id)).day, "2026-10-14");
    await pb.api("DELETE", rec("routine_done", kidTick.id), { token: su });
    await pb.api("DELETE", rec("routine_done", parentTick.id), { token: su });
  });

  it("unique per routine, member and day; day must be a household date", async () => {
    const first = await pb.api("POST", rec("routine_done"), { token: tokens.device, body: tick(ids.kind1) });
    assert.equal(first.status, 200);
    denied(
      await pb.api("POST", rec("routine_done"), { token: tokens.device, body: tick(ids.kind1) }),
      "duplicate",
    );
    assert.equal(
      (await pb.api("POST", rec("routine_done"), { token: tokens.device, body: tick(ids.kind2) })).status,
      200,
    );
    assert.equal(
      (
        await pb.api("POST", rec("routine_done"), {
          token: tokens.device,
          body: tick(ids.kind1, "2026-10-14"),
        })
      ).status,
      200,
    );
    for (const day of ["2026-10-13T10:00:00Z", "13.10.2026", "", "tomorrow"]) {
      denied(
        await pb.api("POST", rec("routine_done"), { token: tokens.device, body: tick(ids.kind2, day) }),
        day,
      );
    }
    assert.equal(await superCount("routine_done"), 3);
  });

  it("parent: full access", async () => {
    const created = await pb.api("POST", rec("routine_done"), {
      token: tokens.parent,
      body: tick(ids.papa, "2026-10-20"),
    });
    assert.equal(created.status, 200);
    assert.equal((await pb.api("GET", rec("routine_done"), { token: tokens.parent })).status, 200);
    assert.equal(
      (
        await pb.api("PATCH", rec("routine_done", created.data.id), {
          token: tokens.parent,
          body: { day: "2026-10-21" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await pb.api("DELETE", rec("routine_done", created.data.id), { token: tokens.parent })).status,
      204,
    );
  });

  it("anonymous: nothing", async () => {
    hidden(await pb.api("GET", rec("routine_done")), "anonymous list");
    denied(
      await pb.api("POST", rec("routine_done"), { body: tick(ids.kind1, "2026-11-01") }),
      "anonymous create",
    );
    const any = (await pb.api("GET", rec("routine_done"), { token: su })).data.items[0];
    denied(await pb.api("DELETE", rec("routine_done", any.id)), "anonymous delete");
  });

  it("deleting a routine keeps other routines' ticks; deleting a routine removes its own", async () => {
    const other = await superCreate("routines", routineBody({ title: "Klavierstunde", days: ["2"] }));
    const t = await superCreate("routine_done", tick(ids.kind2, "2026-11-02", other.id));
    const before = await superCount("routine_done");
    await pb.api("DELETE", rec("routines", other.id), { token: tokens.parent });
    assert.equal(await superCount("routine_done"), before - 1);
    assert.equal((await pb.api("GET", rec("routine_done", t.id), { token: su })).status, 404);
  });

  it("editing a routine (moving it to another weekday) keeps recorded ticks", async () => {
    const before = await superCount("routine_done");
    const moved = await pb.api("PATCH", rec("routines", ids.routine), {
      token: tokens.parent,
      body: { days: ["2"] },
    });
    assert.equal(moved.status, 200);
    assert.equal(await superCount("routine_done"), before);
  });
});

describe("seed", () => {
  it("seeds the fake routines once", async () => {
    const { runSeed } = require("../../scripts/seed.js");
    const pb2 = await startPocketBase();
    try {
      const opts = {
        base: pb2.base,
        email: "root@example.test",
        password: "change-me-test-only",
        log: () => {},
      };
      const first = await runSeed(opts);
      assert.equal(first.find((r) => r.collection === "routines").outcome, "seeded");
      const list = await pb2.api("GET", "/api/collections/routines/records?perPage=50", {
        token: pb2.superToken,
      });
      assert.equal(list.data.totalItems, 7);
      const piano = list.data.items.find((r) => r.title === "Klavierstunde");
      assert.equal(piano.who, "member");
      assert.ok(piano.member);
      const second = await runSeed(opts);
      assert.equal(second.find((r) => r.collection === "routines").outcome, "kept");
    } finally {
      await pb2.stop();
    }
  });
});
