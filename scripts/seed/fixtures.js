// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (no real names or values in the public repo)
//
// The fake household: two parents, two kids, sample routines, to-dos, areas, lists and purchase history.
// All names are obviously fake. Each entry maps to the collection of the same name (SPEC-0001 design); the
// story that creates a collection also adjusts the matching records here to its schema.

const members = [
  { key: "papa", name: "Test-Papa", role: "parent" },
  { key: "mama", name: "Test-Mama", role: "parent" },
  { key: "kind1", name: "Test-Kind-1", role: "kid" },
  { key: "kind2", name: "Test-Kind-2", role: "kid" },
];

const routines = [
  { title: "Zähne putzen", who: ["kind1", "kind2"] },
  { title: "Tasche packen", who: ["kind1"] },
  { title: "Zimmer aufräumen", who: ["kind2"] },
];

const todos = [
  { title: "Test-Aufgabe: Altglas wegbringen", who: "papa" },
  { title: "Test-Aufgabe: Geschenk besorgen", who: "mama" },
];

const areas = [
  { title: "Test-Bereich: Müll", owner: "papa" },
  { title: "Test-Bereich: Wäsche", owner: "mama" },
];

const lists = [{ title: "Lebensmittel" }, { title: "Drogerie" }];

const purchases = [
  { list: "Lebensmittel", item: "Test-Milch", times: 4 },
  { list: "Lebensmittel", item: "Test-Brot", times: 3 },
  { list: "Drogerie", item: "Test-Seife", times: 2 },
];

module.exports = { members, routines, todos, areas, lists, purchases };
