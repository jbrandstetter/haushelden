// Governing: SPEC-0001 REQ "Household Day and Time Zone", design "Day boundaries in household time"
//
// Household-day helpers. A day is a `YYYY-MM-DD` string computed in the household time zone (HH_TZ, default
// Europe/Berlin), never in the device's own zone. Rewrites the prototype's todayN / keyN / wd, which used the
// device's local date. Day numbers (days since 1970-01-01) are plain calendar arithmetic and zone-free.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).dates = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 86400000;
  const DEFAULT_TZ = "Europe/Berlin";
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const WDL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  const formatters = new Map();
  function formatter(tz) {
    let f = formatters.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      formatters.set(tz, f);
    }
    return f;
  }

  function isValidTimeZone(tz) {
    if (typeof tz !== "string" || tz === "") return false;
    try {
      formatter(tz);
      return true;
    } catch {
      return false;
    }
  }

  /** The configured zone if it is a real IANA name, else the default. */
  const resolveTimeZone = (tz) => (isValidTimeZone(tz) ? tz : DEFAULT_TZ);

  /** Wall-clock parts of `now` in `tz`. */
  function wallClock(now, tz) {
    const out = {};
    for (const p of formatter(resolveTimeZone(tz)).formatToParts(now)) out[p.type] = p.value;
    return {
      year: Number(out.year),
      month: Number(out.month),
      day: Number(out.day),
      hour: Number(out.hour),
      minute: Number(out.minute),
      second: Number(out.second),
    };
  }

  const pad = (n, width) => String(n).padStart(width, "0");

  /** `YYYY-MM-DD` of the household day containing `now`. */
  function householdDay(now, tz) {
    const w = wallClock(now, tz);
    return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`;
  }

  /** Day number (days since 1970-01-01) of a `YYYY-MM-DD` key. Throws on malformed keys. */
  function dayNumber(key) {
    const m = KEY_RE.exec(key);
    if (!m) throw new RangeError(`invalid day key: ${key}`);
    const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY;
    if (dayKey(n) !== key) throw new RangeError(`invalid day key: ${key}`);
    return n;
  }

  /** `YYYY-MM-DD` of a day number (prototype keyN). */
  const dayKey = (n) => new Date(n * DAY).toISOString().slice(0, 10);

  /** Day number of the household's today (prototype todayN); `offsetDays` previews another day. */
  const todayNumber = (now, tz, offsetDays = 0) => dayNumber(householdDay(now, tz)) + offsetDays;

  /** Weekday of a day number, Monday = 0 (prototype wd). */
  const weekday = (n) => (new Date(n * DAY).getUTCDay() + 6) % 7;
  const weekdayOfKey = (key) => weekday(dayNumber(key));

  const addDays = (key, delta) => dayKey(dayNumber(key) + delta);

  /**
   * Milliseconds until the next 00:00 household time, for scheduling a re-render at midnight. On a day with a
   * time change the result can be an hour off; callers re-check the day when the timer fires and reschedule.
   */
  function msUntilNextDay(now, tz) {
    const w = wallClock(now, tz);
    const elapsed = ((w.hour * 60 + w.minute) * 60 + w.second) * 1000 + (now.getTime() % 1000);
    return Math.max(1000, DAY - elapsed);
  }

  return {
    DAY,
    DEFAULT_TZ,
    WD,
    WDL,
    isValidTimeZone,
    resolveTimeZone,
    householdDay,
    dayNumber,
    dayKey,
    todayNumber,
    weekday,
    weekdayOfKey,
    addDays,
    msUntilNextDay,
  };
});
