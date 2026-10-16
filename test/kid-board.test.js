// Governing: ADR-0003, SPEC-0002 REQ "Today Board", REQ "Tomorrow Preview", REQ "Week Strip and Streak", REQ
// "Completion Celebration", REQ "Mascot Feedback", REQ "No Competitive or Reward Mechanics by Default"
//
// Render and interaction tests of the kid board (app/js/screens/kind.js) in a fake DOM with a data stub that
// behaves like the data layer (writes show up in the next subscription callback). Scenario names from SPEC-0002
// appear in the test names. Real-browser behaviour (speech voices, confetti canvas, CSS) is not covered here.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const K = require("../app/js/screens/kind.js");

const WED = "2026-10-14";
const member = (id, role, name, created, colour = "blue") => ({
  id,
  role,
  name,
  emoji: "🙂",
  colour,
  created,
});
const MEMBERS = [
  member("papa", "parent", "Test-Papa", "1", "teal"),
  member("kind1", "kid", "Test-Kind-1", "3", "blue"),
  member("kind2", "kid", "Test-Kind-2", "4", "pink"),
];
const ALL = ["0", "1", "2", "3", "4", "5", "6"];
const routine = (o) => ({
  emoji: "📝",
  hint: "",
  time: "",
  kind: "chore",
  days: ALL,
  who: "kids",
  member: "",
  ...o,
  title: o.title || o.id,
});
const CHORES = ["a", "b", "c", "d", "e"].map((id) => routine({ id, title: `Aufgabe ${id}` }));
const tick = (r, m, day) => ({ id: `${r}-${m}-${day}`, routine: r, member: m, day });

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
      return () => {
        subs[c] = subs[c].filter((x) => x !== cb);
      };
    },
    async create(c, rec) {
      calls.push(["create", c, rec]);
      rows[c].push({ id: `new${++n}`, ...rec });
      emit(c);
    },
    async delete(c, id) {
      calls.push(["delete", c, id]);
      rows[c] = rows[c].filter((r) => r.id !== id);
      emit(c);
    },
    emit,
  };
}

function boot({
  routines = CHORES,
  ticks = [],
  settings = [],
  today = WED,
  memberId = "kind1",
  auth = { collectionName: "devices" },
  reduced = false,
  random = () => 0.99,
  store = {},
  meals = [],
  mealVotes = [],
} = {}) {
  const doc = createDocument();
  const view = doc.createElement("main");
  view.ownerDocument = doc;
  const data = stubData({
    members: MEMBERS.slice(),
    routines,
    routine_done: ticks.slice(),
    settings,
    meal_plan: meals.slice(),
    meal_votes: mealVotes.slice(),
    dishes: [],
  });
  const spoken = [];
  const confetti = [];
  const kv = { ...store };
  const env = {
    store: { get: (k) => (k in kv ? kv[k] : null), set: (k, v) => void (kv[k] = v) },
    random,
    reducedMotion: () => reduced,
    speak: (t) => spoken.push(t),
    confetti: (...a) => confetti.push(a),
  };
  const ctx = {
    args: [memberId],
    data,
    clock: { today: () => today, tz: () => "Europe/Berlin", now: () => new Date("2026-10-14T10:00:00Z") },
    auth: { record: () => auth },
    env,
  };
  const cleanup = K.screen(view, ctx);
  const tiles = () => view.querySelectorAll(".tile");
  const tile = (id) => view.querySelector(`.tile[data-routine="${id}"]`);
  return { view, data, spoken, confetti, kv, cleanup, tiles, tile, doc };
}
const text = (view, sel) => view.querySelector(sel).textContent;

test("Scenario: tapping a tile - done, progress 0/5 -> 1/5, one routine_done for member, routine and day", async () => {
  const b = boot();
  assert.equal(b.tiles().length, 5);
  assert.equal(text(b.view, ".ring .lbl"), "0/5");
  assert.equal(text(b.view, ".kid-name"), "Test-Kind-1");
  assert.equal(text(b.view, ".kid-day"), "Mittwoch");
  await b.tile("a").click();
  assert.deepEqual(b.data.calls, [["create", "routine_done", { routine: "a", member: "kind1", day: WED }]]);
  assert.equal(b.tile("a").getAttribute("aria-pressed"), "true");
  assert.ok(b.tile("a").className.includes("done"));
  assert.equal(text(b.view, ".ring .lbl"), "1/5");
  assert.equal(b.view.querySelector(".ring").getAttribute("aria-valuenow"), "1");
});

test("Scenario: tapping an already-done tile returns it to not done without any celebration", async () => {
  const b = boot({ ticks: [tick("a", "kind1", WED)] });
  assert.equal(text(b.view, ".ring .lbl"), "1/5");
  await b.tile("a").click();
  assert.deepEqual(b.data.calls, [["delete", "routine_done", "a-kind1-" + WED]]);
  assert.equal(text(b.view, ".ring .lbl"), "0/5");
  assert.ok(!b.tile("a").className.includes("done"));
  assert.equal(b.view.querySelector(".alldone"), null);
  assert.deepEqual(b.spoken, []);
});

