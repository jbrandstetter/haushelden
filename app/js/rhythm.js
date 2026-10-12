// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Purchase History and Rhythm",
// REQ "Automatic Refill", REQ "Suggestions While Typing", REQ "Learned Overview"
//
// The deterministic learning of the shopping lists as pure functions, shared by the app (script tag) and the
// server (pb_hooks/lib/learning.js requires this very file, so both always agree): purchase days -> rhythm,
// due check, deferral, reason text, learned items, suggestions. Days are `YYYY-MM-DD` household-day strings; day
// arithmetic is plain calendar arithmetic (zone-free). Ports the prototype's rhythm / dueFor / frequent.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).rhythm = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_MS = 86400000;
  const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /** The most recent intervals that count (SPEC-0005: "up to five"). */
  const MAX_INTERVALS = 5;

  /** Day number (days since 1970-01-01) of a `YYYY-MM-DD` string, NaN when it is not a real date. */
  function dayNumber(key) {
    const m = DAY_RE.exec(String(key));
    if (!m) return NaN;
    const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
    return new Date(n * DAY_MS).toISOString().slice(0, 10) === key ? n : NaN;
  }
  const dayKey = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

  /** Sorted, de-duplicated valid day numbers (at most one purchase per day). */
  function uniqueDays(days) {
    return Array.from(new Set(days.map(dayNumber).filter((n) => !Number.isNaN(n)))).sort((a, b) => a - b);
  }

  function median(numbers) {
    const s = numbers.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * Rhythm in whole days from purchase days, or null with fewer than two purchases: the median of the most
   * recent (up to five) intervals, rounded, at least 1. Days 0, 4, 10, 15, 20 -> intervals 4, 6, 5, 5 -> 5.
   */
  function rhythmOf(days) {
    const nums = uniqueDays(days);
    if (nums.length < 2) return null;
    const intervals = [];
    for (let i = 1; i < nums.length; i++) intervals.push(nums[i] - nums[i - 1]);
    return Math.max(1, Math.round(median(intervals.slice(-MAX_INTERVALS))));
  }

  /** Days an automatic item removed unbought stays away: half the rhythm, rounded up. */
  const deferDays = (rhythm) => Math.ceil(rhythm / 2);

  /**
   * Learned items from purchase rows `{ list, key, name, day, skip_until? }`: one entry per list and key with the
   * display name of the latest purchase, sorted days, count, rhythm (or null), last day and the deferral of the
   * latest purchase (`skipUntil`, or ""). A deferral older than the newest purchase no longer counts.
   */
  function learn(purchases) {
    const groups = new Map();
    for (const p of purchases) {
      if (Number.isNaN(dayNumber(p.day))) continue;
      const id = `${p.list}\u0000${p.key}`;
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { list: p.list, key: p.key, name: p.name, days: new Set(), rows: [] }));
      g.days.add(p.day);
      g.rows.push(p);
    }
    const out = [];
    for (const g of groups.values()) {
      const days = Array.from(g.days).sort();
      const last = days[days.length - 1];
      const latest = g.rows.filter((r) => r.day === last);
      const named = latest[latest.length - 1];
      const skip = latest.map((r) => r.skip_until || "").sort()[latest.length - 1] || "";
      out.push({
        list: g.list,
        key: g.key,
        name: named.name || g.name,
        days,
        count: days.length,
        rhythm: rhythmOf(days),
        last,
        skipUntil: skip,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  /**
   * Due: has a rhythm, today is on or after last + rhythm - 1, it was not bought today, and no deferral is
   * running (today >= skipUntil).
   */
  function isDue(entry, today) {
    if (!entry || entry.rhythm == null) return false;
    const t = dayNumber(today);
    const last = dayNumber(entry.last);
    if (Number.isNaN(t) || Number.isNaN(last)) return false;
    if (t <= last) return false; // bought today: in the cart or already finished, not due again today
    if (t < last + entry.rhythm - 1) return false;
    if (entry.skipUntil && t < dayNumber(entry.skipUntil)) return false;
    return true;
  }

  const sinceDays = (last, today) => dayNumber(today) - dayNumber(last);
  const dayWord = (n) => (n === 1 ? "1 Tag" : `${n} Tage`);

  /** "etwa alle 5 Tage · zuletzt vor 4 Tagen" (the server stores rhythm and last day; the app adds the "✨"). */
  function reasonText(rhythm, last, today) {
    const ago = sinceDays(last, today);
    const agoText = ago <= 0 ? "zuletzt heute" : `zuletzt vor ${ago === 1 ? "1 Tag" : `${ago} Tagen`}`;
    return `etwa alle ${dayWord(rhythm)} · ${agoText}`;
  }

  /** "alle ~5 Tage" or "noch kein Rhythmus" for the learned overview. */
  const rhythmLabel = (rhythm) => (rhythm == null ? "noch kein Rhythmus" : `alle ~${dayWord(rhythm)}`);

  /**
   * Suggestions while typing: learned entries (of one list) whose name contains `typed` (case-insensitive),
   * names starting with it first, then by number of purchases, then by name. With an empty `typed` the most
   * frequently bought. `taken` is a Set of keys already open or in the cart, which are never suggested.
   */
  function suggest(entries, typed, taken, limit = 6) {
    const q = String(typed == null ? "" : typed)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const pool = entries.filter((e) => !taken.has(e.key) && (q === "" || e.key.includes(q)));
    pool.sort((a, b) => {
      const sa = q !== "" && a.key.startsWith(q) ? 0 : 1;
      const sb = q !== "" && b.key.startsWith(q) ? 0 : 1;
      return sa - sb || b.count - a.count || a.key.localeCompare(b.key, "de");
    });
    return pool.slice(0, limit);
  }

  return {
    MAX_INTERVALS,
    dayNumber,
    dayKey,
    rhythmOf,
    deferDays,
    learn,
    isDue,
    sinceDays,
    reasonText,
    rhythmLabel,
    suggest,
  };
});
