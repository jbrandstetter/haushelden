// Governing: SPEC-0003 REQ "To-dos" (Shared to-do), REQ "Quick Add" (Adding while an area is selected),
// REQ "List Grouping" (Overdue), REQ "Editing" (Next week on a Sunday)
//
// Render tests for the parents' list view: buildView is rendered into a fake DOM and inspected / clicked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const { buildView } = require("../app/js/screens/eltern.js");

const MON = "2026-10-12";
const SUN = "2026-10-18";
const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", emoji: "⚽" },
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

function render({ todos = [], areas = [], today = MON, state = freshState(), me = "papa", calls = [] } = {}) {
  const doc = createDocument();
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  const actions = Object.fromEntries(
    [
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
    ].map((n) => [n, record(n)]),
  );
  const root = buildView(doc, { today, me, members, todos, areas, state }, actions);
  return { root, calls };
}
const groupTitles = (root) => root.querySelectorAll("[data-group]").map((e) => e.textContent);
const titlesIn = (root, group) =>
  root
    .querySelector(`[data-group-list="${group}"]`)
    .querySelectorAll(".tt")
    .map((e) => e.textContent);

test("List Grouping: renders overdue, today, upcoming, someday and done-today groups in order", () => {
  const { root } = render({
    todos: [
      todo({ title: "alt", due: "2026-10-10" }),
      todo({ title: "jetzt", due: MON }),
      todo({ title: "bald", due: "2026-10-14" }),
      todo({ title: "irgendwann" }),
      todo({ title: "fertig", due: MON, done: MON }),
    ],
  });
  assert.deepEqual(groupTitles(root), ["Überfällig", "Heute", "Demnächst", "Irgendwann", "Heute erledigt"]);
  assert.deepEqual(titlesIn(root, "overdue"), ["alt"]);
  assert.deepEqual(titlesIn(root, "doneToday"), ["fertig"]);
  const done = root.querySelector('[data-group-list="doneToday"] .todo');
  assert.ok(done.className.includes("done"), "done-today rows are marked done");
  assert.equal(done.querySelector('[data-role="check"]').getAttribute("aria-label"), "Wieder öffnen");
});

test("Overdue: a to-do due two days ago is under Überfällig, marked überfällig seit 2 Tagen", () => {
  const { root } = render({ todos: [todo({ title: "Altglas", due: "2026-10-10" })] });
  assert.deepEqual(groupTitles(root), ["Überfällig"]);
  const late = root.querySelector(".meta .late");
  assert.equal(late.textContent, "überfällig seit 2 Tagen");
});

test("Shared to-do: for both parents, due tomorrow, it appears under Demnächst in both views", () => {
  const shared = todo({ title: "Elternabend", who: "parents", due: "2026-10-13" });
  for (const me of ["papa", "mama"]) {
    const { root } = render({ todos: [shared], me });
    assert.deepEqual(titlesIn(root, "upcoming"), ["Elternabend"]);
    assert.match(root.querySelector(".meta").textContent, /morgen · für beide/);
  }
});

test("a parent does not see the other parent's personal to-dos; empty list shows the empty note", () => {
  const { root } = render({ todos: [todo({ title: "nur Mama", who: "mama" })] });
  assert.deepEqual(groupTitles(root), []);
  assert.ok(root.querySelector('[data-role="empty"]'));
});

test("Quick Add: one text field, due chips none/today/tomorrow, assignee chips me/other/both", () => {
  const { root } = render({});
  assert.equal(root.querySelectorAll('input[data-key="quick-title"]').length, 1);
  assert.deepEqual(
    root
      .querySelector('[data-role="quick-due"]')
      .querySelectorAll("button")
      .map((b) => b.textContent),
    ["Kein Datum", "Heute", "Morgen"],
  );
  assert.deepEqual(
    root
      .querySelector('[data-role="quick-who"]')
      .querySelectorAll("button")
      .map((b) => b.textContent),
    ["Für mich", "Für Test-Mama", "Für uns beide"],
  );
  assert.equal(root.querySelector('[data-who="me"]').getAttribute("aria-pressed"), "true");
});

test("Quick Add: submitting and tapping chips call the actions", () => {
  const { root, calls } = render({});
  const input = root.querySelector('input[data-key="quick-title"]');
  input.value = "Brot kaufen";
  input.dispatch("input");
  root.querySelector('[data-who="parents"]').click();
  root.querySelector('[data-due="2026-10-13"]').click();
  root.querySelector("form").dispatch("submit");
  assert.deepEqual(calls, [
    ["draft", "Brot kaufen"],
    ["setAddWho", "parents"],
    ["setAddDue", "2026-10-13"],
    ["add", "Brot kaufen"],
  ]);
});

