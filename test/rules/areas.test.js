// Governing: ADR-0001 (rules are the security model), SPEC-0003 REQ "Areas of Responsibility" (parents add, rename,
// delete and set owners; the owner is a parent or empty; deleting an area keeps its to-dos),
// SPEC-0003 REQ "Parents' Routines Today" (parents tick routines via routine_done),
// SPEC-0001 design table "Three principal types, rules per collection" (`areas`: parents full, devices none)
//
// Access rules of `areas` as parent, other parent, device and anonymous against a real throwaway PocketBase,
// the seven starter areas, the to-do relation (delete keeps to-dos) and a parent ticking a routine for themself.
// Every allowed operation is paired with its forbidden counterpart; forbidden writes are followed by a superuser
// read proving the data is unchanged.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";
const STARTERS = [
  "🏠 Haus & Garten",
  "🚗 Auto",
  "💶 Finanzen & Versicherungen",
  "🏫 Schule & Kinder",
  "🩺 Gesundheit & Ärzte",
  "🚙 Hobbys & Fahrdienste",
  "🖥️ Technik & Smart Home",
];

let pb;
let su;
const tokens = {};
const ids = {};

const rec = (id = "") => `/api/collections/areas/records${id ? `/${id}` : ""}`;
const denied = (res, what) =>
  assert.ok(res.status >= 400, `${what}: expected an error, got HTTP ${res.status}`);
function noRecords(res, what) {
  if (res.status === 200) assert.deepEqual(res.data.items, [], `${what}: records leaked`);
  else assert.ok(res.status >= 400, `${what}: unexpected HTTP ${res.status}`);
}
async function superCreate(collection, body) {
  const res = await pb.api("POST", `/api/collections/${collection}/records`, { token: su, body });
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const superGet = async (id) => (await pb.api("GET", rec(id), { token: su })).data;
const superCount = async () => (await pb.api("GET", `${rec()}?perPage=1`, { token: su })).data.totalItems;

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;
  const member = (role, name, emoji, colour) => superCreate("members", { role, name, emoji, colour });
  ids.papa = (await member("parent", "Test-Papa", "🧔", "blue")).id;
  ids.mama = (await member("parent", "Test-Mama", "👩", "pink")).id;
  ids.kind1 = (await member("kid", "Test-Kind-1", "⚽", "peach")).id;
  for (const [email, m] of [
    ["papa@example.test", ids.papa],
    ["mama@example.test", ids.mama],
  ]) {
    await superCreate("parents", {
      email,
      password: PARENT_PW,
      passwordConfirm: PARENT_PW,
      member: m,
      emailVisibility: false,
    });
  }
  await superCreate("devices", {
    email: "device-1@example.test",
    password: DEVICE_SECRET,
    passwordConfirm: DEVICE_SECRET,
    name: "Test-Tablet",
  });
  tokens.parent = await pb.signIn("parents", "papa@example.test", PARENT_PW);
  tokens.otherParent = await pb.signIn("parents", "mama@example.test", PARENT_PW);
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
  ids.area = (await superCreate("areas", { emoji: "📌", name: "Test-Bereich", owner: ids.papa })).id;
});

after(async () => {
  if (pb) await pb.stop();
});

describe("areas: starter data", () => {
  it("the migration ships the seven generic areas, all without an owner", async () => {
    const all = (await pb.api("GET", `${rec()}?perPage=50`, { token: su })).data.items;
    const labels = all.map((a) => `${a.emoji} ${a.name}`);
    for (const s of STARTERS) assert.ok(labels.includes(s), `missing starter area ${s}`);
    for (const a of all.filter((x) => STARTERS.includes(`${x.emoji} ${x.name}`))) {
      assert.equal(a.owner, "", `${a.name} must start without owner`);
    }
  });
});

