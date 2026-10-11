// Governing: SPEC-0001 REQ "Offline Operation", REQ "Shared State and Live Sync", REQ "Error Handling Standards";
// ADR-0001 (the data API is the only door to PocketBase for feature code)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createData, syncHint } = require("../app/js/data.js");
const { memoryStorage } = require("../app/js/storage.js");
const { sticky } = require("../app/js/merge.js");
const { createFakeServer, createFakeTransport, quietLogger, until } = require("./helpers/fake-transport.js");

let n = 0;
const device = (server, opts = {}) => {
  const transport = createFakeTransport(server, opts.transport);
  const storage = opts.storage || memoryStorage();
  const data = createData({
    transport,
    storage,
    logger: quietLogger,
    autoRetry: false,
    makeId: () => `id${String(++n).padStart(13, "0")}`,
  });
  return { transport, storage, data };
};
const names = (rows) => rows.map((r) => r.name).sort();

test("scenario: Milch added on one device appears on the other within the live-sync window", async () => {
  const server = createFakeServer();
  const a = device(server);
  const b = device(server);
  let seen = [];
  b.data.subscribe("shop_items", (rows) => (seen = rows));
  await until(() => b.transport.state.subs.has("shop_items"));
  const started = Date.now();
  await a.data.create("shop_items", { name: "Milch" });
  await until(() => names(seen).includes("Milch"), 5000);
  assert.ok(Date.now() - started < 5000);
});

test("subscribe delivers the mirror first, then refreshes from the server", async () => {
  const server = createFakeServer();
  server.seed("members", { id: "m1", name: "Test-Kind-1" });
  const { data } = device(server);
  const calls = [];
  data.subscribe("members", (rows) => calls.push(names(rows)));
  await until(() => calls.some((c) => c.length === 1));
  assert.deepEqual(calls[0], [], "the empty mirror is shown immediately");
  assert.deepEqual(calls.at(-1), ["Test-Kind-1"]);
});

test("create shows the record at once and sends it with its client-generated id", async () => {
  const server = createFakeServer();
  const { data } = device(server);
  const rec = await data.create("shop_items", { name: "Eier" });
  assert.match(rec.id, /^id\d{13}$/);
  await until(() => server.col("shop_items").has(rec.id));
  assert.equal(server.col("shop_items").get(rec.id).name, "Eier");
});

test("scenario: three items ticked offline are bought once each after reconnecting", async () => {
  const server = createFakeServer();
  const items = ["Milch", "Brot", "Eier"].map((name) =>
    server.seed("shop_items", { id: `x${name}`, name, bought: false }),
  );
  const a = device(server);
  const b = device(server);
  let onB = [];
  b.data.subscribe("shop_items", (rows) => (onB = rows));
  a.data.subscribe("shop_items", () => {});
  await until(() => onB.length === 3);

  a.transport.setOnline(false);
  for (const it of items) await a.data.update("shop_items", it.id, { bought: true });
  assert.equal(a.data.status().queued, 3);
  const local = await a.data.list("shop_items");
  assert.ok(
    local.every((r) => r.bought === true && r._pending),
    "the offline user sees the ticks immediately",
  );
  assert.ok(
    items.every((it) => server.col("shop_items").get(it.id).bought === false),
    "server has nothing yet",
  );

  a.transport.setOnline(true);
  await a.data.flush();
  assert.ok(items.every((it) => server.col("shop_items").get(it.id).bought === true));
  await until(() => onB.every((r) => r.bought === true));
  const sent = server.log.filter((l) => l[0] === "update");
  assert.equal(sent.length, 3, "one request per item, no duplicates");
  assert.equal(a.data.status().queued, 0);
  await a.data.flush();
  assert.equal(server.log.filter((l) => l[0] === "update").length, 3, "flushing again sends nothing");
});

test("an offline create queued twice with the same entry is stored once (idempotent replay)", async () => {
  const server = createFakeServer();
  const a = device(server);
  a.transport.setOnline(false);
  const rec = await a.data.create("shop_items", { name: "Käse" });
  await a.data.flush(); // learns that the network is down
  // Simulate: the send succeeded on the server, but the app was killed before the entry left the queue.
  server.apply("shop_items", "create", {
    id: rec.id,
    name: "Käse",
    created: server.stamp(),
    updated: server.stamp(),
  });
  a.transport.setOnline(true);
  await a.data.flush();
  assert.equal(a.data.status().queued, 0);
  assert.equal(server.col("shop_items").size, 1);
});

