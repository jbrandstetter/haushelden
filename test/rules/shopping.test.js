// Governing: ADR-0001 (rules are the security model; hooks in one transaction), ADR-0003 (device accounts),
// SPEC-0005 REQ "Lists", REQ "Adding Items", REQ "Shopping Flow", SPEC-0001 REQ "Offline Operation" (bought
// stays bought), REQ "Database Operation Standards", design table "Three principal types, rules per collection"
//
// Access rules and server hooks of lists, shop_items and purchases as parent, device and anonymous against a
// real throwaway PocketBase. Allowed operations are paired with forbidden ones; forbidden writes are followed by
// a superuser read proving nothing changed.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PARENT_PW = "change-me-parent-pw-1";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";
const FOOD = "list1food000001";
const DM = "list2dm00000001";

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
const TODAY = () => dayIn(0);

async function superCreate(collection, body) {
  const res = await pb.api("POST", rec(collection), { token: su, body });
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;
const superList = async (collection, filter = "") =>
  (await pb.api("GET", `${rec(collection)}?perPage=200&filter=${encodeURIComponent(filter)}`, { token: su }))
    .data.items;
const purchasesOf = (name, day) =>
  superList("purchases", `key = "${name.toLowerCase()}"${day ? ` && day = "${day}"` : ""}`);
const addAsDevice = (name, extra = {}, list = FOOD) =>
  pb.api("POST", rec("shop_items"), {
    token: tokens.device,
    body: { list, name, by: ids.kind1, ...extra },
  });
const tick = (id, day = TODAY(), token = tokens.device, headers) =>
  pb.api("PATCH", rec("shop_items", id), { token, body: { bought: day }, headers });

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

describe("lists", () => {
  it("a new household has Lebensmittel and dm, readable by parent and device", async () => {
    for (const token of [tokens.parent, tokens.device]) {
      const res = await pb.api("GET", `${rec("lists")}?sort=created,id`, { token });
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.data.items.map((l) => `${l.emoji} ${l.name}`),
        ["🛒 Lebensmittel", "🧴 dm"],
      );
    }
  });

  it("anonymous cannot read lists", async () => {
    const res = await pb.api("GET", rec("lists"));
    assert.ok(res.status === 403 || (res.status === 200 && res.data.items.length === 0));
  });

  it("parent adds, renames and deletes a list; deleting it deletes its items and purchases", async () => {
    const created = await pb.api("POST", rec("lists"), {
      token: tokens.parent,
      body: { emoji: "🌱", name: "Garten" },
    });
    assert.equal(created.status, 200);
    const listId = created.data.id;
    const renamed = await pb.api("PATCH", rec("lists", listId), {
      token: tokens.parent,
      body: { name: "Garten & Balkon" },
    });
    assert.equal(renamed.data.name, "Garten & Balkon");

    const open = await addAsDevice("Test-Erde", {}, listId);
    assert.equal(open.status, 200, JSON.stringify(open.data));
    const bought = await addAsDevice("Test-Samen", {}, listId);
    assert.equal((await tick(bought.data.id)).status, 200);
    assert.equal((await purchasesOf("test-samen")).length, 1);

    assert.equal((await pb.api("DELETE", rec("lists", listId), { token: tokens.parent })).status, 204);
    assert.equal((await superList("shop_items", `list = "${listId}"`)).length, 0);
    assert.equal((await superList("purchases", `list = "${listId}"`)).length, 0);
  });

  it("device cannot create, rename or delete a list", async () => {
    denied(
      await pb.api("POST", rec("lists"), { token: tokens.device, body: { emoji: "🌱", name: "Nope" } }),
      "device create list",
    );
    denied(
      await pb.api("PATCH", rec("lists", FOOD), { token: tokens.device, body: { name: "Gehackt" } }),
      "device rename list",
    );
    denied(await pb.api("DELETE", rec("lists", DM), { token: tokens.device }), "device delete list");
    assert.equal((await superGet("lists", FOOD)).name, "Lebensmittel");
    assert.equal((await superGet("lists", DM)).name, "dm");
  });
});

