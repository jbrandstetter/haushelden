// Governing: SPEC-0010 REQ "Cleaning Day List", REQ "Ticking Off", REQ "Standard Chores", REQ "Starting a Cleaning Day",
// REQ "Assigning and Adding Chores"; ADR-0003 (kid level on a family device)
//
// Render and interaction tests of the Putztag screen (app/js/screens/putztag.js) on a fake DOM, with a data stub that
// behaves like the data layer (a write shows up in the next subscription callback). Scenario names from SPEC-0010
// appear in the test names. Real-browser behaviour (focus, CSS) is not covered here.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const P = require("../app/js/screens/putztag.js");

const TODAY = "2026-10-14"; // a Wednesday
const SAT = "2026-10-17";
const MEMBERS = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink" },
  { id: "kind1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" },
  { id: "kind2", role: "kid", name: "Test-Kind-2", emoji: "🐴", colour: "mauve" },
];
const chore = (id, assignee, extra = {}) => ({
  id,
  day: SAT,
  title: `Test-Aufgabe ${id}`,
  assignee,
  done: false,
  done_by: "",
  template: "",
  sort: Number(id.replace(/\D/g, "")) || 0,
  ...extra,
});
const DAY = [
  chore("c1", "kind1"),
  chore("c2", "kind1", { done: true, done_by: "kind1" }),
  chore("c3", "kind2"),
  chore("c4", "papa"),
  chore("c5", "mama"),
  chore("c6", ""),
];

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

function boot({ as = "papa", chores = DAY, templates = [], today = TODAY, confirm = () => true } = {}) {
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  const data = stubData({
    members: MEMBERS.map((m) => ({ ...m })),
    chores: chores.map((c) => ({ ...c })),
    chore_templates: templates.map((t) => ({ ...t })),
  });
  const parent = as === "papa" || as === "mama";
  const ctx = {
    args: parent || !as ? [] : [as],
    data,
    clock: { today: () => today },
    auth: {
      record: () => (parent ? { collectionName: "parents", member: as } : { collectionName: "devices" }),
    },
    confirm,
  };
  const cleanup = P.screen(view, ctx);
  const act = (name) => view.querySelector(`[data-act="${name}"]`);
  const row = (id) => view.querySelector(`.chore[data-chore="${id}"]`);
  const check = (id) => row(id).querySelector("button.chore-check");
  const type = (selector, value) => {
    const input = view.querySelector(selector);
    input.value = value;
    input.dispatch("input");
  };
  const group = (key) => view.querySelector(`.chore-group[data-group="${key}"]`);
  return {
    view,
    data,
    cleanup,
    act,
    row,
    check,
    type,
    group,
    text: (s) => view.querySelector(s).textContent,
  };
}
const tpl = (id, title, extra = {}) => ({
  id,
  title,
  kids: false,
  assignee: "",
  every_days: 0,
  sort: Number(id.replace(/\D/g, "")),
  ...extra,
});
const submit = async (b) => {
  b.view.querySelector("form").dispatch("submit");
  await flush();
};
const disabled = (el) => el.getAttribute("disabled") !== null;

test("Everybody sees everything: a child sees the chores of the others, grouped by person, with the progress", () => {
  const b = boot({ as: "kind2" });
  assert.deepEqual(
    b.view.querySelectorAll(".chore-group").map((g) => g.getAttribute("data-group")),
    ["kind1", "kind2", "papa", "mama", "none"],
  );
  assert.equal(b.view.querySelectorAll(".chore").length, 6, "all six chores are shown");
  assert.match(b.text(".chore-count"), /1 von 6 erledigt/);
  assert.match(b.text(".meal-weeklabel"), /Samstag 17\.10\./);
  assert.match(b.group("kind1").textContent, /1\/2/);
  assert.match(b.group("none").textContent, /Noch niemandem zugeteilt/);
  assert.equal(b.row("c2").className.includes("done"), true);
  b.cleanup();
});

test("Day to open on: the coming Saturday on a Thursday, today when it is a cleaning day", () => {
  const b = boot({
    as: "papa",
    chores: [
      chore("c1", "papa", { day: "2026-10-03" }),
      chore("c2", "papa", { day: SAT }),
      chore("c3", "papa", { day: "2026-10-24" }),
    ],
    today: "2026-10-15",
  });
  assert.match(b.text(".meal-weeklabel"), /Samstag 17\.10\./);
  b.act("next-day").click();
  assert.match(b.text(".meal-weeklabel"), /Samstag 24\.10\./);
  assert.equal(disabled(b.act("next-day")), true, "no later cleaning day");
  b.act("prev-day").click();
  b.act("prev-day").click();
  assert.match(b.text(".meal-weeklabel"), /Samstag 3\.10\./);
  assert.equal(disabled(b.act("prev-day")), true);
  const today = boot({ as: "papa", chores: [chore("c1", "papa", { day: TODAY })] });
  assert.match(today.text(".meal-weeklabel"), /heute/);
});

