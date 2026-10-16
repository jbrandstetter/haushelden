// Governing: SPEC-0009 REQ "Week View", REQ "Plan Entries", REQ "Dish Library", REQ "Thumbs Up and Down",
// REQ "Ingredients to the Shopping List", REQ "Copy and Clear"; ADR-0003 (kid level on a family device)
//
// Render and interaction tests of the Essen screen (app/js/screens/essen.js) on a fake DOM, with a data stub that
// behaves like the data layer (a write shows up in the next subscription callback). Scenario names from SPEC-0009
// appear in the test names. Real-browser behaviour (focus, CSS) is not covered here.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const E = require("../app/js/screens/essen.js");

const WED = "2026-10-14";
const MON = "2026-10-12";
const MEMBERS = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink" },
  { id: "kind1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" },
  { id: "kind2", role: "kid", name: "Test-Kind-2", emoji: "🐴", colour: "mauve" },
];
const dish = (id, name, last_planned = "", extra = {}) => ({
  id,
  name,
  emoji: "🍝",
  ingredients: "",
  last_planned,
  added_by: "papa",
  ...extra,
});
const entry = (id, date, slot, title, extra = {}) => ({
  id,
  date,
  slot,
  title,
  dish: "",
  added_by: "papa",
  ...extra,
});