test("a delete of a record that is already gone counts as done", async () => {
  const server = createFakeServer();
  server.seed("shop_items", { id: "gone", name: "X" });
  const a = device(server);
  a.transport.setOnline(false);
  await a.data.delete("shop_items", "gone");
  await a.data.flush();
  server.apply("shop_items", "delete", { id: "gone" });
  a.transport.setOnline(true);
  await a.data.flush();
  assert.equal(a.data.status().queued, 0);
  assert.equal(a.data.status().rejected, 0);
});

test("scenario: a rejected change stays queued, flags the hint and is logged on the client", async () => {
  const server = createFakeServer();
  server.seed("members", { id: "k1", name: "Test-Kind-1" });
  const warnings = [];
  const transport = createFakeTransport(server, {
    rejectWhen: (op, c) => op === "update" && c === "members",
  });
  const data = createData({
    transport,
    storage: memoryStorage(),
    logger: { warn: (...a) => warnings.push(a), info() {} },
    autoRetry: false,
  });
  await data.refresh("members");
  await data.update("members", "k1", { name: "Umbenannt" });
  await data.flush();
  const status = data.status();
  assert.equal(status.queued, 1, "the change is kept");
  assert.equal(status.rejected, 1);
  assert.match(syncHint(status), /nicht synchronisiert/);
  assert.equal(server.col("members").get("k1").name, "Test-Kind-1", "server data unchanged");
  const w = warnings.find((x) => x[0] === "sync: change rejected, kept queued");
  assert.ok(w, "the rejection is logged");
  assert.equal(w[1].collection, "members");
  assert.equal(w[1].record, "k1");
  assert.match(w[1].reason, /failed to update members\/k1: .*not allowed/, "the reason carries context");
  const list = await data.list("members");
  assert.equal(list[0].name, "Umbenannt", "the user still sees their change");
});

test("conflict rule: without a merge rule the later receipt wins per field", async () => {
  const server = createFakeServer();
  server.seed("notes", { id: "n1", title: "alt", body: "alt" });
  const a = device(server);
  const b = device(server);
  a.data.subscribe("notes", () => {});
  b.data.subscribe("notes", () => {});
  await until(() => a.transport.state.subs.has("notes") && b.transport.state.subs.has("notes"));
  await until(async () => (await a.data.list("notes")).length === 1);
  a.transport.setOnline(false);
  await a.data.update("notes", "n1", { title: "von A" });
  await b.data.update("notes", "n1", { title: "von B", body: "von B" });
  await until(() => server.col("notes").get("n1").title === "von B");
  a.transport.setOnline(true);
  await a.data.flush();
  const final = server.col("notes").get("n1");
  assert.equal(
    final.title,
    "von A",
    "A's edit reached the server later, so it wins for the field it changed",
  );
  assert.equal(final.body, "von B", "fields A did not touch keep B's value");
});

test("conflict rule: sticky bought stays bought (generic merge hook on a fake collection)", async () => {
  const server = createFakeServer();
  server.seed("shop_items", { id: "s1", name: "Milch", bought: true });
  const a = device(server);
  const b = device(server);
  for (const d of [a, b]) {
    d.data.configureMerge("shop_items", "bought", sticky(true));
    d.data.subscribe("shop_items", () => {});
  }
  await until(
    async () =>
      (await a.data.list("shop_items")).length === 1 && (await b.data.list("shop_items")).length === 1,
  );

  a.transport.setOnline(false);
  await a.data.update("shop_items", "s1", { bought: false }); // offline un-tick
  await b.data.update("shop_items", "s1", { name: "Milch 1,5%" }); // meanwhile another change on the server
  await until(() => server.col("shop_items").get("s1").name === "Milch 1,5%");
  a.transport.setOnline(true);
  await a.data.flush();
  assert.equal(server.col("shop_items").get("s1").bought, true, "the raced un-tick lost");
  await until(async () => (await a.data.list("shop_items"))[0].bought === true);
  assert.equal(a.data.status().queued, 0, "the discarded change leaves the queue instead of failing");
});

test("conflict rule: an un-tick nobody raced with still works", async () => {
  const server = createFakeServer();
  server.seed("shop_items", { id: "s1", name: "Milch", bought: true });
  const a = device(server);
  a.data.configureMerge("shop_items", "bought", sticky(true));
  a.data.subscribe("shop_items", () => {});
  await until(async () => (await a.data.list("shop_items")).length === 1);
  await a.data.update("shop_items", "s1", { bought: false });
  await until(() => server.col("shop_items").get("s1").bought === false);
});

