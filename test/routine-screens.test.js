// Governing: ADR-0003, SPEC-0002 REQ "Routine Items", REQ "Routine Management", REQ "Alternating Assignment",
// REQ "Mascot Choice"
//
// Render tests for the two parent screens (routine editor, mascot picker) in a fake DOM, plus scenario-named
// tests of the due-for logic. Scenario names from SPEC-0002 appear in the test names.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeDocument } = require("./helpers/fake-dom.js");
const R = require("../app/js/routines.js");
const dates = require("../app/js/dates.js");

const SCREENS = path.join(__dirname, "..", "app", "js", "screens");

function loadScreens() {
  const document = createFakeDocument();
  const HH = { screens: {}, routines: R, dates };
  const context = vm.createContext({ HH, document });
  for (const f of ["routinen.js", "maskottchen.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SCREENS, f), "utf8"), context, { filename: f });
  }
  return { HH, document };
}

const member = (id, role, name, created) => ({ id, role, name, emoji: "🙂", colour: "blue", created });
const MEMBERS = [
  member("papa", "parent", "Test-Papa", "1"),
  member("mama", "parent", "Test-Mama", "2"),
  member("kind1", "kid", "Test-Kind-1", "3"),
  member("kind2", "kid", "Test-Kind-2", "4"),
];
const ROUTINES = [
  {
    id: "r1",
    emoji: "⚽",
    title: "Fußballtraining",
    hint: "Trinkflasche",
    time: "17:00",
    kind: "hobby",
    days: ["1", "3"],
    who: "member",
    member: "kind1",
    updated: "1",
  },
  {
    id: "r2",
    emoji: "🍽️",
    title: "Spülmaschine aus- & einräumen",
    hint: "",
    time: "",
    kind: "chore",
    days: ["0", "1", "2", "3", "4", "5", "6"],
    who: "kids_alternating",
    member: "",
    updated: "1",
  },
];

/** A data API stub: subscribe pushes the rows at once, writes are recorded. */
function stubData(rows) {
  const calls = [];
  const subs = {};
  const data = {
    calls,
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb(rows[c] || []);
      return () => {};
    },
    emit: (c, r) => subs[c].forEach((cb) => cb(r)),
    update: async (c, id, patch) => void calls.push(["update", c, id, patch]),
    create: async (c, rec) => void calls.push(["create", c, rec]),
    delete: async (c, id) => void calls.push(["delete", c, id]),
  };
  return data;
}
const parentCtx = (data) => ({ data, auth: { record: () => ({ collectionName: "parents" }) } });

test("routine editor renders every field and all assignment options for each routine", () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  HH.screens.routinen(view, parentCtx(stubData({ members: MEMBERS, routines: ROUTINES })));
  const cards = view.querySelectorAll(".rt-card");
  assert.equal(cards.length, 2);
  const card = cards[0];
  const find = (n, name) => {
    const hit = [];
    const walk = (x) => x.children.forEach((c) => (c.attrs && c.name === name ? hit.push(c) : null, walk(c)));
    walk(n);
    return hit[0];
  };
  for (const name of ["emoji", "title", "hint", "time", "kind", "assignment"])
    assert.ok(find(card, name), name);
  assert.equal(find(card, "title").value, "Fußballtraining");
  assert.equal(find(card, "time").value, "17:00");
  assert.deepEqual(
    find(card, "assignment").children.map((o) => o.value),
    ["kids", "kids_alternating", "member:kind1", "member:kind2", "parents", "member:papa", "member:mama"],
  );
  assert.equal(find(card, "assignment").value, "member:kind1");
  assert.deepEqual(
    find(card, "kind").children.map((o) => o.value),
    ["chore", "hobby"],
  );
  const days = card.querySelectorAll("[data-day]");
  assert.deepEqual(
    days.map((b) => b.textContent),
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  );
  assert.deepEqual(
    days.map((b) => b.getAttribute("aria-pressed")),
    ["false", "true", "false", "true", "false", "false", "false"],
  );
  assert.ok(view.textContent.includes("+ Aufgabe"));
});