function stubData(rows) {
  const subs = {};
  const calls = [];
  let n = 0;
  const emit = (c) => (subs[c] || []).forEach((cb) => cb(rows[c].slice()));
  return {
    rows,
    calls,
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb((rows[c] || []).slice());
      return () => (subs[c] = subs[c].filter((x) => x !== cb));
    },
    async create(c, rec) {
      calls.push(["create", c, rec]);
      (rows[c] ||= []).push({ id: `new${++n}`, ...rec });
      emit(c);
      return { id: `new${n}` };
    },
    async update(c, id, patch) {
      calls.push(["update", c, id, patch]);
      Object.assign(
        rows[c].find((r) => r.id === id),
        patch,
      );
      emit(c);
    },
    async delete(c, id) {
      calls.push(["delete", c, id]);
      rows[c] = rows[c].filter((r) => r.id !== id);
      emit(c);
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function boot({
  as = "papa", // "papa" (parent), "kind1"/"kind2" (device acting as a kid) or null (device, no profile)
  entries = [],
  dishes = [],
  votes = [],
  today = WED,
  fetchReply,
  confirm = () => true,
} = {}) {
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  const data = stubData({
    members: MEMBERS.map((m) => ({ ...m })),
    meal_plan: entries.map((e) => ({ ...e })),
    dishes: dishes.map((d) => ({ ...d })),
    meal_votes: votes.map((v) => ({ ...v })),
  });
  const fetched = [];
  const parent = as === "papa" || as === "mama";
  const ctx = {
    args: parent || !as ? [] : [as],
    data,
    clock: { today: () => today },
    auth: {
      record: () => (parent ? { collectionName: "parents", member: as } : { collectionName: "devices" }),
      token: () => "token",
    },
    confirm,
    fetch: async (url, init) => {
      fetched.push({ url, body: JSON.parse(init.body) });
      return fetchReply
        ? fetchReply()
        : { ok: true, status: 200, json: async () => ({ added: 0, existing: 0 }) };
    },
  };
  const cleanup = E.screen(view, ctx);
  const slot = (date, s) =>
    view.querySelector(`.meal-slot[data-date="${date}"][data-slot="${s}"]`) ||
    view
      .querySelectorAll(".meal-slot")
      .find((el) => el.getAttribute("data-date") === date && el.getAttribute("data-slot") === s);
  const type = (selector, value) => {
    const input = view.querySelector(selector);
    input.value = value;
    input.dispatch("input");
  };
  const act = (name) => view.querySelector(`[data-act="${name}"]`);
  const text = (selector) => view.querySelector(selector).textContent;
  return { view, data, fetched, cleanup, slot, type, act, text, ctx };
}
const slotIn = (b, date, s) =>
  b.view
    .querySelectorAll(".meal-slot")
    .find((el) => el.getAttribute("data-date") === date && el.getAttribute("data-slot") === s);
const add = (b, date, s) => slotIn(b, date, s).querySelector(".meal-add").click();
const submit = async (b) => {
  b.view.querySelector("form").dispatch("submit");
  await flush();
};

test("Scenario: opening the plan - the current week, Wednesday highlighted, empty slots offer to add a meal", () => {
  const b = boot();
  assert.equal(b.text(".meal-weeklabel"), "KW 42 · 12.10. – 18.10.");
  const days = b.view.querySelectorAll(".meal-day");
  assert.equal(days.length, 7);
  assert.equal(days[0].getAttribute("data-date"), MON);
  assert.deepEqual(
    days.filter((d) => d.className.includes("today")).map((d) => d.getAttribute("data-date")),
    [WED],
  );
  assert.equal(b.view.querySelectorAll(".meal-slot").length, 14);
  assert.deepEqual(
    [...new Set(b.view.querySelectorAll(".meal-slotname").map((s) => s.textContent))],
    ["Mittagessen", "Abendessen"],
  );
  assert.equal(b.view.querySelectorAll(".meal-add").length, 14);
});

test("the week moves to the previous and next week and back to the current one", () => {
  const b = boot({ entries: [entry("n", "2026-10-20", "dinner", "Nächste Woche")] });
  b.act("next-week").click();
  assert.equal(b.text(".meal-weeklabel"), "KW 43 · 19.10. – 25.10.");
  assert.equal(b.text(".meal-title"), "Nächste Woche");
  assert.equal(b.view.querySelectorAll(".meal-day.today").length, 0, "today is not in that week");
  b.act("prev-week").click();
  b.act("prev-week").click();
  assert.equal(b.text(".meal-weeklabel"), "KW 41 · 5.10. – 11.10.");
  b.act("current").click();
  assert.equal(b.text(".meal-weeklabel"), "KW 42 · 12.10. – 18.10.");
});

test("Scenario: plan a dinner - typing offers the dish, picking it plans it with the dish linked", async () => {
  const b = boot({
    dishes: [dish("d1", "Spaghetti", "2026-09-23", { emoji: "🍝" }), dish("d2", "Spätzle", "2026-10-13")],
  });
  add(b, "2026-10-15", "dinner");
  b.type('[data-field="title"]', "Sp");
  const offered = b.view.querySelectorAll(".meal-sugg .sugg");
  assert.deepEqual(
    offered.map((s) => s.getAttribute("data-dish")),
    ["d1", "d2"],
    "the dish planned longest ago first",
  );
  assert.match(offered[0].textContent, /zuletzt vor 21 Tagen/);
  offered[0].click();
  assert.equal(b.view.querySelector('[data-field="title"]').value, "Spaghetti");
  await submit(b);
  assert.deepEqual(b.data.calls, [
    [
      "create",
      "meal_plan",
      {
        date: "2026-10-15",
        slot: "dinner",
        title: "Spaghetti",
        dish: "d1",
        cook: "",
        note: "",
        added_by: "papa",
      },
    ],
  ]);
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelector(".meal-title").textContent, "Spaghetti");
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelector(".meal-emoji").textContent, "🍝");
});

test("a title that matches nothing is free text; an exact library name links the dish; a cook and a note are kept", async () => {
  const b = boot({ dishes: [dish("d1", "Pizza")] });
  add(b, "2026-10-15", "lunch");
  b.type('[data-field="title"]', "Reste vom Vortag");
  b.type('[data-field="note"]', "Nur wenn noch was da ist");
  const cook = b.view.querySelector("select");
  cook.value = "mama";
  cook.dispatch("change");
  await submit(b);
  assert.deepEqual(b.data.calls[0][2], {
    date: "2026-10-15",
    slot: "lunch",
    title: "Reste vom Vortag",
    dish: "",
    cook: "mama",
    note: "Nur wenn noch was da ist",
    added_by: "papa",
  });
  add(b, "2026-10-15", "dinner");
  b.type('[data-field="title"]', "  pizza ");
  await submit(b);
  assert.equal(b.data.calls[1][2].dish, "d1");
  assert.equal(b.data.calls[1][2].title, "Pizza".toLowerCase(), "the typed words are kept");
  const slot = slotIn(b, "2026-10-15", "lunch");
  assert.equal(slot.querySelector(".cook").getAttribute("title"), "Kocht: Test-Mama");
  assert.equal(slot.querySelector(".meal-note").textContent, "Nur wenn noch was da ist");
});

