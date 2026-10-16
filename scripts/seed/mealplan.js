// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0009 REQ "Plan Entries",
// REQ "Dish Library", REQ "Thumbs Up and Down"
//
// Seed steps for the meal plan: a few fake dishes (some never planned, some planned long ago, so the rotation hint
// has something to show), a week of entries around today (Monday to Sunday of the current week: a parent's entries,
// a proposal by a kid, free text, one empty slot) and a few thumbs. Days are computed from the current date, so a
// fresh seed always shows this week. The dishes' last-planned dates are raised by the server hook as the entries
// are created.

const dishes = [
  { name: "Test-Spaghetti", emoji: "🍝", ingredients: "Spaghetti\nTomaten\nZwiebeln", by: "mama", ago: 21 },
  { name: "Test-Pizza", emoji: "🍕", ingredients: "Pizzateig\nMozzarella\nTomaten", by: "kind1", ago: 35 },
  {
    name: "Test-Gemüsesuppe",
    emoji: "🥣",
    ingredients: "Karotten\nKartoffeln\nZwiebeln\nLauch",
    by: "papa",
    ago: 9,
  },
  { name: "Test-Pfannkuchen", emoji: "🥞", ingredients: "Mehl\nEier\nMilch", by: "kind2", ago: null },
  { name: "Test-Linseneintopf", emoji: "🍲", ingredients: "Linsen\nKarotten\nSpeck", by: "papa", ago: null },
];

// Day offset from Monday, slot, title, dish, who added it, cook
const plan = [
  { key: "mo-dinner", day: 0, slot: "dinner", dish: "Test-Gemüsesuppe", by: "mama", cook: "mama" },
  { key: "di-lunch", day: 1, slot: "lunch", title: "Test-Reste", by: "papa" },
  { key: "di-dinner", day: 1, slot: "dinner", dish: "Test-Spaghetti", by: "papa", cook: "papa" },
  { key: "mi-dinner", day: 2, slot: "dinner", dish: "Test-Pfannkuchen", by: "kind2", note: "mit Apfelmus" },
  { key: "do-dinner", day: 3, slot: "dinner", dish: "Test-Linseneintopf", by: "mama" },
  { key: "fr-dinner", day: 4, slot: "dinner", dish: "Test-Pizza", by: "kind1" },
  { key: "so-lunch", day: 6, slot: "lunch", title: "Test-Braten", by: "papa", cook: "papa" },
];

const votes = [
  { entry: "di-dinner", member: "kind1", value: "up" },
  { entry: "di-dinner", member: "kind2", value: "down" },
  { entry: "fr-dinner", member: "kind1", value: "up" },
  { entry: "fr-dinner", member: "mama", value: "up" },
  { entry: "mo-dinner", member: "papa", value: "up" },
];

const DAY = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week containing `now`, as `YYYY-MM-DD` (UTC; the seed is a development convenience). */
function monday(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return dayKey(today - ((new Date(today).getUTCDay() + 6) % 7) * DAY);
}
const addDays = (key, n) => dayKey(Date.parse(`${key}T00:00:00Z`) + n * DAY);

const steps = [
  {
    collection: "dishes",
    key: "key",
    records: ({ ids }) =>
      dishes.map(({ name, emoji, ingredients, by, ago }) => ({
        key: name,
        name,
        emoji,
        ingredients,
        added_by: ids.members[by],
        // (planned entries raise it further; a dish with no entry keeps this date)
        last_planned: ago ? addDays(monday(), -ago) : "",
      })),
    identify: (record) => record.name,
  },
  {
    collection: "meal_plan",
    key: "key",
    records: ({ ids }) =>
      plan.map(({ key, day, slot, title, dish, by, cook, note }) => ({
        key,
        date: addDays(monday(), day),
        slot,
        title: title || dish,
        dish: dish ? ids.dishes[dish] : "",
        cook: cook ? ids.members[cook] : "",
        note: note || "",
        added_by: ids.members[by],
      })),
  },
  {
    collection: "meal_votes",
    records: ({ ids }) =>
      votes.map(({ entry, member, value }) => ({
        entry: ids.meal_plan[entry],
        member: ids.members[member],
        value,
      })),
  },
];

module.exports = { steps, dishes, plan, votes, monday };
