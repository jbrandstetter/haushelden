// Governing: SPEC-0002 REQ "Today Board", REQ "Tomorrow Preview", REQ "Week Strip and Streak", REQ "Mascot
// Feedback", REQ "No Competitive or Reward Mechanics by Default"
//
// Unit tests of the kid board's pure logic (app/js/board.js). Dates are household-day strings. The 2026-10 days
// used: Mon 12, Tue 13, Wed 14, Thu 15, Fri 16, Sat 17, Sun 18.
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../app/js/board.js");

const kid1 = { id: "k1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "blue", created: "3" };
const kid2 = { id: "k2", role: "kid", name: "Test-Kind-2", emoji: "🎹", colour: "pink", created: "4" };
const papa = { id: "p1", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "teal", created: "1" };
const members = [papa, kid1, kid2];
const ALL = ["0", "1", "2", "3", "4", "5", "6"];
const routine = (o) => ({
  id: o.id,
  emoji: "📝",
  title: o.id,
  hint: "",
  time: "",
  kind: "chore",
  days: ALL,
  who: "kids",
  member: "",
  ...o,
});
const tick = (r, member, day) => ({ id: `${r}-${member}-${day}`, routine: r, member, day });
const MON = "2026-10-12";
const THU = "2026-10-15";
const FRI = "2026-10-16";
const SAT = "2026-10-17";
const SUN = "2026-10-18";

test("dayProgress counts only the member's own ticks of due routines", () => {
  const routines = [routine({ id: "a" }), routine({ id: "b" }), routine({ id: "c", who: "parents" })];
  const ticks = [tick("a", "k1", MON), tick("a", "k2", MON), tick("c", "k1", MON), tick("b", "k1", SUN)];
  assert.deepEqual(B.dayProgress({ routines, member: kid1, members, ticks, day: MON }), {
    total: 2,
    done: 1,
  });
  assert.deepEqual(B.dayProgress({ routines, member: kid2, members, ticks, day: MON }), {
    total: 2,
    done: 1,
  });
});

test("a day without due items has total 0 and status none", () => {
  const routines = [routine({ id: "a", days: ["0"] })];
  const p = B.dayProgress({ routines, member: kid1, members, ticks: [], day: SAT });
  assert.deepEqual(p, { total: 0, done: 0 });
  assert.equal(B.dayStatus(p), "none");
});

test("findTick finds the record an un-tick deletes, only for that routine, member and day", () => {
  const ticks = [tick("a", "k1", MON), tick("a", "k2", MON)];
  assert.equal(B.findTick(ticks, "a", "k1", MON).id, "a-k1-" + MON);
  assert.equal(B.findTick(ticks, "a", "k1", SUN), undefined);
  assert.equal(B.findTick(ticks, "b", "k1", MON), undefined);
});

test("week strip runs Monday to Sunday with one marker per day (all done / partly / nothing / no items)", () => {
  const routines = [
    routine({ id: "a", days: ["0", "1", "2", "3", "4"] }),
    routine({ id: "b", days: ["0", "1", "2"] }),
  ];
  const ticks = [
    tick("a", "k1", "2026-10-12"),
    tick("b", "k1", "2026-10-12"), // Mon: all done
    tick("a", "k1", "2026-10-13"), // Tue: partly
    // Wed: nothing done
    // Thu (today, 2 -> 1 item): nothing yet
  ];
  const strip = B.weekStrip({ routines, member: kid1, members, ticks, today: THU });
  assert.deepEqual(
    strip.map((d) => d.label),
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  );
  assert.deepEqual(
    strip.map((d) => d.day),
    ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
  );
  assert.deepEqual(
    strip.map((d) => d.status),
    ["full", "part", "empty", "empty", "empty", "none", "none"],
  );
  assert.deepEqual(
    strip.map((d) => d.isToday),
    [false, false, false, true, false, false, false],
  );
  assert.deepEqual(
    strip.map((d) => d.future),
    [false, false, false, false, true, true, true],
  );
});

test("week strip on a Sunday still starts on that week's Monday", () => {
  const strip = B.weekStrip({ routines: [], member: kid1, members, ticks: [], today: SUN });
  assert.equal(strip[0].day, MON);
  assert.equal(strip[6].day, SUN);
  assert.equal(strip[6].isToday, true);
});

// ---- streak -------------------------------------------------------------------------------------------------
const prog = (map) => (day) => map[day] || { total: 0, done: 0 };
const full = { total: 2, done: 2 };

test("Scenario: Weekend without tasks - Thursday and Friday done, no items Saturday, Sunday done -> streak 3", () => {
  const p = prog({ [THU]: full, [FRI]: full, [SUN]: { total: 1, done: 1 } });
  assert.equal(B.streakOf(p, SUN), 3);
});

test("streak: days without items neither break nor extend it", () => {
  const p = prog({ [THU]: full, [FRI]: full }); // Saturday and Sunday empty
  assert.equal(B.streakOf(p, SUN), 2);
  assert.equal(B.streakOf(prog({}), SUN), 0);
});

test("streak: an unfinished today does not break it yet, a complete today counts once", () => {
  const before = prog({ [THU]: full, [FRI]: full, [SAT]: { total: 2, done: 1 } });
  assert.equal(B.streakOf(before, SAT), 2);
  const after = prog({ [THU]: full, [FRI]: full, [SAT]: full });
  assert.equal(B.streakOf(after, SAT), 3);
});

test("streak: a missed earlier day ends it", () => {
  const p = prog({ [THU]: { total: 2, done: 1 }, [FRI]: full, [SAT]: full });
  assert.equal(B.streakOf(p, SAT), 2);
});

test("streak: yesterday incomplete means zero even with a complete day before", () => {
  const p = prog({ [THU]: full, [FRI]: { total: 2, done: 0 } });
  assert.equal(B.streakOf(p, SAT), 0);
});

test("streak from collections matches the scenario (Weekend without tasks)", () => {
  const routines = [routine({ id: "a", days: ["0", "1", "2", "3", "4", "6"] })];
  const ticks = [tick("a", "k1", THU), tick("a", "k1", FRI), tick("a", "k1", SUN)];
  assert.equal(B.streak({ routines, member: kid1, members, ticks, today: SUN }), 3);
});

// ---- tomorrow -----------------------------------------------------------------------------------------------
test("Scenario: Riding tomorrow - the Morgen note lists tomorrow's hobby with its hint, not chores", () => {
  const routines = [
    routine({
      id: "riding",
      title: "Reiten",
      hint: "Reithelm & Stiefel",
      kind: "hobby",
      days: ["3"],
      who: "member",
      member: "k2",
    }),
    routine({ id: "chore", days: ALL }),
  ];
  const tomorrow = B.tomorrowHobbies({ routines, member: kid2, members, today: "2026-10-14" });
  assert.deepEqual(
    tomorrow.map((r) => [r.title, r.hint]),
    [["Reiten", "Reithelm & Stiefel"]],
  );
  assert.deepEqual(B.tomorrowHobbies({ routines, member: kid1, members, today: "2026-10-14" }), []);
});

// ---- speech cadence -----------------------------------------------------------------------------------------
function session(randoms, completeAt) {
  // Simulates ticks in a row; returns which ticks spoke. completeAt = number of the completing tick.
  let silentRun = 0;
  const out = [];
  randoms.forEach((r, i) => {
    const d = B.speechDecision({
      firstOfDay: i === 0,
      completed: i + 1 === completeAt,
      silentRun,
      random: () => r,
    });
    silentRun = d.silentRun;
    out.push(d.speak);
  });
  return out;
}

test("Scenario: five ticks in a row - speaks on the first, stays silent on at least one of the next three, speaks on the last", () => {
  // Worst case for silence: the chance always hits.
  const eager = session([0, 0, 0, 0, 0], 5);
  assert.equal(eager[0], true);
  assert.ok(eager.slice(1, 4).includes(false));
  assert.equal(eager[4], true);
  // And with the chance never hitting.
  const quiet = session([0.99, 0.99, 0.99, 0.99, 0.99], 5);
  assert.deepEqual(quiet, [true, false, false, false, true]);
});

test("the mascot never speaks on every tick and never on two ordinary ticks in a row", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 200; run++) {
    let silentRun = 0;
    let previous = true; // the first tick speaks
    for (let i = 0; i < 12; i++) {
      const d = B.speechDecision({ firstOfDay: i === 0, completed: false, silentRun, random: rnd });
      if (i > 0) assert.ok(!(previous && d.speak), "two spoken ordinary ticks in a row");
      previous = d.speak;
      silentRun = d.silentRun;
    }
  }
});

