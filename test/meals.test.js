// Governing: SPEC-0009 REQ "Week View", REQ "Plan Entries", REQ "Dish Library", REQ "Thumbs Up and Down",
// REQ "Copy and Clear", REQ "What Is for Dinner Today", REQ "Ingredients to the Shopping List"
// The pure logic of the meal plan (app/js/meals.js) and the "Heute" line on a fake DOM.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const M = require("../app/js/meals.js");

const dish = (id, name, last_planned = "", extra = {}) => ({ id, name, last_planned, emoji: "🍝", ...extra });
const entry = (id, date, slot, title, extra = {}) => ({
  id,
  date,
  slot,
  title,
  dish: "",
  added_by: "papa",
  ...extra,
});

test("a week runs Monday to Sunday and is computed from dates", () => {
  assert.equal(M.weekStart("2026-10-14"), "2026-10-12", "Wednesday -> Monday");
  assert.equal(M.weekStart("2026-10-12"), "2026-10-12");
  assert.equal(M.weekStart("2026-10-18"), "2026-10-12", "Sunday belongs to the week before Monday");
  assert.equal(M.weekStart("2026-11-01"), "2026-10-26", "across a month end");
  assert.deepEqual(M.weekDays("2026-10-26"), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
  assert.equal(M.shiftWeek("2026-10-12", 1), "2026-10-19");
  assert.equal(M.shiftWeek("2026-12-28", 1), "2027-01-04", "across a year end");
  assert.ok(M.inWeek("2026-10-18", "2026-10-12"));
  assert.ok(!M.inWeek("2026-10-19", "2026-10-12"));
});

test("week label: ISO calendar week and the dates", () => {
  assert.equal(M.weekLabel("2026-11-02"), "KW 45 · 2.11. – 8.11.");
  assert.equal(M.isoWeek("2026-12-28"), 53);
  assert.equal(M.isoWeek("2027-01-04"), 1);
  assert.equal(M.dayHeading("2026-10-14"), "Mittwoch 14.10.");
});

test("rotation: never planned first, then the longest ago; thumbs down hides nothing", () => {
  const dishes = [
    dish("a", "Spaghetti", "2026-10-13"),
    dish("b", "Pizza", "2026-09-01"),
    dish("c", "Suppe", ""),
    dish("d", "Auflauf", ""),
  ];
  assert.deepEqual(
    M.rotation(dishes).map((d) => d.id),
    ["d", "c", "b", "a"],
    "never planned (by name), then oldest",
  );
  assert.equal(M.rotation(dishes).length, 4);
});

test("labels: zuletzt vor N Tagen, never, today, planned ahead", () => {
  const today = "2026-10-14";
  assert.equal(M.lastPlannedLabel(dish("a", "A", "2026-09-23"), today), "zuletzt vor 21 Tagen");
  assert.equal(M.lastPlannedLabel(dish("a", "A", "2026-10-13"), today), "zuletzt vor 1 Tag");
  assert.equal(M.lastPlannedLabel(dish("a", "A", "2026-10-14"), today), "heute geplant");
  assert.equal(M.lastPlannedLabel(dish("a", "A", "2026-10-16"), today), "geplant am 16.10.");
  assert.equal(M.lastPlannedLabel(dish("a", "A", ""), today), "noch nie geplant");
});

test("suggestions match what is typed, in rotation order, and a free text matches nothing", () => {
  const dishes = [
    dish("a", "Spaghetti Bolognese", "2026-10-13"),
    dish("b", "Spaghetti Carbonara", "2026-08-01"),
  ];
  const s = M.suggest(dishes, " spaghetti ", "2026-10-14");
  assert.deepEqual(
    s.map((x) => x.dish.id),
    ["b", "a"],
  );
  assert.equal(s[0].label, "zuletzt vor 74 Tagen");
  assert.equal(M.suggest(dishes, "", "2026-10-14").length, 2, "nothing typed lists everything");
  assert.deepEqual(M.suggest(dishes, "Pizza", "2026-10-14"), []);
  assert.equal(M.findDish(dishes, "  spaghetti   carbonara ").id, "b");
  assert.equal(M.findDish(dishes, "Spaghetti"), null, "only an exact name links the dish");
});

test("input checks: titles, notes, dishes and ingredient limits", () => {
  assert.match(M.checkEntry({ title: "  ", note: "" }), /Schreib/);
  assert.match(M.checkEntry({ title: "x".repeat(81), note: "" }), /80/);
  assert.match(M.checkEntry({ title: "ok", note: "y".repeat(201) }), /200/);
  assert.equal(M.checkEntry({ title: "x".repeat(80), note: "y".repeat(200) }), "");
  assert.match(M.checkDish({ name: "", ingredients: "" }), /Namen/);
  assert.match(M.checkDish({ name: "Reis", ingredients: Array(41).fill("a").join("\n") }), /40/);
  assert.match(M.checkDish({ name: "Reis", ingredients: "x".repeat(61) }), /60/);
  assert.equal(M.checkDish({ name: "Reis", ingredients: Array(40).fill("x".repeat(60)).join("\n") }), "");
  assert.deepEqual(M.ingredientLines(" Reis \n\n  rote   Zwiebeln \r\n"), ["Reis", "rote Zwiebeln"]);
});

test("who may change what: parents everything, a child only their own", () => {
  const parentEntry = entry("e1", "2026-10-14", "dinner", "Pizza", { added_by: "mama" });
  const kidEntry = entry("e2", "2026-10-15", "dinner", "Nudeln", { added_by: "kind1" });
  const parent = { parent: true, memberId: "papa" };
  const kid1 = { parent: false, memberId: "kind1" };
  const kid2 = { parent: false, memberId: "kind2" };
  assert.ok(M.canChange(parentEntry, parent) && M.canChange(kidEntry, parent));
  assert.ok(M.canChange(kidEntry, kid1));
  assert.ok(!M.canChange(parentEntry, kid1), "a parent's entry is read-only for kids");
  assert.ok(!M.canChange(kidEntry, kid2), "so is another child's");
  assert.ok(!M.canChange(kidEntry, { parent: false, memberId: null }), "no profile chosen yet");
});

test("votes: one per member and entry; same value takes it back, the other value changes it", () => {
  const votes = [
    { id: "v1", entry: "e1", member: "mama", value: "up" },
    { id: "v2", entry: "e1", member: "kind1", value: "down" },
    { id: "v3", entry: "e2", member: "mama", value: "up" },
  ];
  assert.deepEqual(M.tally(votes, "e1"), { up: ["mama"], down: ["kind1"] });
  assert.deepEqual(M.voteAction(votes, "e1", "kind2", "up"), {
    op: "create",
    data: { entry: "e1", member: "kind2", value: "up" },
  });
  assert.deepEqual(M.voteAction(votes, "e1", "mama", "up"), { op: "delete", id: "v1" });
  assert.deepEqual(M.voteAction(votes, "e1", "mama", "down"), {
    op: "update",
    id: "v1",
    patch: { value: "down" },
  });
  const entries = [
    entry("e1", "2026-10-14", "dinner", "Pizza", { dish: "d1" }),
    entry("e2", "2026-10-15", "dinner", "Pizza", { dish: "d1" }),
  ];
  assert.deepEqual(M.dishTally(entries, votes, "d1"), { up: 2, down: 1 }, "all entries of the dish");
  assert.deepEqual(M.dishTally(entries, votes, "other"), { up: 0, down: 0 });
});

test("castVote writes through the data API", async () => {
  const calls = [];
  const data = {
    create: async (...a) => calls.push(["create", ...a]),
    update: async (...a) => calls.push(["update", ...a]),
    delete: async (...a) => calls.push(["delete", ...a]),
  };
  const votes = [{ id: "v1", entry: "e1", member: "mama", value: "up" }];
  await M.castVote(data, votes, "e1", "kind1", "up");
  await M.castVote(data, votes, "e1", "mama", "down");
  await M.castVote(data, votes, "e1", "mama", "up");
  assert.deepEqual(calls, [
    ["create", "meal_votes", { entry: "e1", member: "kind1", value: "up" }],
    ["update", "meal_votes", "v1", { value: "down" }],
    ["delete", "meal_votes", "v1"],
  ]);
});

test("copy onto an empty week copies every entry to the same weekday and asks nothing", () => {
  const entries = [
    entry("a", "2026-10-12", "dinner", "Pizza", { dish: "d1", cook: "papa", note: "scharf" }),
    entry("b", "2026-10-18", "lunch", "Suppe"),
  ];
  const plan = M.copyPlan({
    entries,
    fromStart: "2026-10-12",
    toStart: "2026-10-19",
    mode: "fill",
    actorId: "mama",
  });
  assert.equal(plan.conflicts, 0);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.creates, [
    {
      date: "2026-10-19",
      slot: "dinner",
      title: "Pizza",
      dish: "d1",
      cook: "papa",
      note: "scharf",
      added_by: "mama",
    },
    { date: "2026-10-25", slot: "lunch", title: "Suppe", dish: "", cook: "", note: "", added_by: "mama" },
  ]);
});

