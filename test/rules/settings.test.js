// Governing: ADR-0001, ADR-0003, SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Household and
// Members", REQ "Device Enrollment and Removal", Security Requirements "Authentication", "Rate Limiting"
//
// The settings story against a real throwaway PocketBase: GET /api/hh/export (parent only, every collection,
// no credentials, size), the member guards (kids cannot manage members, parents are not minted or demoted,
// removing a kid), device removal ("Replaced iPad") and "sign out everywhere". Fake names and secrets only.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startPocketBase } = require("./pocketbase.js");

const SETUP_TOKEN = "test-setup-token-not-a-placeholder";
const PW = "test-parent-password-1";
const PIN = "246810";
const rec = (c, id = "") => `/api/collections/${c}/records${id ? `/${id}` : ""}`;
const FORBIDDEN_KEY = /"(pin_hash|tokenKey|password|passwordHash|token_hash|token|secret)"\s*:/i;

describe("household settings and data export", () => {
  let pb;
  let papa; // parent token
  let su;
  const ids = {};
  let device; // { token, secret, id, email }

  const create = async (collection, body, token = su) => {
    const res = await pb.api("POST", rec(collection), { token, body });
    assert.equal(res.status, 200, `${collection}: ${JSON.stringify(res.data)}`);
    return res.data;
  };
  const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;

  before(async () => {
    pb = await startPocketBase({ env: { HH_SETUP_TOKEN: SETUP_TOKEN, HH_TZ: "Europe/Berlin" } });
    su = pb.superToken;
    const setup = await pb.api("POST", "/api/hh/setup", {
      body: { token: SETUP_TOKEN, name: "Test-Papa", email: "test-papa@example.test", password: PW },
    });
    assert.equal(setup.status, 200);
    papa = setup.data.token;
    ids.papa = setup.data.record.member;
    ids.papaAccount = setup.data.record.id;
    ids.kid1 = (await create("members", { role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" }, papa)).id;
    ids.kid2 = (await create("members", { role: "kid", name: "Test-Kind-2", emoji: "🎨", colour: "teal" }, papa)).id;
    // The own PIN, so the member row carries a hash that must not leave the server.
    assert.equal((await pb.api("PUT", "/api/hh/pin", { token: papa, body: { pin: PIN, password: PW } })).status, 200);

    const routine = await create("routines", {
      emoji: "🪥",
      title: "Zähne putzen",
      kind: "chore",
      days: ["0", "1"],
      who: "member",
      member: ids.kid1,
    });
    ids.routine = routine.id;
    await create("routine_done", { routine: routine.id, member: ids.kid1, day: "2026-10-12" });
    await create("routine_done", { routine: routine.id, member: ids.kid1, day: "2026-10-13" });
    await create("todos", { title: "Test-Aufgabe", who: ids.papa }, papa);
    ids.area = (await create("areas", { emoji: "🚗", name: "Test-Bereich", owner: ids.kid2 }, papa)).id;
    ids.list = (await create("lists", { emoji: "🛒", name: "Test-Liste" }, papa)).id;
    ids.item = (await create("shop_items", { list: ids.list, name: "Milch", by: ids.kid1 }, papa)).id;
    await pb.api("PATCH", rec("shop_items", ids.item), { token: papa, body: { bought: "2026-10-12" } });
    await create("settings", { tz: "", mascot: { emoji: "🦊", name: "Test-Fuchs" }, auto_refill: true }, papa);

    const secret = crypto.randomBytes(32).toString("hex");
    const enrolled = await pb.api("POST", "/api/hh/devices/enroll", {
      token: papa,
      body: { name: "Test-Tablet", secret },
    });
    assert.equal(enrolled.status, 200);
    const signedIn = await pb.api("POST", "/api/collections/devices/auth-with-password", {
      body: { identity: enrolled.data.email, password: secret },
    });
    device = { token: signedIn.data.token, secret, id: enrolled.data.id, email: enrolled.data.email };
  });
  after(() => pb.stop());

  describe("Data Export", () => {
    it("Export: a parent gets one JSON file with members, routines, to-dos, areas, lists, purchases and settings", async () => {
      const res = await pb.api("GET", "/api/hh/export", { token: papa });
      assert.equal(res.status, 200);
      const c = res.data.collections;
      for (const name of [
        "members",
        "routines",
        "routine_done",
        "todos",
        "areas",
        "lists",
        "shop_items",
        "purchases",
        "settings",
      ])
        assert.ok(Array.isArray(c[name]), `${name} is exported`);
      assert.equal(c.members.length, 3);
      assert.equal(c.routine_done.length, 2);
      assert.equal(c.purchases.length, 1, "the tick created one purchase");
      assert.ok(c.lists.some((l) => l.name === "Test-Liste"));
      assert.equal(c.settings[0].mascot.name, "Test-Fuchs");
      assert.equal(res.data.version, 1);
      assert.equal(res.data.tz, "Europe/Berlin");
      assert.equal(res.data.app, "haushelden");
      assert.ok(!Number.isNaN(Date.parse(res.data.exported_at)));
    });

    it("carries no password hashes, tokens, PIN hashes, device secrets or invite tokens", async () => {
      const invite = await pb.api("POST", "/api/hh/invite", { token: papa });
      assert.equal(invite.status, 200);
      const res = await pb.api("GET", "/api/hh/export", { token: papa });
      const text = JSON.stringify(res.data);
      assert.doesNotMatch(text, FORBIDDEN_KEY);
      assert.ok(!text.includes("v1$"), "no PIN hash value");
      assert.ok(!text.includes(device.secret), "no device secret");
      assert.ok(!text.includes(invite.data.token), "no invite token");
      assert.ok(!text.includes("test-papa@example.test"), "no account e-mail");
      assert.ok(!("invites" in res.data.collections));
      assert.ok(!("parents" in res.data.collections));
      assert.ok(!("devices" in res.data.collections));
    });

    it("is offered as a download", async () => {
      const raw = await fetch(`${pb.base}/api/hh/export`, { headers: { authorization: papa } });
      assert.match(raw.headers.get("content-disposition"), /^attachment; filename="haushelden-export-\d{4}-\d{2}-\d{2}\.json"$/);
      assert.equal(raw.headers.get("cache-control"), "no-store");
      await raw.text();
    });

    it("refuses devices and anonymous callers", async () => {
      assert.equal((await pb.api("GET", "/api/hh/export", { token: device.token })).status, 403);
      const anon = await pb.api("GET", "/api/hh/export");
      assert.ok([401, 403].includes(anon.status), `anonymous: HTTP ${anon.status}`);
    });

    it("accepts a short PIN session (a parent view on a family device)", async () => {
      const pin = await pb.api("POST", "/api/hh/pin", {
        token: device.token,
        body: { member: ids.papa, pin: PIN },
      });
      assert.equal(pin.status, 200);
      assert.equal((await pb.api("GET", "/api/hh/export", { token: pin.data.token })).status, 200);
    });

    it("Export stays reasonably small and quick for a year of purchases", async () => {
      const list = await create("lists", { emoji: "📦", name: "Test-Vorrat" }, papa);
      const rows = Array.from({ length: 1200 }, (_, i) => ({
        method: "POST",
        url: "/api/collections/purchases/records",
        body: { list: list.id, name: `Artikel ${i}`, key: `artikel ${i}`, day: "2026-09-01" },
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const res = await pb.api("POST", "/api/batch", { token: su, body: { requests: rows.slice(i, i + 200) } });
        assert.equal(res.status, 200, JSON.stringify(res.data).slice(0, 200));
      }
      const t0 = Date.now();
      const raw = await fetch(`${pb.base}/api/hh/export`, { headers: { authorization: papa } });
      const text = await raw.text();
      assert.equal(raw.status, 200);
      assert.ok(Date.now() - t0 < 5000, "export under five seconds");
      assert.ok(text.length < 2 * 1024 * 1024, `export is ${text.length} bytes`);
      assert.equal(JSON.parse(text).collections.purchases.length, 1201);
    });
  });

  describe("Household Settings: members", () => {
    it("Changing a kid's colour: a parent updates colour, name and avatar", async () => {
      const res = await pb.api("PATCH", rec("members", ids.kid1), {
        token: papa,
        body: { colour: "mauve", name: "Test-Kind-1b", emoji: "🦄" },
      });
      assert.equal(res.status, 200);
      assert.equal((await superGet("members", ids.kid1)).colour, "mauve");
    });

    it("Kid cannot manage members: a device cannot add, rename or remove a member", async () => {
      const add = await pb.api("POST", rec("members"), {
        token: device.token,
        body: { role: "kid", name: "Eindringling", emoji: "👻", colour: "red" },
      });
      assert.ok(add.status >= 400);
      const rename = await pb.api("PATCH", rec("members", ids.kid2), { token: device.token, body: { name: "X" } });
      assert.ok(rename.status >= 400);
      const del = await pb.api("DELETE", rec("members", ids.kid2), { token: device.token });
      assert.ok(del.status >= 400);
      assert.equal((await superGet("members", ids.kid2)).name, "Test-Kind-2");
    });

    it("refuses a new member with the parent role (parents come by invite) and role changes", async () => {
      const mint = await pb.api("POST", rec("members"), {
        token: papa,
        body: { role: "parent", name: "Test-Fremd", emoji: "🙂", colour: "red" },
      });
      assert.equal(mint.status, 400);
      const promote = await pb.api("PATCH", rec("members", ids.kid2), { token: papa, body: { role: "parent" } });
      assert.equal(promote.status, 400);
      const demote = await pb.api("PATCH", rec("members", ids.papa), { token: papa, body: { role: "kid" } });
      assert.equal(demote.status, 400);
      assert.equal((await superGet("members", ids.papa)).role, "parent");
      assert.equal((await superGet("members", ids.kid2)).role, "kid");
    });

    it("the last parent cannot be removed", async () => {
      const del = await pb.api("DELETE", rec("members", ids.papa), { token: papa });
      assert.equal(del.status, 403);
      assert.match(del.data.message, /letzte Elternteil/);
      assert.equal((await superGet("members", ids.papa)).id, ids.papa);
    });

    it("removing a kid deletes their routines and ticks and leaves shopping items and areas, unassigned", async () => {
      const del = await pb.api("DELETE", rec("members", ids.kid1), { token: papa });
      assert.equal(del.status, 204);
      const ticks = await pb.api("GET", `${rec("routine_done")}?filter=${encodeURIComponent(`member = "${ids.kid1}"`)}`, { token: su });
      assert.equal(ticks.data.totalItems, 0);
      assert.equal((await pb.api("GET", rec("routines", ids.routine), { token: su })).status, 404);
      assert.equal((await superGet("shop_items", ids.item)).by, "");
      // Area owned by the other kid is untouched; remove that kid too and the area stays, without owner.
      assert.equal((await pb.api("DELETE", rec("members", ids.kid2), { token: papa })).status, 204);
      assert.equal((await superGet("areas", ids.area)).owner, "");
      assert.equal((await pb.api("GET", "/api/hh/export", { token: papa })).data.collections.members.length, 1);
    });
  });

  describe("Device Enrollment and Removal", () => {
    it("a parent lists devices with name and last use; a device cannot", async () => {
      const own = await pb.api("GET", rec("devices"), { token: papa });
      assert.equal(own.status, 200);
      assert.equal(own.data.items[0].name, "Test-Tablet");
      assert.ok(own.data.items[0].last_seen, "last use is stamped by the sign-in");
      assert.equal(JSON.stringify(own.data).includes(device.secret), false);
      const other = await pb.api("GET", rec("devices"), { token: device.token });
      assert.ok(other.status === 403 || other.data.items.length === 0);
    });

    it("Replaced iPad: removing the device ends its session on the next request", async () => {
      assert.equal((await pb.api("GET", rec("members"), { token: device.token })).status, 200);
      assert.equal((await pb.api("DELETE", rec("devices", device.id), { token: device.token })).status >= 400, true);
      assert.equal((await pb.api("DELETE", rec("devices", device.id), { token: papa })).status, 204);
      const after = await pb.api("GET", rec("members"), { token: device.token });
      assert.ok(after.status === 401 || after.status === 403, `HTTP ${after.status}`);
      const refresh = await pb.api("POST", "/api/collections/devices/auth-refresh", { token: device.token });
      assert.ok(refresh.status >= 400);
      const again = await pb.api("POST", "/api/collections/devices/auth-with-password", {
        body: { identity: device.email, password: device.secret },
      });
      assert.equal(again.status, 400);
    });
  });

  describe("own sessions", () => {
    it("sign out everywhere ends every session of the account, including this one", async () => {
      const second = await pb.signIn("parents", "test-papa@example.test", PW);
      assert.equal((await pb.api("GET", "/api/hh/export", { token: second })).status, 200);
      assert.equal((await pb.api("POST", "/api/hh/sessions/revoke", { token: papa, body: {} })).status, 200);
      for (const token of [papa, second]) {
        const res = await pb.api("GET", "/api/hh/export", { token });
        assert.ok(res.status === 401 || res.status === 403, `HTTP ${res.status}`);
      }
      // A fresh sign-in works again.
      const fresh = await pb.signIn("parents", "test-papa@example.test", PW);
      papa = fresh;
      assert.equal((await pb.api("GET", "/api/hh/export", { token: papa })).status, 200);
    });
  });

  describe("export rate limit", () => {
    it("allows five exports per window and then answers 429", async () => {
      const results = [];
      for (let i = 0; i < 8; i++) results.push((await pb.api("GET", "/api/hh/export", { token: papa })).status);
      assert.ok(results.includes(429), JSON.stringify(results));
      assert.equal(results[0], 200);
    });
  });
});
