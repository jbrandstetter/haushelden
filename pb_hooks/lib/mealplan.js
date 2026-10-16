// Governing: ADR-0007 (server-side, idempotent list changes), SPEC-0009 REQ "Ingredients to the Shopping List",
// REQ "Dish Library" (last planned), Security Requirements "Input", SPEC-0005 REQ "Adding Items"
//
// Helpers for pb_hooks/mealplan.pb.js. The pure part (limits, ingredient parsing, the request check, the plan of
// what to add) is unit-tested under Node (test/mealplan-hooks.test.js); the PocketBase part takes the app (or
// transaction app) as an argument and is covered against a real server in test/rules/mealplan.test.js.
// Item names use the shopping list's own normalisation (lib/shopping.js), so a meal's "Zwiebeln" and a typed
// "zwiebeln " are the same item.

/* global Record */
const shopping = require("./shopping.js");

const MAX_TITLE = 80;
const MAX_NOTE = 200;
const MAX_INGREDIENT = 60;
const MAX_INGREDIENTS = 40;
const MAX_RANGE_DAYS = 14;
const FOOD_LIST = "list1food000001"; // the migration's default grocery list ("Lebensmittel")
const ID_RE = /^[a-z0-9]{15}$/;

/** The non-empty, whitespace-normalised lines of an ingredient text. */
const ingredientLines = (text) =>
  String(text == null ? "" : text)
    .split(/\r?\n/)
    .map(shopping.normalizeName)
    .filter((line) => line !== "");

/** A German message when the ingredient text breaks the limits, else "". */
function checkIngredients(text) {
  const lines = ingredientLines(text);
  if (lines.length > MAX_INGREDIENTS) return `Höchstens ${MAX_INGREDIENTS} Zutaten pro Gericht.`;
  if (lines.some((l) => l.length > MAX_INGREDIENT)) {
    return `Eine Zutat darf höchstens ${MAX_INGREDIENT} Zeichen lang sein.`;
  }
  return "";
}

/** The ingredient text as stored: one normalised name per line, empty lines dropped. */
const cleanIngredients = (text) => ingredientLines(text).join("\n");

/**
 * Checks the body of POST /api/hh/mealplan/shopping. Returns `{ from, to }`, `{ dish }` or `{ error }`.
 * A range is at most MAX_RANGE_DAYS days (both ends included); a body with both or neither is refused.
 */
function parseRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const hasDish = b.dish !== undefined && b.dish !== "";
  const hasRange = b.from !== undefined || b.to !== undefined;
  if (hasDish === hasRange) return { error: "Bitte ein Gericht oder einen Zeitraum angeben." };
  if (hasDish) {
    if (typeof b.dish !== "string" || !ID_RE.test(b.dish)) return { error: "Ungültiges Gericht." };
    return { dish: b.dish };
  }
  const from = shopping.dayNumber(String(b.from));
  const to = shopping.dayNumber(String(b.to));
  if (typeof b.from !== "string" || typeof b.to !== "string" || Number.isNaN(from) || Number.isNaN(to)) {
    return { error: "Ungültiger Zeitraum." };
  }
  if (to < from) return { error: "Das Ende liegt vor dem Anfang." };
  if (to - from + 1 > MAX_RANGE_DAYS) return { error: `Höchstens ${MAX_RANGE_DAYS} Tage auf einmal.` };
  return { from: b.from, to: b.to };
}

/**
 * What an action would do. `meals` is `[{ source, ingredients }]` in plan order, `taken` the set of name keys that
 * are already on the list (open or in the cart). Each distinct name is added at most once (the first meal that
 * needs it is its source); `existing` counts the distinct names that were already there.
 * @returns {{ add: { name: string, key: string, source: string }[], existing: number }}
 */
function planAdditions(meals, taken) {
  const seen = new Set();
  const add = [];
  let existing = 0;
  for (const meal of meals) {
    for (const name of ingredientLines(meal.ingredients)) {
      const key = shopping.nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      if (taken.has(key)) existing++;
      else add.push({ name, key, source: String(meal.source).slice(0, MAX_TITLE) });
    }
  }
  return { add, existing };
}