test("copy onto a week with entries: fill keeps them, replace overwrites only the slots the source fills", () => {
  const entries = [
    entry("a", "2026-10-12", "dinner", "Pizza"),
    entry("b", "2026-10-13", "dinner", "Suppe"),
    entry("x", "2026-10-19", "dinner", "Nudeln", { added_by: "kind1" }),
    entry("y", "2026-10-21", "lunch", "Reste"),
    entry("z", "2026-10-20", "dinner", "Suppe"),
  ];
  const base = { entries, fromStart: "2026-10-12", toStart: "2026-10-19", actorId: "mama" };
  const fill = M.copyPlan({ ...base, mode: "fill" });
  assert.equal(fill.conflicts, 2);
  assert.deepEqual(fill.creates, [], "both slots are taken");
  assert.deepEqual(fill.deletes, []);
  const replace = M.copyPlan({ ...base, mode: "replace" });
  assert.deepEqual(
    replace.deletes,
    ["x"],
    "Nudeln is replaced; the identical Suppe is left alone with its votes",
  );
  assert.deepEqual(
    replace.creates.map((c) => [c.date, c.title, c.added_by]),
    [["2026-10-19", "Pizza", "mama"]],
  );
  assert.equal(replace.skipped, 1);
});

test("clearing a week lists exactly the entries of that week", () => {
  const entries = [
    entry("a", "2026-10-12", "dinner", "A"),
    entry("b", "2026-10-18", "lunch", "B"),
    entry("c", "2026-10-19", "lunch", "C"),
  ];
  assert.deepEqual(M.clearPlan(entries, "2026-10-12"), ["a", "b"]);
});