describe("areas: parents", () => {
  it("either parent lists, adds, renames, sets and clears the owner, and deletes", async () => {
    const list = await pb.api("GET", `${rec()}?perPage=50`, { token: tokens.otherParent });
    assert.equal(list.status, 200);
    assert.ok(list.data.totalItems >= 8);

    const created = await pb.api("POST", rec(), {
      token: tokens.parent,
      body: { emoji: "🧺", name: "Test-Wäsche", owner: "" },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.id;
    const renamed = await pb.api("PATCH", rec(id), { token: tokens.otherParent, body: { name: "Test-Neu" } });
    assert.equal(renamed.data.name, "Test-Neu");
    const owned = await pb.api("PATCH", rec(id), { token: tokens.parent, body: { owner: ids.mama } });
    assert.equal(owned.data.owner, ids.mama);
    const cleared = await pb.api("PATCH", rec(id), { token: tokens.otherParent, body: { owner: "" } });
    assert.equal(cleared.data.owner, "");
    assert.equal((await pb.api("DELETE", rec(id), { token: tokens.otherParent })).status, 204);
  });

  it("rejects an owner that is a kid or unknown, and an empty or over-long name (create and update)", async () => {
    const before = await superCount();
    for (const owner of [ids.kind1, "abcdefghijklmno"]) {
      denied(
        await pb.api("POST", rec(), { token: tokens.parent, body: { emoji: "x", name: "Test-X", owner } }),
        `create owner=${owner}`,
      );
      denied(
        await pb.api("PATCH", rec(ids.area), { token: tokens.parent, body: { owner } }),
        `update ${owner}`,
      );
    }
    for (const body of [{ name: "" }, { name: "x".repeat(81) }]) {
      denied(await pb.api("POST", rec(), { token: tokens.parent, body }), JSON.stringify(body));
      denied(await pb.api("PATCH", rec(ids.area), { token: tokens.parent, body }), JSON.stringify(body));
    }
    assert.equal((await superGet(ids.area)).owner, ids.papa);
    assert.equal((await superGet(ids.area)).name, "Test-Bereich");
    assert.equal(await superCount(), before);
  });

  it("removing the owner member leaves the area behind, unowned", async () => {
    const temp = await superCreate("members", {
      role: "parent",
      name: "Test-Opa",
      emoji: "👴",
      colour: "teal",
    });
    const area = await superCreate("areas", { emoji: "🌳", name: "Test-Garten", owner: temp.id });
    const del = await pb.api("DELETE", `/api/collections/members/records/${temp.id}`, { token: su });
    assert.equal(del.status, 204);
    assert.equal((await superGet(area.id)).owner, "");
  });
});

describe("areas: deleting an area keeps its to-dos (SPEC-0003)", () => {
  it("the to-do survives without an area", async () => {
    const area = await superCreate("areas", { emoji: "🧪", name: "Test-Weg", owner: "" });
    const todo = await superCreate("todos", {
      title: "Test-Aufgabe: bleibt",
      who: "parents",
      area: area.id,
    });
    assert.equal(todo.area, area.id);
    const del = await pb.api("DELETE", rec(area.id), { token: tokens.parent });
    assert.equal(del.status, 204);
    const kept = await pb.api("GET", `/api/collections/todos/records/${todo.id}`, { token: tokens.parent });
    assert.equal(kept.status, 200);
    assert.equal(kept.data.area, "");
    assert.equal(kept.data.title, "Test-Aufgabe: bleibt");
  });

  it("a to-do cannot point at an area that does not exist", async () => {
    denied(
      await pb.api("POST", "/api/collections/todos/records", {
        token: tokens.parent,
        body: { title: "Test-X", who: "parents", area: "abcdefghijklmno" },
      }),
      "dangling area",
    );
  });
});

describe("areas: devices (kid sessions) and anonymous", () => {
  it("get no areas and change nothing", async () => {
    for (const [who, token] of [
      ["device", tokens.device],
      ["anonymous", undefined],
    ]) {
      const t = token ? { token } : {};
      noRecords(await pb.api("GET", rec(), t), `${who} list`);
      denied(await pb.api("GET", rec(ids.area), t), `${who} view`);
      denied(await pb.api("POST", rec(), { ...t, body: { name: "Test-X", owner: "" } }), `${who} create`);
      denied(await pb.api("PATCH", rec(ids.area), { ...t, body: { name: "gehackt" } }), `${who} update`);
      denied(await pb.api("PATCH", rec(ids.area), { ...t, body: { owner: ids.mama } }), `${who} owner`);
      denied(await pb.api("DELETE", rec(ids.area), t), `${who} delete`);
    }
    const a = await superGet(ids.area);
    assert.equal(a.name, "Test-Bereich");
    assert.equal(a.owner, ids.papa);
  });
});

describe("Parents' Routines Today: a parent ticks a routine for themself", () => {
  it("parents create and delete routine_done for a parent member; a device cannot", async () => {
    const routine = await superCreate("routines", {
      emoji: "🗑️",
      title: "Test-Mülltonnen",
      kind: "chore",
      days: ["0"],
      who: "parents",
    });
    const tick = (token, member) =>
      pb.api("POST", "/api/collections/routine_done/records", {
        token,
        body: { routine: routine.id, member, day: "2026-10-12" },
      });
    denied(await tick(tokens.device, ids.papa), "device ticks for a parent");
    const ok = await tick(tokens.parent, ids.papa);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const other = await tick(tokens.otherParent, ids.mama);
    assert.equal(other.status, 200, JSON.stringify(other.data));
    // one tick per routine, member and day
    denied(await tick(tokens.parent, ids.papa), "duplicate tick");
    const list = await pb.api("GET", "/api/collections/routine_done/records", { token: tokens.parent });
    assert.equal(list.data.totalItems, 2);
    denied(
      await pb.api("DELETE", `/api/collections/routine_done/records/${ok.data.id}`, { token: tokens.device }),
      "device un-ticks a parent",
    );
    assert.equal(
      (
        await pb.api("DELETE", `/api/collections/routine_done/records/${ok.data.id}`, {
          token: tokens.parent,
        })
      ).status,
      204,
    );
  });
});