/** The grocery list: the migration's default list, else one named Lebensmittel, else the first list. */
function groceryList(app) {
  try {
    return app.findRecordById("lists", FOOD_LIST);
  } catch {
    // renamed or replaced: look further
  }
  try {
    return app.findFirstRecordByFilter("lists", "name = 'Lebensmittel'");
  } catch {
    const all = app.findAllRecords("lists");
    return all.length > 0 ? all[0] : null;
  }
}

/** The meals a request refers to, as `[{ source, ingredients }]`; null when the single dish does not exist. */
function collectMeals(app, request) {
  if (request.dish) {
    try {
      const dish = app.findRecordById("dishes", request.dish);
      return [{ source: dish.getString("name"), ingredients: dish.getString("ingredients") }];
    } catch {
      return null;
    }
  }
  const entries = app.findRecordsByFilter(
    "meal_plan",
    "date >= {:from} && date <= {:to} && dish != ''",
    "date,slot",
    500,
    0,
    { from: request.from, to: request.to },
  );
  const dishes = {};
  const meals = [];
  for (const entry of entries) {
    const id = entry.getString("dish");
    if (!(id in dishes)) {
      try {
        dishes[id] = app.findRecordById("dishes", id);
      } catch {
        dishes[id] = null;
      }
    }
    if (dishes[id]) {
      meals.push({ source: entry.getString("title"), ingredients: dishes[id].getString("ingredients") });
    }
  }
  return meals;
}

/**
 * Adds the ingredients of the request to the grocery list as open items, in one transaction. Idempotent: a name
 * that is already open or in the cart is not added again, so repeating the action adds nothing. A purchase is never
 * recorded. Returns `{ added, existing }`, or null when the dish or the list does not exist.
 */
function addToShopping(app, request, memberId) {
  let result = null;
  app.runInTransaction((tx) => {
    const list = groceryList(tx);
    const meals = collectMeals(tx, request);
    if (!list || !meals) return;
    const taken = new Set(
      tx
        .findRecordsByFilter("shop_items", "list = {:list}", "", 0, 0, { list: list.id })
        .map((r) => r.getString("key")),
    );
    const plan = planAdditions(meals, taken);
    const collection = tx.findCollectionByNameOrId("shop_items");
    let added = 0;
    let existing = plan.existing;
    for (const entry of plan.add) {
      const item = new Record(collection);
      item.set("list", list.id);
      item.set("name", entry.name);
      item.set("key", entry.key);
      item.set("auto", false);
      item.set("bought", "");
      item.set("source_meal", entry.source);
      if (memberId) item.set("by", memberId);
      try {
        tx.save(item);
        added++;
      } catch (err) {
        // Lost a race with another writer of the same name: it is on the list now, which is the goal.
        if (shopping.findOpenDuplicate(tx, list.id, entry.key, "") === null) throw err;
        existing++;
      }
    }
    result = { added, existing };
  });
  return result;
}

/** Sets the dish's `last_planned` to the entry's day when that is later (create or move to a later day). */
function touchDish(app, entry) {
  const id = entry.getString("dish");
  if (!id) return;
  let dish;
  try {
    dish = app.findRecordById("dishes", id);
  } catch {
    return;
  }
  const date = entry.getString("date");
  if (dish.getString("last_planned") < date) {
    dish.set("last_planned", date);
    app.save(dish);
  }
}

/** True when a record with this id already exists (a replayed create whose first response was lost). */
function recordExists(app, collection, id) {
  if (!id) return false;
  try {
    app.findRecordById(collection, id);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MAX_TITLE,
  MAX_NOTE,
  MAX_INGREDIENT,
  MAX_INGREDIENTS,
  MAX_RANGE_DAYS,
  FOOD_LIST,
  ingredientLines,
  checkIngredients,
  cleanIngredients,
  parseRequest,
  planAdditions,
  groceryList,
  addToShopping,
  touchDish,
  recordExists,
};