describe("shop_items: access rules", () => {
  it("device adds an item with its member, parent sees who added it", async () => {
    const res = await addAsDevice("Test-Gummibärchen");
    assert.equal(res.status, 200);
    assert.equal(res.data.by, ids.kind1);
    assert.equal(res.data.bought, "");
    assert.equal("key" in res.data, false, "key stays hidden");
    const seen = await pb.api("GET", rec("shop_items", res.data.id), { token: tokens.parent });
    assert.equal(seen.data.by, ids.kind1);
  });

  it("device cannot add an item that is already bought, automatic, or without a member", async () => {
    denied(await addAsDevice("Test-Bought", { bought: TODAY() }), "bought on create");
    denied(await addAsDevice("Test-Auto", { auto: true }), "auto on create");
    denied(
      await pb.api("POST", rec("shop_items"), {
        token: tokens.device,
        body: { list: FOOD, name: "Test-Ohne-Mitglied" },
      }),
      "no member",
    );
    assert.equal((await superList("shop_items", 'name ~ "Test-Bought" || name ~ "Test-Auto"')).length, 0);
  });

  it("names are limited to 80 characters and may not be empty", async () => {
    denied(await addAsDevice("x".repeat(81)), "81 characters");
    assert.equal((await addAsDevice("y".repeat(80))).status, 200);
    denied(await addAsDevice("   "), "blank name");
    denied(await addAsDevice(""), "empty name");
  });

  it("device may update only bought: name, list, by, auto edits are refused", async () => {
    const item = (await addAsDevice("Test-Edit")).data;
    for (const body of [{ name: "Test-Umbenannt" }, { list: DM }, { by: ids.papa }, { auto: true }]) {
      denied(
        await pb.api("PATCH", rec("shop_items", item.id), { token: tokens.device, body }),
        JSON.stringify(body),
      );
    }
    denied(
      await pb.api("PATCH", rec("shop_items", item.id), {
        token: tokens.device,
        body: { bought: TODAY(), name: "Test-Mixed" },
      }),
      "bought together with a name",
    );
    const after = await superGet("shop_items", item.id);
    assert.equal(after.name, "Test-Edit");
    assert.equal(after.list, FOOD);
    assert.equal(after.bought, "");
  });

  it("device cannot delete an item; parent can edit and delete", async () => {
    const item = (await addAsDevice("Test-Loeschen")).data;
    denied(await pb.api("DELETE", rec("shop_items", item.id), { token: tokens.device }), "device delete");
    assert.ok(await superGet("shop_items", item.id));
    const renamed = await pb.api("PATCH", rec("shop_items", item.id), {
      token: tokens.parent,
      body: { name: "Test-Anders", list: DM },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.list, DM);
    assert.equal((await pb.api("DELETE", rec("shop_items", item.id), { token: tokens.parent })).status, 204);
  });

  it("anonymous cannot read or write items", async () => {
    const list = await pb.api("GET", rec("shop_items"));
    assert.ok(list.status === 403 || (list.status === 200 && list.data.items.length === 0));
    denied(
      await pb.api("POST", rec("shop_items"), { body: { list: FOOD, name: "Test-Anon", by: ids.kind1 } }),
      "anonymous create",
    );
  });
});

describe("shop_items: duplicates", () => {
  it("a name already open on the list, in any case or spacing, creates no second item", async () => {
    assert.equal((await addAsDevice("Test-Milch")).status, 200);
    for (const again of ["test-milch", "  TEST-MILCH ", "Test-Milch"]) {
      const res = await addAsDevice(again);
      assert.equal(res.status, 400, again);
      assert.equal(res.data.data.name.code, "duplicate_item");
    }
    assert.equal((await superList("shop_items", 'key = "test-milch"')).length, 1);
  });

  it("the same name on another list, and again once the first is bought, is fine", async () => {
    assert.equal((await addAsDevice("Test-Milch", {}, DM)).status, 200);
    const first = (await superList("shop_items", 'key = "test-milch" && list = "' + FOOD + '"'))[0];
    assert.equal((await tick(first.id)).status, 200);
    assert.equal((await addAsDevice("Test-Milch")).status, 200);
  });

  it("inner whitespace is collapsed in the stored name", async () => {
    const res = await addAsDevice("  Test-Eier    Bio ");
    assert.equal(res.data.name, "Test-Eier Bio");
    assert.equal((await addAsDevice("test-eier bio")).status, 400);
  });

  it("a replayed create with the same id is rejected as existing, not as a duplicate", async () => {
    const id = "replayitem00001";
    assert.equal((await addAsDevice("Test-Replay", { id })).status, 200);
    const again = await addAsDevice("Test-Replay", { id });
    assert.equal(again.status, 400);
    assert.ok(again.data.data.id, "reported on the id field so the client treats it as already done");
  });
});

describe("shopping flow: purchases are recorded server-side", () => {
  it("ticking records one purchase for today; ticking again changes nothing", async () => {
    const item = (await addAsDevice("Test-Brot")).data;
    const res = await tick(item.id);
    assert.equal(res.status, 200);
    assert.equal(res.data.bought, TODAY());
    const rows = await purchasesOf("test-brot");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, TODAY());
    assert.equal(rows[0].name, "Test-Brot");
    assert.equal(rows[0].item, item.id);
    await tick(item.id); // offline replay
    assert.equal((await purchasesOf("test-brot")).length, 1);
  });

  it("un-ticking on the same day removes that purchase again", async () => {
    const item = (await addAsDevice("Test-Butter")).data;
    await tick(item.id);
    assert.equal((await purchasesOf("test-butter")).length, 1);
    const res = await pb.api("PATCH", rec("shop_items", item.id), {
      token: tokens.device,
      body: { bought: "" },
    });
    assert.equal(res.data.bought, "");
    assert.equal((await purchasesOf("test-butter")).length, 0);
  });

  it("un-ticking an item bought on an earlier day keeps the purchase", async () => {
    const item = await superCreate("shop_items", {
      list: FOOD,
      name: "Test-Kaffee",
      by: ids.papa,
      bought: dayIn(-2),
    });
    assert.equal(
      (await purchasesOf("test-kaffee", dayIn(-2))).length,
      1,
      "created bought: purchase recorded",
    );
    await pb.api("PATCH", rec("shop_items", item.id), { token: tokens.device, body: { bought: "" } });
    assert.equal((await purchasesOf("test-kaffee", dayIn(-2))).length, 1);
  });

  it("an offline tick keeps its original day (within two weeks), a future or absurd day is refused", async () => {
    const item = (await addAsDevice("Test-Offline")).data;
    assert.equal((await tick(item.id, dayIn(-3))).data.bought, dayIn(-3));
    assert.equal((await purchasesOf("test-offline", dayIn(-3))).length, 1);

    const other = (await addAsDevice("Test-Zukunft")).data;
    denied(await tick(other.id, dayIn(5)), "future day");
    denied(await tick(other.id, dayIn(-40)), "far past day");
    denied(await tick(other.id, "heute"), "not a date");
    denied(await tick(other.id, "2026-02-30"), "impossible date");
    assert.equal((await superGet("shop_items", other.id)).bought, "");
    assert.equal((await purchasesOf("test-zukunft")).length, 0);
  });

  it("Einkauf fertig: three ticked items are deleted by the parent and each has one purchase for today", async () => {
    const names = ["Test-Fertig-Milch", "Test-Fertig-Brot", "Test-Fertig-Eier"];
    const items = [];
    for (const n of names) {
      const item = (await addAsDevice(n, {}, DM)).data;
      items.push(item);
      await tick(item.id);
    }
    for (const item of items) {
      assert.equal(
        (await pb.api("DELETE", rec("shop_items", item.id), { token: tokens.parent })).status,
        204,
      );
    }
    assert.equal((await superList("shop_items", 'name ~ "Test-Fertig"')).length, 0);
    for (const n of names) assert.equal((await purchasesOf(n, TODAY())).length, 1, n);
  });

  it("deleting a bought item whose purchase is missing records it, so no purchase is lost", async () => {
    const item = (await addAsDevice("Test-Luecke", {}, DM)).data;
    await tick(item.id);
    for (const p of await purchasesOf("test-luecke"))
      await pb.api("DELETE", rec("purchases", p.id), { token: su });
    await pb.api("DELETE", rec("shop_items", item.id), { token: tokens.parent });
    assert.equal((await purchasesOf("test-luecke", TODAY())).length, 1);
  });

  it("two bought items with one name on one day share one purchase; un-ticking one keeps it", async () => {
    const a = (await addAsDevice("Test-Doppelt", {}, DM)).data;
    await tick(a.id);
    const b = (await addAsDevice("Test-Doppelt", {}, DM)).data;
    await tick(b.id);
    assert.equal((await purchasesOf("test-doppelt")).length, 1);
    await pb.api("PATCH", rec("shop_items", b.id), { token: tokens.device, body: { bought: "" } });
    assert.equal((await purchasesOf("test-doppelt")).length, 1);
  });
});

