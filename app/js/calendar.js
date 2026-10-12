// Governing: ADR-0001 (the calendar is a computed view over the `todos` and `routines` collections),
// SPEC-0004 REQ "Month View", REQ "Day Agenda", REQ "Entry Sources", REQ "Area Filter in Calendar",
// REQ "Mode Switch", SPEC-0001 REQ "Household Day and Time Zone" (days are `YYYY-MM-DD` household-day strings)
//
// Pure logic of the parents' calendar mode, ported from the prototype's monthIdx / monthStart / calEntries /
// todoColors / calHTML. No DOM, no clock: the household's `today` and every day are household-day strings from
// dates.js, so month construction, entry ordering, the marker cap and the filter are unit-tested in Node.
// Entries are computed per day, never stored (design "Calendar is a computed view, not stored events").

(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./dates.js"), require("./todos.js"), require("./routines.js"));
  else (root.HH = root.HH || {}).calendar = factory(root.HH.dates, root.HH.todos, root.HH.routines);
})(typeof self !== "undefined" ? self : this, function (dates, T, R) {
  "use strict";

  const MAX_MARKERS = 4;
  const MODES = ["list", "calendar"];
  const MODE_KEY = "hh.eltern.mode";
  const BOTH_COLOUR = "lavender"; // a routine for both parents has no single owner colour
  const NO_OWNER_COLOUR = "overlay"; // a to-do whose parent is gone
  const MONTHS = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];

  const pad = (n, width) => String(n).padStart(width, "0");
  const colourOf = (m) => (m && /^[a-z]+$/.test(m.colour || "") ? m.colour : NO_OWNER_COLOUR);

  // ---- months ---------------------------------------------------------------------------------------------
  /** Month index of a day key: year * 12 + month (0-based), so months are plain integers to step through. */
  function monthIndex(dayKey) {
    const [y, m] = dayKey.split("-").map(Number);
    return y * 12 + (m - 1);
  }

  /** First day key of a month index. */
  const monthStart = (mi) => `${pad(Math.floor(mi / 12), 4)}-${pad((mi % 12) + 1, 2)}-01`;

  /** German title, "Oktober 2026". */
  const monthTitle = (mi) => `${MONTHS[mi % 12]} ${Math.floor(mi / 12)}`;

  /** "15. Oktober" for a day key. */
  function dayLong(dayKey) {
    const [, m, d] = dayKey.split("-").map(Number);
    return `${d}. ${MONTHS[m - 1]}`;
  }

  /**
   * The Monday-first grid of a month: `{ title, leading, days }` where `leading` is the number of empty cells
   * before the 1st (0 when the month starts on a Monday) and `days` are all day keys of the month.
   */
  function monthGrid(mi) {
    const first = monthStart(mi);
    const start = dates.dayNumber(first);
    const count = dates.dayNumber(monthStart(mi + 1)) - start;
    return {
      title: monthTitle(mi),
      leading: dates.weekday(start),
      days: Array.from({ length: count }, (_, i) => dates.dayKey(start + i)),
    };
  }

  /** "Heute" / "Morgen" / weekday name of a day relative to today (agenda heading). */
  function dayHeading(dayKey, today) {
    const d = dates.dayNumber(dayKey) - dates.dayNumber(today);
    if (d === 0) return "Heute";
    if (d === 1) return "Morgen";
    return dates.WDL[dates.weekdayOfKey(dayKey)];
  }

  // ---- entries --------------------------------------------------------------------------------------------
  /** Marker colours of a to-do: both parents' colours for a shared one, the parent's own otherwise. */
  function todoColours(todo, members) {
    if (todo.who === T.BOTH) return T.parentMembers(members).map(colourOf);
    return [colourOf(members.find((m) => m.id === todo.who))];
  }

  /**
   * SEAM for the external family calendar (SPEC-0004 REQ "External Family Calendar", server-side CalDAV into an
   * `external_events` collection, not in v1 per SPEC-0001 "Version 1 Scope"). When it lands, return its events
   * for the day here as routine-shaped entries (`{ source: "external", emoji, title, time, hint, colour, owner }`);
   * they are hidden while an area is selected, like the routine entries.
   */
  // eslint-disable-next-line no-unused-vars
  const externalEntries = (dayKey) => [];

  /**
   * Routine entries on a day (SPEC-0004 "Entry Sources"): kids' routines of kind `hobby` (one per kid, in that
   * kid's colour) and routines that fall to a parent (once, even if it is for both: lavender, owner "beide").
   * Kids' `chore` routines never appear. Sorted by time, untimed after timed.
   */
  function routineEntries(dayKey, routines, members) {
    const out = [];
    for (const kid of members.filter((m) => m.role === "kid")) {
      for (const r of R.dueFor(routines, kid, members, dayKey)) {
        if (r.kind !== "hobby") continue;
        out.push(entry(r, colourOf(kid), kid.name));
      }
    }
    const seen = new Set();
    for (const parent of T.parentMembers(members)) {
      for (const r of R.dueFor(routines, parent, members, dayKey)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(
          r.who === "parents" ? entry(r, BOTH_COLOUR, "beide") : entry(r, colourOf(parent), parent.name),
        );
      }
    }
    out.push(...externalEntries(dayKey));
    return out.sort((a, b) => (a.time || "99").localeCompare(b.time || "99")); // Array#sort is stable
  }

  function entry(routine, colour, owner) {
    return {
      source: "routine",
      id: routine.id,
      emoji: routine.emoji || "",
      title: routine.title,
      time: routine.time || "",
      hint: routine.hint || "",
      colour,
      owner,
    };
  }

  /**
   * Everything on a day: `{ events, todos }`. `events` are the routine (and later external) entries in agenda
   * order (timed by time, then untimed); `todos` are all to-dos due that day (any parent's, the calendar is the
   * family's), in creation order. An area filter keeps only that area's to-dos and drops every event
   * (SPEC-0004 "Area Filter in Calendar").
   */
  function dayEntries(dayKey, { todos = [], routines = [], members = [], areaFilter = null } = {}) {
    const dayTodos = todos
      .filter((t) => t.due === dayKey && (!areaFilter || t.area === areaFilter))
      .sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
    return { events: areaFilter ? [] : routineEntries(dayKey, routines, members), todos: dayTodos };
  }

  /** Marker colours of a day, at most four: events first, then the colours of its open to-dos. */
  function markerColours(entries, members) {
    return [
      ...entries.events.map((e) => e.colour),
      ...entries.todos.filter((t) => !t.done).flatMap((t) => todoColours(t, members)),
    ].slice(0, MAX_MARKERS);
  }

  // ---- mode switch persistence (per device) ---------------------------------------------------------------
  /** The stored mode of this device, "list" when nothing valid is stored or storage is unavailable. */
  function readMode(storage) {
    try {
      const v = storage && storage.getItem(MODE_KEY);
      return MODES.includes(v) ? v : "list";
    } catch {
      return "list";
    }
  }

  function writeMode(storage, mode) {
    try {
      if (storage && MODES.includes(mode)) storage.setItem(MODE_KEY, mode);
    } catch {
      // private mode or blocked storage: the choice just does not persist
    }
  }

  return {
    MAX_MARKERS,
    MODES,
    MODE_KEY,
    BOTH_COLOUR,
    monthIndex,
    monthStart,
    monthTitle,
    monthGrid,
    dayLong,
    dayHeading,
    todoColours,
    routineEntries,
    dayEntries,
    markerColours,
    readMode,
    writeMode,
  };
});
