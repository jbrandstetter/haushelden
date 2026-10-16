// Governing: SPEC-0009 REQ "Ingredients to the Shopping List", Security Requirements "Input"; ADR-0007
// The pure helpers of the meal plan hooks (the hooks themselves run against PocketBase in test/rules/mealplan.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../pb_hooks/lib/mealplan.js");
const shopping = require("../pb_hooks/lib/shopping.js");

test("ingredient lines are trimmed, whitespace-collapsed and empty lines dropped", () => {
  assert.deepEqual(lib.ingredientLines("  Reis \r\n\n  rote   Zwiebeln\n"), ["Reis", "rote Zwiebeln"]);
  assert.deepEqual(lib.ingredientLines(""), []);
  assert.deepEqual(lib.ingredientLines(null), []);
  assert.equal(lib.cleanIngredients(" a \n\n b "), "a\nb");
});

test("limits: 40 ingredients of 60 characters", () => {
  const lines = (n, len = 5) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(len, "x")).join("\n");
  assert.equal(lib.checkIngredients(lines(40, 60)), "");
  assert.match(lib.checkIngredients(lines(41)), /40/);
  assert.match(lib.checkIngredients("x".repeat(61)), /60/);
  assert.equal(lib.checkIngredients("\n\n\n"), "", "blank lines do not count");
});

test("the request is either a dish or a range of at most 14 days", () => {
  assert.deepEqual(lib.parseRequest({ dish: "abcde1234567890" }), { dish: "abcde1234567890" });
  assert.deepEqual(lib.parseRequest({ from: "2026-11-02", to: "2026-11-15" }), {
    from: "2026-11-02",
    to: "2026-11-15",
  });
  assert.deepEqual(lib.parseRequest({ from: "2026-11-02", to: "2026-11-02" }), {
    from: "2026-11-02",
    to: "2026-11-02",
  });
  for (const body of [
    undefined,
    null,
    {},
    { dish: "" },
    { dish: 5 },
    { dish: "short" },
    { dish: "abcde1234567890", from: "2026-11-02", to: "2026-11-03" },
    { from: "2026-11-02" },
    { to: "2026-11-02" },
    { from: "2026-11-02", to: "2026-11-16" },
    { from: "2026-11-05", to: "2026-11-02" },
    { from: "2026-02-30", to: "2026-03-02" },
    { from: 20261102, to: 20261103 },
  ]) {
    assert.ok(lib.parseRequest(body).error, JSON.stringify(body));
  }
});

test("planning additions: each name once, the first meal is the source, names already on the list are counted", () => {
  const meals = [
    { source: "Spaghetti", ingredients: "Spaghetti\nZwiebeln\nMilch" },
    { source: "Curry", ingredients: " zwiebeln \nReis" },
    { source: "Leer", ingredients: "" },
  ];
  const plan = lib.planAdditions(meals, new Set(["milch"]));
  assert.deepEqual(
    plan.add.map((a) => [a.name, a.key, a.source]),
    [
      ["Spaghetti", "spaghetti", "Spaghetti"],
      ["Zwiebeln", "zwiebeln", "Spaghetti"],
      ["Reis", "reis", "Curry"],
    ],
  );
  assert.equal(plan.existing, 1);
  const again = lib.planAdditions(meals, new Set(["spaghetti", "zwiebeln", "milch", "reis"]));
  assert.deepEqual(again, { add: [], existing: 4 });
});

test("ingredient keys are the shopping list's keys, so the same name never differs", () => {
  const [item] = lib.planAdditions([{ source: "x", ingredients: "  KÄSE   Reibe " }], new Set()).add;
  assert.equal(item.key, shopping.nameKey("käse reibe"));
  assert.equal(item.name, "KÄSE Reibe");
});

test("the source meal is kept within the item field's limit", () => {
  const [item] = lib.planAdditions([{ source: "m".repeat(200), ingredients: "Salz" }], new Set()).add;
  assert.equal(item.source.length, lib.MAX_TITLE);
});
