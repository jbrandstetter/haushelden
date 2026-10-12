// Governing: SPEC-0003 REQ "Areas of Responsibility", REQ "Parents' Routines Today", REQ "Kids' Progress Glance"
//
// Pure logic: area cards (owner, open count, mine), the filter toggle, input cleaning, routine-today selection
// and per-kid progress. Days are household-day strings; 2026-10-12 is a Monday.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../app/js/areas.js");
const T = require("../app/js/todos.js");

const MON = "2026-10-12";
const TUE = "2026-10-13";
const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", created: "2" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", emoji: "⚽", created: "3" },
  { id: "kid2", role: "kid", name: "Test-Kind-2", emoji: "🎨", created: "4" },
];
const areas = [
  { id: "tech", emoji: "🖥️", name: "Technik & Smart Home", owner: "papa", created: "2" },
  { id: "auto", emoji: "🚗", name: "Auto", owner: "", created: "1" },
];
const todo = (o) => ({ id: o.id || o.title, who: "papa", due: "", area: "", done: "", ...o });

test("areaCards: all areas in creation order with owner, open count and ownership", () => {
  const todos = [
    todo({ title: "a", area: "auto" }),
    todo({ title: "b", area: "auto" }),
    todo({ title: "c", area: "auto", done: MON }),
    todo({ title: "d", area: "tech" }),
    todo({ title: "e" }),
  ];
  const cards = A.areaCards(areas, todos, members, "papa", "tech");
  assert.deepEqual(
    cards.map((c) => [c.area.id, c.open, c.mine, c.selected, c.owner && c.owner.id]),
    [
      ["auto", 2, false, false, null],
      ["tech", 1, true, true, "papa"],
    ],
  );
  assert.equal(A.areaCards(areas, todos, members, "mama")[1].mine, false);
});

test("Unowned area: its card reads Wer ist zuständig?; an owned one names the owner", () => {
  const [auto, tech] = A.areaCards(areas, [todo({ title: "x", area: "auto" })], members, "mama");
  assert.equal(A.cardLabel(auto), "Wer ist zuständig? · 1 offen");
  assert.equal(A.cardLabel(tech), "🧔 Test-Papa · 0 offen");
});

test("an owner that is no longer a member shows as unowned", () => {
  const [card] = A.areaCards([{ id: "x", name: "X", owner: "gone" }], [], members, "papa");
  assert.equal(card.owner, null);
  assert.equal(card.mine, false);
});

test("toggleFilter selects, switches and clears; effectiveFilter drops a deleted area", () => {
  assert.equal(A.toggleFilter(null, "auto"), "auto");
  assert.equal(A.toggleFilter("auto", "tech"), "tech");
  assert.equal(A.toggleFilter("auto", "auto"), null);
  assert.equal(A.effectiveFilter("auto", areas), "auto");
  assert.equal(A.effectiveFilter("gone", areas), null);
  assert.equal(A.effectiveFilter(null, areas), null);
});

test("Filtering: only the selected area's to-dos are grouped; the open counts ignore the filter", () => {
  const todos = [todo({ title: "reifen", area: "auto" }), todo({ title: "router", area: "tech" })];
  const groups = T.groupTodos(todos, MON, { area: "auto" });
  assert.deepEqual(
    groups.someday.map((t) => t.title),
    ["reifen"],
  );
  assert.equal(A.areaCards(areas, todos, members, "papa", "auto")[1].open, 1);
});

test("areaPatch trims, caps and refuses an empty name", () => {
  assert.deepEqual(A.areaPatch({ emoji: " 🧺 ", name: "  Wäsche " }), { emoji: "🧺", name: "Wäsche" });
  assert.equal(A.areaPatch({ emoji: "x", name: "   " }), null);
  assert.equal(A.areaPatch({ emoji: "x", name: undefined }), null);
  assert.equal(A.areaPatch({ emoji: "x".repeat(40), name: "n".repeat(200) }).name.length, A.NAME_MAX);
  assert.equal(A.areaPatch({ emoji: "x".repeat(40), name: "n" }).emoji.length, A.EMOJI_MAX);
  assert.deepEqual(A.areaPatch({ emoji: null, name: "n" }), { emoji: "", name: "n" });
  assert.deepEqual(
    A.ownerChoices(members).map((m) => m.id),
    ["papa", "mama"],
  );
});