test("Adding while an area is selected: filter bar and placeholder name the area, others are hidden", () => {
  const areas = [
    { id: "auto", emoji: "🚗", name: "Auto" },
    { id: "haus", emoji: "🏠", name: "Haus" },
  ];
  const { root, calls } = render({
    areas,
    state: freshState({ areaFilter: "auto" }),
    todos: [todo({ title: "Reifen", area: "auto" }), todo({ title: "Dach", area: "haus" })],
  });
  assert.match(root.querySelector('input[data-key="quick-title"]').getAttribute("placeholder"), /für Auto/);
  assert.match(root.querySelector(".filterbar").textContent, /Auto/);
  assert.deepEqual(titlesIn(root, "someday"), ["Reifen"]);
  root.querySelector('[data-role="clear-area"]').click();
  assert.deepEqual(calls, [["clearArea"]]);
});

test("Editing: tapping a to-do asks to open its editor; the editor has title, due, assignee, delete", () => {
  const t = todo({ title: "Altglas", due: MON });
  const closed = render({ todos: [t] });
  assert.equal(closed.root.querySelector('[data-role="editor"]'), null);
  closed.root.querySelector('[data-role="open-editor"]').click();
  assert.deepEqual(closed.calls, [["edit", "Altglas"]]);

  const { root, calls } = render({ todos: [t], state: freshState({ editing: "Altglas" }) });
  const box = root.querySelector('[data-role="editor"]');
  assert.ok(box.querySelector('input[type="text"]'), "title field");
  assert.ok(box.querySelector('[data-role="edit-date"]'), "date picker");
  assert.deepEqual(
    box
      .querySelector('[data-role="edit-due"]')
      .querySelectorAll("button")
      .map((b) => b.textContent),
    ["Kein Datum", "Heute", "Morgen", "Wochenende", "Nächste Woche"],
  );
  assert.deepEqual(
    box
      .querySelector('[data-role="edit-who"]')
      .querySelectorAll("button")
      .map((b) => b.textContent),
    ["Test-Papa", "Test-Mama", "Beide"],
  );
  assert.equal(box.querySelector('[data-who="papa"]').getAttribute("aria-pressed"), "true");
  assert.equal(box.querySelector('[data-role="edit-area"]'), null, "no area row without areas");
  box.querySelector('[data-who="parents"]').click();
  box.querySelector('[data-role="delete"]').click();
  assert.deepEqual(calls, [
    ["patch", t, { who: "parents" }],
    ["remove", t],
  ]);
});

test("Editing: with areas the editor offers them and a way to clear", () => {
  const t = todo({ title: "Reifen", area: "auto" });
  const { root, calls } = render({
    todos: [t],
    areas: [{ id: "auto", emoji: "🚗", name: "Auto" }],
    state: freshState({ editing: "Reifen" }),
  });
  const row = root.querySelector('[data-role="edit-area"]');
  assert.deepEqual(
    row.querySelectorAll("button").map((b) => b.textContent),
    ["Kein Bereich", "🚗 Auto"],
  );
  row.querySelector('[data-area=""]').click();
  assert.deepEqual(calls, [["patch", t, { area: "" }]]);
});

test("Next week on a Sunday: the editor shows Morgen and not also Nächste Woche", () => {
  const { root } = render({
    today: SUN,
    todos: [todo({ title: "x" })],
    state: freshState({ editing: "x" }),
  });
  const labels = root
    .querySelector('[data-role="edit-due"]')
    .querySelectorAll("button")
    .map((b) => b.textContent);
  assert.ok(labels.includes("Morgen"));
  assert.equal(labels.includes("Nächste Woche"), false);
  const values = root
    .querySelector('[data-role="edit-due"]')
    .querySelectorAll("button")
    .map((b) => b.getAttribute("data-due"));
  assert.equal(new Set(values).size, values.length);
});

test("user-supplied titles are rendered as text, never as markup", () => {
  const { root } = render({ todos: [todo({ title: '<img src=x onerror="alert(1)">' })] });
  assert.equal(root.querySelectorAll("img").length, 0);
  assert.equal(root.querySelector(".tt").textContent, '<img src=x onerror="alert(1)">');
});