test("routine editor: scenario Moving piano to Wednesday saves the new weekdays, ticks are not touched", async () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const data = stubData({ members: MEMBERS, routines: ROUTINES });
  HH.screens.routinen(view, parentCtx(data));
  const card = view.querySelectorAll(".rt-card")[0];
  const days = card.querySelectorAll("[data-day]");
  await days[1].click(); // Tuesday off
  await days[2].click(); // Wednesday on
  await card.dispatch("submit");
  assert.equal(data.calls.length, 1);
  const [op, collection, id, patch] = data.calls[0];
  assert.deepEqual([op, collection, id], ["update", "routines", "r1"]);
  assert.deepEqual(patch.days, ["2", "3"]);
  assert.equal(patch.who, "member");
  assert.equal(patch.member, "kind1");
  assert.ok(
    data.calls.every((c) => c[1] === "routines"),
    "routine_done is never written",
  );
});

test("routine editor: invalid input is shown and nothing is saved", async () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const data = stubData({ members: MEMBERS, routines: ROUTINES });
  HH.screens.routinen(view, parentCtx(data));
  const card = view.querySelectorAll(".rt-card")[0];
  const title = card.querySelectorAll("input")[1];
  title.value = "";
  await card.dispatch("submit");
  assert.equal(data.calls.length, 0);
  assert.match(card.querySelector('[data-error="title"]').textContent, /Titel/);
});

test("routine editor: delete needs a second click; add creates a routine; kid sessions get no editor", async () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const data = stubData({ members: MEMBERS, routines: ROUTINES });
  HH.screens.routinen(view, parentCtx(data));
  const del = view.querySelectorAll(".rt-card")[0].querySelectorAll(".btn")[1];
  await del.click();
  assert.equal(data.calls.length, 0);
  assert.equal(del.textContent, "Wirklich löschen?");
  await del.click();
  assert.deepEqual(data.calls[0], ["delete", "routines", "r1"]);

  const add = view.children.find((c) => c.textContent === "+ Aufgabe");
  await add.click();
  assert.equal(data.calls[1][0], "create");
  assert.equal(
    R.validateRoutine({ ...data.calls[1][2], assignment: "kids", days: data.calls[1][2].days }, MEMBERS).ok,
    true,
  );

  const kidView = document.createElement("main");
  const kidData = stubData({ members: MEMBERS, routines: ROUTINES });
  HH.screens.routinen(kidView, { data: kidData, auth: { record: () => ({ collectionName: "devices" }) } });
  assert.equal(kidView.querySelectorAll(".rt-card").length, 0);
  assert.match(kidView.textContent, /Nur Eltern/);
});

test("mascot picker shows at least eight animals and highlights the current one", () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const settings = [{ id: "s1", mascot: { emoji: "🦊", name: "Fuchsi" } }];
  HH.screens.maskottchen(view, parentCtx(stubData({ settings })));
  const pets = view.querySelectorAll("[data-pet]");
  assert.ok(pets.length >= 8);
  assert.deepEqual(
    pets.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.pet),
    ["🦊"],
  );
  assert.ok(
    pets.every((b) => b.getAttribute("aria-label")),
    "icon-only buttons carry a label",
  );
  assert.match(view.textContent, /🦊 Fuchsi/);
});

test("mascot picker: scenario Kids rename the mascot saves fox and Fuchsi in settings.mascot", async () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const data = stubData({ settings: [{ id: "s1", mascot: { emoji: "🐱", name: "Mochi" } }] });
  HH.screens.maskottchen(view, parentCtx(data));
  await view.querySelector('[data-pet="🦊"]').click();
  const save = view.querySelectorAll(".btn").find((b) => b.textContent === "Speichern");
  await save.click();
  assert.deepEqual(JSON.parse(JSON.stringify(data.calls)), [
    ["update", "settings", "s1", { mascot: { emoji: "🦊", name: "Fuchsi" } }],
  ]);
  assert.equal(R.mascotOf({ mascot: data.calls[0][3].mascot }).name, "Fuchsi");
});

