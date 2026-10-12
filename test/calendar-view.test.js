// Governing: SPEC-0004 REQ "Mode Switch", REQ "Month View", REQ "Day Agenda", REQ "Entry Sources",
// REQ "Adding on a Selected Day", REQ "Area Filter in Calendar"; SPEC-0003 REQ "Editing" (agenda to-dos behave
// as in list mode)
//
// Render and flow tests of calendar mode in the parents' view: a fake DOM and a stub data API, no browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const eltern = require("../app/js/screens/eltern.js");

const MON = "2026-10-12";
const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink", created: "2" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach", created: "3" },
  { id: "kid2", role: "kid", name: "Test-Kind-2", emoji: "🎨", colour: "mauve", created: "4" },
];
const areas = [{ id: "auto", emoji: "🚗", name: "Auto", owner: "", created: "1" }];
const routines = [
  {
    id: "fb",
    emoji: "⚽",
    title: "Fußballtraining",
    time: "17:00",
    kind: "hobby",
    who: "member",
    member: "kid1",
    days: ["1"],
    hint: "",
  },
  {
    id: "kl",
    emoji: "🎹",
    title: "Klavierstunde",
    time: "",
    kind: "hobby",
    who: "member",
    member: "kid2",
    days: ["1"],
    hint: "Noten",
  },
  {
    id: "hw",
    emoji: "📚",
    title: "Hausaufgaben",
    time: "",
    kind: "chore",
    who: "kids",
    days: ["0", "1", "2", "3", "4"],
    hint: "",
  },
];
const todo = (o) => ({ id: o.title, who: "papa", due: "", area: "", done: "", ...o });
const TUE = "2026-10-13";

function stubData(initial) {
  const rows = { ...initial };
  const subs = {};
  const calls = [];
  return {
    calls,
    set(c, value) {
      rows[c] = value;
      (subs[c] || []).forEach((cb) => cb(value));
    },
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb(rows[c] || []);
      return () => {};
    },
    create: async (c, r) => calls.push(["create", c, r]),
    update: async (c, id, r) => calls.push(["update", c, id, r]),
    delete: async (c, id) => calls.push(["delete", c, id]),
  };
}

