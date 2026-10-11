// Governing: SPEC-0001 REQ "Offline Operation" (later change by server receipt wins per field; bought stays bought)
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveUpdate, sticky, createMergeRegistry, deepEqual } = require("../app/js/merge.js");

// A fake collection: items with a sticky "bought" flag and an ordinary "note" field.
const rules = { bought: sticky(true) };

test("fields without a rule are sent as they are (the later receipt wins)", () => {
  const server = { id: "a", note: "von B", bought: false, updated: "2" };
  const r = resolveUpdate({
    patch: { note: "von A" },
    base: { updated: "1", values: { note: "alt" } },
    server,
    rules,
  });
  assert.deepEqual(r, { patch: { note: "von A" }, dropped: [] });
});

test("a change nobody else touched goes through, including an un-tick", () => {
  const server = { id: "a", bought: true, updated: "5" };
  const r = resolveUpdate({
    patch: { bought: false },
    base: { updated: "5", values: { bought: true } },
    server,
    rules,
  });
  assert.deepEqual(r.patch, { bought: false });
  assert.deepEqual(r.dropped, []);
});

test("sticky: an un-tick that raced with another change loses, bought stays bought", () => {
  const server = { id: "a", bought: true, updated: "7" }; // bought, changed again after this device last synced
  const r = resolveUpdate({
    patch: { bought: false, note: "x" },
    base: { updated: "5", values: {} },
    server,
    rules,
  });
  assert.deepEqual(r.patch, { note: "x" });
  assert.deepEqual(r.dropped, ["bought"]);
});

test("sticky: a concurrent tick on an item the server shows as not bought still applies", () => {
  const server = { id: "a", bought: false, updated: "7" };
  const r = resolveUpdate({
    patch: { bought: true },
    base: { updated: "5", values: { bought: false } },
    server,
    rules,
  });
  assert.deepEqual(r.patch, { bought: true });
});

test("sticky: a tick of an already bought item is a no-op", () => {
  const server = { id: "a", bought: true, updated: "7" };
  const r = resolveUpdate({
    patch: { bought: true },
    base: { updated: "5", values: { bought: false } },
    server,
    rules,
  });
  assert.deepEqual(r.patch, {});
  assert.deepEqual(r.dropped, ["bought"]);
});

test("without a known base version a change counts as concurrent", () => {
  const server = { id: "a", bought: true, updated: "7" };
  assert.deepEqual(resolveUpdate({ patch: { bought: false }, server, rules }).patch, {});
});

test("the rule receives the field's base, local and server values", () => {
  let seen;
  resolveUpdate({
    patch: { qty: 3 },
    base: { updated: "1", values: { qty: 1 } },
    server: { qty: 2, updated: "2" },
    rules: {
      qty: (c) => {
        seen = c;
        return Math.max(c.local, c.server);
      },
    },
  });
  assert.deepEqual(seen, { field: "qty", base: 1, local: 3, server: 2 });
});

test("registry keeps rules per collection and field", () => {
  const reg = createMergeRegistry();
  assert.deepEqual(reg.rulesFor("shop_items"), {});
  reg.register("shop_items", "bought", sticky(true));
  assert.equal(typeof reg.rulesFor("shop_items").bought, "function");
  assert.equal(reg.hasRules("todos"), false);
  assert.throws(() => reg.register("x", "y", "nope"), TypeError);
});

test("deepEqual compares plain data", () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
  assert.ok(!deepEqual(null, {}));
});
