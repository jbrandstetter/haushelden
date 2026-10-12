// Governing: SPEC-0005 REQ "Purchase History and Rhythm", REQ "Automatic Refill", REQ "Suggestions While Typing"
// Unit tests of the pure learning module shared by the app and the server hook (app/js/rhythm.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const r = require("../app/js/rhythm.js");

const day = (n) => r.dayKey(r.dayNumber("2026-09-01") + n);
const buys = (list, key, offsets, extra = {}) =>
  offsets.map((o) => ({ list, key: key.toLowerCase(), name: key, day: day(o), ...extra }));

test("scenario: Milk every five days - bought on days 0, 4, 10, 15, 20 the rhythm is 5", () => {
  assert.equal(r.rhythmOf([0, 4, 10, 15, 20].map(day)), 5); // median of 4, 6, 5, 5
});

test("an item with fewer than two purchases has no rhythm; duplicate days count once", () => {
  assert.equal(r.rhythmOf([]), null);
  assert.equal(r.rhythmOf([day(0)]), null);
  assert.equal(r.rhythmOf([day(3), day(3)]), null, "two rows on one day are one purchase");
  assert.equal(r.rhythmOf([day(0), day(7)]), 7);
});

test("only the five most recent intervals count, and the rhythm is at least one day", () => {
  // old habit every 20 days, then every 2 days: the last five intervals are all 2
  assert.equal(r.rhythmOf([0, 20, 40, 60, 80, 82, 84, 86, 88, 90].map(day)), 2);
  assert.equal(r.rhythmOf([0, 1, 2].map(day)), 1);
  assert.equal(r.rhythmOf([5, 0, 10].map(day)), 5, "order of the input does not matter");
});

test("the median of an even number of intervals is rounded to whole days", () => {
  assert.equal(r.rhythmOf([0, 3, 7].map(day)), 4, "(3 + 4) / 2 = 3.5 rounds to 4");
  assert.equal(r.rhythmOf([0, 2, 5].map(day)), 3, "(2 + 3) / 2 = 2.5 rounds to 3");
});

test("scenario: Milk comes back - due when today is on or after last + rhythm - 1", () => {
  const entry = r.learn(
    buys(
      "food",
      "Milch",
      [-24, -20, -14, -9, -4].map((n) => n + 100),
    ),
  )[0];
  assert.equal(entry.rhythm, 5);
  assert.equal(r.isDue(entry, day(100)), true, "last bought 4 days ago, rhythm 5");
  assert.equal(r.isDue(entry, day(99)), false, "one day earlier");
  assert.equal(r.isDue(entry, day(101)), true, "and it stays due");
});

test("an item without a rhythm is never due; neither is one bought today (even with a one-day rhythm)", () => {
  assert.equal(r.isDue(r.learn(buys("food", "Salz", [0]))[0], day(60)), false);
  const daily = r.learn(buys("food", "Brötchen", [0, 1, 2, 3]))[0];
  assert.equal(daily.rhythm, 1);
  assert.equal(r.isDue(daily, day(3)), false);
  assert.equal(r.isDue(daily, day(4)), true);
});

test("scenario: Not needed yet - removing automatic Shampoo (rhythm 35) defers it by 18 days", () => {
  assert.equal(r.deferDays(35), 18);
  assert.equal(r.deferDays(5), 3);
  assert.equal(r.deferDays(1), 1);
  assert.equal(r.deferDays(2), 1);
  const rows = buys("dm", "Shampoo", [0, 35, 70]);
  const entry = r.learn(rows)[0];
  const removedOn = day(105);
  const until = r.dayKey(r.dayNumber(removedOn) + r.deferDays(entry.rhythm));
  const deferred = r.learn(rows.map((p, i) => (i === 2 ? { ...p, skip_until: until } : p)))[0];
  assert.equal(r.isDue(deferred, day(105)), false);
  assert.equal(r.isDue(deferred, day(122)), false, "17 days later");
  assert.equal(r.isDue(deferred, day(123)), true, "after 18 days");
});

test("a deferral stored on an older purchase no longer counts once the item was bought again", () => {
  const rows = buys("food", "Tee", [0, 10, 20]);
  rows[0].skip_until = day(500);
  const entry = r.learn(rows)[0];
  assert.equal(entry.skipUntil, "");
  assert.equal(r.isDue(entry, day(29)), true);
});

test("learn groups per list and normalised key, keeps the latest spelling and counts purchase days", () => {
  const rows = [
    ...buys("food", "Milch", [0, 5]),
    { list: "food", key: "milch", name: "milch", day: day(10) },
    ...buys("dm", "Milch", [3]),
  ];
  const learned = r.learn(rows);
  assert.equal(learned.length, 2);
  const food = learned.find((e) => e.list === "food");
  assert.equal(food.count, 3);
  assert.equal(food.name, "milch");
  assert.equal(food.last, day(10));
  assert.equal(learned.find((e) => e.list === "dm").rhythm, null);
});

test("reason text: 'etwa alle 5 Tage · zuletzt vor 4 Tagen', singular for one day", () => {
  assert.equal(r.reasonText(5, day(0), day(4)), "etwa alle 5 Tage · zuletzt vor 4 Tagen");
  assert.equal(r.reasonText(1, day(0), day(1)), "etwa alle 1 Tag · zuletzt vor 1 Tag");
  assert.equal(r.rhythmLabel(5), "alle ~5 Tage");
  assert.equal(r.rhythmLabel(null), "noch kein Rhythmus");
});

test("scenario: Typing 'Ka' - names starting with it first, then by purchases; open items are not suggested", () => {
  const entries = r.learn([
    ...buys(
      "food",
      "Kaffee",
      Array.from({ length: 12 }, (_, i) => i),
    ),
    ...buys("food", "Bio-Kakao", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
    ...buys("food", "Kaugummi", [0, 1]),
    ...buys("food", "Brot", [0, 1, 2]),
  ]);
  const names = (list) => list.map((e) => e.name);
  assert.deepEqual(names(r.suggest(entries, "Ka", new Set())), ["Kaffee", "Kaugummi", "Bio-Kakao"]);
  assert.deepEqual(names(r.suggest(entries, "ka", new Set(["kaffee"]))), ["Kaugummi", "Bio-Kakao"]);
  assert.deepEqual(names(r.suggest(entries, "  KAF ", new Set())), ["Kaffee"]);
  assert.deepEqual(names(r.suggest(entries, "zzz", new Set())), []);
});

test("with an empty field the most frequently bought items are suggested, limited", () => {
  const entries = r.learn([
    ...buys("food", "A", [0, 1, 2, 3]),
    ...buys("food", "B", [0, 1]),
    ...buys("food", "C", [0, 1, 2]),
  ]);
  assert.deepEqual(
    r.suggest(entries, "", new Set(["c"])).map((e) => e.name),
    ["A", "B"],
  );
  assert.equal(r.suggest(entries, "", new Set(), 2).length, 2);
});
