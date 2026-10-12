// Governing: SPEC-0003 REQ "Areas of Responsibility", REQ "Parents' Routines Today", REQ "Kids' Progress Glance",
// REQ "Quick Add" and REQ "Editing" (area parts)
//
// Render tests of the parents' view extensions and the areas management screen in a fake DOM, and a screen-level
// test with a stub data API proving the live updates (a kid's tick advances the glance; a deleted area ends the
// filter and the to-do stays). Uses the shared helper test/helpers/fake-dom-nodes.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const eltern = require("../app/js/screens/eltern.js");
const bereiche = require("../app/js/screens/bereiche.js");

const MON = "2026-10-12";
const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink", created: "2" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach", created: "3" },
  { id: "kid2", role: "kid", name: "Test-Kind-2", emoji: "🎨", colour: "teal", created: "4" },
];
const areas = [
  { id: "tech", emoji: "🖥️", name: "Technik & Smart Home", owner: "papa", created: "1" },
  { id: "auto", emoji: "🚗", name: "Auto", owner: "", created: "2" },
];
const routines = [
  { id: "tonnen", emoji: "🗑️", title: "Mülltonnen rausstellen", who: "parents", days: ["0"], kind: "chore" },
  {
    id: "hausi",
    emoji: "📚",
    title: "Hausaufgaben",
    who: "member",
    member: "kid1",
    days: ["0"],
    kind: "chore",
  },
  { id: "zaehne", emoji: "🪥", title: "Zähne putzen", who: "kids", days: ["0"], kind: "chore" },
];
const todo = (o) => ({ id: o.title, who: "papa", due: "", area: "", done: "", ...o });
const freshState = (o = {}) => ({
  addDue: "",
  addWho: "me",
  draft: "",
  editing: null,
  areaFilter: null,
  mode: "list",
  ...o,
});
const ACTIONS = [
  "add",
  "draft",
  "setAddDue",
  "setAddWho",
  "toggle",
  "edit",
  "patch",
  "setTitle",
  "remove",
  "clearArea",
  "selectArea",
  "tickRoutine",
];

function render({ me = "papa", todos = [], ticks = [], state = freshState(), calls = [] } = {}) {
  const doc = createDocument();
  const actions = Object.fromEntries(ACTIONS.map((n) => [n, (...args) => calls.push([n, ...args])]));
  const root = eltern.buildView(
    doc,
    { today: MON, me, members, todos, areas, routines, ticks, state },
    actions,
  );
  return { root, calls };
}

test("Areas: the panel shows every area with owner avatar, open count, and Wer ist zuständig? when unowned", () => {
  const { root } = render({ me: "mama", todos: [todo({ title: "a", area: "auto" })] });
  const cards = root.querySelectorAll("[data-area-card]");
  assert.equal(cards.length, 2);
  const tech = root.querySelector('[data-area-card="tech"]');
  assert.match(tech.textContent, /Technik & Smart Home/);
  assert.match(tech.textContent, /🧔/);
  assert.match(tech.textContent, /Test-Papa · 0 offen/);
  assert.match(root.querySelector('[data-area-card="auto"]').textContent, /Wer ist zuständig\? · 1 offen/);
});

test("Owner highlight: Technik is outlined in the owner's view and plain in the other parent's view", () => {
  const mine = render({ me: "papa" }).root.querySelector('[data-area-card="tech"]');
  const other = render({ me: "mama" }).root.querySelector('[data-area-card="tech"]');
  assert.ok(mine.className.split(" ").includes("mine"));
  assert.ok(!other.className.split(" ").includes("mine"));
  assert.match(other.textContent, /🧔/, "the other parent sees the owner's avatar");
  assert.ok(!render({ me: "papa" }).root.querySelector('[data-area-card="auto"]').className.includes("mine"));
});

test("tapping an area card calls selectArea; the selected one is marked and the filter bar offers to clear", () => {
  const { root, calls } = render();
  root.querySelector('[data-area-card="auto"]').click();
  assert.deepEqual(calls, [["selectArea", "auto"]]);
  const sel = render({ state: freshState({ areaFilter: "auto" }) });
  const card = sel.root.querySelector('[data-area-card="auto"]');
  assert.ok(card.className.includes("sel"));
  assert.equal(card.getAttribute("aria-pressed"), "true");
  sel.root.querySelector('[data-role="clear-area"]').click();
  assert.deepEqual(sel.calls, [["clearArea"]]);
});

