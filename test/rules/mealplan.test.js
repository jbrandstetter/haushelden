// Governing: ADR-0001 (rules are the security model; hooks in one transaction), ADR-0003 (device accounts),
// ADR-0007 (server-side, idempotent list changes), SPEC-0009 REQ "Plan Entries", REQ "Dish Library", REQ "Thumbs
// Up and Down", REQ "Ingredients to the Shopping List", Security Requirements "Authorisation", "Input"
//
// The meal plan against a real throwaway PocketBase: the migration, the rules for parents, PIN sessions, family
// devices and anonymous callers (allowed operations paired with forbidden ones, each followed by a superuser read
// proving nothing changed), the unique slot and vote, the last-planned hook and the ingredient route.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startPocketBase } = require("./pocketbase.js");

const PW = "change-me-parent-pw-1";
const PIN = "246810";
const DEVICE_SECRET = "change-me-device-secret-0123456789abcdef";
const FOOD = "list1food000001";
const SHOPPING = "/api/hh/mealplan/shopping";

let pb;
let su;
const tokens = {};
const ids = {};

const rec = (collection, id = "") => `/api/collections/${collection}/records${id ? `/${id}` : ""}`;
const dayOffset = (base, n) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MON = "2026-11-02";
const create = (collection, token, body) => pb.api("POST", rec(collection), { token, body });
const patch = (collection, id, token, body) => pb.api("PATCH", rec(collection, id), { token, body });
const remove = (collection, id, token) => pb.api("DELETE", rec(collection, id), { token });
const superGet = async (collection, id) => (await pb.api("GET", rec(collection, id), { token: su })).data;
const superList = async (collection, filter = "") =>
  (await pb.api("GET", `${rec(collection)}?perPage=200&filter=${encodeURIComponent(filter)}`, { token: su }))
    .data.items;
async function superCreate(collection, body) {
  const res = await create(collection, su, body);
  assert.equal(res.status, 200, `fixture ${collection}: ${JSON.stringify(res.data)}`);
  return res.data;
}
const denied = (res, what) => assert.ok(res.status >= 400, `${what}: expected an error, got ${res.status}`);

/** A plan entry as a parent (added_by = the parent) or a device (added_by = a kid). */
const entry = (token, by, date, slot, extra = {}) =>
  create("meal_plan", token, { date, slot, title: "Test-Gericht", added_by: by, ...extra });
const shopping = (token, body) => pb.api("POST", SHOPPING, { token, body });
const itemsOnList = (list = FOOD) => superList("shop_items", `list = "${list}"`);

async function dish(name, ingredients, extra = {}) {
  return superCreate("dishes", { name, emoji: "🍝", ingredients, added_by: ids.papa, ...extra });
}

before(async () => {
  pb = await startPocketBase();
  su = pb.superToken;
  const member = async (key, role, name) => {
    ids[key] = (await superCreate("members", { role, name, emoji: "🙂", colour: "blue" })).id;
  };
  await member("papa", "parent", "Test-Papa");
  await member("mama", "parent", "Test-Mama");
  await member("kid1", "kid", "Test-Kind-1");
  await member("kid2", "kid", "Test-Kind-2");
  for (const [key, email] of [
    ["papa", "papa@example.test"],
    ["mama", "mama@example.test"],
  ]) {
    await superCreate("parents", {
      email,
      password: PW,
      passwordConfirm: PW,
      member: ids[key],
      emailVisibility: false,
    });
    tokens[key] = await pb.signIn("parents", email, PW);
  }
  await superCreate("devices", {
    email: "device-1@example.test",
    password: DEVICE_SECRET,
    passwordConfirm: DEVICE_SECRET,
    name: "Test-Tablet",
  });
  tokens.device = await pb.signIn("devices", "device-1@example.test", DEVICE_SECRET);
  assert.equal(
    (await pb.api("PUT", "/api/hh/pin", { token: tokens.papa, body: { pin: PIN, password: PW } })).status,
    200,
  );
  const pin = await pb.api("POST", "/api/hh/pin", {
    token: tokens.device,
    body: { member: ids.papa, pin: PIN },
  });
  assert.equal(pin.status, 200);
  tokens.pin = pin.data.token;
});