test("roughly one in three ordinary ticks speaks", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let silentRun = 0;
  let spoken = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const d = B.speechDecision({ firstOfDay: false, completed: false, silentRun, random: rnd });
    silentRun = d.silentRun;
    if (d.speak) spoken++;
  }
  const rate = spoken / N;
  assert.ok(rate > 0.25 && rate < 0.45, `rate ${rate}`);
});

test("completion always speaks, whatever the dice and the silent run", () => {
  const d = B.speechDecision({ firstOfDay: false, completed: true, silentRun: 0, random: () => 0.99 });
  assert.equal(d.speak, true);
  assert.equal(d.silentRun, 0);
});

test("speech text turns dashes into commas so the voice pauses", () => {
  assert.equal(B.speechText("Tasche gepackt – super"), "Tasche gepackt , super");
});

// ---- lines (built-in pool) ------------------------------------------------------------------------------------
test("Scenario: no approved lines for today - the built-in fallback pool is used", () => {
  assert.equal(B.approvedLines("k1", MON), null); // v1: the seam returns nothing
  assert.deepEqual(B.linePool("tick", null), B.LINES.tick);
  assert.deepEqual(B.linePool("tick", { tick: [] }), B.LINES.tick);
  assert.deepEqual(B.linePool("tick", { tick: ["Gut!"] }), ["Gut!"]);
});

