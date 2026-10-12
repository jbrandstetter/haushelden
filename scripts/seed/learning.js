// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0005 REQ "Purchase History and
// Rhythm", design "Demo history in the prototype must not be imported into production"
//
// DEV-ONLY fake purchase history, so a fresh local setup shows rhythms, automatic items and suggestions. It lives
// here and nowhere else: the migrations never create purchases, so production starts with an empty history.
// Days are relative to the day the seed runs (negative = days ago). The step runs before the shopping items step so
// the cart item seeded there does not make the collection look "already seeded".

const FOOD = "list1food000001";
const DM = "list2dm00000001";

// [list, name, days ago of every purchase]
const history = [
  [FOOD, "Test-Milch", [-24, -20, -14, -9, -4]], // rhythm 5, due today
  [FOOD, "Test-Kaffee", [-60, -53, -46, -39, -32, -25, -18, -11, -6]], // rhythm 7, due
  [FOOD, "Test-Brot", [-12, -9, -6, -3]], // rhythm 3, due
  [FOOD, "Test-Eier", [-30, -23, -16, -9]], // rhythm 7, on the list soon
  [FOOD, "Test-Butter", [-40, -26, -12, -2]], // rhythm 14, not due
  [DM, "Test-Zahnpasta", [-90, -60, -30, -10]], // rhythm 30, not due
  [DM, "Test-Shampoo", [-105, -70, -35]], // rhythm 35, due: removing it defers it by 18 days
];

const dayKey = (offset) => {
  const d = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const steps = [
  {
    collection: "purchases",
    key: "seedid",
    records: () =>
      history.flatMap(([list, name, offsets]) =>
        offsets.map((offset) => ({
          seedid: `${name}:${offset}`,
          list,
          name,
          key: name.toLowerCase(),
          day: dayKey(offset),
          item: "",
        })),
      ),
  },
];

module.exports = { steps, history };