after(async () => {
  if (pb) await pb.stop();
});

describe("migration", () => {
  it("creates dishes, meal_plan and meal_votes with the unique indexes and the input limits", async () => {
    const col = async (name) => (await pb.api("GET", `/api/collections/${name}`, { token: su })).data;
    const plan = await col("meal_plan");
    assert.ok(plan.indexes.some((i) => /UNIQUE/i.test(i) && i.includes("`date`") && i.includes("`slot`")));
    const field = (c, n) => c.fields.find((f) => f.name === n);
    assert.equal(field(plan, "title").max, 80);
    assert.equal(field(plan, "note").max, 200);
    assert.deepEqual(field(plan, "slot").values, ["lunch", "dinner"]);
    assert.equal(field(plan, "dish").cascadeDelete, false);
    const votes = await col("meal_votes");
    assert.ok(
      votes.indexes.some((i) => /UNIQUE/i.test(i) && i.includes("`entry`") && i.includes("`member`")),
    );
    assert.equal(field(votes, "entry").cascadeDelete, true);
    assert.deepEqual(field(votes, "value").values, ["up", "down"]);
    const dishes = await col("dishes");
    for (const name of ["name", "emoji", "ingredients", "last_planned", "added_by"]) {
      assert.ok(field(dishes, name), `dishes.${name}`);
    }
    assert.ok(field(await col("shop_items"), "source_meal"));
  });

  it("anonymous callers read and write nothing", async () => {
    for (const c of ["dishes", "meal_plan", "meal_votes"]) {
      const list = await pb.api("GET", rec(c));
      assert.ok(list.status === 403 || (list.status === 200 && list.data.items.length === 0), c);
      denied(await create(c, undefined, { name: "x" }), `anonymous create ${c}`);
    }
  });

  it("is part of the data export", async () => {
    const res = await pb.api("GET", "/api/hh/export", { token: tokens.papa });
    for (const c of ["dishes", "meal_plan", "meal_votes"])
      assert.ok(Array.isArray(res.data.collections[c]), c);
  });
});