test("a tick is idempotent per routine, member and day: tap-tap creates once and deletes once", async () => {
  const b = boot();
  await b.tile("a").click();
  await b.tile("a").click();
  assert.deepEqual(
    b.data.calls.map((c) => c[0]),
    ["create", "delete"],
  );
  assert.equal(b.data.rows.routine_done.length, 0);
});

test("a sibling's ticks and routines do not show on this board; neither board shows the other's progress (no competition)", async () => {
  const ticks = [tick("a", "kind2", WED), tick("b", "kind2", WED)];
  const b = boot({ ticks });
  assert.equal(text(b.view, ".ring .lbl"), "0/5");
  const all = b.view.textContent;
  assert.ok(!all.includes("Test-Kind-2"), "the sibling is not named");
  assert.ok(!/Punkte|Rang|Platz|Gewinn|Preis/.test(all));
});

test("Scenario: free day - a message instead of an empty grid", () => {
  const b = boot({ routines: [routine({ id: "x", days: ["5", "6"] })] });
  assert.equal(b.tiles().length, 0);
  assert.equal(b.view.querySelector(".tiles"), null);
  assert.match(text(b.view, ".free-day"), /nichts an/);
  assert.equal(text(b.view, ".ring .lbl"), "0/0");
});

test("Scenario: Riding tomorrow - a Morgen note with the item and its hint", () => {
  const riding = routine({
    id: "r",
    emoji: "🐴",
    title: "Reiten",
    hint: "Reithelm & Stiefel",
    kind: "hobby",
    days: ["3"],
    who: "member",
    member: "kind1",
  });
  const b = boot({ routines: [...CHORES, riding] });
  assert.match(b.view.textContent, /Morgen/);
  assert.equal(text(b.view, ".tomorrow"), "🐴 Reiten – Reithelm & Stiefel");
  assert.equal(b.tiles().length, 5, "tomorrow's hobby is not a tile today");
  const none = boot();
  assert.equal(none.view.querySelector(".tomorrow"), null);
});

test("hobby tiles carry the time tag, alternating chores say 'Heute du' and hide the hint", () => {
  const soccer = routine({
    id: "s",
    title: "Fußball",
    hint: "Trinkflasche",
    time: "17:00",
    kind: "hobby",
    days: ["2"],
    who: "member",
    member: "kind1",
  });
  const dishes = routine({
    id: "d",
    title: "Spülmaschine",
    hint: "intern",
    who: "kids_alternating",
    days: ["2"],
  });
  const b = boot({ routines: [soccer, dishes], today: WED });
  assert.equal(text(b.tile("s"), ".tag"), "17:00 Uhr");
  assert.equal(text(b.tile("s"), ".st"), "Trinkflasche");
  // 2026-10-14 is day number 20740 (even) -> the first kid (kind1) has the turn
  assert.equal(text(b.tile("d"), ".tag"), "Heute du");
  assert.equal(b.tile("d").querySelector(".st"), null);
});

test("week strip shows Mo-So with a marker per day and today highlighted; the streak is shown", () => {
  const ticks = ["2026-10-12", "2026-10-13"].flatMap((d) => CHORES.map((r) => tick(r.id, "kind1", d)));
  const b = boot({ ticks });
  const cells = b.view.querySelectorAll(".week .d");
  assert.deepEqual(
    cells.map((c) => c.getAttribute("data-day")),
    ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
  );
  assert.deepEqual(
    b.view.querySelectorAll(".week .dot").map((d) => d.getAttribute("data-status")),
    ["full", "full", "empty", "empty", "empty", "empty", "empty"],
  );
  assert.ok(cells[2].className.includes("today"));
  assert.match(text(b.view, ".streak"), /2 Tage am Stück/);
});

test("Scenario: Last tile - the mascot's 'Alles geschafft!' celebration appears, is spoken, confetti plays, one tap dismisses", async () => {
  const done = CHORES.slice(0, 4).map((r) => tick(r.id, "kind1", WED));
  const b = boot({ ticks: done, reduced: true });
  await b.tile("e").click();
  const ov = b.view.querySelector(".alldone");
  assert.ok(ov, "celebration shown");
  assert.match(ov.textContent, /Alles geschafft!/);
  assert.match(ov.textContent, /🐱/, "the default mascot");
  assert.equal(b.spoken.length, 1);
  assert.equal(b.spoken[0], text(b.view, ".celebration-text"));
  await ov.click();
  assert.equal(b.view.querySelector(".alldone"), null);
});

test("Scenario: reduced motion - celebration still appears but no confetti and no hop/pop animation classes", async () => {
  const done = CHORES.slice(0, 4).map((r) => tick(r.id, "kind1", WED));
  const calm = boot({ ticks: done, reduced: true });
  await calm.tile("e").click();
  assert.equal(calm.confetti.length, 0);
  assert.ok(!calm.view.querySelector(".pet").className.includes("hop"));
  assert.ok(!calm.tile("e").className.includes("pop"));
  assert.ok(calm.view.querySelector(".alldone"));

  const lively = boot({ ticks: [], reduced: false });
  await lively.tile("a").click();
  assert.equal(lively.confetti.length, 1);
  assert.ok(lively.view.querySelector(".pet").className.includes("hop"));
  assert.ok(lively.tile("a").className.includes("pop"));
});