test("today's meals: lunch before dinner, only today", () => {
  const entries = [
    entry("d", "2026-10-14", "dinner", "Pizza"),
    entry("l", "2026-10-14", "lunch", "Suppe"),
    entry("x", "2026-10-15", "lunch", "Morgen"),
  ];
  assert.deepEqual(
    M.todaysMeals(entries, "2026-10-14").map((e) => e.id),
    ["l", "d"],
  );
  assert.deepEqual(M.todaysMeals(entries, "2026-10-16"), []);
});

test("the ingredient result is worded for added, existing, repeated and empty", () => {
  assert.equal(
    M.shoppingMessage({ added: 3, existing: 2 }),
    "3 Zutaten neu auf der Einkaufsliste, 2 standen schon drauf.",
  );
  assert.equal(
    M.shoppingMessage({ added: 1, existing: 1 }),
    "1 Zutat neu auf der Einkaufsliste, 1 stand schon drauf.",
  );
  assert.equal(M.shoppingMessage({ added: 2, existing: 0 }), "2 Zutaten neu auf der Einkaufsliste.");
  assert.match(
    M.shoppingMessage({ added: 0, existing: 5 }),
    /Nichts Neues: alle 5 Zutaten stehen schon auf der Liste/,
  );
  assert.match(M.shoppingMessage({ added: 0, existing: 0 }), /Keine Zutaten/);
});

test("requestShopping posts the body with the token and maps failures to messages", async () => {
  const calls = [];
  const reply = (status, json) => async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => json };
  };
  const ok = await M.requestShopping({
    fetchImpl: reply(200, { added: 2, existing: 1 }),
    token: "t",
    body: { dish: "d1" },
  });
  assert.deepEqual(ok, { ok: true, added: 2, existing: 1 });
  assert.equal(calls[0].url, "/api/hh/mealplan/shopping");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "t");
  assert.deepEqual(JSON.parse(calls[0].init.body), { dish: "d1" });
  const forbidden = await M.requestShopping({ fetchImpl: reply(403, {}), token: "t", body: {} });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.message, /Eltern/);
  const bad = await M.requestShopping({
    fetchImpl: reply(400, { message: "Höchstens 14 Tage auf einmal." }),
    token: "t",
    body: {},
  });
  assert.equal(bad.message, "Höchstens 14 Tage auf einmal.");
  const offline = await M.requestShopping({
    fetchImpl: async () => {
      throw new TypeError("network");
    },
    token: "t",
    body: {},
  });
  assert.match(offline.message, /Internet/);
  assert.equal((await M.requestShopping({ fetchImpl: null, token: null, body: {} })).ok, false);
});

