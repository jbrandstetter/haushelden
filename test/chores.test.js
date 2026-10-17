// Governing: SPEC-0010 REQ "Cleaning Day List", REQ "Ticking Off", REQ "Standard Chores", REQ "Starting a Cleaning Day",
// REQ "Assigning and Adding Chores", REQ "Cleaning Day on the Kid Board"
// The pure logic of the cleaning day (app/js/chores.js): which day to show, grouping, who may tick, building a day from
// the standard chores, the starter set and the "Putztag heute" text.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/js/chores.js");

const MEMBERS = [
  { id: "papa", role: "parent", name: "Test-Papa" },
  { id: "mama", role: "parent", name: "Test-Mama" },
  { id: "kind1", role: "kid", name: "Test-Kind-1" },
  { id: "kind2", role: "kid", name: "Test-Kind-2" },
];
const chore = (id, day, assignee, extra = {}) => ({
  id,
  day,
  title: `Aufgabe ${id}`,
  assignee,
  done: false,
  done_by: "",
  ...extra,
});

test("the day to open on: today, else the next cleaning day, else the latest past one", () => {
  const chores = [
    chore("a", "2026-10-03", "kind1"),
    chore("b", "2026-10-17", "kind1"),
    chore("c", "2026-10-24", "kind1"),
  ];
  assert.equal(C.defaultDay(chores, "2026-10-17"), "2026-10-17", "today is a cleaning day");
  assert.equal(C.defaultDay(chores, "2026-10-15"), "2026-10-17", "the next one");
  assert.equal(C.defaultDay(chores, "2026-10-30"), "2026-10-24", "the latest past one");
  assert.equal(C.defaultDay([], "2026-10-15"), null);
  assert.deepEqual(C.daysWithChores(chores), ["2026-10-03", "2026-10-17", "2026-10-24"]);
});

test("the new-day form opens on the next Saturday (today when it is Saturday)", () => {
  assert.equal(C.nextSaturday("2026-10-14"), "2026-10-17");
  assert.equal(C.nextSaturday("2026-10-17"), "2026-10-17");
  assert.equal(C.nextSaturday("2026-10-18"), "2026-10-24");
  assert.equal(C.dayHeading("2026-10-17"), "Samstag 17.10.");
});

test("groups: kids first, then parents, then the unassigned; a removed member's chores count as unassigned", () => {
  const chores = [
    chore("1", "d", "papa"),
    chore("2", "d", "kind2", { done: true, done_by: "kind2" }),
    chore("3", "d", ""),
    chore("4", "d", "kind1"),
    chore("5", "d", "gone"),
    chore("6", "other", "kind1"),
  ];
  const groups = C.groupsOfDay(chores, MEMBERS, "d");
  assert.deepEqual(
    groups.map((g) => g.key),
    ["kind1", "kind2", "papa", "mama", "none"],
  );
  assert.deepEqual(
    groups.find((g) => g.key === "none").chores.map((c) => c.id),
    ["3", "5"],
  );
  assert.deepEqual(
    groups.find((g) => g.key === "kind2"),
    { ...groups.find((g) => g.key === "kind2"), done: 1, total: 1 },
  );
  assert.equal(groups.find((g) => g.key === "mama").total, 0, "a member without chores is still listed");
  assert.equal(
    C.groupsOfDay([chore("1", "d", "kind1")], MEMBERS, "d").some((g) => g.key === "none"),
    false,
    "no empty unassigned group",
  );
  assert.equal(C.progressText(C.progress(chores.slice(0, 5))), "1 von 5 erledigt");
});

test("who may tick: parents anything; a kid only what is assigned to the chosen profile", () => {
  const mine = chore("1", "d", "kind1");
  assert.equal(C.canTick(mine, { parent: true, memberId: "papa" }), true);
  assert.equal(
    C.canTick(chore("2", "d", ""), { parent: true, memberId: "papa" }),
    true,
    "a parent may tick an unassigned chore",
  );
  assert.equal(C.canTick(mine, { parent: false, memberId: "kind1" }), true);
  assert.equal(C.canTick(mine, { parent: false, memberId: "kind2" }), false, "another kid's chore");
  assert.equal(
    C.canTick(chore("3", "d", "papa"), { parent: false, memberId: "kind1" }),
    false,
    "a parent's chore",
  );
  assert.equal(
    C.canTick(chore("4", "d", ""), { parent: false, memberId: "kind1" }),
    false,
    "an unassigned chore",
  );
  assert.equal(C.canTick(mine, { parent: false, memberId: null }), false, "no profile chosen yet");
  assert.equal(C.canManage({ parent: false, memberId: "kind1" }), false);
  assert.equal(C.canManage({ parent: true }), true);
});