test("Kid ticks their own chore: the update records the child, and a second tap takes it back", async () => {
  const b = boot({ as: "kind1" });
  b.check("c1").click();
  await flush();
  assert.deepEqual(b.data.calls.at(-1), ["update", "chores", "c1", { done: true, done_by: "kind1" }]);
  assert.equal(b.row("c1").className.includes("done"), true);
  assert.match(b.text(".chore-count"), /2 von 6/);
  b.check("c1").click();
  await flush();
  assert.deepEqual(b.data.calls.at(-1), ["update", "chores", "c1", { done: false, done_by: "" }]);
  assert.equal(b.row("c1").className.includes("done"), false);
  b.cleanup();
});

test("Kid cannot tick someone else's chore: the control is off for other kids, parents and unassigned chores", async () => {
  const b = boot({ as: "kind1" });
  for (const id of ["c3", "c4", "c5", "c6"]) {
    assert.equal(disabled(b.check(id)), true, `${id} is shown without a tick control`);
    b.check(id).click();
  }
  await flush();
  assert.equal(b.data.calls.length, 0);
  assert.equal(disabled(b.check("c1")), false, "their own chore is tickable");
  b.cleanup();
});

test("a device with no profile chosen can look but not tick, and picks a kid from the chips", async () => {
  const b = boot({ as: null });
  assert.equal(b.view.querySelectorAll(".whochips button").length, 2, "only the kids are offered");
  assert.equal(disabled(b.check("c1")), true);
  b.view.querySelectorAll(".whochips button")[0].click();
  assert.equal(disabled(b.check("c1")), false);
  assert.equal(disabled(b.check("c3")), true);
  b.cleanup();
});

test("Parent ticks for a child: the chore is done and the parent is recorded", async () => {
  const b = boot({ as: "mama" });
  b.check("c1").click();
  await flush();
  assert.deepEqual(b.data.calls.at(-1), ["update", "chores", "c1", { done: true, done_by: "mama" }]);
  b.check("c6").click();
  await flush();
  assert.deepEqual(
    b.data.calls.at(-1),
    ["update", "chores", "c6", { done: true, done_by: "mama" }],
    "an unassigned chore too",
  );
  b.cleanup();
});

test("a child has none of the parents' controls", () => {
  const b = boot({ as: "kind1" });
  for (const name of ["new-day", "add-chore", "delete-day"]) assert.equal(b.act(name), null, name);
  assert.equal(b.view.querySelectorAll(".meal-edit").length, 0, "no edit pencils");
  assert.equal(b.view.querySelectorAll(".ltabs").length, 0, "no tab to the standard chores");
  b.cleanup();
});

test("Start for Saturday: every kids' chore once per kid, the parents' chores to the parents, the day opens", async () => {
  const templates = [
    tpl("t1", "Bad saugen", { kids: true }),
    tpl("t2", "Fenster putzen", { assignee: "mama" }),
    tpl("t3", "Garage", { assignee: "papa" }),
  ];
  const b = boot({ as: "papa", chores: [], templates });
  assert.match(b.view.textContent, /Noch kein Putztag/);
  b.act("new-day").click();
  assert.equal(
    b.view.querySelector('[data-field="newday"]').value,
    SAT,
    "the form opens on the next Saturday",
  );
  await submit(b);
  const created = b.data.calls.filter((c) => c[0] === "create").map((c) => c[2]);
  assert.deepEqual(
    created.map((c) => [c.title, c.assignee]),
    [
      ["Bad saugen", "kind1"],
      ["Bad saugen", "kind2"],
      ["Fenster putzen", "mama"],
      ["Garage", "papa"],
    ],
  );
  assert.match(b.text(".meal-result"), /4 Aufgaben angelegt/);
  assert.match(b.text(".chore-count"), /0 von 4 erledigt/);
  assert.match(b.text(".meal-weeklabel"), /Samstag 17\.10\./);
  b.cleanup();
});

