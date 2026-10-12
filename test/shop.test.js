// Governing: SPEC-0005 REQ "Adding Items" (duplicates, who added), REQ "Shopping Flow" (tick, finish, offline),
// REQ "Entry Points"; SPEC-0001 REQ "Offline Operation" (bought stays bought, replays are idempotent)
const test = require("node:test");
const assert = require("node:assert/strict");
const shop = require("../app/js/shop.js");
const { createData } = require("../app/js/data.js");
const { createPocketBaseTransport } = require("../app/js/pb.js");
const { memoryStorage } = require("../app/js/storage.js");
const { createFakeServer, createFakeTransport, quietLogger, until } = require("./helpers/fake-transport.js");

let n = 0;
function device(server) {
  const transport = createFakeTransport(server);
  const data = createData({
    transport,
    storage: memoryStorage(),
    logger: quietLogger,
    autoRetry: false,
    makeId: () => `id${String(++n).padStart(13, "0")}`,
  });
  shop.registerMerge(data);
  return { transport, data };
}
const rows = (server) => Array.from(server.col("shop_items").values());

test("names are normalised like the server does: trimmed, spaces collapsed, case-insensitive identity", () => {
  assert.equal(shop.normalizeName("  Hafer   Milch "), "Hafer Milch");
  assert.equal(shop.nameKey("  HAFER   milch"), "hafer milch");
  assert.equal(shop.normalizeName(null), "");
});

test("scenario: 'milch' while 'Milch' is open on Lebensmittel creates no second item", async () => {
  const server = createFakeServer();
  const { data } = device(server);
  const items = [{ id: "a", list: "food", name: "Milch", bought: "" }];
  const res = await shop.addItem(data, items, { list: "food", name: " milch ", by: "kid" });
  assert.deepEqual([res.ok, res.reason], [false, "duplicate"]);
  assert.equal(rows(server).length, 0);
});

test("a bought item or another list does not block the same name", async () => {
  const server = createFakeServer();
  const { data } = device(server);
  const items = [
    { id: "a", list: "food", name: "Milch", bought: "2026-10-12" },
    { id: "b", list: "dm", name: "Seife", bought: "" },
  ];
  assert.equal((await shop.addItem(data, items, { list: "food", name: "milch", by: "m" })).ok, true);
  assert.equal((await shop.addItem(data, items, { list: "food", name: "Seife", by: "m" })).ok, true);
});

test("scenario: the son adds Gummibärchen; the item records who added it and shows on the other device", async () => {
  const server = createFakeServer();
  const kid = device(server);
  const parent = device(server);
  let seen = [];
  parent.data.subscribe("shop_items", (r) => (seen = r));
  await until(() => parent.transport.state.subs.has("shop_items"));
  const res = await shop.addItem(kid.data, [], { list: "food", name: "Gummibärchen", by: "kind1" });
  assert.equal(res.ok, true);
  await until(() => seen.some((i) => i.name === "Gummibärchen"));
  const stored = rows(server)[0];
  assert.deepEqual([stored.by, stored.list, stored.bought, stored.auto], ["kind1", "food", "", false]);
});

test("validation: empty, too long, and no member are refused before anything is queued", async () => {
  const server = createFakeServer();
  const { data } = device(server);
  assert.equal((await shop.addItem(data, [], { list: "l", name: "   ", by: "m" })).reason, "empty");
  assert.equal(
    (await shop.addItem(data, [], { list: "l", name: "x".repeat(81), by: "m" })).reason,
    "too_long",
  );
  assert.equal((await shop.addItem(data, [], { list: "l", name: "x".repeat(80), by: "m" })).ok, true);
  assert.equal((await shop.addItem(data, [], { list: "l", name: "Milch", by: "" })).reason, "no_member");
  await until(() => rows(server).length === 1);
  assert.equal(rows(server)[0].name, "x".repeat(80));
});

test("counts: open items per list and the cart", () => {
  const items = [
    { id: "1", list: "a", bought: "" },
    { id: "2", list: "a", bought: "2026-10-12" },
    { id: "3", list: "b", bought: "" },
  ];
  assert.equal(shop.openCount(items, "a"), 1);
  assert.equal(shop.cartItems(items, "a").length, 1);
  assert.equal(shop.totalOpen(items), 2);
  assert.equal(shop.entrySummary(0), "Leer");
  assert.equal(shop.entrySummary(3), "3 Sachen drauf");
});