test("updates arriving out of order do not roll the mirror back", async () => {
  const server = createFakeServer();
  const { data, transport } = device(server);
  let seen = [];
  data.subscribe("members", (rows) => (seen = rows));
  await until(() => transport.state.subs.has("members"));
  const handler = Array.from(transport.state.subs.get("members"))[0];
  handler({ action: "update", record: { id: "m", name: "neu", updated: "000009" } });
  handler({ action: "update", record: { id: "m", name: "alt", updated: "000002" } });
  await until(() => names(seen).includes("neu"));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(names(seen), ["neu"]);
});

test("the mirror survives a restart: the last synced data shows with no network", async () => {
  const server = createFakeServer();
  server.seed("members", { id: "m1", name: "Test-Mama" });
  const storage = memoryStorage();
  const first = device(server, { storage });
  first.data.subscribe("members", () => {});
  await until(async () => (await first.data.list("members")).length === 1);

  const second = device(server, { storage });
  second.transport.setOnline(false);
  const rows = await second.data.list("members");
  assert.deepEqual(names(rows), ["Test-Mama"]);
  await second.data.refresh("members");
  assert.equal(second.data.status().online, false);
  assert.deepEqual(
    names(await second.data.list("members")),
    ["Test-Mama"],
    "a failed refresh keeps the mirror",
  );
});

test("queued changes survive a restart and go out after reconnecting", async () => {
  const server = createFakeServer();
  server.seed("shop_items", { id: "q1", name: "Salz", bought: false });
  const storage = memoryStorage();
  const first = device(server, { storage });
  first.transport.setOnline(false);
  await first.data.update("shop_items", "q1", { bought: true });
  await first.data.flush();
  assert.equal(server.col("shop_items").get("q1").bought, false);

  const second = device(server, { storage });
  await second.data.start();
  assert.equal(second.data.status().queued, 0);
  assert.equal(server.col("shop_items").get("q1").bought, true, "start() flushes the persisted queue");
});

test("after a realtime reconnect the subscribed collections are refreshed and the queue is flushed", async () => {
  const server = createFakeServer();
  const a = device(server);
  let seen = [];
  a.data.subscribe("shop_items", (rows) => (seen = rows));
  await until(() => a.transport.state.subs.has("shop_items"));
  a.transport.setOnline(false);
  server.apply("shop_items", "create", { id: "late", name: "Verpasst", created: "1", updated: "1" });
  assert.equal(seen.length, 0, "the event was missed while offline");
  a.transport.setOnline(true); // reconnect callback
  await until(() => names(seen).includes("Verpasst"));
});

test("reset forgets the mirror and the queue (sign-out)", async () => {
  const server = createFakeServer();
  server.seed("members", { id: "m1", name: "Test-Papa" });
  const a = device(server);
  a.data.subscribe("members", () => {});
  await until(async () => (await a.data.list("members")).length === 1);
  a.transport.setOnline(false);
  await a.data.update("members", "m1", { name: "x" });
  await a.data.reset();
  assert.deepEqual(await a.data.list("members"), []);
  assert.equal(a.data.status().queued, 0);
  assert.deepEqual(await a.storage.getAll("members"), []);
});

test("syncHint: shown while changes are unsent, not while sending, offline text otherwise", () => {
  assert.equal(syncHint({ online: true, queued: 0, syncing: false }), "");
  assert.equal(syncHint({ online: false, queued: 0, syncing: false }), "offline");
  assert.equal(syncHint({ online: true, queued: 1, syncing: true }), "");
  assert.equal(syncHint({ online: false, queued: 1, syncing: false }), "nicht synchronisiert (1 Änderung)");
  assert.equal(syncHint({ online: true, queued: 3, syncing: false }), "nicht synchronisiert (3 Änderungen)");
});

test("list supports filter and sort; get finds one record", async () => {
  const server = createFakeServer();
  server.seed("shop_items", { id: "1", name: "B", bought: false });
  server.seed("shop_items", { id: "2", name: "A", bought: true });
  const { data } = device(server);
  await data.refresh("shop_items");
  assert.deepEqual(
    (await data.list("shop_items", { filter: (r) => !r.bought })).map((r) => r.name),
    ["B"],
  );
  assert.deepEqual(
    (await data.list("shop_items", { sort: (x, y) => x.name.localeCompare(y.name) })).map((r) => r.name),
    ["A", "B"],
  );
  assert.equal((await data.get("shop_items", "2")).name, "A");
  assert.equal(await data.get("shop_items", "nope"), null);
});