test("Started twice: no chore appears twice", async () => {
  const templates = [tpl("t1", "Bad saugen", { kids: true })];
  const b = boot({ as: "papa", chores: [], templates });
  for (let i = 0; i < 2; i++) {
    b.act("new-day").click();
    await submit(b);
  }
  assert.equal(b.data.calls.filter((c) => c[0] === "create").length, 2);
  assert.equal(b.view.querySelectorAll(".chore").length, 2);
  assert.match(b.text(".meal-result"), /Nichts Neues anzulegen\. 2 gab es schon\./);
  b.cleanup();
});

test("starting a day needs a date today or later and standard chores", async () => {
  const b = boot({ as: "papa", chores: [], templates: [tpl("t1", "Bad", { kids: true })] });
  b.act("new-day").click();
  b.type('[data-field="newday"]', "2026-10-01");
  await submit(b);
  assert.match(b.text(".form-error"), /Vergangenheit/);
  b.type('[data-field="newday"]', "");
  await submit(b);
  assert.match(b.text(".form-error"), /Datum/);
  assert.equal(b.data.calls.length, 0);
  const empty = boot({ as: "papa", chores: [], templates: [] });
  empty.act("new-day").click();
  assert.match(empty.view.textContent, /noch keine Standard-Aufgaben/);
  await submit(empty);
  assert.match(empty.text(".form-error"), /Standard-Aufgaben/);
  assert.equal(empty.data.calls.length, 0);
});

test("Assign the open ones: reassigning changes the group and clears a tick", async () => {
  const b = boot({ as: "papa" });
  b.row("c6").querySelector(".meal-edit").click();
  b.view.querySelector('[data-field="assignee"]').value = "kind2";
  b.view.querySelector('[data-field="assignee"]').dispatch("change");
  await submit(b);
  assert.deepEqual(b.data.calls.at(-1), [
    "update",
    "chores",
    "c6",
    { assignee: "kind2", done: false, done_by: "" },
  ]);
  assert.equal(b.group("none"), null, "the unassigned group is gone");
  assert.match(b.group("kind2").textContent, /Test-Aufgabe c6/);
  b.row("c2").querySelector(".meal-edit").click();
  b.view.querySelector('[data-field="assignee"]').value = "mama";
  b.view.querySelector('[data-field="assignee"]').dispatch("change");
  await submit(b);
  assert.deepEqual(b.data.calls.at(-1), [
    "update",
    "chores",
    "c2",
    { assignee: "mama", done: false, done_by: "" },
  ]);
  assert.equal(b.row("c2").className.includes("done"), false, "the tick of the ticked chore is gone");
  b.cleanup();
});

test("changing only the title sends only the title", async () => {
  const b = boot({ as: "papa" });
  b.row("c4").querySelector(".meal-edit").click();
  b.type('[data-field="title"]', "  Garage   kehren ");
  await submit(b);
  assert.deepEqual(b.data.calls.at(-1), ["update", "chores", "c4", { title: "Garage kehren" }]);
});

test("One-off chore: added to the shown day for the chosen person, the standard chores stay as they are", async () => {
  const b = boot({ as: "papa", templates: [tpl("t1", "Bad", { kids: true })] });
  b.act("add-chore").click();
  b.type('[data-field="title"]', "Garage kehren");
  b.view.querySelector('[data-field="assignee"]').value = "papa";
  b.view.querySelector('[data-field="assignee"]').dispatch("change");
  await submit(b);
  const made = b.data.calls.at(-1);
  assert.equal(made[0], "create");
  assert.equal(made[1], "chores");
  assert.deepEqual(
    {
      day: made[2].day,
      title: made[2].title,
      assignee: made[2].assignee,
      template: made[2].template,
      done: made[2].done,
    },
    { day: SAT, title: "Garage kehren", assignee: "papa", template: "", done: false },
  );
  assert.equal(b.data.rows.chore_templates.length, 1);
  assert.match(b.group("papa").textContent, /Garage kehren/);
});

test("an empty title is refused with a message", async () => {
  const b = boot({ as: "papa" });
  b.act("add-chore").click();
  await submit(b);
  assert.match(b.text(".form-error"), /schreib auf/);
  assert.equal(b.data.calls.length, 0);
});

test("a parent deletes a chore from its editor and the whole day after confirming", async () => {
  const b = boot({ as: "papa" });
  b.row("c3").querySelector(".meal-edit").click();
  b.act("delete").click();
  await flush();
  assert.deepEqual(b.data.calls.at(-1), ["delete", "chores", "c3"]);
  const declined = boot({ as: "papa", confirm: () => false });
  declined.act("delete-day").click();
  await flush();
  assert.equal(declined.data.calls.length, 0, "nothing is deleted unless confirmed");
  b.act("delete-day").click();
  await flush();
  assert.equal(
    b.data.calls.filter((c) => c[0] === "delete").length,
    6,
    "the one and the five that were left",
  );
  assert.match(b.view.textContent, /Noch kein Putztag/);
});

