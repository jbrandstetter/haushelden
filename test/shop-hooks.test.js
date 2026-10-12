// Governing: SPEC-0005 REQ "Adding Items", REQ "Shopping Flow"; SPEC-0001 REQ "Household Day and Time Zone"
// The pure helpers of the shopping hook (the hook itself is exercised against PocketBase in test/rules/).
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../pb_hooks/lib/shopping.js");
const clientShop = require("../app/js/shop.js");

test("server and client normalise names identically", () => {
  for (const name of ["  Milch ", "HAFER   Milch", "Käse\tBrot", "Ärger", "", "  "]) {
    assert.equal(lib.normalizeName(name), clientShop.normalizeName(name), name);
    assert.equal(lib.nameKey(name), clientShop.nameKey(name), name);
  }
});

test("tick days: today, yesterday, and an offline tick from last week are fine; the future is not", () => {
  assert.equal(lib.checkTickDay("2026-10-12", "2026-10-12"), null);
  assert.equal(lib.checkTickDay("2026-10-11", "2026-10-12"), null);
  assert.equal(lib.checkTickDay("2026-10-05", "2026-10-12"), null);
  assert.equal(lib.checkTickDay("2026-10-13", "2026-10-12"), null, "one day of clock skew");
  assert.match(lib.checkTickDay("2026-10-14", "2026-10-12"), /Zukunft/);
  assert.match(lib.checkTickDay("2026-09-01", "2026-10-12"), /zurück/);
  assert.match(lib.checkTickDay("2026-02-30", "2026-10-12"), /Ungültig/);
  assert.match(lib.checkTickDay("heute", "2026-10-12"), /Ungültig/);
});

test("day numbers are calendar arithmetic across month and year ends", () => {
  assert.equal(lib.dayNumber("2026-11-01") - lib.dayNumber("2026-10-31"), 1);
  assert.equal(lib.dayNumber("2027-01-01") - lib.dayNumber("2026-12-31"), 1);
  assert.ok(Number.isNaN(lib.dayNumber("2026-13-01")));
});
