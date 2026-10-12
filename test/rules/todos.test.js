// Governing: ADR-0001 (rules are the security model), SPEC-0003 REQ "To-dos" (Kid session: the server returns no
// to-dos; either parent may create, edit, complete, un-complete and delete any to-do), SPEC-0001 REQ "Kid Access
// on Enrolled Devices" (Device reads to-dos: no records), design table "Three principal types, rules per collection"
//
// Access rules of `todos` as parent, other parent, device and anonymous against a real throwaway PocketBase.
// Every allowed operation is paired with its forbidden counterpart; forbidden writes are followed by a
// superuser read proving the data is unchanged.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";

let pb;
let su;
const tokens = {};
const ids = {};

const rec = (id = "") => `/api/collections/todos/records${id ? `/${id}` : ""}`;
const denied = (res, what) =>
  assert.ok(res.status >= 400, `${what}: expected an error, got HTTP ${res.status}`);
// A list the caller may not see is answered with an error or an empty page, never with records.
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
  ids.todo = (
    await superCreate("todos", { title: "Test-Aufgabe: Altglas", who: ids.papa, due: "2026-10-12" })
  ).id;
});

after(async () => {
  if (pb) await pb.stop();
});

describe("todos: parents", () => {
  it("create for one parent, the other parent and both; edit, complete, un-complete, delete", async () => {
    for (const who of [ids.papa, ids.mama, "parents"]) {
      const created = await pb.api("POST", rec(), {
        token: tokens.parent,
        body: { title: "Test-Aufgabe: Elternabend", who, due: "2026-10-13", area: "", done: "" },
      });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      assert.equal(created.data.who, who);
      const id = created.data.id;
      // the other parent sees and edits it too (any parent, any to-do)
      assert.equal((await pb.api("GET", rec(id), { token: tokens.otherParent })).status, 200);
      const done = await pb.api("PATCH", rec(id), {
        token: tokens.otherParent,
        body: { done: "2026-10-12" },
      });
      assert.equal(done.data.done, "2026-10-12");
      const undone = await pb.api("PATCH", rec(id), { token: tokens.parent, body: { done: "" } });
      assert.equal(undone.data.done, "");
      const edited = await pb.api("PATCH", rec(id), {
        token: tokens.parent,
        body: { title: "Test-Aufgabe: neu", due: "", who: "parents" },
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.data.who, "parents");
      assert.equal((await pb.api("DELETE", rec(id), { token: tokens.otherParent })).status, 204);
    }
    assert.equal(await superCount(), 1);
  });

  it("lists every to-do", async () => {
    const list = await pb.api("GET", rec(), { token: tokens.parent });
    assert.equal(list.status, 200);
    assert.equal(list.data.totalItems, 1);
  });

  it("rejects an assignee that is a kid, unknown, or malformed (create and update)", async () => {
    for (const who of [ids.kind1, "abcdefghijklmno", "everyone", ""]) {
      denied(
        await pb.api("POST", rec(), { token: tokens.parent, body: { title: "Test-X", who } }),
        `create who=${who}`,
      );
      denied(
        await pb.api("PATCH", rec(ids.todo), { token: tokens.parent, body: { who } }),
        `update who=${who}`,
      );
    }
    assert.equal((await superGet(ids.todo)).who, ids.papa);
    assert.equal(await superCount(), 1);
  });

  it("rejects an empty title, an over-long title and malformed dates", async () => {
    for (const body of [
      { title: "", who: "parents" },
      { title: "x".repeat(201), who: "parents" },
      { title: "Test-X", who: "parents", due: "morgen" },
      { title: "Test-X", who: "parents", due: "2026-1-3" },
      { title: "Test-X", who: "parents", done: "2026-10-12T10:00:00Z" },
      { title: "Test-X", who: "parents", area: "not an id!" },
    ]) {
      denied(await pb.api("POST", rec(), { token: tokens.parent, body }), JSON.stringify(body));
    }
    assert.equal(await superCount(), 1);
  });
});

describe("todos: devices (kid sessions)", () => {
  it("get no to-dos: list, view, create, update and delete are all refused", async () => {
    noRecords(await pb.api("GET", rec(), { token: tokens.device }), "device list");
    denied(await pb.api("GET", rec(ids.todo), { token: tokens.device }), "device view");
    denied(
      await pb.api("POST", rec(), { token: tokens.device, body: { title: "Test-X", who: "parents" } }),
      "device create",
    );
    denied(
      await pb.api("PATCH", rec(ids.todo), { token: tokens.device, body: { title: "gehackt" } }),
      "device update",
    );
    denied(await pb.api("DELETE", rec(ids.todo), { token: tokens.device }), "device delete");
    assert.equal((await superGet(ids.todo)).title, "Test-Aufgabe: Altglas");
    assert.equal(await superCount(), 1);
  });
});

describe("todos: anonymous", () => {
  it("gets nothing and changes nothing", async () => {
    noRecords(await pb.api("GET", rec()), "anonymous list");
    denied(await pb.api("GET", rec(ids.todo)), "anonymous view");
    denied(await pb.api("POST", rec(), { body: { title: "Test-X", who: "parents" } }), "anonymous create");
    denied(await pb.api("PATCH", rec(ids.todo), { body: { title: "gehackt" } }), "anonymous update");
    denied(await pb.api("DELETE", rec(ids.todo)), "anonymous delete");
    assert.equal((await superGet(ids.todo)).title, "Test-Aufgabe: Altglas");
    assert.equal(await superCount(), 1);
  });
});
