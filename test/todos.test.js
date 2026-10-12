// Governing: SPEC-0003 REQ "To-dos", REQ "Quick Add", REQ "List Grouping", REQ "Editing"
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../app/js/todos.js");

// 2026-10-12 is a Monday; 2026-10-18 a Sunday; 2026-10-17 a Saturday.
const MON = "2026-10-12";
const todo = (o) => ({ id: o.title, who: "papa", due: "", area: "", done: "", ...o });

test("dueLabel: overdue states how long (Overdue: überfällig seit 2 Tagen)", () => {
  assert.deepEqual(T.dueLabel("2026-10-10", MON), { text: "überfällig seit 2 Tagen", late: true });
  assert.deepEqual(T.dueLabel("2026-10-11", MON), { text: "überfällig seit gestern", late: true });
  assert.deepEqual(T.dueLabel("2026-09-12", MON), { text: "überfällig seit 30 Tagen", late: true });
});

test("dueLabel: today, tomorrow, weekday within a week, short date later", () => {
  assert.deepEqual(T.dueLabel(MON, MON), { text: "heute", late: false });
  assert.deepEqual(T.dueLabel("2026-10-13", MON), { text: "morgen", late: false });
  assert.deepEqual(T.dueLabel("2026-10-14", MON), { text: "Mittwoch", late: false });
  assert.deepEqual(T.dueLabel("2026-10-18", MON), { text: "Sonntag", late: false });
  assert.deepEqual(T.dueLabel("2026-10-19", MON), { text: "Mo, 19.10.", late: false });
  assert.deepEqual(T.dueLabel("2026-12-24", MON), { text: "Do, 24.12.", late: false });
});

test("dueOptions: none, today, tomorrow, weekend, next week on a Monday", () => {
  assert.deepEqual(T.dueOptions(MON), [
    ["", "Kein Datum"],
    ["2026-10-12", "Heute"],
    ["2026-10-13", "Morgen"],
    ["2026-10-17", "Wochenende"],
    ["2026-10-19", "Nächste Woche"],
  ]);
});

test("Next week on a Sunday: Morgen and Nächste Woche are not both shown for the same date", () => {
  const options = T.dueOptions("2026-10-18");
  assert.deepEqual(
    options.map(([, l]) => l),
    ["Kein Datum", "Heute", "Morgen", "Wochenende"],
  );
  const values = options.map(([v]) => v);
  assert.equal(new Set(values).size, values.length, "every date once");
  assert.equal(options.find(([v]) => v === "2026-10-19")[1], "Morgen");
});

test("dueOptions: on a Saturday the weekend shortcut is the next Saturday, on a Friday it is tomorrow", () => {
  assert.equal(T.dueOptions("2026-10-17").find(([, l]) => l === "Wochenende")[0], "2026-10-24");
  const fri = T.dueOptions("2026-10-16");
  assert.deepEqual(
    fri.map(([, l]) => l),
    ["Kein Datum", "Heute", "Morgen", "Nächste Woche"],
    "Morgen is Saturday, so Wochenende is not repeated",
  );
});

test("dueOptions works across the year boundary and leap days", () => {
  assert.equal(T.dueOptions("2026-12-31").find(([, l]) => l === "Morgen")[0], "2027-01-01");
  assert.equal(T.dueOptions("2028-02-28").find(([, l]) => l === "Morgen")[0], "2028-02-29");
});

test("visibleTo: own and shared to-dos, not the other parent's", () => {
  const all = [
    todo({ title: "a", who: "papa" }),
    todo({ title: "b", who: "mama" }),
    todo({ title: "c", who: "parents" }),
  ];
  assert.deepEqual(
    T.visibleTo(all, "papa").map((t) => t.title),
    ["a", "c"],
  );
});