test("a tap ticks and records who, or un-ticks and clears it", () => {
  assert.deepEqual(C.tickPatch(chore("1", "d", "kind1"), "kind1"), { done: true, done_by: "kind1" });
  assert.deepEqual(C.tickPatch(chore("1", "d", "kind1", { done: true, done_by: "kind1" }), "kind1"), {
    done: false,
    done_by: "",
  });
});

const T = (id, title, extra = {}) => ({
  id,
  title,
  kids: false,
  assignee: "",
  every_days: 0,
  sort: 0,
  ...extra,
});

test("starting a day: 'for each child' gives one chore per kid, a named member gets theirs, nobody stays unassigned", () => {
  const templates = [
    T("t1", "Bad saugen", { kids: true, sort: 1 }),
    T("t2", "Fenster", { assignee: "mama", sort: 2 }),
    T("t3", "Garage", { sort: 3 }),
    T("t4", "Weg", { assignee: "removed", sort: 4 }),
  ];
  const plan = C.planDay({ day: "2026-10-17", templates, chores: [], members: MEMBERS });
  assert.deepEqual(
    plan.creates.map((c) => [c.title, c.assignee, c.template]),
    [
      ["Bad saugen", "kind1", "t1"],
      ["Bad saugen", "kind2", "t1"],
      ["Fenster", "mama", "t2"],
      ["Garage", "", "t3"],
      ["Weg", "", "t4"],
    ],
  );
  assert.ok(plan.creates.every((c) => c.day === "2026-10-17" && c.done === false && c.done_by === ""));
  assert.deepEqual(
    plan.creates.map((c) => c.sort),
    [1, 2, 3, 4, 5],
    "in template order",
  );
  assert.equal(C.startMessage(plan), "5 Aufgaben angelegt.");
});

test("starting the same day twice adds only what is missing", () => {
  const templates = [
    T("t1", "Bad saugen", { kids: true, sort: 1 }),
    T("t2", "Fenster", { assignee: "mama", sort: 2 }),
  ];
  const first = C.planDay({ day: "d1", templates, chores: [], members: MEMBERS });
  const chores = first.creates.map((c, i) => ({ id: `c${i}`, ...c }));
  const again = C.planDay({ day: "d1", templates, chores, members: MEMBERS });
  assert.equal(again.creates.length, 0);
  assert.equal(again.existing, 3);
  assert.equal(C.startMessage(again), "Nichts Neues anzulegen. 3 gab es schon.");
  const partial = C.planDay({
    day: "d1",
    templates,
    chores: chores.filter((c) => c.assignee !== "kind2"),
    members: MEMBERS,
  });
  assert.deepEqual(
    partial.creates.map((c) => c.assignee),
    ["kind2"],
  );
  assert.ok(
    partial.creates[0].sort > Math.max(...chores.map((c) => c.sort)),
    "new chores sort after the existing ones",
  );
});

test("an interval chore is left out when it was done more recently than its interval, and comes back when it was not done", () => {
  const templates = [T("t1", "Filter reinigen", { assignee: "mama", every_days: 30, sort: 1 })];
  const done = { id: "c1", day: "2026-10-03", template: "t1", assignee: "mama", done: true };
  const tooSoon = C.planDay({ day: "2026-10-17", templates, chores: [done], members: MEMBERS });
  assert.equal(tooSoon.creates.length, 0);
  assert.equal(tooSoon.tooSoon, 1);
  assert.match(C.startMessage(tooSoon), /1 sind noch nicht wieder dran/);
  assert.equal(
    C.planDay({ day: "2026-11-02", templates, chores: [done], members: MEMBERS }).creates.length,
    1,
    "30 days later it is due",
  );
  const notDone = { ...done, done: false };
  assert.equal(
    C.planDay({ day: "2026-10-17", templates, chores: [notDone], members: MEMBERS }).creates.length,
    1,
    "undone chores come back",
  );
  assert.equal(
    C.planDay({ day: "2026-10-17", templates, chores: [{ ...done, day: "2026-10-24" }], members: MEMBERS })
      .creates.length,
    1,
    "a later cleaning day does not count for an earlier one",
  );
});