test("input is checked before anything is written: empty and too long titles stay in the form", async () => {
  const b = boot();
  add(b, "2026-10-15", "dinner");
  await submit(b);
  assert.match(b.text(".form-error"), /Schreib auf/);
  b.type('[data-field="title"]', "x".repeat(81));
  await submit(b);
  assert.match(b.text(".form-error"), /80/);
  assert.deepEqual(b.data.calls, []);
  assert.ok(b.view.querySelector(".meal-editor"), "the form stays open");
  b.act("cancel").click();
  assert.equal(b.view.querySelector(".meal-editor"), null);
});

test("titles and notes are shown as text, never as markup", () => {
  const b = boot({ entries: [entry("e", WED, "dinner", "<b>Fett</b><img src=x>", { note: "<i>x</i>" })] });
  assert.equal(b.text(".meal-title"), "<b>Fett</b><img src=x>");
  assert.equal(b.text(".meal-note"), "<i>x</i>");
  assert.equal(b.view.querySelector("img"), null);
  assert.equal(b.view.querySelector("b.x"), null);
});

test("Scenario: kid proposes a meal - the son adds Pizza to the empty Friday dinner, with his avatar", async () => {
  const b = boot({ as: "kind1" });
  assert.match(b.text(".hello"), /Hallo Test-Kind-1/);
  add(b, "2026-10-16", "dinner");
  b.type('[data-field="title"]', "Pizza");
  await submit(b);
  assert.deepEqual(b.data.calls, [
    [
      "create",
      "meal_plan",
      { date: "2026-10-16", slot: "dinner", title: "Pizza", dish: "", cook: "", note: "", added_by: "kind1" },
    ],
  ]);
  const slot = slotIn(b, "2026-10-16", "dinner");
  assert.equal(slot.querySelector(".by").textContent, "⚽");
  assert.equal(slot.querySelector(".by").getAttribute("title"), "Test-Kind-1");
});

test("a kid cannot change or clear a parent's entry or another child's, but can change their own", () => {
  const b = boot({
    as: "kind1",
    entries: [
      entry("p", "2026-10-15", "dinner", "Von Papa", { added_by: "papa" }),
      entry("k2", "2026-10-16", "dinner", "Von Kind 2", { added_by: "kind2" }),
      entry("k1", "2026-10-17", "dinner", "Von Kind 1", { added_by: "kind1" }),
    ],
  });
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelector(".meal-edit"), null);
  assert.equal(slotIn(b, "2026-10-16", "dinner").querySelector(".meal-edit"), null);
  assert.ok(slotIn(b, "2026-10-17", "dinner").querySelector(".meal-edit"));
  assert.equal(b.view.querySelectorAll(".meal-edit").length, 1);
  // and none of the parents' tools
  for (const name of ["week-ingredients", "copy-week", "clear-week", "day-ingredients"]) {
    assert.equal(b.act(name), null, name);
  }
});

test("a kid edits their own entry: the same meal updates the note, a different meal replaces it", async () => {
  const b = boot({
    as: "kind1",
    entries: [entry("k1", "2026-10-17", "dinner", "Nudeln", { added_by: "kind1" })],
  });
  slotIn(b, "2026-10-17", "dinner").querySelector(".meal-edit").click();
  b.type('[data-field="note"]', "mit Käse");
  await submit(b);
  assert.deepEqual(b.data.calls, [["update", "meal_plan", "k1", { note: "mit Käse" }]]);
  slotIn(b, "2026-10-17", "dinner").querySelector(".meal-edit").click();
  b.type('[data-field="title"]', "Reis");
  await submit(b);
  assert.deepEqual(
    b.data.calls.slice(1).map((c) => [c[0], c[2].id || c[2].title || c[2]]),
    [
      ["delete", "k1"],
      ["create", "Reis"],
    ],
  );
});