// ---- routine today ---------------------------------------------------------------------------------------
const routines = [
  { id: "tonnen", emoji: "🗑️", title: "Mülltonnen rausstellen", who: "parents", days: ["0"], kind: "chore" },
  {
    id: "papa-only",
    emoji: "📦",
    title: "Test-Papa-Aufgabe",
    who: "member",
    member: "papa",
    days: ["0", "1"],
  },
  { id: "mama-only", emoji: "🧺", title: "Test-Mama-Aufgabe", who: "member", member: "mama", days: ["0"] },
  { id: "kids", emoji: "🪥", title: "Zähne putzen", who: "kids", days: ["0", "1"], kind: "chore" },
  { id: "alt", emoji: "🍽️", title: "Spülmaschine", who: "kids_alternating", days: ["0", "1", "2"] },
];

test("Parents' routine on its day: assigned to both parents on Mondays, both see it under Routine heute", () => {
  for (const id of ["papa", "mama"]) {
    const me = members.find((m) => m.id === id);
    const ids = A.routineToday(routines, [], me, members, MON).map((x) => x.routine.id);
    assert.ok(ids.includes("tonnen"), `${id} sees Mülltonnen on Monday`);
    assert.ok(!ids.includes("kids") && !ids.includes("alt"), "kid routines never show for a parent");
  }
  assert.ok(!A.routineToday(routines, [], members[0], members, TUE).some((x) => x.routine.id === "tonnen"));
});

test("a routine for one named parent shows only to that parent", () => {
  const ids = (id) =>
    A.routineToday(
      routines,
      [],
      members.find((m) => m.id === id),
      members,
      MON,
    ).map((x) => x.routine.id);
  assert.deepEqual(ids("papa"), ["tonnen", "papa-only"]);
  assert.deepEqual(ids("mama"), ["tonnen", "mama-only"]);
});

test("ticks are per parent and per day", () => {
  const ticks = [
    { id: "t1", routine: "tonnen", member: "papa", day: MON },
    { id: "t2", routine: "tonnen", member: "mama", day: "2026-10-05" },
  ];
  const papa = A.routineToday(routines, ticks, members[0], members, MON).find(
    (x) => x.routine.id === "tonnen",
  );
  const mama = A.routineToday(routines, ticks, members[1], members, MON).find(
    (x) => x.routine.id === "tonnen",
  );
  assert.equal(papa.done, true);
  assert.equal(papa.tick.id, "t1");
  assert.equal(mama.done, false, "Mama's tick of last Monday does not count today");
  assert.equal(mama.tick, undefined);
});

test("routineToday is empty for a kid or an unknown member", () => {
  assert.deepEqual(A.routineToday(routines, [], members[2], members, MON), []);
  assert.deepEqual(A.routineToday(routines, [], undefined, members, MON), []);
});

// ---- kids' progress --------------------------------------------------------------------------------------
test("Kids' progress: done / total per kid for today, in creation order", () => {
  const ticks = [
    { routine: "kids", member: "kid1", day: MON },
    { routine: "kids", member: "kid2", day: "2026-10-05" },
  ];
  const progress = A.kidsProgress(routines, ticks, members, MON);
  assert.deepEqual(
    progress.map((p) => p.kid.id),
    ["kid1", "kid2"],
  );
  const [k1, k2] = progress;
  assert.equal(k1.done, 1);
  assert.equal(k1.pct, Math.round(100 / k1.total));
  assert.equal(k2.done, 0, "last week's tick does not count");
  assert.equal(k1.total + k2.total, 3, "the shared routine for both kids plus exactly one alternating turn");
});

test("Kids' progress advances when a tick appears, and a kid without routines is at 100 %", () => {
  const before = A.dayProgress(routines, [], members[2], members, MON);
  const after = A.dayProgress(
    routines,
    [{ routine: "kids", member: "kid1", day: MON }],
    members[2],
    members,
    MON,
  );
  assert.equal(after.done, before.done + 1);
  assert.ok(after.pct > before.pct);
  const empty = A.dayProgress([], [], members[2], members, MON);
  assert.deepEqual(empty, { done: 0, total: 0, pct: 100 });
});

test("a tick of a routine that is not due does not count towards done", () => {
  const p = A.dayProgress(
    routines,
    [{ routine: "papa-only", member: "kid1", day: MON }],
    members[2],
    members,
    MON,
  );
  assert.equal(p.done, 0);
});
