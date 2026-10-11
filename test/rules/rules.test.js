// Governing: ADR-0001 (rules are the security model), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "Household and Members" (Kid cannot manage members), REQ "Kid Access on Enrolled Devices"
// (Device reads to-dos: no records), design table "Three principal types, rules per collection"
//
// Exercises the access rules of members, parents, devices and settings as parent, device and anonymous against a
// real throwaway PocketBase. Every allowed operation is paired with its forbidden counterpart, and forbidden
// writes are followed by a superuser read proving the data is unchanged.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";

let pb;
let su; // superuser token
const tokens = { parent: "", otherParent: "", device: "", anonymous: undefined };
const ids = {};

const rec = (collection, id = "") => `/api/collections/${collection}/records${id ? `/${id}` : ""}`;
const denied = (res, what) =>
  assert.ok(res.status >= 400, `${what}: expected an error, got HTTP ${res.status}`);

async function superCreate(collection, body) {
  const res = await pb.api("POST", rec(collection), { token: su, body });
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;
const superCount = async (collection) =>
  (await pb.api("GET", `${rec(collection)}?perPage=1`, { token: su })).data.totalItems;

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;

  ids.papa = (
    await superCreate("members", { role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" })
  ).id;
  ids.mama = (
    await superCreate("members", { role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink" })
  ).id;
  ids.kind1 = (
    await superCreate("members", { role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" })
  ).id;
  ids.kind2 = (
    await superCreate("members", { role: "kid", name: "Test-Kind-2", emoji: "🐴", colour: "mauve" })
  ).id;
  await pb.api("PATCH", rec("members", ids.kind1), {
    token: su,
    body: { pin_hash: "fake-hash-not-a-real-pin" },
  });

  for (const [key, member, email] of [
    ["papaAcc", ids.papa, "papa@example.test"],
    ["mamaAcc", ids.mama, "mama@example.test"],
  ]) {
    const created = await superCreate("parents", {
      email,
      password: PARENT_PW,
      passwordConfirm: PARENT_PW,
      member,
      emailVisibility: false,
    });
    ids[key] = created.id;
  }
  ids.device = (
    await superCreate("devices", {
      email: "device-1@example.test",
      password: DEVICE_SECRET,
      passwordConfirm: DEVICE_SECRET,
      name: "Test-Tablet",
    })
  ).id;
  ids.device2 = (
    await superCreate("devices", {
      email: "device-2@example.test",
      password: DEVICE_SECRET,
      passwordConfirm: DEVICE_SECRET,
      name: "Test-Tablet-2",
    })
  ).id;
  ids.settings = (await superCreate("settings", { tz: "", mascot: { pet: "fox" }, auto_refill: true })).id;

  tokens.parent = await pb.signIn("parents", "papa@example.test", PARENT_PW);
  tokens.otherParent = await pb.signIn("parents", "mama@example.test", PARENT_PW);
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
  tokens.device2 = await pb.signIn("devices", "device-2@example.test", DEVICE_SECRET);
});

after(async () => {
  if (pb) await pb.stop();
});

describe("members", () => {
  it("parent: full access, and pin_hash is never returned", async () => {
    const list = await pb.api("GET", rec("members"), { token: tokens.parent });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 4);
    for (const m of list.data.items) assert.equal("pin_hash" in m, false, "pin_hash must stay hidden");

    const created = await pb.api("POST", rec("members"), {
      token: tokens.parent,
      body: { role: "kid", name: "Test-Kind-3", emoji: "🎨", colour: "teal" },
    });
    assert.equal(created.status, 200);
    assert.equal("pin_hash" in created.data, false);
    const renamed = await pb.api("PATCH", rec("members", created.data.id), {
      token: tokens.parent,
      body: { name: "Test-Kind-3b", colour: "lavender" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.name, "Test-Kind-3b");
    assert.equal(
      (await pb.api("DELETE", rec("members", created.data.id), { token: tokens.parent })).status,
      204,
    );
    assert.equal(await superCount("members"), 4);
  });

  it("parent: invalid role and colour are rejected", async () => {
    for (const body of [
      { role: "admin", name: "Test-X", emoji: "🙂", colour: "blue" },
      { role: "kid", name: "Test-X", emoji: "🙂", colour: "hotpink" },
      { role: "kid", name: "", emoji: "🙂", colour: "blue" },
    ]) {
      denied(await pb.api("POST", rec("members"), { token: tokens.parent, body }), JSON.stringify(body));
    }
    assert.equal(await superCount("members"), 4);
  });

  it("parent: cannot filter by or write-then-read pin_hash", async () => {
    const set = await pb.api("PATCH", rec("members", ids.kind2), {
      token: tokens.parent,
      body: { pin_hash: "fake-hash-2" },
    });
    assert.equal(set.status, 200);
    assert.equal("pin_hash" in set.data, false);
    denied(
      await pb.api("GET", `${rec("members")}?filter=${encodeURIComponent('pin_hash != ""')}`, {
        token: tokens.parent,
      }),
      "filter on pin_hash",
    );
    await pb.api("PATCH", rec("members", ids.kind2), { token: su, body: { pin_hash: "" } });
  });

  it("device: reads members but never pin_hash", async () => {
    const list = await pb.api("GET", rec("members"), { token: tokens.device });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 4);
    for (const m of list.data.items) assert.equal("pin_hash" in m, false);
    const one = await pb.api("GET", rec("members", ids.kind1), { token: tokens.device });
    assert.equal(one.status, 200);
    assert.equal("pin_hash" in one.data, false);
    denied(
      await pb.api("GET", `${rec("members")}?filter=${encodeURIComponent('pin_hash != ""')}`, {
        token: tokens.device,
      }),
      "device filter on pin_hash",
    );
    denied(
      await pb.api("GET", `${rec("members")}?sort=pin_hash`, { token: tokens.device }),
      "device sort by pin_hash",
    );
  });

  it("device: cannot create, rename or remove members (Kid cannot manage members)", async () => {
    denied(
      await pb.api("POST", rec("members"), {
        token: tokens.device,
        body: { role: "parent", name: "Test-Eindringling", emoji: "🙂", colour: "red" },
      }),
      "device create",
    );
    denied(
      await pb.api("PATCH", rec("members", ids.kind1), { token: tokens.device, body: { name: "Umbenannt" } }),
      "device rename",
    );
    denied(
      await pb.api("PATCH", rec("members", ids.kind1), { token: tokens.device, body: { role: "parent" } }),
      "device promote to parent",
    );
    denied(await pb.api("DELETE", rec("members", ids.kind1), { token: tokens.device }), "device delete");
    denied(
      await pb.api("DELETE", rec("members", ids.papa), { token: tokens.device }),
      "device delete parent",
    );
    assert.equal(await superCount("members"), 4);
    const kid = await superGet("members", ids.kind1);
    assert.equal(kid.name, "Test-Kind-1");
    assert.equal(kid.role, "kid");
  });

  it("anonymous: gets nothing and changes nothing", async () => {
    const list = await pb.api("GET", rec("members"));
    assert.equal(list.data.totalItems, 0);
    assert.deepEqual(list.data.items, []);
    assert.equal((await pb.api("GET", rec("members", ids.kind1))).status, 404);
    denied(
      await pb.api("POST", rec("members"), {
        body: { role: "kid", name: "Test-X", emoji: "🙂", colour: "blue" },
      }),
      "anonymous create",
    );
    denied(
      await pb.api("PATCH", rec("members", ids.kind1), { body: { name: "Umbenannt" } }),
      "anonymous rename",
    );
    denied(await pb.api("DELETE", rec("members", ids.kind1)), "anonymous delete");
    assert.equal(await superCount("members"), 4);
    assert.equal((await superGet("members", ids.kind1)).name, "Test-Kind-1");
  });

  it("a member linked to a parent account cannot be deleted from under it", async () => {
    denied(
      await pb.api("DELETE", rec("members", ids.papa), { token: tokens.parent }),
      "delete linked member",
    );
    assert.equal(await superCount("members"), 4);
  });
});

describe("parents", () => {
  it("parent: lists and views parents, updates only their own account", async () => {
    const list = await pb.api("GET", rec("parents"), { token: tokens.parent });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 2);
    for (const p of list.data.items) {
      assert.equal("password" in p, false);
      assert.equal("tokenKey" in p, false);
    }
    assert.equal((await pb.api("GET", rec("parents", ids.mamaAcc), { token: tokens.parent })).status, 200);

    const own = await pb.api("PATCH", rec("parents", ids.papaAcc), {
      token: tokens.parent,
      body: { emailVisibility: true },
    });
    assert.equal(own.status, 200);
    denied(
      await pb.api("PATCH", rec("parents", ids.mamaAcc), {
        token: tokens.parent,
        body: { emailVisibility: true },
      }),
      "parent edits the other parent",
    );
    assert.equal((await superGet("parents", ids.mamaAcc)).emailVisibility, false);
  });

  it("parent: cannot create or delete parent accounts through the API", async () => {
    denied(
      await pb.api("POST", rec("parents"), {
        token: tokens.parent,
        body: {
          email: "third@example.test",
          password: PARENT_PW,
          passwordConfirm: PARENT_PW,
          member: ids.kind1,
        },
      }),
      "parent create",
    );
    denied(
      await pb.api("DELETE", rec("parents", ids.mamaAcc), { token: tokens.parent }),
      "parent delete other",
    );
    denied(
      await pb.api("DELETE", rec("parents", ids.papaAcc), { token: tokens.parent }),
      "parent delete self",
    );
    assert.equal(await superCount("parents"), 2);
  });

  it("parent: cannot repoint their account at another member", async () => {
    // The 1:1 link is unique, so pointing at a member that already has an account fails.
    denied(
      await pb.api("PATCH", rec("parents", ids.papaAcc), {
        token: tokens.parent,
        body: { member: ids.mama },
      }),
      "relink to a member that has an account",
    );
    assert.equal((await superGet("parents", ids.papaAcc)).member, ids.papa);
  });

  it("device: cannot read, create, change or delete parents", async () => {
    const list = await pb.api("GET", rec("parents"), { token: tokens.device });
    assert.equal(list.data.totalItems, 0);
    assert.equal((await pb.api("GET", rec("parents", ids.papaAcc), { token: tokens.device })).status, 404);
    denied(
      await pb.api("POST", rec("parents"), {
        token: tokens.device,
        body: { email: "x@example.test", password: PARENT_PW, passwordConfirm: PARENT_PW, member: ids.kind1 },
      }),
      "device create parent",
    );
    denied(
      await pb.api("PATCH", rec("parents", ids.papaAcc), {
        token: tokens.device,
        body: { emailVisibility: true },
      }),
      "device update parent",
    );
    denied(
      await pb.api("DELETE", rec("parents", ids.papaAcc), { token: tokens.device }),
      "device delete parent",
    );
    assert.equal(await superCount("parents"), 2);
  });

  it("anonymous: gets nothing and changes nothing, but may attempt sign-in", async () => {
    assert.equal((await pb.api("GET", rec("parents"))).data.totalItems, 0);
    assert.equal((await pb.api("GET", rec("parents", ids.papaAcc))).status, 404);
    denied(
      await pb.api("POST", rec("parents"), {
        body: { email: "x@example.test", password: PARENT_PW, passwordConfirm: PARENT_PW, member: ids.kind1 },
      }),
      "anonymous create parent",
    );
    denied(await pb.api("DELETE", rec("parents", ids.papaAcc)), "anonymous delete parent");
    assert.equal(await superCount("parents"), 2);
    const bad = await pb.api("POST", "/api/collections/parents/auth-with-password", {
      body: { identity: "papa@example.test", password: "wrong-password-1234" },
    });
    denied(bad, "wrong password");
  });

  it("passwords need at least 12 characters (SPEC-0001 Parent Authentication)", async () => {
    const res = await pb.api("POST", rec("parents"), {
      token: su,
      body: {
        email: "short@example.test",
        password: "elevenchars",
        passwordConfirm: "elevenchars",
        member: ids.kind1,
      },
    });
    denied(res, "11-character password");
  });
});

describe("devices", () => {
  it("parent: lists, views and removes devices, but cannot create or edit them directly", async () => {
    const list = await pb.api("GET", rec("devices"), { token: tokens.parent });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 2);
    assert.equal((await pb.api("GET", rec("devices", ids.device), { token: tokens.parent })).status, 200);
    denied(
      await pb.api("POST", rec("devices"), {
        token: tokens.parent,
        body: {
          email: "device-3@example.test",
          password: DEVICE_SECRET,
          passwordConfirm: DEVICE_SECRET,
          name: "Test-Tablet-3",
        },
      }),
      "parent creates device directly (enrollment goes through the server route)",
    );
    denied(
      await pb.api("PATCH", rec("devices", ids.device), {
        token: tokens.parent,
        body: { name: "Umbenannt" },
      }),
      "parent edits device",
    );
    assert.equal((await superGet("devices", ids.device)).name, "Test-Tablet");
  });

  it("device secrets need at least 32 characters", async () => {
    const short = "change-me-too-short";
    denied(
      await pb.api("POST", rec("devices"), {
        token: su,
        body: { email: "short@example.test", password: short, passwordConfirm: short, name: "Test-Kurz" },
      }),
      "short device secret",
    );
  });

  it("device: cannot read, change or delete devices (not even itself)", async () => {
    assert.equal((await pb.api("GET", rec("devices"), { token: tokens.device })).data.totalItems, 0);
    assert.equal((await pb.api("GET", rec("devices", ids.device), { token: tokens.device })).status, 404);
    denied(
      await pb.api("PATCH", rec("devices", ids.device2), {
        token: tokens.device,
        body: { name: "Umbenannt" },
      }),
      "device update device",
    );
    denied(
      await pb.api("DELETE", rec("devices", ids.device2), { token: tokens.device }),
      "device delete device",
    );
    denied(
      await pb.api("DELETE", rec("devices", ids.device), { token: tokens.device }),
      "device delete itself",
    );
    assert.equal(await superCount("devices"), 2);
  });

  it("anonymous: gets nothing and changes nothing, but can attempt sign-in", async () => {
    assert.equal((await pb.api("GET", rec("devices"))).data.totalItems, 0);
    denied(await pb.api("DELETE", rec("devices", ids.device)), "anonymous delete device");
    denied(
      await pb.api("POST", rec("devices"), {
        body: {
          email: "x@example.test",
          password: DEVICE_SECRET,
          passwordConfirm: DEVICE_SECRET,
          name: "Test-X",
        },
      }),
      "anonymous create device",
    );
    assert.equal(await superCount("devices"), 2);
    denied(
      await pb.api("POST", "/api/collections/devices/auth-with-password", {
        body: { identity: "device-1@example.test", password: "change-me-wrong-secret-0123456789abcd" },
      }),
      "wrong device secret",
    );
  });

  it("a removed device loses access: its token no longer reads members and cannot refresh", async () => {
    assert.equal((await pb.api("GET", rec("members"), { token: tokens.device2 })).data.totalItems, 4);
    assert.equal((await pb.api("DELETE", rec("devices", ids.device2), { token: tokens.parent })).status, 204);
    // PocketBase treats a token of a deleted record as unauthenticated: rules see a guest, so no data comes back.
    assert.equal((await pb.api("GET", rec("members"), { token: tokens.device2 })).data.totalItems, 0);
    denied(
      await pb.api("POST", "/api/collections/devices/auth-refresh", { token: tokens.device2 }),
      "refresh",
    );
  });
});

describe("settings", () => {
  it("parent: reads and updates the single record, cannot add a second or delete it", async () => {
    const list = await pb.api("GET", rec("settings"), { token: tokens.parent });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 1);
    const updated = await pb.api("PATCH", rec("settings", ids.settings), {
      token: tokens.parent,
      body: { tz: "Europe/Vienna", auto_refill: false, mascot: { pet: "owl" } },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.tz, "Europe/Vienna");
    denied(
      await pb.api("POST", rec("settings"), { token: tokens.parent, body: { tz: "" } }),
      "second settings record",
    );
    denied(
      await pb.api("DELETE", rec("settings", ids.settings), { token: tokens.parent }),
      "delete settings",
    );
    assert.equal(await superCount("settings"), 1);
  });

  it("parent: rejects a malformed time zone name", async () => {
    denied(
      await pb.api("PATCH", rec("settings", ids.settings), {
        token: tokens.parent,
        body: { tz: "not a zone!" },
      }),
      "malformed tz",
    );
  });

  it("device: reads settings but cannot create, change or delete them", async () => {
    const list = await pb.api("GET", rec("settings"), { token: tokens.device });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 1);
    assert.equal((await pb.api("GET", rec("settings", ids.settings), { token: tokens.device })).status, 200);
    const before = await superGet("settings", ids.settings);
    denied(
      await pb.api("PATCH", rec("settings", ids.settings), {
        token: tokens.device,
        body: { auto_refill: true },
      }),
      "device update settings",
    );
    denied(
      await pb.api("POST", rec("settings"), { token: tokens.device, body: { tz: "" } }),
      "device create settings",
    );
    denied(
      await pb.api("DELETE", rec("settings", ids.settings), { token: tokens.device }),
      "device delete settings",
    );
    assert.deepEqual(await superGet("settings", ids.settings), before);
  });

  it("anonymous: gets nothing and changes nothing", async () => {
    assert.equal((await pb.api("GET", rec("settings"))).data.totalItems, 0);
    assert.equal((await pb.api("GET", rec("settings", ids.settings))).status, 404);
    const before = await superGet("settings", ids.settings);
    denied(
      await pb.api("PATCH", rec("settings", ids.settings), { body: { auto_refill: true } }),
      "anonymous update",
    );
    denied(await pb.api("POST", rec("settings"), { body: { tz: "" } }), "anonymous create");
    denied(await pb.api("DELETE", rec("settings", ids.settings)), "anonymous delete");
    assert.deepEqual(await superGet("settings", ids.settings), before);
  });

  it("the single-record rule holds even for the superuser", async () => {
    denied(await pb.api("POST", rec("settings"), { token: su, body: { tz: "" } }), "superuser second record");
    assert.equal(await superCount("settings"), 1);
  });
});

describe("other principals", () => {
  it("the second parent is a full parent too", async () => {
    assert.equal((await pb.api("GET", rec("members"), { token: tokens.otherParent })).data.totalItems, 4);
    const res = await pb.api("PATCH", rec("members", ids.kind2), {
      token: tokens.otherParent,
      body: { emoji: "🦄" },
    });
    assert.equal(res.status, 200);
  });

  it("a parent token is not accepted for the other auth collections' guarded data", async () => {
    // Sanity: the superuser-only system collections stay closed to every household principal.
    for (const token of [tokens.parent, tokens.device, undefined]) {
      denied(await pb.api("GET", "/api/collections", { token }), "collections schema");
      denied(await pb.api("GET", "/api/collections/_superusers/records", { token }), "superusers");
    }
  });
});