test("Scenario: parent overrides - replacing the son's Pizza deletes it (and its votes) and adds Lasagne by the parent", async () => {
  const b = boot({
    as: "mama",
    entries: [entry("pz", "2026-10-16", "dinner", "Pizza", { added_by: "kind1" })],
    votes: [{ id: "v", entry: "pz", member: "kind2", value: "up" }],
  });
  slotIn(b, "2026-10-16", "dinner").querySelector(".meal-edit").click();
  b.type('[data-field="title"]', "Lasagne");
  await submit(b);
  assert.deepEqual(
    b.data.calls.map((c) => c[0]),
    ["delete", "create"],
    "replaced, not edited in place, so the adder changes and the votes go",
  );
  assert.deepEqual(b.data.calls[0], ["delete", "meal_plan", "pz"]);
  assert.equal(b.data.calls[1][2].added_by, "mama");
  assert.equal(b.data.calls[1][2].title, "Lasagne");
  assert.equal(slotIn(b, "2026-10-16", "dinner").querySelector(".by").getAttribute("title"), "Test-Mama");
});

test("a parent changing only the note or the cook of a child's entry keeps it the child's", async () => {
  const b = boot({ entries: [entry("pz", "2026-10-16", "dinner", "Pizza", { added_by: "kind1" })] });
  slotIn(b, "2026-10-16", "dinner").querySelector(".meal-edit").click();
  const cook = b.view.querySelector("select");
  cook.value = "papa";
  cook.dispatch("change");
  await submit(b);
  assert.deepEqual(b.data.calls, [["update", "meal_plan", "pz", { cook: "papa" }]]);
});

test("clearing an entry deletes it, and the slot is empty again", async () => {
  const b = boot({ entries: [entry("e", "2026-10-15", "dinner", "Weg damit")] });
  slotIn(b, "2026-10-15", "dinner").querySelector(".meal-edit").click();
  b.act("clear").click();
  await flush();
  assert.deepEqual(b.data.calls, [["delete", "meal_plan", "e"]]);
  assert.ok(slotIn(b, "2026-10-15", "dinner").querySelector(".meal-add"));
});

test("Scenario: vote - a thumb is counted once, the second tap removes it, and the other thumb changes it", async () => {
  const b = boot({
    as: "kind2",
    entries: [entry("e", "2026-10-15", "dinner", "Spaghetti")],
    votes: [{ id: "v0", entry: "e", member: "papa", value: "up" }],
  });
  const thumb = (value) => slotIn(b, "2026-10-15", "dinner").querySelector(`.thumb.${value}`);
  assert.equal(thumb("up").textContent, "👍 1");
  assert.equal(thumb("up").getAttribute("aria-pressed"), "false");
  thumb("up").click();
  await flush();
  assert.deepEqual(b.data.calls[0], ["create", "meal_votes", { entry: "e", member: "kind2", value: "up" }]);
  assert.equal(thumb("up").textContent, "👍 2");
  assert.equal(thumb("up").getAttribute("aria-pressed"), "true");
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelectorAll(".voter").length, 2, "faces of who voted");
  thumb("down").click();
  await flush();
  assert.deepEqual(b.data.calls[1], ["update", "meal_votes", "new1", { value: "down" }]);
  assert.equal(thumb("up").textContent, "👍 1");
  assert.equal(thumb("down").textContent, "👎 1");
  thumb("down").click();
  await flush();
  assert.deepEqual(b.data.calls[2], ["delete", "meal_votes", "new1"]);
  assert.equal(thumb("down").textContent, "👎");
});

test("a parent votes as themselves, also on a child's entry", async () => {
  const b = boot({ entries: [entry("e", "2026-10-15", "dinner", "Pizza", { added_by: "kind1" })] });
  slotIn(b, "2026-10-15", "dinner").querySelector(".thumb.down").click();
  await flush();
  assert.deepEqual(b.data.calls[0], ["create", "meal_votes", { entry: "e", member: "papa", value: "down" }]);
});

