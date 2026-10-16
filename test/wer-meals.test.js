// Governing: SPEC-0009 REQ "What Is for Dinner Today" (the profile chooser shows today's meals read-only, with the thumbs)
// "Wer bist du?" (js/auth-ui.js) with the meals line, in a fake DOM against a stubbed data API.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const dates = require("../app/js/dates.js");
const meals = require("../app/js/meals.js");
const createUi = require("../app/js/auth-ui.js");

const MEMBERS = [
  { id: "kind1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "blue" },
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" },
];
const PLAN = [
  { id: "m1", date: "2026-10-14", slot: "dinner", title: "Pizza", dish: "", added_by: "papa" },
  { id: "m2", date: "2026-10-15", slot: "dinner", title: "Morgen", dish: "", added_by: "papa" },
];
const VOTES = [{ id: "v1", entry: "m1", member: "kind1", value: "up" }];

function open(kind, record) {
  globalThis.location = { hash: "" };
  const ui = createUi({ dates, meals, flow: { kind: () => kind } });
  const doc = createDocument();
  const make = doc.createElement;
  doc.createElement = (tag) => Object.assign(make(tag), { style: { setProperty() {} }, focus() {} });
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  const rows = { members: MEMBERS, meal_plan: PLAN, meal_votes: VOTES, dishes: [] };
  const calls = [];
  const cleanup = ui.wer(view, {
    args: [],
    clock: { todayNumber: () => 20000, today: () => "2026-10-14" },
    data: {
      subscribe(collection, cb) {
        cb(rows[collection] || []);
        return () => {};
      },
      async create(...a) {
        calls.push(a);
      },
    },
    auth: { record: () => record },
  });
  return { view, cleanup, calls };
}

test("a family device's chooser shows 'Heute: Pizza' with the thumbs as counts, nothing to edit or tap", () => {
  const { view } = open("device", { id: "dev1", collectionName: "devices" });
  const line = view.querySelector(".mealtoday");
  assert.equal(line.querySelector(".mt-text").textContent, "Heute: Pizza");
  assert.equal(line.querySelector(".thumb.up").textContent, "👍 1");
  assert.equal(line.querySelectorAll("button").length, 0, "no profile chosen yet: counts only");
  assert.equal(line.querySelectorAll("input").length, 0);
});

test("a signed-in parent's chooser lets them vote as themselves", async () => {
  const { view, calls } = open("parent", { id: "acc1", collectionName: "parents", member: "papa" });
  view.querySelector(".mealtoday .thumb.down").click();
  await Promise.resolve();
  assert.deepEqual(calls, [["meal_votes", { entry: "m1", member: "papa", value: "down" }]]);
});

test("the line is cleaned up with the screen", () => {
  const { cleanup } = open("device", { id: "dev1", collectionName: "devices" });
  assert.equal(typeof cleanup, "function");
  cleanup();
});
