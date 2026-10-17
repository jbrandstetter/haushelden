// Governing: ADR-0001 (rules are the security model), ADR-0003 (device accounts), SPEC-0010 REQ "Ticking Off",
// REQ "Standard Chores", REQ "Starting a Cleaning Day", REQ "Assigning and Adding Chores",
// Security Requirements "Authorisation" and "Input"
//
// The cleaning day against a real throwaway PocketBase: the migration, the rules for parents, PIN sessions, family
// devices and anonymous callers (allowed operations paired with forbidden ones, each followed by a superuser read
// proving nothing changed) and the request hooks (trimmed titles, valid days, consistent tick state, replayed creates).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PW = "change-me-parent-pw-1";
const PIN = "246810";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";

let pb;
let su;
const tokens = {};
const ids = {};
const DAY = "2026-11-07";

const rec = (collection, id = "") => `/api/collections/${collection}/records${id ? `/${id}` : ""}`;
const create = (collection, token, body) => pb.api("POST", rec(collection), { token, body });
const patch = (collection, id, token, body) => pb.api("PATCH", rec(collection, id), { token, body });
const remove = (collection, id, token) => pb.api("DELETE", rec(collection, id), { token });
const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;
async function superCreate(collection, body) {
  const res = await create(collection, su, body);
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const denied = (res, what) => assert.ok(res.status >= 400, `${what}: expected an error, got ${res.status}`);
const chore = (extra = {}) =>
  superCreate("chores", { day: DAY, title: "Test-Bad putzen", assignee: ids.kid1, ...extra });

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;
  const member = async (key, role, name) => {
    ids[key] = (await superCreate("members", { role, name, emoji: "🙂", colour: "blue" })).id;
  };
  await member("papa", "parent", "Test-Papa");
  await member("mama", "parent", "Test-Mama");
  await member("kid1", "kid", "Test-Kind-1");
  await member("kid2", "kid", "Test-Kind-2");
  for (const [key, email] of [
    ["papa", "papa@example.test"],
    ["mama", "mama@example.test"],
  ]) {
    await superCreate("parents", {
      email,
      password: PW,
      passwordConfirm: PW,
      member: ids[key],
      emailVisibility: false,
    });
    tokens[key] = await pb.signIn("parents", email, PW);
  }
  await superCreate("devices", {
    email: "device-1@example.test",
    password: DEVICE_SECRET,
    passwordConfirm: DEVICE_SECRET,
    name: "Test-Tablet",
  });
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
  assert.equal(
    (await pb.api("PUT", "/api/hh/pin", { token: tokens.papa, body: { pin: PIN, password: PW } })).status,
    200,
  );
  const pin = await pb.api("POST", "/api/hh/pin", {
    token: tokens.device,
    body: { member: ids.papa, pin: PIN },
  });
  assert.equal(pin.status, 200);
  tokens.pin = pin.data.token;
});

after(async () => {
  if (pb) await pb.stop();
});

describe("migration", () => {
  it("creates chore_templates and chores with the input limits and non-blocking relations", async () => {
    const col = async (name) => (await pb.api("GET", `/api/collections/${name}`, { token: su })).data;
    const field = (c, n) => c.fields.find((f) => f.name === n);
    const chores = await col("chores");
    assert.equal(field(chores, "title").max, 80);
    assert.equal(field(chores, "day").pattern, "^\\d{4}-\\d{2}-\\d{2}$");
    for (const n of ["assignee", "done_by", "template"]) {
      assert.equal(field(chores, n).required, false);
      assert.equal(field(chores, n).cascadeDelete, false);
    }
    const templates = await col("chore_templates");
    assert.equal(field(templates, "title").max, 80);
    assert.equal(field(templates, "every_days").max, 365);
  });
});

describe("reading", () => {
  it("lets parents, PIN sessions and devices read everything and nobody else", async () => {
    const c = await chore();
    for (const who of ["papa", "pin", "device"]) {
      assert.equal((await pb.api("GET", rec("chores", c.id), { token: tokens[who] })).status, 200, who);
      assert.equal(
        (await pb.api("GET", rec("chores"), { token: tokens[who] })).data.totalItems >= 1,
        true,
        who,
      );
    }
    const t = await superCreate("chore_templates", { title: "Test-Vorlage", kids: true });
    assert.equal((await pb.api("GET", rec("chore_templates", t.id), { token: tokens.device })).status, 200);
    denied(await pb.api("GET", rec("chores", c.id), {}), "anonymous view");
    assert.equal((await pb.api("GET", rec("chores"), {})).data.items.length, 0, "anonymous list");
  });
});