test("a family device without a chosen profile asks who is there before adding or voting", () => {
  const b = boot({ as: null, entries: [entry("e", "2026-10-15", "dinner", "Pizza")] });
  const chips = b.view.querySelectorAll(".whochips button");
  assert.deepEqual(
    chips.map((c) => c.textContent),
    ["⚽ Test-Kind-1", "🐴 Test-Kind-2"],
    "only the kids",
  );
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelectorAll("button.thumb").length, 0, "counts only");
  add(b, "2026-10-16", "dinner");
  assert.match(b.text(".meal-result"), /Wähle zuerst oben/);
  assert.equal(b.view.querySelector(".meal-editor"), null);
  chips[1].click();
  assert.equal(b.view.querySelectorAll(".whochips").length, 0);
  assert.equal(slotIn(b, "2026-10-15", "dinner").querySelectorAll("button.thumb").length, 2);
});

test("a parent id in the route is not trusted: a family device only acts as a kid", () => {
  const b = boot({ as: "papa" });
  b.ctx.auth.record = () => ({ collectionName: "devices" });
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  E.screen(view, { ...b.ctx, args: ["papa"], data: b.data });
  assert.ok(view.querySelectorAll(".whochips button").length > 0, "still asks for a kid");
  assert.equal(view.querySelectorAll("button.thumb").length, 0);
});

// ---- ingredients ---------------------------------------------------------------------------------------------
test("Scenario: whole week - the week button asks the server for Monday to Sunday and shows added and existing", async () => {
  const b = boot({
    entries: [entry("e", "2026-10-15", "dinner", "Spaghetti", { dish: "d1" })],
    dishes: [dish("d1", "Spaghetti")],
    fetchReply: async () => ({ ok: true, status: 200, json: async () => ({ added: 3, existing: 2 }) }),
  });
  b.act("week-ingredients").click();
  await flush();
  assert.deepEqual(b.fetched, [
    { url: "/api/hh/mealplan/shopping", body: { from: "2026-10-12", to: "2026-10-18" } },
  ]);
  assert.equal(b.text(".meal-result"), "3 Zutaten neu auf der Einkaufsliste, 2 standen schon drauf.");
  b.act("next-week").click();
  b.act("week-ingredients").click();
  await flush();
  assert.deepEqual(b.fetched[1].body, { from: "2026-10-19", to: "2026-10-25" }, "the displayed week");
});

test("a day offers its ingredients when a dish is planned on it, and asks for exactly that day", async () => {
  const b = boot({
    entries: [
      entry("e", "2026-10-15", "dinner", "Spaghetti", { dish: "d1" }),
      entry("f", "2026-10-16", "dinner", "Reste"),
    ],
    dishes: [dish("d1", "Spaghetti")],
  });
  assert.equal(
    b.view.querySelectorAll('[data-act="day-ingredients"]').length,
    1,
    "free text has no ingredients",
  );
  b.act("day-ingredients").click();
  await flush();
  assert.deepEqual(b.fetched[0].body, { from: "2026-10-15", to: "2026-10-15" });
});

test("Scenario: single dish - 'Zutaten auf die Liste' in the library sends the dish, no dates", async () => {
  const b = boot({
    dishes: [dish("d1", "Spaghetti", "", { ingredients: "Nudeln\nTomaten" })],
    fetchReply: async () => ({ ok: true, status: 200, json: async () => ({ added: 0, existing: 2 }) }),
  });
  b.view.querySelector('[data-mode="dishes"]').click();
  b.act("dish-ingredients").click();
  await flush();
  assert.deepEqual(b.fetched[0].body, { dish: "d1" });
  assert.match(b.text(".meal-result"), /Nichts Neues: alle 2 Zutaten stehen schon auf der Liste/);
});

test("a refused or failed ingredient request shows the reason as a warning", async () => {
  const b = boot({
    fetchReply: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  });
  b.act("week-ingredients").click();
  await flush();
  assert.match(b.text(".meal-result"), /Eltern/);
  assert.ok(b.view.querySelector(".meal-result").className.includes("warn"));
});