test("the starter set is Kathrin's checklist in German: seven for each child, eight each for the parents", () => {
  assert.equal(C.STARTER.kids.length, 7);
  assert.equal(C.STARTER.papa.length, 8);
  assert.equal(C.STARTER.mama.length, 8);
  const all = Object.values(C.STARTER).flat();
  assert.ok(all.every((c) => c.title.length <= C.MAX_TITLE && C.checkTitle(c.title) === ""));
  assert.ok(
    all.some((c) => /Staubsaugerfilter/.test(c.title) && c.every_days === 30),
    "the monthly one",
  );
  const t = C.starterTemplates({ papa: "p1", mama: "m1" });
  assert.equal(t.length, 23);
  assert.deepEqual(t.filter((x) => x.kids).length, 7);
  assert.ok(t.filter((x) => !x.kids && /Büro/.test(x.title)).every((x) => x.assignee === "p1"));
  assert.ok(t.filter((x) => /Handtücher/.test(x.title)).every((x) => x.assignee === "m1"));
  assert.deepEqual(new Set(t.map((x) => x.sort)).size, 23, "a sort number each");
  assert.equal(
    C.starterTemplates({}).every((x) => x.assignee === ""),
    true,
    "unmapped parents' chores are for nobody yet",
  );
});

test("titles: required, at most 80 characters, whitespace collapsed", () => {
  assert.match(C.checkTitle("   "), /schreib auf/);
  assert.match(C.checkTitle("x".repeat(81)), /80/);
  assert.equal(C.checkTitle("x".repeat(80)), "");
  assert.equal(C.clean("  Bad   putzen "), "Bad putzen");
});

test("labels for the standard chores", () => {
  assert.equal(C.forLabel(T("t", "x", { kids: true }), MEMBERS), "Jedes Kind");
  assert.equal(C.forLabel(T("t", "x", { assignee: "mama" }), MEMBERS), "Test-Mama");
  assert.equal(C.forLabel(T("t", "x"), MEMBERS), "Noch niemand");
  assert.equal(C.intervalLabel(0), "Bei jedem Putztag");
  assert.equal(C.intervalLabel(14), "Alle 2 Wochen");
  assert.equal(C.intervalLabel(30), "Monatlich");
  assert.equal(C.intervalLabel(21), "Alle 21 Tage");
});

test("'Putztag heute': nothing on a day without chores; own open chores for a kid; the day's progress for the chooser", () => {
  const chores = [
    chore("1", "d", "kind1"),
    chore("2", "d", "kind1", { done: true }),
    chore("3", "d", "kind1"),
    chore("4", "d", "papa"),
    chore("5", "d", "kind2", { done: true }),
  ];
  assert.equal(C.lineText(chores, "other", "kind1"), null);
  assert.equal(C.lineText(chores, "d", "kind1"), "Putztag heute: 2 von 3 deiner Aufgaben sind noch offen.");
  assert.equal(
    C.lineText([chore("1", "d", "kind1")], "d", "kind1"),
    "Putztag heute: 1 von 1 deiner Aufgaben ist noch offen.",
  );
  assert.equal(C.lineText(chores, "d", "kind2"), "Putztag: Du hast alles geschafft! 🎉");
  assert.match(C.lineText(chores, "d", "mama"), /keine eigene Aufgabe/);
  assert.equal(C.lineText(chores, "d", null), "Putztag heute: 2 von 5 erledigt.");
  assert.doesNotMatch(
    C.lineText(chores, "d", "kind1"),
    /Test-|kind2/,
    "no sibling comparison on a kid's line",
  );
});