describe("plan entries: kids propose, parents override", () => {
  it("a parent sets any slot; a second entry for the same day and slot is refused", async () => {
    const first = await entry(tokens.papa, ids.papa, MON, "dinner", { title: "  Spaghetti   Test " });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.title, "Spaghetti Test", "title is stored normalised");
    denied(await entry(tokens.mama, ids.mama, MON, "dinner", { title: "Pizza" }), "second entry in the slot");
    assert.equal((await superList("meal_plan", `date = "${MON}" && slot = "dinner"`)).length, 1);
    assert.equal((await entry(tokens.mama, ids.mama, MON, "lunch")).status, 200, "the other slot is free");
  });

  it("a replayed create (same id) is reported as 'id already exists', not as a slot conflict", async () => {
    const first = await create("meal_plan", tokens.papa, {
      id: "replay000000001",
      date: dayOffset(MON, 1),
      slot: "lunch",
      title: "Reis",
      added_by: ids.papa,
    });
    assert.equal(first.status, 200);
    const again = await create("meal_plan", tokens.papa, {
      id: "replay000000001",
      date: dayOffset(MON, 1),
      slot: "lunch",
      title: "Reis",
      added_by: ids.papa,
    });
    assert.equal(again.status, 400);
    assert.ok(again.data.data.id, "the error names the id field");
  });

  it("a parent names themselves as the adder; a PIN session is a parent session", async () => {
    denied(await entry(tokens.papa, ids.mama, dayOffset(MON, 2), "lunch"), "parent naming the other parent");
    denied(await entry(tokens.papa, undefined, dayOffset(MON, 2), "lunch"), "parent without added_by");
    const viaPin = await entry(tokens.pin, ids.papa, dayOffset(MON, 2), "lunch", { title: "Suppe" });
    assert.equal(viaPin.status, 200, JSON.stringify(viaPin.data));
  });

  it("the family device reads everything and adds an entry to an empty slot as a kid", async () => {
    const list = await pb.api("GET", `${rec("meal_plan")}?perPage=200`, { token: tokens.device });
    assert.equal(list.status, 200);
    assert.ok(list.data.items.length >= 3);
    const day = dayOffset(MON, 4);
    const kidEntry = await entry(tokens.device, ids.kid1, day, "dinner", { title: "Pizza" });
    assert.equal(kidEntry.status, 200, JSON.stringify(kidEntry.data));
    ids.pizza = kidEntry.data.id;
    ids.pizzaDay = day;
    denied(await entry(tokens.device, ids.kid2, day, "dinner", { title: "Nudeln" }), "occupied slot");
    assert.equal((await superGet("meal_plan", ids.pizza)).title, "Pizza");
  });

  it("a device cannot write as a parent or without naming a member", async () => {
    const day = dayOffset(MON, 5);
    denied(await entry(tokens.device, ids.papa, day, "lunch"), "device naming a parent");
    denied(await entry(tokens.device, undefined, day, "lunch"), "device without added_by");
    denied(await entry(tokens.device, "", day, "lunch"), "device with an empty added_by");
    assert.equal((await superList("meal_plan", `date = "${day}"`)).length, 0);
  });

  it("a kid changes and clears their own entry", async () => {
    const changed = await patch("meal_plan", ids.pizza, tokens.device, { note: "mit Salami" });
    assert.equal(changed.status, 200);
    assert.equal((await superGet("meal_plan", ids.pizza)).note, "mit Salami");
    const day = dayOffset(MON, 5);
    const mine = await entry(tokens.device, ids.kid2, day, "lunch", { title: "Brot" });
    assert.equal((await remove("meal_plan", mine.data.id, tokens.device)).status, 204);
    assert.equal((await superList("meal_plan", `date = "${day}"`)).length, 0);
  });

  it("a kid cannot change or clear an entry a parent added", async () => {
    const parents = await superList("meal_plan", `date = "${MON}" && slot = "dinner"`);
    const id = parents[0].id;
    denied(await patch("meal_plan", id, tokens.device, { title: "Hackbraten" }), "device edits parent entry");
    denied(await remove("meal_plan", id, tokens.device), "device deletes parent entry");
    assert.equal((await superGet("meal_plan", id)).title, "Spaghetti Test");
  });

  it("added_by never changes after creation", async () => {
    denied(
      await patch("meal_plan", ids.pizza, tokens.device, { added_by: ids.papa }),
      "device takes it over",
    );
    denied(await patch("meal_plan", ids.pizza, tokens.papa, { added_by: ids.papa }), "parent re-assigns it");
    assert.equal((await superGet("meal_plan", ids.pizza)).added_by, ids.kid1);
    const same = await patch("meal_plan", ids.pizza, tokens.papa, { added_by: ids.kid1, note: "scharf" });
    assert.equal(same.status, 200, "naming the unchanged adder is harmless");
  });

  it("a parent overrides: replacing the kid's entry removes the old votes, and the kid cannot change the new one", async () => {
    const vote = await create("meal_votes", tokens.device, {
      entry: ids.pizza,
      member: ids.kid2,
      value: "up",
    });
    assert.equal(vote.status, 200);
    assert.equal((await remove("meal_plan", ids.pizza, tokens.mama)).status, 204);
    assert.equal((await superList("meal_votes", `entry = "${ids.pizza}"`)).length, 0, "votes cascade");
    const lasagne = await entry(tokens.mama, ids.mama, ids.pizzaDay, "dinner", { title: "Lasagne" });
    assert.equal(lasagne.status, 200);
    denied(
      await patch("meal_plan", lasagne.data.id, tokens.device, { title: "Pizza" }),
      "kid edits override",
    );
    denied(await remove("meal_plan", lasagne.data.id, tokens.device), "kid deletes override");
    assert.equal((await superGet("meal_plan", lasagne.data.id)).added_by, ids.mama);
  });

  it("titles, notes and slots are validated", async () => {
    const day = dayOffset(MON, 6);
    denied(await entry(tokens.papa, ids.papa, day, "lunch", { title: "x".repeat(81) }), "title of 81");
    denied(await entry(tokens.papa, ids.papa, day, "lunch", { note: "x".repeat(201) }), "note of 201");
    denied(await entry(tokens.papa, ids.papa, day, "lunch", { title: "   " }), "blank title");
    denied(await entry(tokens.papa, ids.papa, day, "brunch"), "unknown slot");
    denied(await entry(tokens.papa, ids.papa, "2026-13-40", "lunch"), "bad date");
    const ok = await entry(tokens.papa, ids.papa, day, "lunch", {
      title: "x".repeat(80),
      note: "y".repeat(200),
    });
    assert.equal(ok.status, 200);
  });
});

