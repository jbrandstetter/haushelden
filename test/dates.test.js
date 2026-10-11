// Governing: SPEC-0001 REQ "Household Day and Time Zone"
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const d = require("../app/js/dates.js");

const BERLIN = "Europe/Berlin";
const at = (iso) => new Date(iso);

test("scenario: phone set to UTC at 00:30 Tuesday in Berlin shows Tuesday", () => {
  // Tuesday 2026-10-13 00:30 CEST = Monday 22:30 UTC
  const now = at("2026-10-12T22:30:00Z");
  assert.equal(now.getUTCDay(), 1, "the device's UTC date is still Monday");
  assert.equal(d.householdDay(now, BERLIN), "2026-10-13");
  assert.equal(d.WDL[d.weekdayOfKey(d.householdDay(now, BERLIN))], "Dienstag");
});

test("a day begins at 00:00 household time", () => {
  assert.equal(d.householdDay(at("2026-10-12T21:59:59Z"), BERLIN), "2026-10-12"); // 23:59:59 CEST
  assert.equal(d.householdDay(at("2026-10-12T22:00:00Z"), BERLIN), "2026-10-13"); // 00:00:00 CEST
  assert.equal(d.householdDay(at("2026-01-15T22:59:59Z"), BERLIN), "2026-01-15"); // 23:59:59 CET
  assert.equal(d.householdDay(at("2026-01-15T23:00:00Z"), BERLIN), "2026-01-16"); // 00:00:00 CET
});

test("spring-forward (2026-03-29): the short day starts and ends at local midnight", () => {
  assert.equal(d.householdDay(at("2026-03-28T22:59:59Z"), BERLIN), "2026-03-28");
  assert.equal(d.householdDay(at("2026-03-28T23:00:00Z"), BERLIN), "2026-03-29");
  assert.equal(d.householdDay(at("2026-03-29T00:59:59Z"), BERLIN), "2026-03-29"); // 01:59:59 CET
  assert.equal(d.householdDay(at("2026-03-29T01:00:00Z"), BERLIN), "2026-03-29"); // 03:00:00 CEST
  assert.equal(d.householdDay(at("2026-03-29T21:59:59Z"), BERLIN), "2026-03-29"); // 23:59:59 CEST
  assert.equal(d.householdDay(at("2026-03-29T22:00:00Z"), BERLIN), "2026-03-30");
});

test("fall-back (2026-10-25): the long day has 25 hours, no day is skipped or repeated", () => {
  assert.equal(d.householdDay(at("2026-10-24T21:59:59Z"), BERLIN), "2026-10-24");
  assert.equal(d.householdDay(at("2026-10-24T22:00:00Z"), BERLIN), "2026-10-25"); // 00:00 CEST
  assert.equal(d.householdDay(at("2026-10-25T00:59:59Z"), BERLIN), "2026-10-25"); // 02:59:59 CEST
  assert.equal(d.householdDay(at("2026-10-25T01:00:00Z"), BERLIN), "2026-10-25"); // 02:00:00 CET (repeated hour)
  assert.equal(d.householdDay(at("2026-10-25T22:59:59Z"), BERLIN), "2026-10-25"); // 23:59:59 CET
  assert.equal(d.householdDay(at("2026-10-25T23:00:00Z"), BERLIN), "2026-10-26");
});

test("the result does not depend on the device's own zone", () => {
  const script = `
    const d = require(${JSON.stringify(path.join(__dirname, "../app/js/dates.js"))});
    const out = [
      "2026-10-12T22:30:00Z", "2026-03-28T23:30:00Z", "2026-10-25T00:30:00Z", "2026-12-31T23:30:00Z",
    ].map((iso) => d.householdDay(new Date(iso), "Europe/Berlin"));
    console.log(JSON.stringify(out));`;
  const results = ["UTC", "Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata", "Europe/Berlin"].map(
    (tz) => {
      const r = spawnSync(process.execPath, ["-e", script], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    },
  );
  assert.deepEqual(new Set(results).size, 1, `device zones disagree: ${results.join(" | ")}`);
  assert.deepEqual(JSON.parse(results[0]), ["2026-10-13", "2026-03-29", "2026-10-25", "2027-01-01"]);
});

test("another household zone gives another day", () => {
  const now = at("2026-10-12T22:30:00Z");
  assert.equal(d.householdDay(now, "America/New_York"), "2026-10-12");
  assert.equal(d.householdDay(now, "Pacific/Auckland"), "2026-10-13");
  assert.equal(d.householdDay(now, "Asia/Tokyo"), "2026-10-13");
});

test("an invalid or empty zone falls back to Europe/Berlin", () => {
  const now = at("2026-10-12T22:30:00Z");
  assert.equal(d.householdDay(now, "Not/AZone"), "2026-10-13");
  assert.equal(d.householdDay(now, ""), "2026-10-13");
  assert.equal(d.householdDay(now, undefined), "2026-10-13");
  assert.equal(d.isValidTimeZone("Europe/Vienna"), true);
  assert.equal(d.isValidTimeZone("Europe/Nowhere"), false);
});

test("day numbers, keys and weekdays round-trip (prototype todayN, keyN, wd)", () => {
  assert.equal(d.dayKey(d.dayNumber("2026-02-28") + 1), "2026-03-01");
  assert.equal(d.dayKey(d.dayNumber("2028-02-28") + 1), "2028-02-29"); // leap year
  assert.equal(d.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(d.addDays("2026-03-29", -1), "2026-03-28");
  assert.equal(d.weekdayOfKey("2026-10-12"), 0); // Monday = 0
  assert.equal(d.weekdayOfKey("2026-10-18"), 6); // Sunday = 6
  assert.equal(d.dayNumber("1970-01-01"), 0);
  assert.equal(d.todayNumber(at("2026-10-12T22:30:00Z"), BERLIN), d.dayNumber("2026-10-13"));
  assert.equal(d.todayNumber(at("2026-10-12T22:30:00Z"), BERLIN, 2), d.dayNumber("2026-10-15")); // ?tag=2 preview
});

test("malformed day keys are rejected", () => {
  for (const bad of ["2026-13-01", "2026-02-30", "26-10-12", "2026-1-1", "", "abc"]) {
    assert.throws(() => d.dayNumber(bad), RangeError, bad);
  }
});

test("msUntilNextDay counts down to local midnight", () => {
  assert.equal(d.msUntilNextDay(at("2026-10-12T21:00:00Z"), BERLIN), 3600 * 1000); // 23:00 CEST
  assert.equal(d.msUntilNextDay(at("2026-10-12T22:00:00Z"), BERLIN), 24 * 3600 * 1000); // exactly midnight
  assert.ok(d.msUntilNextDay(at("2026-10-12T21:59:59.999Z"), BERLIN) >= 1000);
});