test("the editor now shows the area row and picks an area; the panel links to the areas editor", () => {
  const { root, calls } = render({
    state: freshState({ editing: "x" }),
    todos: [todo({ title: "x", id: "x" })],
  });
  const row = root.querySelector('[data-role="edit-area"]');
  assert.ok(row, "the area row is visible");
  row.querySelector('[data-area="auto"]').click();
  assert.deepEqual(calls, [["patch", todo({ title: "x", id: "x" }), { area: "auto" }]]);
  assert.equal(root.querySelector('[data-role="manage-areas"]').getAttribute("href"), "#/bereiche");
});

test("Routine heute: on Monday both parents see the Mülltonnen routine; ticking calls tickRoutine per parent", () => {
  for (const me of ["papa", "mama"]) {
    const { root, calls } = render({ me });
    const list = root.querySelector('[data-role="routine-today"]');
    assert.equal(list.querySelectorAll(".tt").length, 1);
    assert.match(list.querySelector(".tt").textContent, /Mülltonnen rausstellen/);
    list.querySelector('[data-role="routine-check"]').click();
    assert.equal(calls[0][0], "tickRoutine");
    assert.equal(calls[0][1].id, "tonnen");
    assert.equal(calls[0][2], false);
  }
});

test("Routine heute: a ticked routine is shown done for that parent only; no routines, no heading", () => {
  const ticks = [{ id: "t1", routine: "tonnen", member: "papa", day: MON }];
  const papa = render({ me: "papa", ticks }).root;
  const mama = render({ me: "mama", ticks }).root;
  assert.ok(papa.querySelector('[data-routine="tonnen"]').className.includes("done"));
  assert.ok(!mama.querySelector('[data-routine="tonnen"]').className.includes("done"));
  const doc = createDocument();
  const empty = eltern.buildView(
    doc,
    {
      today: "2026-10-13",
      me: "papa",
      members,
      todos: [],
      areas: [],
      routines,
      ticks: [],
      state: freshState(),
    },
    Object.fromEntries(ACTIONS.map((n) => [n, () => {}])),
  );
  assert.equal(empty.querySelector('[data-role="routine-heading"]'), null);
});

test("Kids' progress glance: one bar per kid with done / total at the top, before the quick add", () => {
  const ticks = [{ id: "t1", routine: "hausi", member: "kid1", day: MON }];
  const { root } = render({ ticks });
  const rows = root.querySelectorAll("[data-kid]");
  assert.deepEqual(
    rows.map((r) => r.querySelector('[data-role="progress"]').textContent),
    ["1/2", "0/1"],
  );
  assert.match(rows[0].querySelector("b").textContent, /Test-Kind-1/);
  assert.match(rows[0].querySelector("i").getAttribute("style"), /width:50%/);
  const kinds = root.children.map((c) => c.getAttribute("data-role") || c.className);
  assert.ok(
    kinds.indexOf("kids-progress") > -1 && kinds.indexOf("kids-progress") < kinds.indexOf("quick-add"),
  );
});

// ---- screen: live updates -----------------------------------------------------------------------------
function stubData(initial) {
  const rows = { ...initial };
  const subs = {};
  const calls = [];
  const push = (c) => (subs[c] || []).forEach((cb) => cb(rows[c]));
  return {
    calls,
    set(c, value) {
      rows[c] = value;
      push(c);
    },
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb(rows[c] || []);
      return () => {};
    },
    create: async (c, r) => calls.push(["create", c, r]),
    update: async (c, id, r) => calls.push(["update", c, id, r]),
    delete: async (c, id) => calls.push(["delete", c, id]),
  };
}
function mountScreen(screen, data, me = "papa") {
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  screen(view, {
    data,
    auth: { record: () => ({ member: me }) },
    clock: { today: () => MON },
  });
  return view;
}

test("Kids' progress is live: a tick arriving through the subscription advances the bar", () => {
  const data = stubData({ members, todos: [], areas, routines, routine_done: [] });
  const view = mountScreen(eltern.screen, data);
  const text = () => view.querySelector('[data-kid="kid1"] [data-role="progress"]').textContent;
  assert.equal(text(), "0/2");
  data.set("routine_done", [{ id: "t1", routine: "hausi", member: "kid1", day: MON }]);
  assert.equal(text(), "1/2");
});

test("Ticking Routine heute creates a tick for this parent today; ticking again deletes it", () => {
  const data = stubData({ members, todos: [], areas, routines, routine_done: [] });
  const view = mountScreen(eltern.screen, data, "mama");
  view.querySelector('[data-role="routine-check"]').click();
  assert.deepEqual(data.calls, [["create", "routine_done", { routine: "tonnen", member: "mama", day: MON }]]);
  data.set("routine_done", [{ id: "t9", routine: "tonnen", member: "mama", day: MON }]);
  view.querySelector('[data-role="routine-check"]').click();
  assert.deepEqual(data.calls[1], ["delete", "routine_done", "t9"]);
});

