// Governing: SPEC-0001 REQ "Offline Operation" (queued, ordered, idempotent), REQ "Error Handling Standards"
const test = require("node:test");
const assert = require("node:assert/strict");
const { createOutbox, applyPending } = require("../app/js/outbox.js");
const { memoryStorage } = require("../app/js/storage.js");

const make = () => {
  const storage = memoryStorage();
  return { storage, outbox: createOutbox({ storage }) };
};
const ok = { status: "ok" };

test("entries replay in the order they were made", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "create", collection: "items", recordId: "a", data: { name: "Milch" } });
  await outbox.enqueue({ op: "create", collection: "items", recordId: "b", data: { name: "Brot" } });
  await outbox.enqueue({ op: "update", collection: "items", recordId: "x", data: { bought: true } });
  const sent = [];
  const summary = await outbox.flush(async (e) => (sent.push(`${e.op}:${e.recordId}`), ok));
  assert.deepEqual(sent, ["create:a", "create:b", "update:x"]);
  assert.equal(summary.sent, 3);
  assert.equal(outbox.size(), 0);
});

test("scenario: three tick-offs made offline are all sent once after reconnecting", async () => {
  const { outbox } = make();
  for (const id of ["a", "b", "c"]) {
    await outbox.enqueue({ op: "update", collection: "items", recordId: id, data: { bought: true } });
  }
  let online = false;
  const serverCalls = [];
  const send = async (e) => {
    if (!online) return { status: "network" };
    serverCalls.push(e.recordId);
    return ok;
  };
  const offlineRun = await outbox.flush(send);
  assert.equal(offlineRun.stopped, "network");
  assert.equal(outbox.size(), 3, "nothing is lost while offline");
  online = true;
  await outbox.flush(send);
  assert.deepEqual(serverCalls, ["a", "b", "c"]);
  assert.equal(outbox.size(), 0);
  await outbox.flush(send); // a second flush finds nothing to send
  assert.deepEqual(serverCalls, ["a", "b", "c"], "each tick-off is sent exactly once");
});

test("a network failure stops the run and keeps the failed entry first", async () => {
  const { outbox } = make();
  for (const id of ["a", "b", "c"])
    await outbox.enqueue({ op: "update", collection: "i", recordId: id, data: { v: 1 } });
  let calls = 0;
  await outbox.flush(async () => (++calls === 2 ? { status: "network" } : ok));
  assert.deepEqual(
    outbox.entries().map((e) => e.recordId),
    ["b", "c"],
  );
});

test("a rejected entry stays queued with its reason; other records still go out", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "update", collection: "i", recordId: "bad", data: { v: 1 } });
  await outbox.enqueue({ op: "update", collection: "i", recordId: "good", data: { v: 1 } });
  const sent = [];
  const summary = await outbox.flush(async (e) => {
    sent.push(e.recordId);
    return e.recordId === "bad" ? { status: "rejected", reason: "nicht erlaubt" } : ok;
  });
  assert.deepEqual(sent, ["bad", "good"]);
  assert.equal(summary.rejected, 1);
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.failedCount(), 1);
  assert.equal(outbox.entries()[0].failed.reason, "nicht erlaubt");
});

test("a rejected entry blocks later entries for the same record, keeping their order", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "create", collection: "i", recordId: "r", data: { n: 1 } });
  await outbox.enqueue({ op: "update", collection: "i", recordId: "other", data: { n: 1 } });
  const first = outbox.entries()[0];
  // make the first entry un-mergeable by marking it failed, then queue a follow-up for the same record
  await outbox.flush(async (e) => (e.recordId === "r" ? { status: "rejected", reason: "x" } : ok));
  await outbox.enqueue({ op: "update", collection: "i", recordId: "r", data: { n: 2 } });
  const sent = [];
  await outbox.flush(
    async (e) => (sent.push(`${e.op}:${e.recordId}`), { status: "rejected", reason: "still" }),
  );
  assert.deepEqual(sent, ["create:r"], "the follow-up update waits behind the rejected create");
  assert.equal(outbox.size(), 2);
  assert.equal(first.seq, outbox.entries()[0].seq);
});

