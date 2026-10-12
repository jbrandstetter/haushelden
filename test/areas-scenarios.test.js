// Governing: SPEC-0003 REQ "Areas of Responsibility" (Scenario: Assigning an owner, Scenario: Unowned area),
// REQ "Parents' Routines Today" (Scenario: Bins), REQ "Kids' Progress Glance" (Scenario: Homework done)
//
// Scenario-named tests for traceability (#28). Each one drives both parents' screens (`#/eltern`) and the areas
// editor (`#/bereiche`) end to end against one shared in-memory stand-in for the data layer, so a change made
// in one view shows in the other, like the live sync does.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const eltern = require("../app/js/screens/eltern.js");
const bereiche = require("../app/js/screens/bereiche.js");

const MON = "2026-10-12";
const TUE = "2026-10-13";
const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink", created: "2" },
  { id: "sohn", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach", created: "3" },
];

/** A shared in-memory data layer: writes apply to the rows and notify every subscriber, like live sync. */
function household(initial) {
  const rows = { members, todos: [], areas: [], routines: [], routine_done: [], ...initial };
  const subs = {};
  const notify = (c) => (subs[c] || []).forEach((cb) => cb(rows[c].slice()));
  let n = 0;
  return {
    rows,
    api: {
      subscribe(c, cb) {
        (subs[c] ||= []).push(cb);
        cb(rows[c].slice());
        return () => {};
      },
      async create(c, r) {
        rows[c].push({ id: `new${++n}`, ...r });
        notify(c);
      },
      async update(c, id, patch) {
        Object.assign(
          rows[c].find((x) => x.id === id),
          patch,
        );
        notify(c);
      },
      async delete(c, id) {
        rows[c] = rows[c].filter((x) => x.id !== id);
        notify(c);
      },
    },
  };
}
function mount(screen, hh, me, today = MON) {
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  screen(view, { data: hh.api, auth: { record: () => ({ member: me }) }, clock: { today: () => today } });
  return view;
}
const isMine = (view, id) =>
  view.querySelector(`[data-area-card="${id}"]`).className.split(" ").includes("mine");

test("Scenario: Assigning an owner - the card is highlighted for the owner and shows the avatar to the other parent", async () => {
  const hh = household({ areas: [{ id: "tech", emoji: "🖥️", name: "Technik & Smart Home", owner: "" }] });
  const papa = mount(eltern.screen, hh, "papa");
  const mama = mount(eltern.screen, hh, "mama");
  const editor = mount(bereiche.screen, hh, "papa");
  assert.ok(!isMine(papa, "tech"));

  editor.querySelector('[data-area-row="tech"] [data-owner="papa"]').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(isMine(papa, "tech"), "highlighted in the owner's view");
  assert.ok(!isMine(mama, "tech"), "not highlighted for the other parent");
  assert.match(mama.querySelector('[data-area-card="tech"]').textContent, /🧔 Test-Papa/);
});

test("Scenario: Unowned area - its card reads Wer ist zuständig?, and clearing the owner brings that back", async () => {
  const hh = household({ areas: [{ id: "auto", emoji: "🚗", name: "Auto", owner: "mama" }] });
  const papa = mount(eltern.screen, hh, "papa");
  const editor = mount(bereiche.screen, hh, "mama");
  assert.doesNotMatch(papa.querySelector('[data-area-card="auto"]').textContent, /Wer ist zuständig/);
  editor.querySelector('[data-area-row="auto"] [data-owner=""]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(papa.querySelector('[data-area-card="auto"]').textContent, /Wer ist zuständig\?/);
});

test("Selecting an area filters the to-do list to that area until cleared", () => {
  const hh = household({
    areas: [
      { id: "auto", emoji: "🚗", name: "Auto", owner: "" },
      { id: "haus", emoji: "🏠", name: "Haus & Garten", owner: "" },
    ],
    todos: [
      { id: "a", title: "Winterreifen", who: "papa", due: "", area: "auto", done: "" },
      { id: "b", title: "Rasen mähen", who: "papa", due: "", area: "haus", done: "" },
      { id: "c", title: "Ohne Bereich", who: "papa", due: "", area: "", done: "" },
    ],
  });
  const view = mount(eltern.screen, hh, "papa");
  const titles = () => view.querySelectorAll(".todos .tt").map((e) => e.textContent);
  assert.equal(titles().length, 3);
  view.querySelector('[data-area-card="auto"]').click();
  assert.deepEqual(titles(), ["Winterreifen"]);
  view.querySelector('[data-role="clear-area"]').click();
  assert.equal(titles().length, 3);
});

test("Scenario: Bins - assigned to both parents on Mondays, both see it on Monday under Routine heute and not on Tuesday", () => {
  const routines = [
    {
      id: "tonnen",
      emoji: "🗑️",
      title: "Mülltonnen rausstellen",
      who: "parents",
      days: ["0"],
      kind: "chore",
    },
  ];
  const hh = household({ routines });
  for (const me of ["papa", "mama"]) {
    const monday = mount(eltern.screen, hh, me, MON);
    assert.match(monday.querySelector('[data-role="routine-today"]').textContent, /Mülltonnen rausstellen/);
    const tuesday = mount(eltern.screen, hh, me, TUE);
    assert.equal(tuesday.querySelector('[data-role="routine-today"]'), null);
  }
});

test("Scenario: Bins - each parent ticks for themself; the other parent's row stays open", async () => {
  const routines = [
    {
      id: "tonnen",
      emoji: "🗑️",
      title: "Mülltonnen rausstellen",
      who: "parents",
      days: ["0"],
      kind: "chore",
    },
  ];
  const hh = household({ routines });
  const papa = mount(eltern.screen, hh, "papa");
  const mama = mount(eltern.screen, hh, "mama");
  papa.querySelector('[data-role="routine-check"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(hh.rows.routine_done, [{ id: "new1", routine: "tonnen", member: "papa", day: MON }]);
  assert.ok(papa.querySelector('[data-routine="tonnen"]').className.includes("done"));
  assert.ok(!mama.querySelector('[data-routine="tonnen"]').className.includes("done"));
});

test("Scenario: Homework done - the son's tick advances his bar in both parents' views", async () => {
  const hh = household({
    routines: [
      {
        id: "hausi",
        emoji: "📚",
        title: "Hausaufgaben",
        who: "member",
        member: "sohn",
        days: ["0"],
        kind: "chore",
      },
      { id: "zaehne", emoji: "🪥", title: "Zähne putzen", who: "kids", days: ["0"], kind: "chore" },
    ],
  });
  const views = ["papa", "mama"].map((me) => mount(eltern.screen, hh, me));
  const progress = (v) => v.querySelector('[data-kid="sohn"] [data-role="progress"]').textContent;
  assert.deepEqual(views.map(progress), ["0/2", "0/2"]);
  await hh.api.create("routine_done", { routine: "hausi", member: "sohn", day: MON }); // the iPad's tick
  assert.deepEqual(views.map(progress), ["1/2", "1/2"]);
  assert.match(views[0].querySelector('[data-kid="sohn"] i').getAttribute("style"), /width:50%/);
});