describe("dish library", () => {
  it("every member adds a dish; a kid edits and deletes only their own, a parent any", async () => {
    const mine = await create("dishes", tokens.device, {
      name: "Kinder-Pfannkuchen",
      emoji: "🥞",
      ingredients: "Mehl\nEier",
      added_by: ids.kid1,
    });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.equal((await patch("dishes", mine.data.id, tokens.device, { emoji: "🥞" })).status, 200);
    const parents = await dish("Test-Eintopf", "Kartoffeln\nKarotten");
    denied(await patch("dishes", parents.id, tokens.device, { name: "Hack" }), "kid edits parent dish");
    denied(await remove("dishes", parents.id, tokens.device), "kid deletes parent dish");
    denied(
      await create("dishes", tokens.device, { name: "Als Papa", added_by: ids.papa }),
      "device naming a parent",
    );
    assert.equal((await superGet("dishes", parents.id)).name, "Test-Eintopf");
    assert.equal((await patch("dishes", mine.data.id, tokens.mama, { emoji: "🍳" })).status, 200);
    assert.equal((await remove("dishes", mine.data.id, tokens.device)).status, 204);
    assert.equal((await remove("dishes", parents.id, tokens.mama)).status, 204);
  });

  it("limits: 40 ingredients of 60 characters, names normalised, empty lines dropped", async () => {
    const lines = (n) => Array.from({ length: n }, (_, i) => `Zutat ${i}`).join("\n");
    assert.equal(
      (await create("dishes", tokens.papa, { name: "Viel", ingredients: lines(40), added_by: ids.papa }))
        .status,
      200,
    );
    denied(
      await create("dishes", tokens.papa, { name: "Zu viel", ingredients: lines(41), added_by: ids.papa }),
      "41 ingredients",
    );
    denied(
      await create("dishes", tokens.papa, { name: "Lang", ingredients: "x".repeat(61), added_by: ids.papa }),
      "ingredient of 61",
    );
    denied(await create("dishes", tokens.papa, { name: "x".repeat(81), added_by: ids.papa }), "name of 81");
    const cleaned = await create("dishes", tokens.papa, {
      name: "  Reis   mit Ei ",
      ingredients: "  Reis \n\n  Ei  \r\n",
      added_by: ids.papa,
    });
    assert.equal(cleaned.data.name, "Reis mit Ei");
    assert.equal(cleaned.data.ingredients, "Reis\nEi");
    denied(
      await patch("dishes", cleaned.data.id, tokens.papa, { ingredients: lines(41) }),
      "update over limit",
    );
  });

  it("deleting a dish keeps the plan entries that used it, as free text", async () => {
    const d = await dish("Test-Gulasch", "Rindfleisch");
    const day = dayOffset(MON, 10);
    const e = await entry(tokens.papa, ids.papa, day, "dinner", { title: "Test-Gulasch", dish: d.id });
    assert.equal(e.status, 200);
    assert.equal((await remove("dishes", d.id, tokens.papa)).status, 204);
    const kept = await superGet("meal_plan", e.data.id);
    assert.equal(kept.title, "Test-Gulasch");
    assert.equal(kept.dish, "");
  });
});

