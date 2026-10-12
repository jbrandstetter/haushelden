// Governing: ADR-0001 (rules and hooks are the security model), SPEC-0005 REQ "Purchase History and Rhythm",
// REQ "Automatic Refill" (due, not due, marked, no duplicates, deferral, switch), REQ "Learned Overview" (reset,
// parent only), SPEC-0001 Security Requirements (authenticated endpoints)
//
// The purchase-history story against a real throwaway PocketBase: history is written as a superuser (the real
// path is the shopping hook), then the refill endpoint, the hourly job, the removal hook and the reset endpoint
// are exercised as parent, device and anonymous. Every test uses its own list, so tests do not influence each other.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";

let pb;
let su;
const tokens = {};
const ids = {};

const rec = (collection, id = "") => `/api/collections/${collection}/records${id ? `/${id}` : ""}`;
const denied = (res, what) =>
  assert.ok(res.status >= 400, `${what}: expected an error, got HTTP ${res.status}`);
const dayIn = (offset = 0) => {
  const key = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function superCreate(collection, body) {
  const res = await pb.api("POST", rec(collection), { token: su, body });
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const superList = async (collection, filter = "") =>
  (await pb.api("GET", `${rec(collection)}?perPage=200&filter=${encodeURIComponent(filter)}`, { token: su }))
    .data.items;
const newList = async (name) => (await superCreate("lists", { emoji: "🧪", name })).id;
/** Writes purchase history as a superuser: offsets are days relative to today (negative = past). */
async function history(list, name, offsets) {
  for (const o of offsets) {
    await superCreate("purchases", { list, name, key: name.toLowerCase(), day: dayIn(o), item: "" });
  }
}
const refill = (list, token = tokens.device) => pb.api("POST", "/api/hh/refill", { token, body: { list } });
const itemsOf = (list) => superList("shop_items", `list = "${list}"`);
const addItem = (list, name, extra = {}) =>
  pb.api("POST", rec("shop_items"), { token: tokens.device, body: { list, name, by: ids.kind1, ...extra } });

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;
  ids.papa = (
    await superCreate("members", { role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" })
  ).id;
  ids.kind1 = (
    await superCreate("members", { role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" })
  ).id;
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
  tokens.parent = await pb.signIn("parents", "papa@example.test", PARENT_PW);
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
});

after(async () => {
  if (pb) await pb.stop();
});

describe("automatic refill: due and not due", () => {
  it("Milch (rhythm 5, last bought 4 days ago) is added, marked automatic, with its reason data", async () => {
    const list = await newList("Test-Due");
    await history(list, "Milch", [-24, -20, -14, -9, -4]); // intervals 4, 6, 5, 5 -> rhythm 5
    const res = await refill(list);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.added, 1);
    const [item] = await itemsOf(list);
    assert.equal(item.name, "Milch");
    assert.equal(item.auto, true);
    assert.equal(item.bought, "");
    assert.equal(item.by, "");
    assert.equal(item.auto_rhythm, 5);
    assert.equal(item.auto_last, dayIn(-4));
  });

  it("is not added while it is not due yet, and not without a rhythm (one purchase)", async () => {
    const list = await newList("Test-NotDue");
    await history(list, "Butter", [-12, -8, -4, -2]); // rhythm 3 (4, 4, 2 -> 4)? -> 4; last 2 days ago: not due
    await history(list, "Einmalig", [-30]); // a single purchase never has a rhythm
    assert.equal((await refill(list)).data.added, 0);
    assert.equal((await itemsOf(list)).length, 0);
  });

  it("an item bought today is not added again the same day, even with a one-day rhythm", async () => {
    const list = await newList("Test-Today");
    await history(list, "Brötchen", [-3, -2, -1, 0]); // rhythm 1
    assert.equal((await refill(list)).data.added, 0);
  });

  it("never duplicates: not when already open, not when in the cart, not on a repeated run", async () => {
    const list = await newList("Test-NoDup");
    await history(list, "Eier", [-18, -12, -6]); // rhythm 6, due
    await history(list, "Käse", [-18, -12, -6]);
    await history(list, "Joghurt", [-18, -12, -6]);
    const open = await addItem(list, "  eier ");
    assert.equal(open.status, 200);
    const cart = await addItem(list, "Käse");
    assert.equal(
      (
        await pb.api("PATCH", rec("shop_items", cart.data.id), {
          token: tokens.device,
          body: { bought: dayIn(0) },
        })
      ).status,
      200,
    );
    assert.equal((await refill(list)).data.added, 1, "only Joghurt");
    assert.equal((await refill(list)).data.added, 0, "second run adds nothing");
    const names = (await itemsOf(list)).map((i) => i.name).sort();
    assert.deepEqual(names, ["Joghurt", "Käse", "eier"]);
  });

  it("simultaneous runs from several devices create exactly one open item", async () => {
    const list = await newList("Test-Race");
    await history(list, "Reis", [-20, -15, -10]); // rhythm 5, due
    const runs = await Promise.all(Array.from({ length: 8 }, () => refill(list)));
    for (const r of runs) assert.equal(r.status, 200, JSON.stringify(r.data));
    const open = (await itemsOf(list)).filter((i) => i.bought === "");
    assert.equal(open.length, 1);
    assert.equal(
      runs.reduce((n, r) => n + r.data.added, 0),
      1,
    );
  });

  it("the hourly job refills every list (run through the cron endpoint)", async () => {
    const list = await newList("Test-Cron");
    await history(list, "Nudeln", [-20, -15, -10]);
    const run = await pb.api("POST", "/api/crons/hh_auto_refill", { token: su });
    assert.ok(run.status === 204 || run.status === 200, `cron run: HTTP ${run.status}`);
    for (let i = 0; i < 30 && (await itemsOf(list)).length === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal((await itemsOf(list)).length, 1);
  });
});

describe("automatic refill: removal defers, switch turns it off", () => {
  it("removing an automatic Shampoo (rhythm 35) unbought defers it by 18 days", async () => {
    const list = await newList("Test-Defer");
    await history(list, "Shampoo", [-105, -70, -35]);
    await refill(list);
    const [item] = await itemsOf(list);
    assert.equal(item.auto, true);
    assert.equal((await pb.api("DELETE", rec("shop_items", item.id), { token: tokens.parent })).status, 204);
    const [latest] = await superList("purchases", `list = "${list}" && day = "${dayIn(-35)}"`);
    assert.equal(latest.skip_until, dayIn(18));
    assert.equal((await refill(list)).data.added, 0, "not added again");
    assert.equal((await itemsOf(list)).length, 0);
  });

  it("a deferral that has run out no longer holds the item back", async () => {
    const list = await newList("Test-DeferOver");
    await history(list, "Seife", [-30, -20, -10]); // rhythm 10, due
    const purchases = await superList("purchases", `list = "${list}"`);
    const latest = purchases.find((p) => p.day === dayIn(-10));
    await pb.api("PATCH", rec("purchases", latest.id), { token: su, body: { skip_until: dayIn(0) } });
    assert.equal((await refill(list)).data.added, 1, "skip_until is today: due again");
  });

  it("a deferral older than the newest purchase is ignored", async () => {
    const list = await newList("Test-DeferBought");
    await history(list, "Tee", [-40, -30, -20, -10]);
    const old = (await superList("purchases", `list = "${list}" && day = "${dayIn(-20)}"`))[0];
    await pb.api("PATCH", rec("purchases", old.id), { token: su, body: { skip_until: dayIn(30) } });
    assert.equal((await refill(list)).data.added, 1);
  });

  it("removing a manual item, or a ticked automatic one (Einkauf fertig), defers nothing", async () => {
    const list = await newList("Test-NoDefer");
    await history(list, "Mehl", [-20, -15, -10]);
    const manual = await addItem(list, "Mehl");
    assert.equal(
      (await pb.api("DELETE", rec("shop_items", manual.data.id), { token: tokens.parent })).status,
      204,
    );
    assert.equal((await superList("purchases", `list = "${list}" && skip_until != ""`)).length, 0);

    await refill(list);
    const [auto] = await itemsOf(list);
    assert.equal(auto.auto, true);
    assert.equal(
      (
        await pb.api("PATCH", rec("shop_items", auto.id), {
          token: tokens.device,
          body: { bought: dayIn(0) },
        })
      ).status,
      200,
    );
    assert.equal((await pb.api("DELETE", rec("shop_items", auto.id), { token: tokens.parent })).status, 204);
    assert.equal((await superList("purchases", `list = "${list}" && skip_until != ""`)).length, 0);
    assert.equal((await superList("purchases", `list = "${list}" && day = "${dayIn(0)}"`)).length, 1);
  });

  it("deleting a whole list with an automatic item works and defers nothing", async () => {
    const list = await newList("Test-ListGone");
    await history(list, "Salz", [-20, -15, -10]);
    await refill(list);
    assert.equal((await pb.api("DELETE", rec("lists", list), { token: tokens.parent })).status, 204);
    assert.equal((await superList("purchases", `list = "${list}"`)).length, 0);
  });

  it("with automatic refill off nothing is added; switched on again it is", async () => {
    const list = await newList("Test-Switch");
    await history(list, "Zucker", [-20, -15, -10]);
    const settings = await superCreate("settings", { tz: "", mascot: { pet: "fox" }, auto_refill: false });
    assert.equal((await refill(list)).data.added, 0);
    assert.equal((await itemsOf(list)).length, 0);
    const on = await pb.api("PATCH", rec("settings", settings.id), {
      token: tokens.parent,
      body: { auto_refill: true },
    });
    assert.equal(on.status, 200);
    assert.equal((await refill(list)).data.added, 1);
    // a device cannot flip the switch
    denied(
      await pb.api("PATCH", rec("settings", settings.id), {
        token: tokens.device,
        body: { auto_refill: false },
      }),
      "device switch",
    );
    assert.equal((await superList("settings"))[0].auto_refill, true);
  });
});

describe("endpoints and rules", () => {
  it("refill needs a signed-in parent or device and a real list id", async () => {
    const list = await newList("Test-Auth");
    denied(await pb.api("POST", "/api/hh/refill", { body: { list } }), "anonymous refill");
    assert.equal((await refill(list, tokens.parent)).status, 200);
    denied(await refill("nope"), "malformed id");
    denied(await refill("abcdefghijklmno"), "unknown list");
    denied(await pb.api("POST", "/api/hh/refill", { token: tokens.device, body: {} }), "no list");
  });

  it("only a parent resets the history; devices and anonymous cannot", async () => {
    const list = await newList("Test-Reset");
    const other = await newList("Test-ResetOther");
    await history(list, "Milch", [-10, -5]);
    await history(other, "Brot", [-10, -5]);
    denied(await pb.api("POST", "/api/hh/purchases/reset", { token: tokens.device, body: {} }), "device");
    denied(await pb.api("POST", "/api/hh/purchases/reset", { body: {} }), "anonymous");
    assert.equal((await superList("purchases", `list = "${list}"`)).length, 2, "nothing was deleted");

    const one = await pb.api("POST", "/api/hh/purchases/reset", { token: tokens.parent, body: { list } });
    assert.equal(one.status, 200);
    assert.equal(one.data.deleted, 2);
    assert.equal((await superList("purchases", `list = "${other}"`)).length, 2, "other list untouched");

    await addItem(other, "Offen");
    const all = await pb.api("POST", "/api/hh/purchases/reset", { token: tokens.parent, body: {} });
    assert.equal(all.status, 200);
    assert.equal((await superList("purchases")).length, 0);
    assert.equal((await itemsOf(other)).length, 1, "open items stay");
    assert.equal((await refill(other)).data.added, 0, "no history, nothing learned");
    denied(
      await pb.api("POST", "/api/hh/purchases/reset", { token: tokens.parent, body: { list: "x" } }),
      "bad id",
    );
  });

  it("purchases: parents read and delete, nobody writes through the API, devices see nothing", async () => {
    const list = await newList("Test-Rules");
    await history(list, "Milch", [-10, -5]);
    const [row] = await superList("purchases", `list = "${list}"`);
    assert.equal((await pb.api("GET", rec("purchases", row.id), { token: tokens.parent })).status, 200);
    denied(await pb.api("GET", rec("purchases", row.id), { token: tokens.device }), "device view");
    assert.equal(
      (await pb.api("GET", rec("purchases"), { token: tokens.device })).data.items?.length ?? 0,
      0,
      "device list is empty or refused",
    );
    const body = { list, name: "X", key: "x", day: dayIn(0) };
    for (const [who, token] of [
      ["parent", tokens.parent],
      ["device", tokens.device],
      ["anonymous", undefined],
    ]) {
      denied(await pb.api("POST", rec("purchases"), { token, body }), `${who} create`);
      denied(
        await pb.api("PATCH", rec("purchases", row.id), { token, body: { skip_until: dayIn(9) } }),
        `${who} update`,
      );
    }
    denied(await pb.api("DELETE", rec("purchases", row.id), { token: tokens.device }), "device delete");
    assert.equal((await superList("purchases", `id = "${row.id}"`))[0].skip_until, "");
    assert.equal((await pb.api("DELETE", rec("purchases", row.id), { token: tokens.parent })).status, 204);
  });

  it("devices cannot set the reason fields of an item", async () => {
    const list = await newList("Test-Reason");
    denied(await addItem(list, "Test-Fake", { auto_rhythm: 3 }), "auto_rhythm on create");
    denied(await addItem(list, "Test-Fake2", { auto_last: dayIn(-1) }), "auto_last on create");
    const item = (await addItem(list, "Test-Real")).data;
    denied(
      await pb.api("PATCH", rec("shop_items", item.id), { token: tokens.device, body: { auto_rhythm: 9 } }),
      "auto_rhythm on update",
    );
    assert.equal((await itemsOf(list)).length, 1);
    assert.equal((await itemsOf(list))[0].auto_rhythm, 0);
  });
});
