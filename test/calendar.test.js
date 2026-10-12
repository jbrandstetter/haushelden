// Governing: SPEC-0004 REQ "Month View" (grid, markers, cap), REQ "Day Agenda" (order), REQ "Entry Sources"
// (hobbies and parents' routines in, chores out), REQ "Area Filter in Calendar", REQ "Mode Switch" (persistence)
//
// Unit tests of the pure calendar logic in app/js/calendar.js, over household-day strings.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/js/calendar.js");

const members = [
  { id: "papa", role: "parent", name: "Test-Papa", colour: "blue", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", colour: "pink", created: "2" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", colour: "peach", created: "3" },
  { id: "kid2", role: "kid", name: "Test-Kind-2", colour: "mauve", created: "4" },
];
const TUE = "2026-10-13";
const routine = (o) => ({ id: o.title, emoji: "•", hint: "", time: "", kind: "hobby", days: ["1"], ...o });
const soccer = routine({
  title: "Fußballtraining",
  time: "17:00",
  who: "member",
  member: "kid1",
  emoji: "⚽",
});
const piano = routine({ title: "Klavierstunde", who: "member", member: "kid2", hint: "Noten einpacken" });
const homework = routine({
  title: "Hausaufgaben",
  kind: "chore",
  who: "kids",
  days: ["0", "1", "2", "3", "4"],
});
const todo = (o) => ({ id: o.title, who: "papa", due: "", area: "", done: "", ...o });

test("Month View: the grid is Monday-first and has the right number of leading blanks and days", () => {
  const cases = [
    ["2026-10", 3, 31, "Oktober 2026"], // 1 Oct 2026 is a Thursday
    ["2026-06", 0, 30, "Juni 2026"], // Monday
    ["2026-02", 6, 28, "Februar 2026"], // Sunday
    ["2024-02", 3, 29, "Februar 2024"], // leap year, Thursday
    ["2026-12", 1, 31, "Dezember 2026"], // year end, Tuesday
    ["2027-01", 4, 31, "Januar 2027"], // year start, Friday
  ];
  for (const [ym, leading, count, title] of cases) {
    const g = C.monthGrid(C.monthIndex(`${ym}-15`));
    assert.equal(g.leading, leading, ym);
    assert.equal(g.days.length, count, ym);
    assert.equal(g.title, title);
    assert.equal(g.days[0], `${ym}-01`);
    assert.equal(g.days[count - 1], `${ym}-${count}`);
  }
});

test("Month View: every weekday start is covered and month stepping crosses year boundaries", () => {
  const starts = new Set();
  for (let mi = C.monthIndex("2026-01-01"); mi < C.monthIndex("2027-01-01"); mi++) {
    starts.add(C.monthGrid(mi).leading);
  }
  assert.equal(starts.size, 7);
  const dec = C.monthIndex("2026-12-20");
  assert.equal(C.monthStart(dec + 1), "2027-01-01");
  assert.equal(C.monthStart(C.monthIndex("2026-01-05") - 1), "2025-12-01");
});

test("Month View: markers are in the owner's colour, both parents show both colours, capped at four", () => {
  const source = {
    members,
    routines: [soccer, piano],
    todos: [todo({ title: "Kinderarzt", who: "parents", due: TUE })],
  };
  const entries = C.dayEntries(TUE, source);
  // Busy Tuesday: soccer (peach), piano (mauve), then both parents' colours
  assert.deepEqual(C.markerColours(entries, members), ["peach", "mauve", "blue", "pink"]);
  const busier = C.dayEntries(TUE, {
    ...source,
    todos: [...source.todos, todo({ title: "Mehr", due: TUE })],
  });
  assert.equal(C.markerColours(busier, members).length, C.MAX_MARKERS, "never more than four");
  assert.equal(busier.todos.length, 2, "but the agenda keeps every entry");
});

test("Month View: done to-dos produce no marker but stay in the agenda", () => {
  const entries = C.dayEntries(TUE, {
    members,
    routines: [],
    todos: [todo({ title: "Fertig", due: TUE, done: TUE })],
  });
  assert.deepEqual(C.markerColours(entries, members), []);
  assert.equal(entries.todos.length, 1);
});

test("Month View: a to-do whose parent is gone gets the neutral colour", () => {
  assert.deepEqual(C.todoColours(todo({ title: "x", who: "weg" }), members), ["overlay"]);
});