describe("sticky bought", () => {
  it("an un-tick from a stale copy (header X-HH-Seen) cannot un-buy the item", async () => {
    const item = (await addAsDevice("Test-Sticky")).data;
    await tick(item.id);
    const stale = await pb.api("PATCH", rec("shop_items", item.id), {
      token: tokens.device,
      body: { bought: "" },
      headers: { "X-HH-Seen": "2000-01-01 00:00:00.000Z" },
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.data.bought, TODAY(), "the response shows the item is still bought");
    assert.equal((await superGet("shop_items", item.id)).bought, TODAY());
    assert.equal((await purchasesOf("test-sticky")).length, 1);

    const fresh = await pb.api("PATCH", rec("shop_items", item.id), {
      token: tokens.device,
      body: { bought: "" },
      headers: { "X-HH-Seen": stale.data.updated },
    });
    assert.equal(fresh.data.bought, "", "an un-tick from the current version works");
    assert.equal((await purchasesOf("test-sticky")).length, 0);
  });

  it("a second tick with another day does not move the bought day", async () => {
    const item = (await addAsDevice("Test-Tag")).data;
    await tick(item.id, TODAY());
    const res = await tick(item.id, dayIn(-1));
    assert.equal(res.data.bought, TODAY());
    assert.equal((await purchasesOf("test-tag")).length, 1);
  });

  it("concurrent ticks and un-ticks never lose a purchase", async () => {
    const item = (await addAsDevice("Test-Rennen")).data;
    await tick(item.id);
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        pb.api("PATCH", rec("shop_items", item.id), {
          token: tokens.device,
          body: { bought: "" },
          headers: { "X-HH-Seen": "stale" },
        }),
      ),
      ...Array.from({ length: 4 }, () => tick(item.id)),
    ]);
    for (const r of results) assert.ok(r.status === 200 || r.status === 400, `unexpected ${r.status}`);
    assert.equal((await superGet("shop_items", item.id)).bought, TODAY());
    assert.equal((await purchasesOf("test-rennen")).length, 1);
  });
});

describe("purchases", () => {
  it("parents read and delete; devices see nothing; nobody can write through the API", async () => {
    const item = (await addAsDevice("Test-Historie")).data;
    await tick(item.id);
    const [row] = await purchasesOf("test-historie");
    assert.equal((await pb.api("GET", rec("purchases", row.id), { token: tokens.parent })).status, 200);
    denied(await pb.api("GET", rec("purchases", row.id), { token: tokens.device }), "device read");
    for (const token of [tokens.parent, tokens.device]) {
      denied(
        await pb.api("POST", rec("purchases"), {
          token,
          body: { list: FOOD, name: "Test-Fake", key: "test-fake", day: TODAY() },
        }),
        "create purchase",
      );
      denied(await pb.api("PATCH", rec("purchases", row.id), { token, body: { day: dayIn(-1) } }), "update");
    }
    denied(await pb.api("DELETE", rec("purchases", row.id), { token: tokens.device }), "device delete");
    assert.equal((await purchasesOf("test-historie")).length, 1);
    assert.equal((await pb.api("DELETE", rec("purchases", row.id), { token: tokens.parent })).status, 204);
    assert.equal((await purchasesOf("test-historie")).length, 0);
  });
});