// ---- copy and clear ------------------------------------------------------------------------------------------
test("Scenario: copy last week - onto an empty week it copies at once to the same weekdays", async () => {
  const b = boot({
    entries: [
      entry("a", "2026-10-12", "dinner", "Pizza", { dish: "d1" }),
      entry("b", "2026-10-18", "lunch", "Suppe", { added_by: "kind1" }),
    ],
  });
  b.act("copy-week").click();
  assert.deepEqual(b.data.calls, [], "opening the panel changes nothing");
  assert.match(b.text(".meal-copy"), /KW 43/);
  b.act("copy").click();
  await flush();
  assert.deepEqual(
    b.data.calls.map((c) => [c[0], c[2].date, c[2].slot, c[2].title, c[2].added_by]),
    [
      ["create", "2026-10-19", "dinner", "Pizza", "papa"],
      ["create", "2026-10-25", "lunch", "Suppe", "papa"],
    ],
  );
  assert.equal(b.text(".meal-weeklabel"), "KW 43 · 19.10. – 25.10.", "shows the target week afterwards");
  assert.match(b.text(".meal-result"), /2 Einträge kopiert/);
});

test("copying onto a week with entries asks first and deletes nothing until the parent decided", async () => {
  const b = boot({
    entries: [
      entry("a", "2026-10-12", "dinner", "Pizza"),
      entry("b", "2026-10-13", "dinner", "Suppe"),
      entry("x", "2026-10-19", "dinner", "Nudeln"),
    ],
  });
  b.act("copy-week").click();
  assert.match(b.text(".meal-copy"), /schon 1 Platz belegt/);
  assert.ok(b.act("copy-replace") && b.act("copy-fill"));
  assert.equal(b.act("copy"), null);
  assert.deepEqual(b.data.calls, [], "nothing deleted or created yet");
  b.act("cancel-copy").click();
  assert.deepEqual(b.data.calls, []);
  b.act("copy-week").click();
  b.act("copy-fill").click();
  await flush();
  assert.deepEqual(
    b.data.calls.map((c) => c[0]),
    ["create"],
    "fill keeps Nudeln and adds only Suppe",
  );
  assert.equal(b.data.rows.meal_plan.find((e) => e.id === "x").title, "Nudeln");
});

test("replace overwrites the taken slot (delete, then create) and leaves the rest of the target week alone", async () => {
  const b = boot({
    entries: [
      entry("a", "2026-10-12", "dinner", "Pizza"),
      entry("x", "2026-10-19", "dinner", "Nudeln"),
      entry("y", "2026-10-22", "dinner", "Bleibt"),
    ],
  });
  b.act("copy-week").click();
  b.act("copy-replace").click();
  await flush();
  assert.deepEqual(
    b.data.calls.map((c) => [c[0], c[2].id || c[2].title || c[2]]),
    [
      ["delete", "x"],
      ["create", "Pizza"],
    ],
  );
  assert.ok(b.data.rows.meal_plan.some((e) => e.id === "y"));
});

test("an empty source week has nothing to copy; the target can be chosen", () => {
  const b = boot();
  b.act("copy-week").click();
  assert.match(b.text(".meal-copy"), /nichts zu kopieren/);
  b.act("next-target").click();
  assert.match(b.text(".meal-copy"), /KW 44/);
});

test("clearing the week asks first; declining deletes nothing, confirming deletes only that week's entries", async () => {
  const entries = [
    entry("a", "2026-10-12", "dinner", "A"),
    entry("b", "2026-10-18", "lunch", "B"),
    entry("c", "2026-10-19", "lunch", "C"),
  ];
  let asked = "";
  const no = boot({ entries, confirm: (t) => ((asked = t), false) });
  no.act("clear-week").click();
  await flush();
  assert.match(asked, /2 Einträge/);
  assert.deepEqual(no.data.calls, []);
  const yes = boot({ entries });
  yes.act("clear-week").click();
  await flush();
  assert.deepEqual(yes.data.calls, [
    ["delete", "meal_plan", "a"],
    ["delete", "meal_plan", "b"],
  ]);
  assert.equal(yes.view.querySelectorAll(".meal-entry").length, 0);
});

// ---- dish library --------------------------------------------------------------------------------------------
const library = (b) => b.view.querySelector('[data-mode="dishes"]').click();