test("mascot picker: an empty name is rejected", async () => {
  const { HH, document } = loadScreens();
  const view = document.createElement("main");
  const data = stubData({ settings: [{ id: "s1", mascot: { emoji: "🐱", name: "Mochi" } }] });
  HH.screens.maskottchen(view, parentCtx(data));
  const input = view.querySelectorAll("input")[0];
  input.value = "  ";
  const save = view.querySelectorAll(".btn").find((b) => b.textContent === "Speichern");
  await save.click();
  assert.equal(data.calls.length, 0);
  assert.match(view.textContent, /Namen/);
});

// ---- spec scenarios on the pure logic ------------------------------------------------------------------

const kidsAndParents = MEMBERS;
const dueDays = (routine, who, from, n) =>
  Array.from({ length: n }, (_, i) => dates.addDays(from, i)).filter((day) =>
    R.isDue(
      routine,
      kidsAndParents.find((m) => m.id === who),
      kidsAndParents,
      day,
    ),
  );

test("scenario Soccer twice a week: the son's board shows the tile on Tuesdays and Thursdays only, labelled 17:00 Uhr", () => {
  const soccer = ROUTINES[0];
  const days = dueDays(soccer, "kind1", "2026-10-12", 14);
  assert.deepEqual(
    days.map((d) => dates.WD[dates.weekdayOfKey(d)]),
    ["Di", "Do", "Di", "Do"],
  );
  assert.equal(R.tileTag(soccer), "17:00 Uhr");
  assert.deepEqual(dueDays(soccer, "kind2", "2026-10-12", 14), []);
});

test("scenario Moving piano to Wednesday: gone Tuesday, there Wednesday", () => {
  const piano = { id: "p", kind: "hobby", who: "member", member: "kind2", days: ["1"] };
  assert.equal(R.isDue(piano, MEMBERS[3], MEMBERS, "2026-10-13"), true);
  const moved = { ...piano, days: ["2"] };
  assert.equal(R.isDue(moved, MEMBERS[3], MEMBERS, "2026-10-13"), false);
  assert.equal(R.isDue(moved, MEMBERS[3], MEMBERS, "2026-10-14"), true);
});

test("scenario Dishwasher alternates: exactly one kid per day, the other the next day, same answer on every device", () => {
  const dw = ROUTINES[1];
  const turn = (day, list) =>
    R.kidsOf(list)
      .filter((k) => R.isDue(dw, k, list, day))
      .map((k) => k.id);
  for (let i = 0; i < 400; i++) {
    const day = dates.addDays("2026-01-01", i);
    const a = turn(day, MEMBERS);
    assert.equal(a.length, 1, day);
    assert.notDeepEqual(a, turn(dates.addDays(day, 1), MEMBERS));
    // another device with the members loaded in a different order and with extra server fields agrees
    assert.deepEqual(
      turn(
        day,
        [...MEMBERS].reverse().map((m) => ({ ...m, extra: 1 })),
      ),
      a,
    );
  }
  assert.equal(R.tileTag(dw), "Heute du");
});

test("alternation uses the household date: a UTC clock still on Monday late Monday evening does not shift the turn", () => {
  const dw = ROUTINES[1];
  const now = new Date("2026-10-12T22:30:00Z"); // Tuesday 00:30 in Berlin
  const day = dates.householdDay(now, "Europe/Berlin");
  assert.equal(day, "2026-10-13");
  const kid = R.alternatingKid(MEMBERS, day);
  assert.equal(R.isDue(dw, kid, MEMBERS, day), true);
});