describe("last planned", () => {
  it("is set when an entry with the dish is created and only ever moves to a later day", async () => {
    const d = await dish("Test-Lasagne", "Hack");
    assert.equal(d.last_planned, "");
    const day = dayOffset(MON, 14);
    const e = await entry(tokens.papa, ids.papa, day, "dinner", { dish: d.id });
    assert.equal(e.status, 200);
    assert.equal((await superGet("dishes", d.id)).last_planned, day);
    // an earlier entry does not lower it
    const earlier = dayOffset(MON, 12);
    await entry(tokens.papa, ids.papa, earlier, "dinner", { dish: d.id });
    assert.equal((await superGet("dishes", d.id)).last_planned, day);
    // moving the entry to a later day raises it
    const later = dayOffset(MON, 20);
    assert.equal((await patch("meal_plan", e.data.id, tokens.papa, { date: later })).status, 200);
    assert.equal((await superGet("dishes", d.id)).last_planned, later);
  });

  it("is also set for an entry a kid proposes", async () => {
    const d = await dish("Test-Fischstäbchen", "Fischstäbchen");
    const day = dayOffset(MON, 22);
    assert.equal((await entry(tokens.device, ids.kid1, day, "lunch", { dish: d.id })).status, 200);
    assert.equal((await superGet("dishes", d.id)).last_planned, day);
  });
});

describe("thumbs up and down", () => {
  let target;
  before(async () => {
    target = (await entry(tokens.papa, ids.papa, dayOffset(MON, 30), "dinner", { title: "Abstimmung" })).data
      .id;
  });

  it("a member has one vote per entry, can change it and take it back", async () => {
    const up = await create("meal_votes", tokens.mama, { entry: target, member: ids.mama, value: "up" });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    denied(
      await create("meal_votes", tokens.mama, { entry: target, member: ids.mama, value: "down" }),
      "second vote",
    );
    assert.equal((await patch("meal_votes", up.data.id, tokens.mama, { value: "down" })).status, 200);
    assert.equal((await superList("meal_votes", `entry = "${target}"`)).length, 1);
    assert.equal((await remove("meal_votes", up.data.id, tokens.mama)).status, 204);
    assert.equal((await superList("meal_votes", `entry = "${target}"`)).length, 0);
  });

  it("values are up or down; a vote needs an existing entry", async () => {
    denied(
      await create("meal_votes", tokens.papa, { entry: target, member: ids.papa, value: "maybe" }),
      "value",
    );
    denied(
      await create("meal_votes", tokens.papa, { entry: "doesnotexist123", member: ids.papa, value: "up" }),
      "entry",
    );
  });

  it("a parent votes only as themselves", async () => {
    denied(
      await create("meal_votes", tokens.papa, { entry: target, member: ids.mama, value: "up" }),
      "as mama",
    );
    denied(
      await create("meal_votes", tokens.papa, { entry: target, member: ids.kid1, value: "up" }),
      "as a kid",
    );
    const own = await create("meal_votes", tokens.papa, { entry: target, member: ids.papa, value: "up" });
    assert.equal(own.status, 200);
    denied(await patch("meal_votes", own.data.id, tokens.mama, { value: "down" }), "other parent changes it");
    denied(await remove("meal_votes", own.data.id, tokens.mama), "other parent removes it");
    denied(
      await patch("meal_votes", own.data.id, tokens.papa, { member: ids.mama }),
      "re-assigning the vote",
    );
    assert.equal((await superGet("meal_votes", own.data.id)).value, "up");
  });

  it("a family device votes for a kid, not for a parent; votes on a parent's entry are fine", async () => {
    const vote = await create("meal_votes", tokens.device, {
      entry: target,
      member: ids.kid1,
      value: "down",
    });
    assert.equal(vote.status, 200, JSON.stringify(vote.data));
    denied(
      await create("meal_votes", tokens.device, { entry: target, member: ids.papa, value: "up" }),
      "as a parent",
    );
    denied(await create("meal_votes", tokens.device, { entry: target, value: "up" }), "without a member");
    denied(
      await patch("meal_votes", vote.data.id, tokens.device, { entry: target, value: "up" }),
      "moving a vote",
    );
    assert.equal((await patch("meal_votes", vote.data.id, tokens.device, { value: "up" })).status, 200);
    const parentVote = (await superList("meal_votes", `entry = "${target}" && member = "${ids.papa}"`))[0];
    denied(
      await patch("meal_votes", parentVote.id, tokens.device, { value: "down" }),
      "device edits a parent's vote",
    );
    denied(await remove("meal_votes", parentVote.id, tokens.device), "device removes a parent's vote");
    assert.equal((await remove("meal_votes", vote.data.id, tokens.device)).status, 204);
  });

  it("deleting the entry deletes its votes; deleting a member deletes theirs", async () => {
    const e = await entry(tokens.papa, ids.papa, dayOffset(MON, 31), "dinner", { title: "Weg" });
    await create("meal_votes", tokens.papa, { entry: e.data.id, member: ids.papa, value: "up" });
    await create("meal_votes", tokens.device, { entry: e.data.id, member: ids.kid2, value: "up" });
    assert.equal((await superList("meal_votes", `entry = "${e.data.id}"`)).length, 2);
    assert.equal((await remove("meal_plan", e.data.id, tokens.papa)).status, 204);
    assert.equal((await superList("meal_votes", `entry = "${e.data.id}"`)).length, 0);
  });
});

