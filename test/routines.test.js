// Governing: ADR-0003, SPEC-0002 REQ "Routine Items", REQ "Alternating Assignment", REQ "Mascot Choice"
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../app/js/routines.js");
const d = require("../app/js/dates.js");

const m = (id, role, created) => ({ id, role, name: id, emoji: "🙂", created });
const members = [
  m("papa", "parent", "2026-01-01 10:00:00.000Z"),
  m("mama", "parent", "2026-01-01 10:00:01.000Z"),
  m("kind1", "kid", "2026-01-01 10:00:02.000Z"),
  m("kind2", "kid", "2026-01-01 10:00:03.000Z"),
];
const byId = Object.fromEntries(members.map((x) => [x.id, x]));
const all = ["0", "1", "2", "3", "4", "5", "6"];
const routine = (over) => ({
  id: "r",
  title: "T",
  kind: "chore",
  days: all,
  who: "kids",
  member: "",
  ...over,
});
const due = (r, who, day) => R.isDue(r, byId[who], members, day);

test("dueFor: assignment kinds", () => {
  const day = "2026-10-12"; // Monday
  assert.deepEqual(
    [...members].filter((x) => due(routine({ who: "kids" }), x.id, day)).map((x) => x.id),
    ["kind1", "kind2"],
  );
  assert.deepEqual(
    [...members].filter((x) => due(routine({ who: "parents" }), x.id, day)).map((x) => x.id),
    ["papa", "mama"],
  );
  for (const id of ["papa", "kind1"]) {
    const only = members
      .filter((x) => due(routine({ who: "member", member: id }), x.id, day))
      .map((x) => x.id);
    assert.deepEqual(only, [id]);
  }
});

test("dueFor: only on the routine's weekdays (Monday = 0), strings or numbers", () => {
  const soccer = routine({ days: ["1", "3"], who: "member", member: "kind1", kind: "hobby" });
  const week = [
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ];
  assert.deepEqual(
    week.map((k) => due(soccer, "kind1", k)),
    [false, true, false, true, false, false, false],
  );
  assert.equal(due({ ...soccer, days: [1, 3] }, "kind1", "2026-10-13"), true);
  assert.equal(due({ ...soccer, days: undefined }, "kind1", "2026-10-13"), false);
  assert.deepEqual(
    R.dueFor([soccer, routine({ id: "x" })], byId.kind1, members, "2026-10-13").map((r) => r.id),
    ["r", "x"],
  );
});

test("alternation: exactly one kid per day, the other the next day, parents never", () => {
  const dw = routine({ who: "kids_alternating" });
  let day = "2026-01-01";
  let previous = null;
  for (let i = 0; i < 800; i++) {
    const kids = ["kind1", "kind2"].filter((id) => due(dw, id, day));
    assert.equal(kids.length, 1, day);
    assert.notEqual(kids[0], previous, `${day} must differ from the day before`);
    assert.equal(due(dw, "papa", day) || due(dw, "mama", day), false);
    previous = kids[0];
    day = d.addDays(day, 1);
  }
});

test("alternation: kids[dayNumber mod kidCount], kids ordered by creation, independent of list order", () => {
  const day = "2026-10-12";
  const n = d.dayNumber(day);
  const kids = R.kidsOf([...members].reverse());
  assert.deepEqual(
    kids.map((k) => k.id),
    ["kind1", "kind2"],
  );
  assert.equal(R.alternatingKid([...members].reverse(), day).id, kids[n % 2].id);
  const three = [...members, m("kind3", "kid", "2026-01-01 10:00:04.000Z")];
  for (let i = 0; i < 9; i++) {
    const k = d.addDays(day, i);
    assert.equal(R.alternatingKid(three, k).id, R.kidsOf(three)[d.dayNumber(k) % 3].id);
  }
  assert.equal(
    R.alternatingKid(
      members.filter((x) => x.role === "parent"),
      day,
    ),
    null,
  );
  assert.equal(
    R.isDue(
      routine({ who: "kids_alternating" }),
      byId.kind1,
      members.filter((x) => x.role === "parent"),
      day,
    ),
    false,
  );
});

test("alternation: only on days the routine occurs", () => {
  const dw = routine({ who: "kids_alternating", days: ["5"] }); // Saturday
  assert.equal(["kind1", "kind2"].filter((id) => due(dw, id, "2026-10-16")).length, 0);
  assert.equal(["kind1", "kind2"].filter((id) => due(dw, id, "2026-10-17")).length, 1);
});

test("tileTag: 'Heute du' for alternating, time for hobbies", () => {
  assert.equal(R.tileTag(routine({ who: "kids_alternating" })), "Heute du");
  assert.equal(R.tileTag(routine({ kind: "hobby", time: "17:00" })), "17:00 Uhr");
  assert.equal(R.tileTag(routine({ kind: "hobby", time: "" })), "Hobby");
  assert.equal(R.tileTag(routine()), "");
});

test("validateRoutine: normalises and rejects bad input", () => {
  const form = {
    emoji: " ⚽ ",
    title: " Training ",
    hint: "",
    time: "17:00",
    kind: "hobby",
    days: [3, 1, 1],
    assignment: "member:kind1",
  };
  const ok = R.validateRoutine(form, members);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.record, {
    emoji: "⚽",
    title: "Training",
    hint: "",
    time: "17:00",
    kind: "hobby",
    days: ["1", "3"],
    who: "member",
    member: "kind1",
  });
  for (const bad of [
    { title: "" },
    { emoji: "" },
    { time: "25:00" },
    { kind: "other" },
    { days: [7] },
    { assignment: "member:nobody" },
    { assignment: "everyone" },
    { title: "x".repeat(81) },
  ]) {
    assert.equal(R.validateRoutine({ ...form, ...bad }, members).ok, false, JSON.stringify(bad));
  }
  assert.equal(
    R.validateRoutine({ ...form, days: [] }, members).ok,
    true,
    "a routine without weekdays is allowed",
  );
});

test("assignment options and round trip", () => {
  const opts = R.assignmentOptions(members);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["kids", "kids_alternating", "member:kind1", "member:kind2", "parents", "member:papa", "member:mama"],
  );
  for (const o of opts) assert.ok(R.parseAssignment(o.value));
  assert.equal(R.assignmentValue(routine({ who: "member", member: "kind2" })), "member:kind2");
  assert.equal(R.assignmentLabel(routine({ who: "kids_alternating" }), members), "Kinder im Wechsel");
});

test("mascot: at least eight animals, validation, tolerant read", () => {
  assert.ok(R.MASCOTS.length >= 8);
  assert.equal(new Set(R.MASCOTS.map((x) => x.emoji)).size, R.MASCOTS.length);
  assert.deepEqual(R.validateMascot({ emoji: "🦊", name: " Fuchsi " }).mascot, {
    emoji: "🦊",
    name: "Fuchsi",
  });
  assert.equal(R.validateMascot({ emoji: "💥", name: "X" }).ok, false);
  assert.equal(R.validateMascot({ emoji: "🦊", name: "  " }).ok, false);
  assert.equal(R.validateMascot({ emoji: "🦊", name: "x".repeat(25) }).ok, false);
  assert.deepEqual(R.mascotOf({ mascot: { emoji: "🦊", name: "Fuchsi" } }), { emoji: "🦊", name: "Fuchsi" });
  assert.deepEqual(R.mascotOf({ mascot: { pet: "fox" } }), R.DEFAULT_MASCOT);
  assert.deepEqual(R.mascotOf(undefined), R.DEFAULT_MASCOT);
});