test("a rejected entry is retried by the next flush and leaves the queue when it succeeds", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 1 } });
  await outbox.flush(async () => ({ status: "rejected", reason: "temporär" }));
  assert.equal(outbox.failedCount(), 1);
  await outbox.flush(async () => ok);
  assert.equal(outbox.size(), 0);
});

test("one flush attempts each entry at most once (no tight retry loop)", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 1 } });
  let calls = 0;
  await outbox.flush(async () => (calls++, { status: "rejected", reason: "no" }));
  assert.equal(calls, 1);
});

test("a thrown send error is treated as a rejection, never swallowed", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 1 } });
  await outbox.flush(async () => {
    throw new Error("kaputt");
  });
  assert.equal(outbox.entries()[0].failed.reason, "kaputt");
});

test("updates to one record collapse; a create absorbs later updates; create+delete cancel", async () => {
  const { outbox } = make();
  await outbox.enqueue({
    op: "update",
    collection: "i",
    recordId: "a",
    data: { bought: true, note: "1" },
    base: { updated: "1" },
  });
  await outbox.enqueue({
    op: "update",
    collection: "i",
    recordId: "a",
    data: { note: "2" },
    base: { updated: "2" },
  });
  await outbox.enqueue({ op: "create", collection: "i", recordId: "n", data: { name: "Eier" } });
  await outbox.enqueue({ op: "update", collection: "i", recordId: "n", data: { name: "Eier (10)" } });
  await outbox.enqueue({ op: "create", collection: "i", recordId: "t", data: { name: "Tmp" } });
  await outbox.enqueue({ op: "delete", collection: "i", recordId: "t" });
  const e = outbox.entries();
  assert.equal(e.length, 2);
  assert.deepEqual(e[0].data, { bought: true, note: "2" });
  assert.equal(e[0].base.updated, "1", "the first edit's base version is kept");
  assert.equal(e[1].op, "create");
  assert.deepEqual(e[1].data, { name: "Eier (10)" });
});

test("an update made while the same record's entry is being sent is queued separately", async () => {
  const { outbox } = make();
  await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 1 } });
  let release;
  const gate = new Promise((r) => (release = r));
  const sent = [];
  const run = outbox.flush(async (e) => {
    sent.push(JSON.stringify(e.data));
    if (sent.length === 1) await gate;
    return ok;
  });
  await new Promise((r) => setImmediate(r));
  await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 2 } });
  release();
  await run;
  assert.deepEqual(sent, ['{"v":1}', '{"v":2}']);
});

test("the queue survives a restart", async () => {
  const { storage, outbox } = make();
  await outbox.enqueue({ op: "create", collection: "i", recordId: "a", data: { n: 1 } });
  await outbox.enqueue({ op: "update", collection: "i", recordId: "b", data: { n: 2 } });
  const reopened = createOutbox({ storage });
  await reopened.load();
  assert.deepEqual(
    reopened.entries().map((e) => e.recordId),
    ["a", "b"],
  );
  const added = await reopened.enqueue({ op: "update", collection: "i", recordId: "c", data: { n: 3 } });
  assert.ok(added.seq > reopened.entries()[1].seq, "sequence numbers keep growing after a restart");
});

test("discard removes a rejected entry", async () => {
  const { outbox } = make();
  const e = await outbox.enqueue({ op: "update", collection: "i", recordId: "a", data: { v: 1 } });
  await outbox.discard(e.seq);
  assert.equal(outbox.size(), 0);
});

test("applyPending lays unsent changes over the mirror", () => {
  const records = [
    { id: "a", name: "Milch", bought: false },
    { id: "b", name: "Brot", bought: false },
  ];
  const out = applyPending(records, [
    { op: "update", recordId: "a", data: { bought: true } },
    { op: "delete", recordId: "b" },
    { op: "create", recordId: "c", data: { name: "Eier" } },
  ]);
  assert.deepEqual(out, [
    { id: "a", name: "Milch", bought: true, _pending: true },
    { id: "c", name: "Eier", _pending: true },
  ]);
  assert.equal(records[0].bought, false, "the mirror itself is not modified");
});