describe("ingredients to the shopping list", () => {
  const WEEK = { from: dayOffset(MON, 40), to: dayOffset(MON, 46) };
  let spaghetti;
  let curry;

  before(async () => {
    spaghetti = await dish("Test-Spaghetti", "Spaghetti\nZwiebeln\nTomaten");
    curry = await dish("Test-Curry", "  zwiebeln \nReis\nKokosmilch");
    const plan = async (offset, slot, extra) =>
      (await entry(tokens.papa, ids.papa, dayOffset(MON, 40 + offset), slot, extra)).status;
    assert.equal(await plan(0, "dinner", { title: "Spaghetti", dish: spaghetti.id }), 200);
    assert.equal(await plan(1, "dinner", { title: "Curry", dish: curry.id }), 200);
    assert.equal(await plan(2, "lunch", { title: "Reste vom Vortag" }), 200);
  });

  it("only parents (PIN sessions included) may run it; devices and anonymous callers are refused", async () => {
    denied(await shopping(tokens.device, WEEK), "device");
    denied(await shopping(undefined, WEEK), "anonymous");
    denied(await shopping(tokens.device, { dish: spaghetti.id }), "device single dish");
    assert.equal((await itemsOnList()).length, 0, "nothing was added");
    const viaPin = await shopping(tokens.pin, { dish: spaghetti.id });
    assert.equal(viaPin.status, 200, JSON.stringify(viaPin.data));
    assert.deepEqual(viaPin.data, { added: 3, existing: 0 });
    for (const item of await itemsOnList()) await remove("shop_items", item.id, su);
  });

  it("adds each ingredient once for a week, with the meal it came from, and records no purchase", async () => {
    await superCreate("shop_items", { list: FOOD, name: "Reis", by: ids.papa, bought: "" });
    const res = await shopping(tokens.papa, WEEK);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    // Spaghetti, Zwiebeln, Tomaten from the first dish; Zwiebeln again (same name) and Kokosmilch from the
    // second; Reis was on the list already.
    assert.deepEqual(res.data, { added: 4, existing: 1 });
    const items = await itemsOnList();
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    assert.deepEqual(Object.keys(by).sort(), ["kokosmilch", "reis", "spaghetti", "tomaten", "zwiebeln"]);
    assert.equal(by.zwiebeln.source_meal, "Spaghetti", "the first meal that needs it is the source");
    assert.equal(by.kokosmilch.source_meal, "Curry");
    assert.equal(by.zwiebeln.bought, "");
    assert.equal(by.zwiebeln.auto, false);
    assert.equal(by.zwiebeln.by, ids.papa, "attributed to the parent who pressed the button");
    assert.equal((await superList("purchases")).length, 0, "no purchase recorded");
  });

  it("repeating the action adds nothing and reports the names already there", async () => {
    const before = (await itemsOnList()).length;
    const again = await shopping(tokens.papa, WEEK);
    assert.deepEqual(again.data, { added: 0, existing: 5 });
    assert.equal((await itemsOnList()).length, before);
  });

  it("an ingredient already in the cart counts as there", async () => {
    const tomaten = (await itemsOnList()).find((i) => i.key === "tomaten");
    await pb.api("PATCH", rec("shop_items", tomaten.id), { token: su, body: { bought: "2026-11-03" } });
    const res = await shopping(tokens.papa, WEEK);
    assert.deepEqual(res.data, { added: 0, existing: 5 });
    assert.equal((await itemsOnList()).length, 5);
    await pb.api("DELETE", rec("shop_items", tomaten.id), { token: su });
    await superList("purchases").then((rows) => Promise.all(rows.map((r) => remove("purchases", r.id, su))));
  });

  it("two simultaneous runs create each item once", async () => {
    for (const item of await itemsOnList()) await remove("shop_items", item.id, su);
    const runs = await Promise.all([
      shopping(tokens.papa, WEEK),
      shopping(tokens.mama, WEEK),
      shopping(tokens.papa, WEEK),
    ]);
    for (const r of runs) assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(
      runs.reduce((n, r) => n + r.data.added, 0),
      5,
      "five distinct names, added once in total",
    );
    const keys = (await itemsOnList()).map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, 5);
  });

  it("a day, and a single dish that is in no week", async () => {
    for (const item of await itemsOnList()) await remove("shop_items", item.id, su);
    const day = await shopping(tokens.papa, { from: dayOffset(MON, 41), to: dayOffset(MON, 41) });
    assert.deepEqual(day.data, { added: 3, existing: 0 }, "Curry only: Zwiebeln, Reis, Kokosmilch");
    const lonely = await dish("Test-Suppe", "Lauch\nReis");
    const single = await shopping(tokens.mama, { dish: lonely.id });
    assert.deepEqual(single.data, { added: 1, existing: 1 });
    const free = await shopping(tokens.papa, { from: dayOffset(MON, 42), to: dayOffset(MON, 42) });
    assert.deepEqual(free.data, { added: 0, existing: 0 }, "a free-text entry has no ingredients");
  });

  it("refuses bad requests with a message: both or neither, ranges over 14 days, bad dates, unknown dishes", async () => {
    const bad = async (body, status = 400) => {
      const res = await shopping(tokens.papa, body);
      assert.equal(res.status, status, JSON.stringify(body));
      assert.ok(res.data.message, "a message for the screen");
    };
    await bad({});
    await bad({ dish: spaghetti.id, from: WEEK.from, to: WEEK.to });
    await bad({ from: WEEK.from });
    await bad({ from: "2026-02-30", to: "2026-03-01" });
    await bad({ from: "morgen", to: "übermorgen" });
    await bad({ from: WEEK.to, to: WEEK.from });
    await bad({ from: "2026-11-02", to: "2026-11-16" }); // 15 days
    await bad({ dish: "not an id" });
    await bad({ dish: "doesnotexist123" }, 404);
    const fourteen = await shopping(tokens.papa, { from: "2026-11-02", to: "2026-11-15" });
    assert.equal(fourteen.status, 200, "14 days are fine");
  });

  it("a device cannot set the source of an item itself", async () => {
    const res = await pb.api("POST", rec("shop_items"), {
      token: tokens.device,
      body: { list: FOOD, name: "Test-Heimlich", by: ids.kid1, source_meal: "Etwas" },
    });
    denied(res, "device sets source_meal");
    const ok = await pb.api("POST", rec("shop_items"), {
      token: tokens.device,
      body: { list: FOOD, name: "Test-Heimlich", by: ids.kid1 },
    });
    assert.equal(ok.status, 200);
    denied(
      await pb.api("PATCH", rec("shop_items", ok.data.id), {
        token: tokens.device,
        body: { source_meal: "x" },
      }),
      "device edits source_meal",
    );
  });
});