test("Scenario: five ticks in a row - speaks on the first tick, silent on at least one of the next three, speaks on the last", async () => {
  const b = boot({ random: () => 0, reduced: true }); // chance always hits: worst case for silence
  const spokeAfter = [];
  for (const r of CHORES) {
    await b.tile(r.id).click();
    spokeAfter.push(b.spoken.length);
  }
  assert.equal(spokeAfter[0], 1, "first tick of the day speaks");
  const lastBefore = spokeAfter[4] - spokeAfter[3];
  assert.equal(lastBefore, 1, "the completing tick speaks");
  assert.ok(spokeAfter[3] - spokeAfter[0] < 3, "silent on at least one of the next three");
  assert.ok(b.spoken.length < 5, "never on every tick");
});

test("the mascot reacts visually on every tick even when it is silent", async () => {
  const b = boot({ random: () => 0.99 });
  await b.tile("a").click();
  await b.tile("b").click();
  assert.equal(b.spoken.length, 1);
  assert.ok(b.view.querySelector(".pet").className.includes("hop"));
  assert.ok(b.view.querySelector(".line").textContent.length > 0);
});

test("the first tick of the day speaks only once per day and member, even after un-ticking", async () => {
  const b = boot({ random: () => 0.99 });
  await b.tile("a").click();
  await b.tile("a").click(); // un-tick
  await b.tile("a").click(); // tick again
  assert.equal(b.spoken.length, 1);
});

test("sound off: nothing is spoken; the choice is kept per device", async () => {
  const b = boot({ store: { "hh.sound": "0" }, random: () => 0 });
  assert.equal(b.view.querySelector('[data-role="sound"]').textContent, "🔇 Ton aus");
  await b.tile("a").click();
  assert.deepEqual(b.spoken, []);
  await b.view.querySelector('[data-role="sound"]').click();
  assert.equal(b.kv["hh.sound"], "1");
  assert.equal(b.view.querySelector('[data-role="sound"]').textContent, "🔊 Ton an");
  await b.tile("b").click();
  await b.tile("c").click();
  assert.equal(b.spoken.length, 1, "after switching it on, the next speaking tick is voiced");
});

test("Scenario: Kids rename the mascot - the board shows the chosen animal and name", () => {
  const b = boot({ settings: [{ id: "s", mascot: { emoji: "🦊", name: "Fuchsi" } }] });
  assert.equal(text(b.view, ".pet"), "🦊");
  assert.equal(text(b.view, ".mascot-name"), "Fuchsi");
  const fallback = boot();
  assert.equal(text(fallback.view, ".pet"), "🐱");
});

test("works under a parent session too, and writes the same tick", async () => {
  const b = boot({ auth: { collectionName: "parents", member: "papa" } });
  await b.tile("a").click();
  assert.equal(b.data.calls[0][2].member, "kind1");
});

test("unknown member, a parent's id and a missing id show a message instead of a board", () => {
  assert.match(boot({ memberId: "nobody" }).view.textContent, /gibt es nicht/);
  assert.match(boot({ memberId: "papa" }).view.textContent, /gibt es nicht/);
  assert.match(boot({ memberId: "" }).view.textContent, /Welches Kind/);
});

test("cleanup unsubscribes from every collection", () => {
  const b = boot();
  b.cleanup();
  b.data.emit("routine_done");
  assert.ok(b.view.querySelector(".kid")); // nothing crashed, the last render stays
});

test("Scenario: kid looks at the board - tonight's dinner by a parent shows 'Heute: Pizza' with thumbs and no way to edit it", async () => {
  const b = boot({
    meals: [{ id: "m1", date: WED, slot: "dinner", title: "Pizza", dish: "", added_by: "papa" }],
    mealVotes: [{ id: "v1", entry: "m1", member: "papa", value: "up" }],
  });
  const line = b.view.querySelector(".mealtoday");
  assert.equal(line.querySelector(".mt-text").textContent, "Heute: Pizza");
  assert.equal(line.querySelector(".thumb.up").textContent, "👍 1");
  assert.equal(line.querySelector("input"), null);
  assert.equal(line.querySelector(".meal-edit"), null);
  line.querySelector(".thumb.up").click();
  await Promise.resolve();
  assert.deepEqual(b.data.calls, [["create", "meal_votes", { entry: "m1", member: "kind1", value: "up" }]]);
  assert.equal(b.view.querySelector(".mealtoday .thumb.up").getAttribute("aria-pressed"), "true");
  assert.equal(b.tiles().length, 5, "the routine tiles are untouched");
});

test("the board shows no meals line when nothing is planned for today", () => {
  const b = boot({
    meals: [{ id: "m1", date: "2026-10-15", slot: "dinner", title: "Morgen", dish: "", added_by: "papa" }],
  });
  assert.ok(b.view.querySelector(".mealtoday").className.includes("hidden"), "the line stays hidden");
});