test("Selecting an area filters the list until cleared; deleting the area ends the filter and keeps the to-do", () => {
  const todos = [
    todo({ title: "Reifen", id: "t1", area: "auto" }),
    todo({ title: "Router", id: "t2", area: "tech" }),
  ];
  const data = stubData({ members, todos, areas, routines: [], routine_done: [] });
  const view = mountScreen(eltern.screen, data);
  const titles = () => view.querySelectorAll(".todos .tt").map((e) => e.textContent);
  assert.deepEqual(titles().sort(), ["Reifen", "Router"]);
  view.querySelector('[data-area-card="auto"]').click();
  assert.deepEqual(titles(), ["Reifen"]);
  view.querySelector('[data-area-card="auto"]').click();
  assert.deepEqual(titles().sort(), ["Reifen", "Router"], "tapping the selected card clears the filter");
  view.querySelector('[data-area-card="auto"]').click();
  view.querySelector('[data-role="clear-area"]').click();
  assert.equal(view.querySelector('[data-role="clear-area"]'), null);
  // the selected area is deleted elsewhere: the server unlinks its to-do, the filter ends
  view.querySelector('[data-area-card="auto"]').click();
  data.set("areas", [areas[0]]);
  data.set("todos", [todo({ title: "Reifen", id: "t1", area: "" }), todos[1]]);
  assert.equal(view.querySelector('[data-role="clear-area"]'), null);
  assert.deepEqual(titles().sort(), ["Reifen", "Router"]);
});

// ---- areas management screen ---------------------------------------------------------------------------
test("Areas editor: lists areas with name, owner chips and delete; actions call through", () => {
  const doc = createDocument();
  const calls = [];
  const rec =
    (n) =>
    (...a) =>
      calls.push([n, ...a.map((x) => (x && x.id) || x)]);
  const root = bereiche.buildView(
    doc,
    { areas, members, todos: [todo({ title: "a", area: "auto" })] },
    { add: rec("add"), save: rec("save"), setOwner: rec("setOwner"), remove: rec("remove") },
  );
  const rows = root.querySelectorAll("[data-area-row]");
  assert.deepEqual(
    rows.map((r) => r.getAttribute("data-area-row")),
    ["tech", "auto"],
  );
  const auto = root.querySelector('[data-area-row="auto"]');
  assert.deepEqual(
    auto
      .querySelectorAll("[data-owner]")
      .map((b) => [b.getAttribute("data-owner"), b.getAttribute("aria-pressed")]),
    [
      ["papa", "false"],
      ["mama", "false"],
      ["", "true"],
    ],
  );
  assert.match(auto.textContent, /1 offen – bleiben beim Löschen erhalten/);
  auto.querySelector('[data-owner="mama"]').click();
  auto.querySelector('[data-role="delete-area"]').click();
  const name = auto.querySelector('[data-field="name"]');
  name.value = "Fahrzeuge";
  name.dispatch("change");
  root.querySelector('[data-role="add-area"]').click();
  assert.deepEqual(calls, [
    ["setOwner", "auto", "mama"],
    ["remove", "auto"],
    ["save", "auto", { emoji: "🚗", name: "Fahrzeuge" }],
    ["add"],
  ]);
});

test("Areas editor screen: add, rename (cleaned), set and clear owner, delete go to the data layer", async () => {
  const data = stubData({ members, todos: [], areas });
  const view = mountScreen(bereiche.screen, data);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  view.querySelector('[data-role="add-area"]').click();
  view.querySelector('[data-area-row="tech"] [data-owner="mama"]').click();
  view.querySelector('[data-area-row="tech"] [data-owner=""]').click();
  const name = view.querySelector('[data-area-row="auto"] [data-field="name"]');
  name.value = "  Fahrzeuge  ";
  name.dispatch("change");
  const empty = view.querySelector('[data-area-row="auto"] [data-field="name"]');
  empty.value = "   ";
  empty.dispatch("change");
  view.querySelector('[data-area-row="auto"] [data-role="delete-area"]').click();
  await settle();
  assert.deepEqual(data.calls, [
    ["create", "areas", { emoji: "📌", name: "Neuer Bereich", owner: "" }],
    ["update", "areas", "tech", { owner: "mama" }],
    ["update", "areas", "tech", { owner: "" }],
    ["update", "areas", "auto", { emoji: "🚗", name: "Fahrzeuge" }],
    ["delete", "areas", "auto"],
  ]);
});

test("Areas editor screen without a session shows the not-signed-in note and no editor", () => {
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  bereiche.screen(view, { data: stubData({}), auth: { record: () => null }, clock: { today: () => MON } });
  assert.equal(view.querySelector('[data-role="areas-editor"]'), null);
  assert.match(view.textContent, /Nicht angemeldet/);
});
