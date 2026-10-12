// Governing: SPEC-0005 REQ "Automatic Refill" (marked items show the reason), REQ "Suggestions While Typing"
// (one-tap chips, due items offered when refill is off), REQ "Learned Overview" (rows, reset needs a second tap)
// Render tests on the fake document (no browser): the DOM builders of app/js/shop-learning.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeDocument } = require("./helpers/fake-dom.js");
const L = require("../app/js/shop-learning.js");
const r = require("../app/js/rhythm.js");

const day = (n) => r.dayKey(r.dayNumber("2026-09-01") + n);
const buys = (list, name, offsets) =>
  offsets.map((o) => ({ list, key: name.toLowerCase(), name, day: day(o) }));

test("scenario: Milk comes back - an automatic item shows '✨ automatisch · etwa alle 5 Tage · zuletzt vor 4 Tagen'", () => {
  const doc = createFakeDocument();
  const el = L.reasonEl(doc, { auto: true, auto_rhythm: 5, auto_last: day(0) }, day(4));
  assert.equal(el.textContent, "✨ automatisch · etwa alle 5 Tage · zuletzt vor 4 Tagen");
  assert.equal(L.reasonEl(doc, { auto: false }, day(4)), null, "manual items have no reason line");
  assert.equal(L.reasonEl(doc, { auto: true }, day(4)).textContent, "✨ automatisch", "without reason data");
});

test("the days since the last purchase move on with the household day", () => {
  const item = { auto: true, auto_rhythm: 7, auto_last: day(0) };
  assert.match(L.reasonText(item, day(6)), /zuletzt vor 6 Tagen$/);
  assert.match(L.reasonText(item, day(8)), /zuletzt vor 8 Tagen$/);
});

test("scenario: Typing 'Ka' - Kaffee is suggested unless it is already on the list", () => {
  const entries = r.learn(buys("food", "Kaffee", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  const base = { entries, typed: "Ka", today: day(12), autoRefill: true };
  assert.deepEqual(
    L.chipsFor({ ...base, taken: new Set() }).map((c) => c.name),
    ["Kaffee"],
  );
  assert.deepEqual(L.chipsFor({ ...base, taken: new Set(["kaffee"]) }), []);
});

test("chips are one-tap buttons that hand the name to the add function", async () => {
  const doc = createFakeDocument();
  const box = doc.createElement("div");
  const picked = [];
  L.renderChips(doc, box, [{ name: "Kaffee" }, { name: "Shampoo", due: true }], (n) => picked.push(n));
  const buttons = box.querySelectorAll("button");
  assert.deepEqual(
    buttons.map((b) => b.textContent),
    ["Kaffee", "⏰ Shampoo"],
  );
  assert.equal(buttons[1].getAttribute("aria-label"), "Shampoo hinzufügen (fällig)");
  await buttons[0].click();
  assert.deepEqual(picked, ["Kaffee"]);
  L.renderChips(doc, box, [], () => {});
  assert.equal(box.querySelectorAll("button").length, 0, "re-rendering replaces the chips");
});

test("with automatic refill off, due items are offered first as suggestions; with it on they are not marked", () => {
  const entries = r.learn([
    ...buys("food", "Brot", [0, 3, 6]),
    ...buys("food", "Kaffee", [0, 1, 2, 3, 4, 5, 6, 7]),
  ]);
  const args = { entries, typed: "", taken: new Set(), today: day(20) };
  const off = L.chipsFor({ ...args, autoRefill: false });
  assert.deepEqual(
    off.map((c) => [c.name, c.due]),
    [
      ["Kaffee", true],
      ["Brot", true],
    ],
    "both are due and marked",
  );
  const quiet = L.chipsFor({ ...args, today: day(6), autoRefill: false });
  assert.deepEqual(
    quiet.map((c) => [c.name, c.due]),
    [
      ["Kaffee", false],
      ["Brot", false],
    ],
    "nothing due: the most frequent first",
  );
  assert.ok(L.chipsFor({ ...args, autoRefill: true }).every((c) => !c.due));
});

test("scenario: Reviewing what was learned - rows like '🛒 Milch — alle ~5 Tage — 6× gekauft'", () => {
  const doc = createFakeDocument();
  const lists = [
    { id: "food", emoji: "🛒", name: "Lebensmittel" },
    { id: "dm", emoji: "🧴", name: "dm" },
  ];
  const entries = r.learn([
    ...buys("food", "Milch", [0, 4, 10, 15, 20, 25]),
    ...buys("dm", "Seife", [3]),
    ...buys("food", "Brot", [1, 2]),
  ]);
  const view = L.buildLearnedView(doc, { lists, entries, autoRefill: true, onToggleAuto() {}, onReset() {} });
  assert.deepEqual(
    view.querySelectorAll(".row").map((n) => n.textContent),
    [
      "🛒 Milch — alle ~5 Tage — 6× gekauft",
      "🛒 Brot — alle ~1 Tag — 2× gekauft",
      "🧴 Seife — noch kein Rhythmus — 1× gekauft",
    ],
  );
});

test("the overview says so when nothing has been learned yet", () => {
  const doc = createFakeDocument();
  const view = L.buildLearnedView(doc, {
    lists: [],
    entries: [],
    autoRefill: true,
    onToggleAuto() {},
    onReset() {},
  });
  assert.match(view.textContent, /Noch nichts gelernt/);
});

test("the reset needs a second tap to confirm; the first tap only asks", async () => {
  const doc = createFakeDocument();
  let resets = 0;
  const view = L.buildLearnedView(doc, {
    lists: [],
    entries: [],
    autoRefill: true,
    onToggleAuto() {},
    onReset: () => resets++,
    armMs: 20,
  });
  const button = view.querySelectorAll("button")[0];
  await button.click();
  assert.equal(resets, 0);
  assert.match(button.textContent, /Nochmal tippen/);
  await button.click();
  assert.equal(resets, 1);
  assert.equal(button.textContent, "Einkaufsverlauf zurücksetzen");
  await button.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(button.textContent, "Einkaufsverlauf zurücksetzen", "the confirmation expires on its own");
  await button.click();
  assert.equal(resets, 1, "a first tap after expiry asks again");
});

test("the automatic-refill switch reports the new value", async () => {
  const doc = createFakeDocument();
  const seen = [];
  const view = L.buildLearnedView(doc, {
    lists: [],
    entries: [],
    autoRefill: true,
    onToggleAuto: (v) => seen.push(v),
    onReset() {},
  });
  const box = view.querySelectorAll("input")[0];
  assert.equal(box.checked, true);
  box.checked = false;
  await box.dispatch("change");
  assert.deepEqual(seen, [false]);
});

test("requestRefill posts the list id with the token and swallows failures", async () => {
  const calls = [];
  const ok = await L.requestRefill({
    fetchImpl: async (url, init) => (calls.push([url, init]), { ok: true, json: async () => ({ added: 2 }) }),
    token: "t0k",
    listId: "list1",
  });
  assert.deepEqual(ok, { added: 2 });
  assert.equal(calls[0][0], "/api/hh/refill");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers.authorization, "t0k");
  assert.deepEqual(JSON.parse(calls[0][1].body), { list: "list1" });
  assert.equal(
    await L.requestRefill({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      token: "t",
      listId: "x",
    }),
    null,
  );
  assert.equal(
    await L.requestRefill({ fetchImpl: async () => ({ ok: false }), token: "t", listId: "x" }),
    null,
  );
  assert.equal(await L.requestRefill({ fetchImpl: null, token: "t", listId: "x" }), null);
});