test("fill replaces {name} and {streak}; pick stays inside the pool", () => {
  assert.equal(
    B.fill("Hallo {name}, {streak} Tage", { name: "Test-Kind-1", streak: 4 }),
    "Hallo Test-Kind-1, 4 Tage",
  );
  assert.equal(
    B.pick(["a", "b"], () => 0.9999),
    "b",
  );
  assert.equal(
    B.pick(["a", "b"], () => 0),
    "a",
  );
});

test("tick lines: the last remaining item, halftime and the routine's own topic", () => {
  const vars = { name: "Test-Kind-1", streak: 0 };
  const hobby = routine({ id: "h", kind: "hobby", title: "Fußball" });
  const first = (pool) => pool[0];
  const rnd = () => 0;
  assert.equal(
    B.tickLine({ routine: hobby, progress: { total: 4, done: 3 }, vars, random: rnd }),
    B.fill(first(B.LINES.last), vars),
  );
  assert.equal(
    B.tickLine({ routine: hobby, progress: { total: 4, done: 2 }, vars, random: rnd }),
    first(B.LINES.half),
  );
  assert.equal(
    B.tickLine({ routine: hobby, progress: { total: 5, done: 1 }, vars, random: rnd }),
    first(B.LINES.hobby),
  );
  assert.equal(B.routineTrigger(routine({ id: "x", title: "Hausaufgaben" })), "homework");
  assert.equal(B.routineTrigger(routine({ id: "x", title: "Schultasche packen" })), "bag");
  assert.equal(B.routineTrigger(routine({ id: "x", title: "Spülmaschine" })), "dishes");
});

test("celebration line uses the streak pool only for streaks longer than one day", () => {
  const vars = { name: "Test-Kind-1" };
  const streakLine = B.celebrationLine({ streak: 3, vars, random: () => 0 });
  assert.match(streakLine, /3/);
  assert.ok(B.LINES.streak.some((l) => B.fill(l, { ...vars, streak: 3 }) === streakLine));
  const plain = B.celebrationLine({ streak: 1, vars, random: () => 0 });
  assert.ok(B.LINES.allDone.some((l) => B.fill(l, vars) === plain));
});

test("opening line: greeting by hour on the first visit, free-day and done lines afterwards", () => {
  const vars = { name: "Test-Kind-1" };
  assert.equal(B.greetingTrigger(8), "greetMorning");
  assert.equal(B.greetingTrigger(13), "greetDay");
  assert.equal(B.greetingTrigger(19), "greetEvening");
  const rnd = () => 0;
  const free = B.openingLine({
    progress: { total: 0, done: 0 },
    hour: 9,
    firstVisit: false,
    vars,
    random: rnd,
  });
  assert.equal(free, B.fill(B.LINES.free[0], vars));
  const done = B.openingLine({
    progress: { total: 2, done: 2 },
    hour: 9,
    firstVisit: false,
    vars,
    random: rnd,
  });
  assert.equal(done, B.fill(B.LINES.allDone[0], vars));
});

test("the pool and the logic offer no points, rankings or sibling comparison (SPEC-0002 no competitive mechanics)", () => {
  const text = JSON.stringify(B.LINES).toLowerCase();
  for (const word of ["punkte", "rang", "platz", "gewinn", "bruder", "schwester", "besser als"]) {
    assert.ok(!text.includes(word), `line pool mentions ${word}`);
  }
  assert.deepEqual(
    Object.keys(B).filter((k) => /rank|score|point|prize|compare/i.test(k)),
    [],
  );
});