function mount(data, { me = "papa", store } = {}) {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const fake = store && {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
  try {
    const doc = createDocument();
    const create = doc.createElement;
    doc.createElement = (tag) => Object.assign(create(tag), { focus() {} }); // the helper has no focus()
    const view = doc.createElement("div");
    view.ownerDocument = doc;
    eltern.screen(view, {
      data,
      auth: { record: () => ({ member: me }) },
      clock: { today: () => MON },
    });
    return view;
  } finally {
    // the screen reads storage again on every mode change, so keep the stub installed for the test's duration
    if (!store) restore(real);
  }
}
function restore(real) {
  if (real) Object.defineProperty(globalThis, "localStorage", real);
  else delete globalThis.localStorage;
}

const fresh = (todos = []) => stubData({ members, todos, areas, routines, routine_done: [] });
const toCalendar = (view) => view.querySelector('[data-mode="calendar"]').click();
const day = (view, key) => view.querySelector(`[data-day="${key}"]`);
const agendaTitles = (view) => view.querySelectorAll('[data-role="agenda"] .tt').map((e) => e.textContent);

test("Mode Switch: Kalender replaces the grouped list and the quick add stays at the top", () => {
  const view = mount(fresh([todo({ title: "Offen", due: MON })]));
  assert.ok(view.querySelector('[data-group="today"]'));
  assert.equal(view.querySelector('[data-role="month-grid"]'), null);
  toCalendar(view);
  assert.ok(view.querySelector('[data-role="month-grid"]'));
  assert.equal(view.querySelector('[data-group="today"]'), null);
  assert.equal(view.querySelector('[data-mode="calendar"]').getAttribute("aria-pressed"), "true");
  const eltern_ = view.querySelector(".eltern");
  const roles = eltern_.children.map((c) => c.getAttribute("data-role") || c.className);
  assert.ok(roles.indexOf("quick-add") > -1 && roles.indexOf("quick-add") < roles.indexOf("cal-head"));
  view.querySelector('[data-mode="list"]').click();
  assert.ok(view.querySelector('[data-group="today"]'));
});

test("Mode Switch: the choice is stored per device and restored on the next open", () => {
  const store = new Map();
  const first = mount(fresh(), { store });
  toCalendar(first);
  assert.equal(store.get("hh.eltern.mode"), "calendar");
  const second = mount(fresh(), { store });
  assert.ok(second.querySelector('[data-role="month-grid"]'), "reopens in calendar mode");
  restore(undefined);
});

test("Month View: Monday-first header, October 2026 starts on a Thursday, today is highlighted", () => {
  const view = mount(fresh());
  toCalendar(view);
  assert.deepEqual(
    view.querySelectorAll(".mcal .wd").map((e) => e.textContent),
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  );
  assert.equal(view.querySelectorAll(".mcal .pad").length, 3);
  assert.equal(view.querySelectorAll(".mcal [data-day]").length, 31);
  assert.equal(view.querySelector('[data-role="cal-title"]').textContent, "Oktober 2026");
  assert.match(day(view, MON).className, /\btoday\b/);
  assert.match(day(view, MON).className, /\bsel\b/);
  assert.match(day(view, "2026-10-11").className, /\bpast\b/);
  assert.equal(view.querySelectorAll(".mcal .today").length, 1);
});

test("Month View: Tuesday shows peach, mauve and both parents' colours", () => {
  const view = mount(fresh([todo({ title: "Kinderarzt", who: "parents", due: TUE })]));
  toCalendar(view);
  assert.deepEqual(
    day(view, TUE)
      .querySelectorAll("i")
      .map((i) => i.getAttribute("data-colour")),
    ["peach", "mauve", "blue", "pink"],
  );
  assert.equal(day(view, "2026-10-14").querySelectorAll("i").length, 0, "Wednesday has no chores as markers");
});

test("Month View: previous, next and Heute move through months and back", () => {
  const view = mount(fresh());
  toCalendar(view);
  const title = () => view.querySelector('[data-role="cal-title"]').textContent;
  view.querySelector('[data-role="cal-next"]').click();
  assert.equal(title(), "November 2026");
  assert.equal(view.querySelectorAll(".mcal .pad").length, 6, "1 Nov 2026 is a Sunday");
  assert.match(day(view, "2026-11-01").className, /\bsel\b/, "the first of the month is selected");
  view.querySelector('[data-role="cal-prev"]').click();
  view.querySelector('[data-role="cal-prev"]').click();
  assert.equal(title(), "September 2026");
  view.querySelector('[data-role="cal-today"]').click();
  assert.equal(title(), "Oktober 2026");
  assert.match(day(view, MON).className, /\bsel\b/);
  // across the year boundary
  for (let i = 0; i < 3; i++) view.querySelector('[data-role="cal-next"]').click();
  assert.equal(title(), "Januar 2027");
});

test("Day Agenda: Fußballtraining, then Klavierstunde, then the to-do; each shows emoji, owner and hint", () => {
  const view = mount(fresh([todo({ title: "Kinderarzt anrufen", due: TUE })]));
  toCalendar(view);
  day(view, TUE).click();
  assert.equal(view.querySelector('[data-role="agenda-heading"]').textContent, "Morgen, 13. Oktober");
  assert.deepEqual(agendaTitles(view), ["17:00Fußballtraining", "Klavierstunde", "Kinderarzt anrufen"]);
  const metas = view.querySelectorAll('[data-role="agenda"] .ev .meta').map((e) => e.textContent);
  assert.deepEqual(metas, ["Test-Kind-1", "Test-Kind-2 · Noten"]);
  assert.equal(view.querySelectorAll('[data-role="agenda"] .evi')[0].textContent, "⚽");
  assert.equal(view.querySelectorAll(".ev .cb").length, 0, "routine entries have no check box");
});

test("Entry Sources: Hausaufgaben never appears in the agenda; an empty day says so", () => {
  const view = mount(fresh());
  toCalendar(view);
  day(view, "2026-10-14").click();
  assert.deepEqual(agendaTitles(view), []);
  assert.ok(view.querySelector('[data-role="empty"]'));
  day(view, TUE).click();
  assert.ok(!agendaTitles(view).some((t) => t.includes("Hausaufgaben")));
});

test("Day Agenda: to-dos are completable and editable as in list mode", () => {
  const data = fresh([todo({ title: "Kinderarzt anrufen", id: "t1", due: TUE })]);
  const view = mount(data);
  toCalendar(view);
  day(view, TUE).click();
  view.querySelector('[data-todo="t1"] [data-role="check"]').click();
  assert.deepEqual(data.calls.pop(), ["update", "todos", "t1", { done: MON }]);
  view.querySelector('[data-todo="t1"] [data-role="open-editor"]').click();
  assert.ok(view.querySelector('[data-box="t1"]'), "the same inline editor opens in the agenda");
  view.querySelector('[data-box="t1"] [data-role="edit-who"] [data-who="mama"]').click();
  assert.deepEqual(data.calls.pop(), ["update", "todos", "t1", { who: "mama" }]);
  view.querySelector('[data-box="t1"] [data-role="delete"]').click();
  assert.deepEqual(data.calls.pop(), ["delete", "todos", "t1"]);
});

test("Adding on a Selected Day: the placeholder names the day and the to-do is due on it", () => {
  const data = fresh();
  const view = mount(data);
  toCalendar(view);
  assert.match(
    view.querySelector('[data-key="quick-title"]').getAttribute("placeholder"),
    /am Mo\., 12\.10\./,
  );
  assert.equal(
    view.querySelector('[data-role="quick-due"]'),
    null,
    "no due chips: the selected day is the due date",
  );
  day(view, "2026-10-15").click();
  const input = view.querySelector('[data-key="quick-title"]');
  assert.equal(input.getAttribute("placeholder"), "Neue Aufgabe am Do., 15.10.…");
  input.value = "Geschenk kaufen";
  view.querySelector('[data-role="quick-add"]').dispatch("submit");
  assert.equal(data.calls.length, 1);
  assert.deepEqual(data.calls[0][2], {
    title: "Geschenk kaufen",
    who: "papa",
    due: "2026-10-15",
    area: "",
    done: "",
  });
  data.set("todos", [todo({ title: "Geschenk kaufen", due: "2026-10-15" })]);
  assert.deepEqual(agendaTitles(view), ["Geschenk kaufen"], "it appears in that day's agenda");
  assert.equal(day(view, "2026-10-15").querySelectorAll("i").length, 1);
});

test("Adding on a Selected Day: in list mode the due chips still decide the date", () => {
  const data = fresh();
  const view = mount(data);
  assert.ok(view.querySelector('[data-role="quick-due"]'));
  const input = view.querySelector('[data-key="quick-title"]');
  input.value = "Liste";
  view.querySelector('[data-role="quick-add"]').dispatch("submit");
  assert.equal(data.calls[0][2].due, "");
});

test("Area Filter in Calendar: Auto leaves only its to-dos as markers and hides routines", () => {
  const view = mount(
    fresh([
      todo({ title: "Reifen", due: TUE, area: "auto" }),
      todo({ title: "Router", due: TUE, area: "tech" }),
    ]),
  );
  toCalendar(view);
  assert.equal(day(view, TUE).querySelectorAll("i").length, 4, "unfiltered: two events and two to-dos");
  view.querySelector('[data-area-card="auto"]').click();
  assert.equal(day(view, TUE).querySelectorAll("i").length, 1);
  assert.equal(day(view, TUE).querySelector("i").getAttribute("data-colour"), "blue");
  day(view, TUE).click();
  assert.deepEqual(agendaTitles(view), ["Reifen"]);
  assert.match(
    view.querySelector('[data-key="quick-title"]').getAttribute("placeholder"),
    /für Auto am Di\., 13\.10\./,
  );
  view.querySelector('[data-role="clear-area"]').click();
  assert.equal(day(view, TUE).querySelectorAll("i").length, 4);
});

test("Calendar is live: a to-do arriving through the subscription adds its marker", () => {
  const data = fresh();
  const view = mount(data);
  toCalendar(view);
  assert.equal(day(view, "2026-10-21").querySelectorAll("i").length, 0);
  data.set("todos", [todo({ title: "Neu", who: "mama", due: "2026-10-21" })]);
  assert.equal(day(view, "2026-10-21").querySelector("i").getAttribute("data-colour"), "pink");
});