test("the library lists dishes with the rotation hint and the tally of votes on all their entries", () => {
  const b = boot({
    dishes: [
      dish("d1", "Spaghetti", "2026-09-23"),
      dish("d2", "Suppe", ""),
      dish("d3", "Pizza", "2026-10-13"),
    ],
    entries: [
      entry("e1", "2026-10-13", "dinner", "Pizza", { dish: "d3" }),
      entry("e2", "2026-10-20", "dinner", "Pizza", { dish: "d3" }),
    ],
    votes: [
      { id: "v1", entry: "e1", member: "mama", value: "up" },
      { id: "v2", entry: "e2", member: "mama", value: "up" },
      { id: "v3", entry: "e2", member: "kind1", value: "down" },
    ],
  });
  library(b);
  const rows = b.view.querySelectorAll(".meal-dish");
  assert.deepEqual(
    rows.map((r) => r.getAttribute("data-dish")),
    ["d2", "d1", "d3"],
    "never planned, longest ago, recent",
  );
  assert.match(rows[0].textContent, /noch nie geplant/);
  assert.match(rows[1].textContent, /zuletzt vor 21 Tagen/);
  assert.equal(rows[2].querySelector(".meal-tally").textContent, "👍 2 · 👎 1");
});

test("every member adds a dish: names and ingredients are checked, the adder is the acting member", async () => {
  const b = boot({ as: "kind2" });
  library(b);
  b.act("new-dish").click();
  b.type('[data-field="name"]', "Pfannkuchen");
  b.type('[data-field="emoji"]', "🥞");
  b.type('[data-field="ingredients"]', Array(41).fill("Ei").join("\n"));
  await submit(b);
  assert.match(b.text(".form-error"), /40/);
  assert.deepEqual(b.data.calls, []);
  b.type('[data-field="ingredients"]', " Mehl \n\n  Eier\nMilch ");
  await submit(b);
  assert.deepEqual(b.data.calls, [
    [
      "create",
      "dishes",
      {
        name: "Pfannkuchen",
        emoji: "🥞",
        ingredients: "Mehl\nEier\nMilch",
        last_planned: "",
        added_by: "kind2",
      },
    ],
  ]);
  assert.match(b.text(".meal-dish"), /Pfannkuchen/);
  assert.match(b.text(".meal-dish"), /3 Zutaten/);
});

test("a kid edits only their own dishes; parents edit and delete any (deleting keeps the entries as text)", async () => {
  const dishes = [
    dish("mine", "Meins", "", { added_by: "kind1" }),
    dish("papas", "Papas", "", { added_by: "papa" }),
  ];
  const kid = boot({ as: "kind1", dishes });
  library(kid);
  assert.equal(kid.view.querySelectorAll(".meal-dish .meal-edit").length, 1);
  assert.equal(kid.view.querySelector('.meal-dish[data-dish="papas"] .meal-edit'), null);
  assert.equal(kid.act("dish-ingredients"), null, "ingredients to the list are for parents");

  const parent = boot({ dishes, entries: [entry("e", WED, "dinner", "Papas", { dish: "papas" })] });
  library(parent);
  parent.view.querySelector('.meal-dish[data-dish="papas"] .meal-edit').click();
  parent.type('[data-field="name"]', "Papas Eintopf");
  await submit(parent);
  assert.deepEqual(parent.data.calls, [
    ["update", "dishes", "papas", { name: "Papas Eintopf", emoji: "🍝", ingredients: "" }],
  ]);
  parent.view.querySelector('.meal-dish[data-dish="papas"] .meal-edit').click();
  parent.act("delete").click();
  await flush();
  assert.deepEqual(parent.data.calls[1], ["delete", "dishes", "papas"]);
  assert.equal(parent.data.rows.meal_plan.length, 1, "the plan entry is untouched by the client");
});

test("the library is empty-friendly and a profile is needed before adding on a family device", () => {
  const b = boot({ as: null });
  library(b);
  assert.match(b.text(".note"), /Noch keine Gerichte/);
  b.act("new-dish").click();
  assert.match(b.text(".meal-result"), /Wähle zuerst oben/);
});

test("signed out: a message, no data access; cleanup unsubscribes", () => {
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  assert.equal(
    E.screen(view, { args: [], data: null, clock: { today: () => WED }, auth: { record: () => null } }),
    undefined,
  );
  assert.match(view.textContent, /Nicht angemeldet/);
  const b = boot();
  assert.equal(typeof b.cleanup, "function");
  b.cleanup();
});