test("scenario: tick Milch, Brot and Eier then 'Einkauf fertig': the three items leave the list", async () => {
  const server = createFakeServer();
  const { data } = device(server);
  for (const name of ["Milch", "Brot", "Eier"]) {
    server.seed("shop_items", { id: `s${name}`, list: "food", name, bought: "2026-10-12" });
  }
  server.seed("shop_items", { id: "sOpen", list: "food", name: "Butter", bought: "" });
  server.seed("shop_items", { id: "sOther", list: "dm", name: "Seife", bought: "2026-10-12" });
  await data.refresh("shop_items");
  const all = await data.list("shop_items");
  assert.equal(await shop.finishShopping(data, all, "food"), 3);
  await until(() => rows(server).length === 2);
  assert.deepEqual(
    rows(server)
      .map((r) => r.id)
      .sort(),
    ["sOpen", "sOther"],
  );
});

test("offline ticks are queued, sent once on reconnect, and replaying them changes nothing more", async () => {
  const server = createFakeServer();
  const a = device(server);
  server.seed("shop_items", { id: "m1", list: "food", name: "Milch", bought: "" });
  await a.data.refresh("shop_items");
  a.transport.setOnline(false);
  a.data.setOnline(false);
  await shop.setBought(a.data, { id: "m1" }, "2026-10-12");
  assert.equal(a.data.status().queued, 1);
  assert.equal((await a.data.list("shop_items"))[0].bought, "2026-10-12", "shown ticked at once");
  a.transport.setOnline(true);
  await a.data.flush();
  assert.equal(rows(server)[0].bought, "2026-10-12");
  const updates = () => server.log.filter((e) => e[0] === "update").length;
  assert.equal(updates(), 1);
  await a.data.flush();
  assert.equal(updates(), 1, "nothing is sent twice");
});

test("sticky bought: an offline un-tick that raced with a purchase on another device loses", async () => {
  const server = createFakeServer();
  const a = device(server);
  const b = device(server);
  server.seed("shop_items", { id: "m1", list: "food", name: "Milch", bought: "2026-10-11" });
  await a.data.refresh("shop_items");
  a.transport.setOnline(false);
  a.data.setOnline(false);
  await shop.setBought(a.data, { id: "m1" }, ""); // A un-ticks while offline, against the version it saw
  // Meanwhile B changes the item on the server (still bought).
  const current = server.col("shop_items").get("m1");
  server.apply("shop_items", "update", { ...current, name: "Milch 1l", updated: server.stamp() });
  a.transport.setOnline(true);
  await a.data.flush();
  assert.equal(rows(server)[0].bought, "2026-10-11", "bought stays bought");
  void b;
});

test("sticky bought: a deliberate un-tick of an unchanged item goes through", async () => {
  const server = createFakeServer();
  const a = device(server);
  server.seed("shop_items", { id: "m1", list: "food", name: "Milch", bought: "2026-10-12" });
  await a.data.refresh("shop_items");
  await shop.setBought(a.data, { id: "m1" }, "");
  await until(() => rows(server)[0].bought === "");
});

test("the transport tells the server which version a change was made against (X-HH-Seen)", async () => {
  const calls = [];
  const transport = createPocketBaseTransport({
    getToken: () => "token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    },
  });
  await transport.update("shop_items", "m1", { bought: "" }, { seen: "2026-10-12 08:00:00.000Z" });
  await transport.update("shop_items", "m1", { bought: "2026-10-12" });
  assert.equal(calls[0].init.headers["x-hh-seen"], "2026-10-12 08:00:00.000Z");
  assert.equal(calls[0].init.headers.authorization, "token");
  assert.equal("x-hh-seen" in calls[1].init.headers, false);
});

test("the data layer passes the merged-against version to the transport on updates", async () => {
  const server = createFakeServer();
  const a = device(server);
  const seen = [];
  const original = a.transport.update;
  a.transport.update = (c, id, patch, opts) => (seen.push(opts), original(c, id, patch));
  server.seed("shop_items", { id: "m1", list: "food", name: "Milch", bought: "" });
  await a.data.refresh("shop_items");
  const before = server.col("shop_items").get("m1").updated;
  await shop.setBought(a.data, { id: "m1" }, "2026-10-12");
  await until(() => seen.length === 1);
  assert.equal(seen[0].seen, before, "the version the change was made against is sent");
  assert.ok(seen[0].seen, "a version is sent");
});

test("the entry button links to the shopping screen for that member and shows the open count", async () => {
  const children = [];
  const makeEl = (tag) => {
    const e = { tag, style: {}, children: [], className: "", textContent: "", href: "" };
    e.append = (...c) => e.children.push(...c);
    children.push(e);
    return e;
  };
  const doc = { createElement: makeEl };
  let push;
  const data = {
    subscribe: (c, cb) => {
      assert.equal(c, "shop_items");
      push = cb;
      return () => {};
    },
  };
  const { el } = shop.entryButton({ data, who: "kind1", doc });
  assert.equal(el.href, "#/einkauf/kind1");
  assert.equal(el.className, "shopbtn");
  push([{ bought: "" }, { bought: "" }, { bought: "2026-10-12" }]);
  const sub = el.children[1].children[1];
  assert.equal(sub.textContent, "2 Sachen drauf");
});