test("First use: the standard chores offer the starter set and map Papa's and Mama's lists to the parents", async () => {
  const b = boot({ as: "mama", chores: [] });
  b.view.querySelectorAll(".ltabs button")[1].click();
  b.act("start-import").click();
  assert.match(b.view.textContent, /Wer übernimmt welche Liste/);
  const papa = b.view.querySelector('[data-field="papa"]');
  const mama = b.view.querySelector('[data-field="mama"]');
  assert.equal(papa.value, "papa", "defaults to the first parent");
  assert.equal(mama.value, "mama", "and the second");
  papa.value = "mama";
  papa.dispatch("change");
  mama.value = "papa";
  mama.dispatch("change");
  b.act("import").click();
  await flush();
  const made = b.data.calls.filter((c) => c[1] === "chore_templates").map((c) => c[2]);
  assert.equal(made.length, 23);
  assert.equal(made.filter((t) => t.kids).length, 7);
  assert.ok(
    made.filter((t) => /Büro/.test(t.title)).every((t) => t.assignee === "mama"),
    "Papa's list went to Mama",
  );
  assert.ok(made.filter((t) => /Handtücher/.test(t.title)).every((t) => t.assignee === "papa"));
  assert.match(b.text(".meal-result"), /Standardliste ist übernommen/);
  assert.equal(b.act("start-import"), null, "offered only while there are none");
  assert.equal(b.view.querySelectorAll(".chore").length, 23);
  assert.match(b.view.textContent, /Jedes Kind · Bei jedem Putztag/);
});

test("Add a chore of our own: Balkon kehren, for one child, monthly", async () => {
  const b = boot({ as: "papa", chores: [], templates: [tpl("t1", "Bad", { kids: true })] });
  b.view.querySelectorAll(".ltabs button")[1].click();
  b.act("new-template").click();
  b.type('[data-field="title"]', "Balkon kehren");
  const who = b.view.querySelector('[data-field="who"]');
  who.value = "kind1";
  who.dispatch("change");
  const every = b.view.querySelector('[data-field="every"]');
  every.value = "30";
  every.dispatch("change");
  await submit(b);
  const made = b.data.calls.at(-1);
  assert.deepEqual(made.slice(0, 2), ["create", "chore_templates"]);
  assert.deepEqual(
    { title: made[2].title, kids: made[2].kids, assignee: made[2].assignee, every_days: made[2].every_days },
    { title: "Balkon kehren", kids: false, assignee: "kind1", every_days: 30 },
  );
  assert.match(b.view.textContent, /Test-Kind-1 · Monatlich/);
});

test("a standard chore can be changed and deleted; deleting asks first", async () => {
  const templates = [tpl("t1", "Bad saugen", { kids: true })];
  const b = boot({ as: "papa", templates });
  b.view.querySelectorAll(".ltabs button")[1].click();
  b.view.querySelector('.chore[data-template="t1"] .meal-edit').click();
  b.type('[data-field="title"]', "Bad saugen und wischen");
  const who = b.view.querySelector('[data-field="who"]');
  who.value = "mama";
  who.dispatch("change");
  await submit(b);
  assert.deepEqual(b.data.calls.at(-1), [
    "update",
    "chore_templates",
    "t1",
    { title: "Bad saugen und wischen", kids: false, assignee: "mama", every_days: 0 },
  ]);
  const declined = boot({ as: "papa", templates, confirm: () => false });
  declined.view.querySelectorAll(".ltabs button")[1].click();
  declined.view.querySelector('.chore[data-template="t1"] .meal-edit').click();
  declined.act("delete").click();
  await flush();
  assert.equal(declined.data.calls.length, 0);
  b.view.querySelector('.chore[data-template="t1"] .meal-edit').click();
  b.act("delete").click();
  await flush();
  assert.deepEqual(b.data.calls.at(-1), ["delete", "chore_templates", "t1"]);
});

test("titles from the data store are text, never markup", () => {
  const b = boot({ as: "kind1", chores: [chore("c1", "kind1", { title: "<img src=x onerror=alert(1)>" })] });
  assert.equal(b.row("c1").textContent.includes("<img src=x onerror=alert(1)>"), true);
  assert.equal(b.view.querySelectorAll("img").length, 0);
  b.cleanup();
});

test("without a session the screen only says so", () => {
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  P.screen(view, {});
  assert.match(view.textContent, /Nicht angemeldet/);
});