test("Shared to-do: created for both, due tomorrow, it is upcoming for both parents", () => {
  const rec = T.newTodo({
    title: "Elternabend in den Kalender eintragen",
    due: "2026-10-13",
    assignee: "parents",
    me: "papa",
    other: "mama",
  });
  const all = [{ id: "x", ...rec }];
  for (const me of ["papa", "mama"]) {
    const g = T.groupTodos(T.visibleTo(all, me), MON);
    assert.equal(g.upcoming.length, 1);
    assert.equal(g.upcoming[0].title, "Elternabend in den Kalender eintragen");
  }
});

test("groupTodos: overdue, today, upcoming sorted by due, someday, done today", () => {
  const g = T.groupTodos(
    [
      todo({ title: "late2", due: "2026-10-09" }),
      todo({ title: "late1", due: "2026-10-11" }),
      todo({ title: "now", due: MON }),
      todo({ title: "up2", due: "2026-11-01" }),
      todo({ title: "up1", due: "2026-10-13" }),
      todo({ title: "some" }),
      todo({ title: "doneNow", due: MON, done: MON }),
      todo({ title: "doneEarlier", due: "2026-10-01", done: "2026-10-02" }),
    ],
    MON,
  );
  const names = (xs) => xs.map((t) => t.title);
  assert.deepEqual(names(g.overdue), ["late2", "late1"]);
  assert.deepEqual(names(g.today), ["now"]);
  assert.deepEqual(names(g.upcoming), ["up1", "up2"]);
  assert.deepEqual(names(g.someday), ["some"]);
  assert.deepEqual(names(g.doneToday), ["doneNow"], "done earlier days are no longer listed");
});

test("groupTodos: an area filter keeps only that area's to-dos", () => {
  const g = T.groupTodos(
    [todo({ title: "a", area: "r1" }), todo({ title: "b", area: "r2" }), todo({ title: "c" })],
    MON,
    {
      area: "r1",
    },
  );
  assert.deepEqual(
    g.someday.map((t) => t.title),
    ["a"],
  );
});

test("groupTodos: null instead of empty strings (offline mirror, older records) behaves like empty", () => {
  const g = T.groupTodos([todo({ title: "n", due: null, done: null })], MON);
  assert.equal(g.someday.length, 1);
});

test("Adding while an area is selected: the new to-do belongs to that area", () => {
  const rec = T.newTodo({ title: "Winterreifen-Termin", me: "papa", area: "auto1" });
  assert.equal(rec.area, "auto1");
  assert.equal(T.newTodo({ title: "x", me: "papa" }).area, "");
});

test("newTodo: assignee me / other parent / both, due, trimmed title, empty title creates nothing", () => {
  const base = { me: "papa", other: "mama", due: "2026-10-13" };
  assert.equal(T.newTodo({ ...base, title: "  Brot  ", assignee: "me" }).title, "Brot");
  assert.equal(T.newTodo({ ...base, title: "a", assignee: "me" }).who, "papa");
  assert.equal(T.newTodo({ ...base, title: "a", assignee: "other" }).who, "mama");
  assert.equal(T.newTodo({ ...base, title: "a", assignee: "parents" }).who, "parents");
  assert.equal(T.newTodo({ ...base, title: "a" }).due, "2026-10-13");
  assert.equal(T.newTodo({ me: "papa", title: "a" }).due, "");
  assert.equal(T.newTodo({ ...base, title: "   " }), null);
  assert.equal(T.newTodo({ ...base, title: "x".repeat(500) }).title.length, T.TITLE_MAX);
});

test("toggleDone completes today and un-completes", () => {
  assert.deepEqual(T.toggleDone(todo({ title: "a" }), MON), { done: MON });
  assert.deepEqual(T.toggleDone(todo({ title: "a", done: MON }), MON), { done: "" });
});

test("titlePatch ignores empty titles", () => {
  assert.equal(T.titlePatch("   "), null);
  assert.deepEqual(T.titlePatch(" neu "), { title: "neu" });
});

test("whoLabel names the parent or says beide", () => {
  const members = [{ id: "mama", name: "Test-Mama" }];
  assert.equal(T.whoLabel("parents", members), "beide");
  assert.equal(T.whoLabel("mama", members), "Test-Mama");
  assert.equal(T.whoLabel("gone", members), "");
});
