// Governing: ADR-0001 (PocketBase as the household backend), ADR-0007 (server-side, idempotent list changes),
// SPEC-0009 REQ "Dish Library" (planning a dish updates its last planned date), REQ "Ingredients to the Shopping
// List", Security Requirements "Authorisation", "Input" and "Rate limiting"
//
//  - POST /api/hh/mealplan/shopping {from, to} or {dish}: parents only (PIN sessions included); adds the
//    ingredients to the grocery list in one transaction and answers {added, existing}. Like the other /api/hh/
//    routes it has a small body limit and needs a session; it records no purchase.
//  - meal_plan create/update: `dishes.last_planned` follows the planned day (inside the write's transaction).
//  - request hooks: titles and names are stored trimmed, ingredient lists are checked against the limits (the
//    collection rules and field limits cannot count lines), and a replayed create is reported as "id already
//    exists" (the client treats that as done).
// (Handlers run in isolated scopes: helpers live in lib/mealplan.js.)

/* global BadRequestError, NotFoundError */

routerAdd(
  "POST",
  "/api/hh/mealplan/shopping",
  (e) => {
    const m = require(`${__hooks}/lib/mealplan.js`);
    const request = m.parseRequest(e.requestInfo().body);
    if (request.error) throw new BadRequestError(request.error);
    const result = m.addToShopping(e.app, request, e.auth.getString("member"));
    if (!result)
      throw new NotFoundError(request.dish ? "Gericht nicht gefunden." : "Keine Einkaufsliste gefunden.");
    return e.json(200, result);
  },
  $apis.bodyLimit(1024),
  $apis.requireAuth("parents"),
);

onRecordCreate((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  e.next();
  m.touchDish(e.app, e.record);
}, "meal_plan");

onRecordUpdate((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  e.next();
  m.touchDish(e.app, e.record);
}, "meal_plan");

onRecordCreateRequest((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  const s = require(`${__hooks}/lib/shopping.js`);
  if (m.recordExists(e.app, "meal_plan", e.record.id)) {
    throw s.invalid("id", "validation_not_unique", "Dieser Eintrag existiert schon.");
  }
  if (Number.isNaN(s.dayNumber(e.record.getString("date")))) {
    throw s.invalid("date", "invalid_day", "Ungültiges Datum.");
  }
  e.record.set("title", s.normalizeName(e.record.getString("title")));
  e.record.set("note", s.normalizeName(e.record.getString("note")));
  e.next();
}, "meal_plan");

onRecordUpdateRequest((e) => {
  const s = require(`${__hooks}/lib/shopping.js`);
  if (Number.isNaN(s.dayNumber(e.record.getString("date")))) {
    throw s.invalid("date", "invalid_day", "Ungültiges Datum.");
  }
  e.record.set("title", s.normalizeName(e.record.getString("title")));
  e.record.set("note", s.normalizeName(e.record.getString("note")));
  e.next();
}, "meal_plan");

onRecordCreateRequest((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  const s = require(`${__hooks}/lib/shopping.js`);
  if (m.recordExists(e.app, "dishes", e.record.id)) {
    throw s.invalid("id", "validation_not_unique", "Dieser Eintrag existiert schon.");
  }
  const problem = m.checkIngredients(e.record.getString("ingredients"));
  if (problem) throw s.invalid("ingredients", "invalid_ingredients", problem);
  e.record.set("name", s.normalizeName(e.record.getString("name")));
  e.record.set("ingredients", m.cleanIngredients(e.record.getString("ingredients")));
  e.next();
}, "dishes");

onRecordUpdateRequest((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  const s = require(`${__hooks}/lib/shopping.js`);
  const problem = m.checkIngredients(e.record.getString("ingredients"));
  if (problem) throw s.invalid("ingredients", "invalid_ingredients", problem);
  e.record.set("name", s.normalizeName(e.record.getString("name")));
  e.record.set("ingredients", m.cleanIngredients(e.record.getString("ingredients")));
  e.next();
}, "dishes");

onRecordCreateRequest((e) => {
  const m = require(`${__hooks}/lib/mealplan.js`);
  const s = require(`${__hooks}/lib/shopping.js`);
  if (m.recordExists(e.app, "meal_votes", e.record.id)) {
    throw s.invalid("id", "validation_not_unique", "Dieser Eintrag existiert schon.");
  }
  e.next();
}, "meal_votes");
