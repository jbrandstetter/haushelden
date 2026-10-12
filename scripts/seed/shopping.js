// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0005 REQ "Lists"
//
// Seed step for the shopping lists. The two default lists come from the migration (fixed ids), so only items are
// seeded: a few open items added by different fake members and one item already in the cart. The cart item is
// created with today's date, so the server hook records its purchase like a real tick.

const FOOD = "list1food000001";
const DM = "list2dm00000001";

const items = [
  { list: FOOD, name: "Test-Milch", by: "kind1" },
  { list: FOOD, name: "Test-Brot", by: "mama" },
  { list: FOOD, name: "Test-Gummibärchen", by: "kind2" },
  { list: FOOD, name: "Test-Eier", by: "papa", cart: true },
  { list: DM, name: "Test-Zahnpasta", by: "papa" },
  { list: DM, name: "Test-Haargummis", by: "kind2" },
];

const today = () => new Date().toISOString().slice(0, 10);

const steps = [
  {
    collection: "shop_items",
    key: "key",
    records: ({ ids }) =>
      items.map(({ list, name, by, cart }) => ({
        key: name,
        list,
        name,
        by: ids.members[by],
        auto: false,
        bought: cart ? today() : "",
      })),
  },
];

module.exports = { steps, items };