describe("parents and PIN sessions", () => {
  for (const who of ["papa", "mama", "pin"]) {
    it(`${who} creates, assigns, ticks and deletes chores and standard chores`, async () => {
      const made = await create("chores", tokens[who], {
        day: DAY,
        title: "  Test-Küche   wischen ",
        assignee: ids.papa,
      });
      assert.equal(made.status, 200, JSON.stringify(made.data));
      assert.equal(made.data.title, "Test-Küche wischen", "title trimmed and collapsed");
      assert.equal((await patch("chores", made.data.id, tokens[who], { assignee: ids.kid2 })).status, 200);
      assert.equal(
        (await patch("chores", made.data.id, tokens[who], { title: "Test-Küche saugen" })).status,
        200,
      );
      const tpl = await create("chore_templates", tokens[who], {
        title: " Test-Staub  ",
        kids: false,
        every_days: 30,
      });
      assert.equal(tpl.status, 200, JSON.stringify(tpl.data));
      assert.equal(tpl.data.title, "Test-Staub");
      assert.equal((await patch("chore_templates", tpl.data.id, tokens[who], { kids: true })).status, 200);
      assert.equal((await remove("chore_templates", tpl.data.id, tokens[who])).status, 204);
      assert.equal((await remove("chores", made.data.id, tokens[who])).status, 204);
    });
  }

  it("a parent ticks a child's chore; with no done_by the parent is recorded", async () => {
    const c = await chore();
    const res = await patch("chores", c.id, tokens.mama, { done: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.done, true);
    assert.equal(res.data.done_by, ids.mama);
    const un = await patch("chores", c.id, tokens.mama, { done: false, done_by: "" });
    assert.equal(un.data.done, false);
    assert.equal(un.data.done_by, "");
  });

  it("a parent may record the assignee, but not a third member, as the one who ticked", async () => {
    const c = await chore();
    assert.equal((await patch("chores", c.id, tokens.mama, { done: true, done_by: ids.kid1 })).status, 200);
    const d = await chore();
    denied(
      await patch("chores", d.id, tokens.mama, { done: true, done_by: ids.kid2 }),
      "other kid as done_by",
    );
    denied(
      await patch("chores", d.id, tokens.mama, { done: true, done_by: ids.papa }),
      "another parent as done_by",
    );
    assert.equal((await superGet("chores", d.id)).done, false);
  });

  it("reassigning a ticked chore clears the tick", async () => {
    const c = await chore();
    await patch("chores", c.id, tokens.papa, { done: true });
    const res = await patch("chores", c.id, tokens.papa, { assignee: ids.kid2 });
    assert.equal(res.status, 200);
    assert.equal(res.data.done, false);
    assert.equal(res.data.done_by, "");
  });
});

describe("hooks", () => {
  it("refuses an invalid day, an empty title and a title over 80 characters", async () => {
    denied(await create("chores", tokens.papa, { day: "2026-02-30", title: "Test" }), "impossible day");
    denied(await create("chores", tokens.papa, { day: "morgen", title: "Test" }), "not a date");
    denied(await create("chores", tokens.papa, { day: DAY, title: "   " }), "blank title");
    denied(await create("chores", tokens.papa, { day: DAY, title: "x".repeat(81) }), "long title");
    denied(await create("chore_templates", tokens.papa, { title: "x".repeat(81) }), "long template title");
    denied(await create("chore_templates", tokens.papa, { title: "Test", every_days: 400 }), "interval");
  });

  it("answers a replayed create with 'id already exists'", async () => {
    const body = { id: "chorereplay0001", day: DAY, title: "Test-Replay" };
    assert.equal((await create("chores", tokens.papa, body)).status, 200);
    const again = await create("chores", tokens.papa, body);
    assert.equal(again.status, 400);
    assert.match(JSON.stringify(again.data), /existiert schon|validation_not_unique/);
    const t = { id: "choretplreplay1", title: "Test-Replay" };
    assert.equal((await create("chore_templates", tokens.papa, t)).status, 200);
    assert.equal((await create("chore_templates", tokens.papa, t)).status, 400);
  });

  it("deleting a standard chore keeps the chores made from it", async () => {
    const t = await superCreate("chore_templates", { title: "Test-Vorlage 2", kids: true });
    const c = await chore({ template: t.id });
    assert.equal((await remove("chore_templates", t.id, tokens.papa)).status, 204);
    const after = await superGet("chores", c.id);
    assert.equal(after.template, "");
    assert.equal(after.title, "Test-Bad putzen");
  });

  it("removing a member keeps their chores, unassigned", async () => {
    const extra = await superCreate("members", {
      role: "kid",
      name: "Test-Kind-3",
      emoji: "🙂",
      colour: "red",
    });
    const c = await chore({ assignee: extra.id });
    assert.equal((await pb.api("DELETE", rec("members", extra.id), { token: su })).status, 204);
    assert.equal((await superGet("chores", c.id)).assignee, "");
  });
});

describe("family devices", () => {
  it("ticks and un-ticks a kid's chore, recording the assignee", async () => {
    const c = await chore();
    const tick = await patch("chores", c.id, tokens.device, { done: true, done_by: ids.kid1 });
    assert.equal(tick.status, 200, JSON.stringify(tick.data));
    assert.equal(tick.data.done_by, ids.kid1);
    const untick = await patch("chores", c.id, tokens.device, { done: false, done_by: "" });
    assert.equal(untick.status, 200);
    assert.equal(untick.data.done, false);
  });

  it("a tick without done_by is recorded for the assignee", async () => {
    const c = await chore();
    const tick = await patch("chores", c.id, tokens.device, { done: true });
    assert.equal(tick.status, 200);
    assert.equal(tick.data.done_by, ids.kid1);
  });

  it("cannot name another member as the one who ticked", async () => {
    const c = await chore();
    denied(await patch("chores", c.id, tokens.device, { done: true, done_by: ids.kid2 }), "other kid");
    denied(await patch("chores", c.id, tokens.device, { done: true, done_by: ids.papa }), "a parent");
    assert.equal((await superGet("chores", c.id)).done, false);
  });

  it("cannot tick a parent's chore or an unassigned one", async () => {
    const parents = await chore({ assignee: ids.papa });
    const nobody = await chore({ assignee: "" });
    denied(
      await patch("chores", parents.id, tokens.device, { done: true, done_by: ids.papa }),
      "parent chore",
    );
    denied(await patch("chores", parents.id, tokens.device, { done: true }), "parent chore, no done_by");
    denied(await patch("chores", nobody.id, tokens.device, { done: true }), "unassigned chore");
    assert.equal((await superGet("chores", parents.id)).done, false);
    assert.equal((await superGet("chores", nobody.id)).done, false);
  });

  it("cannot change title, day, assignee, template or sort, even while ticking", async () => {
    const c = await chore();
    for (const body of [
      { title: "Hacked" },
      { day: "2026-12-24" },
      { assignee: ids.kid2 },
      { assignee: "" },
      { template: "x" },
      { sort: 5 },
      { done: true, title: "Hacked" },
      { done: true, assignee: ids.papa },
    ]) {
      denied(await patch("chores", c.id, tokens.device, body), JSON.stringify(body));
    }
    const after = await superGet("chores", c.id);
    assert.equal(after.title, "Test-Bad putzen");
    assert.equal(after.assignee, ids.kid1);
    assert.equal(after.done, false);
  });

  it("cannot create or delete chores or touch standard chores", async () => {
    const c = await chore();
    const t = await superCreate("chore_templates", { title: "Test-Vorlage 3", kids: true });
    denied(
      await create("chores", tokens.device, { day: DAY, title: "Test", assignee: ids.kid1 }),
      "create chore",
    );
    denied(await remove("chores", c.id, tokens.device), "delete chore");
    denied(await create("chore_templates", tokens.device, { title: "Test" }), "create template");
    denied(await patch("chore_templates", t.id, tokens.device, { title: "Hacked" }), "update template");
    denied(await remove("chore_templates", t.id, tokens.device), "delete template");
    assert.equal((await superGet("chores", c.id)).id, c.id);
    assert.equal((await superGet("chore_templates", t.id)).title, "Test-Vorlage 3");
  });
});

describe("anonymous callers", () => {
  it("cannot write anything", async () => {
    const c = await chore();
    denied(await create("chores", "", { day: DAY, title: "Test" }), "create");
    denied(await patch("chores", c.id, "", { done: true }), "update");
    denied(await remove("chores", c.id, ""), "delete");
    denied(await create("chore_templates", "", { title: "Test" }), "create template");
    assert.equal((await superGet("chores", c.id)).done, false);
  });
});