// ---- the "Heute" line ---------------------------------------------------------------------------------------
function stubData(rows) {
  const subs = {};
  return {
    rows,
    calls: [],
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb((rows[c] || []).slice());
      return () => (subs[c] = subs[c].filter((x) => x !== cb));
    },
    async create(c, rec) {
      this.calls.push(["create", c, rec]);
      (rows[c] ||= []).push({ id: `new${this.calls.length}`, ...rec });
      (subs[c] || []).forEach((cb) => cb(rows[c].slice()));
    },
    async update(c, id, patch) {
      this.calls.push(["update", c, id, patch]);
    },
    async delete(c, id) {
      this.calls.push(["delete", c, id]);
    },
  };
}
const MEMBERS = [
  { id: "papa", name: "Test-Papa", emoji: "🧔", role: "parent" },
  { id: "kind1", name: "Test-Kind-1", emoji: "⚽", role: "kid" },
];

test("Heute line: nothing planned shows nothing; one dinner reads 'Heute: Pizza' with read-only text", () => {
  const doc = createDocument();
  const empty = M.todayLine({
    data: stubData({ members: MEMBERS }),
    doc,
    today: () => "2026-10-14",
    who: "kind1",
  });
  assert.ok(empty.el.className.includes("hidden"));
  const data = stubData({
    members: MEMBERS,
    dishes: [dish("d1", "Pizza", "", { emoji: "🍕" })],
    meal_plan: [entry("e1", "2026-10-14", "dinner", "Pizza", { dish: "d1" })],
  });
  const line = M.todayLine({ data, doc, today: () => "2026-10-14", who: "kind1" });
  assert.ok(!line.el.className.includes("hidden"));
  assert.equal(line.el.querySelector(".mt-text").textContent, "Heute: Pizza");
  assert.equal(line.el.querySelector(".mt-emoji").textContent, "🍕");
  assert.equal(line.el.querySelector("input"), null, "no way to edit it");
  assert.equal(line.el.querySelector(".mt-link").getAttribute("href"), "#/essen/kind1");
});

test("Heute line: lunch and dinner are labelled; thumbs vote as the viewer and show counts and faces", async () => {
  const doc = createDocument();
  const data = stubData({
    members: MEMBERS,
    meal_plan: [entry("l", "2026-10-14", "lunch", "Suppe"), entry("d", "2026-10-14", "dinner", "Pizza")],
    meal_votes: [{ id: "v1", entry: "d", member: "papa", value: "up" }],
  });
  const line = M.todayLine({ data, doc, today: () => "2026-10-14", who: "kind1" });
  assert.deepEqual(
    line.el.querySelectorAll(".mt-text").map((t) => t.textContent),
    ["Heute Mittag: Suppe", "Heute Abend: Pizza"],
  );
  const dinner = line.el.querySelector('.mealtoday-row[data-slot="dinner"]');
  assert.equal(dinner.querySelector(".thumb.up").textContent, "👍 1");
  assert.equal(dinner.querySelectorAll(".voter").length, 1);
  assert.equal(dinner.querySelector(".voter").getAttribute("title"), "Test-Papa: 👍");
  dinner.querySelector(".thumb.down").click();
  await Promise.resolve();
  assert.deepEqual(data.calls, [["create", "meal_votes", { entry: "d", member: "kind1", value: "down" }]]);
  line.dispose();
});

test("Heute line without a profile (family device on 'Wer bist du?') shows the thumbs but cannot vote", () => {
  const doc = createDocument();
  const data = stubData({
    members: MEMBERS,
    meal_plan: [entry("d", "2026-10-14", "dinner", "Pizza")],
    meal_votes: [{ id: "v1", entry: "d", member: "kind1", value: "up" }],
  });
  const line = M.todayLine({ data, doc, today: () => "2026-10-14", who: null });
  assert.equal(line.el.querySelectorAll("button").length, 0);
  assert.equal(line.el.querySelector(".thumb.up").textContent, "👍 1");
  assert.equal(line.el.querySelector(".mt-link").getAttribute("href"), "#/essen");
});