test("Entry Sources: chores of the kids never appear, hobbies and parents' routines do", () => {
  const tonnen = routine({ title: "Mülltonnen", kind: "chore", who: "parents" });
  const papaOnly = routine({ title: "Auto waschen", who: "member", member: "papa", time: "09:30" });
  const entries = C.dayEntries(TUE, { members, routines: [homework, soccer, tonnen, papaOnly], todos: [] });
  assert.deepEqual(
    entries.events.map((e) => e.title),
    ["Auto waschen", "Fußballtraining", "Mülltonnen"],
  );
  assert.ok(!entries.events.some((e) => e.title === "Hausaufgaben"));
  const byTitle = Object.fromEntries(entries.events.map((e) => [e.title, e]));
  assert.equal(byTitle["Mülltonnen"].colour, C.BOTH_COLOUR);
  assert.equal(byTitle["Mülltonnen"].owner, "beide");
  assert.equal(byTitle["Auto waschen"].colour, "blue");
  assert.equal(byTitle["Fußballtraining"].owner, "Test-Kind-1");
});

test("Entry Sources: a hobby for both kids shows once per kid in their colours; routines respect weekdays", () => {
  const swim = routine({ title: "Schwimmen", who: "kids", days: ["1"] });
  const entries = C.dayEntries(TUE, { members, routines: [swim], todos: [] });
  assert.deepEqual(
    entries.events.map((e) => [e.owner, e.colour]),
    [
      ["Test-Kind-1", "peach"],
      ["Test-Kind-2", "mauve"],
    ],
  );
  assert.deepEqual(C.dayEntries("2026-10-14", { members, routines: [swim], todos: [] }).events, []);
});

test("Entry Sources: an alternating hobby falls to the kid whose turn it is", () => {
  const alt = routine({ title: "Fahrdienst", who: "kids_alternating", days: ["1"] });
  const entries = C.dayEntries(TUE, { members, routines: [alt], todos: [] });
  assert.equal(entries.events.length, 1);
  assert.ok(["Test-Kind-1", "Test-Kind-2"].includes(entries.events[0].owner));
});

test("Entry Sources: only to-dos due that day are included, whoever they are for", () => {
  const entries = C.dayEntries(TUE, {
    members,
    routines: [],
    todos: [
      todo({ title: "Heute", due: TUE }),
      todo({ title: "Mamas", who: "mama", due: TUE }),
      todo({ title: "Morgen", due: "2026-10-14" }),
      todo({ title: "Ohne" }),
    ],
  });
  assert.deepEqual(entries.todos.map((t) => t.title).sort(), ["Heute", "Mamas"]);
});

test("Day Agenda: timed entries in time order, then untimed, then the to-dos", () => {
  const early = routine({ title: "Früh", time: "08:15", who: "member", member: "kid2" });
  const entries = C.dayEntries(TUE, {
    members,
    routines: [piano, soccer, early],
    todos: [todo({ title: "Kinderarzt anrufen", due: TUE })],
  });
  assert.deepEqual(
    entries.events.map((e) => e.title),
    ["Früh", "Fußballtraining", "Klavierstunde"],
  );
  assert.equal(entries.todos[0].title, "Kinderarzt anrufen");
  const e = entries.events[1];
  assert.deepEqual([e.emoji, e.title, e.owner, e.time], ["⚽", "Fußballtraining", "Test-Kind-1", "17:00"]);
  assert.equal(entries.events[2].hint, "Noten einpacken");
});

test("Area Filter in Calendar: only that area's to-dos produce entries, routines are hidden", () => {
  const source = {
    members,
    routines: [soccer, piano],
    todos: [
      todo({ title: "Reifen", due: TUE, area: "auto" }),
      todo({ title: "Router", due: TUE, area: "tech" }),
      todo({ title: "Ohne", due: TUE }),
    ],
  };
  const entries = C.dayEntries(TUE, { ...source, areaFilter: "auto" });
  assert.deepEqual(
    entries.todos.map((t) => t.title),
    ["Reifen"],
  );
  assert.deepEqual(entries.events, []);
  assert.deepEqual(C.markerColours(entries, members), ["blue"]);
});

test("Day heading and long date", () => {
  assert.equal(C.dayHeading("2026-10-12", "2026-10-12"), "Heute");
  assert.equal(C.dayHeading("2026-10-13", "2026-10-12"), "Morgen");
  assert.equal(C.dayHeading("2026-10-15", "2026-10-12"), "Donnerstag");
  assert.equal(C.dayLong("2026-10-15"), "15. Oktober");
});

test("Mode Switch: the mode persists per device and survives missing or broken storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(C.readMode(storage), "list");
  C.writeMode(storage, "calendar");
  assert.equal(C.readMode(storage), "calendar");
  C.writeMode(storage, "bogus");
  assert.equal(C.readMode(storage), "calendar", "an invalid mode is not stored");
  store.set(C.MODE_KEY, "weird");
  assert.equal(C.readMode(storage), "list");
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(C.readMode(broken), "list");
  assert.doesNotThrow(() => C.writeMode(broken, "calendar"));
  assert.equal(C.readMode(null), "list");
});
