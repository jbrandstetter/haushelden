// Governing: ADR-0001 (to-dos live in the `todos` collection), SPEC-0003 REQ "To-dos", REQ "Quick Add",
// REQ "List Grouping", REQ "Editing", SPEC-0001 REQ "Household Day and Time Zone" (all days are household-day
// `YYYY-MM-DD` strings from dates.js, never device-local dates)
//
// The pure logic of the parents' to-do list, ported from the prototype's mineTodos / dueLabel / dueOptions /
// renderAdult grouping / quick add. No DOM, no clock: callers pass the household's `today` key, so everything
// is unit-tested. A to-do is `{ id, title, who, due, area, done }` where `who` is a parent member id or
// "parents" (both), `due` and `done` are day keys or "" (the form PocketBase stores; null is accepted too).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dates.js"));
  else (root.HH = root.HH || {}).todos = factory(root.HH.dates);
})(typeof self !== "undefined" ? self : this, function (dates) {
  "use strict";

  const BOTH = "parents";
  const TITLE_MAX = 200;
  const GROUPS = [
    ["overdue", "Überfällig"],
    ["today", "Heute"],
    ["upcoming", "Demnächst"],
    ["someday", "Irgendwann"],
  ];

  const isOpen = (t) => !t.done;
  const byDue = (a, b) =>
    a.due.localeCompare(b.due) || String(a.created || "").localeCompare(String(b.created || ""));

  /** To-dos a parent sees: their own and the ones for both (prototype mineTodos). */
  const visibleTo = (todos, memberId) => todos.filter((t) => t.who === memberId || t.who === BOTH);

  /**
   * Groups the to-dos into overdue / today / upcoming (by due date) / someday, plus those done today
   * (SPEC-0003 "List Grouping"). An area filter keeps only that area's to-dos.
   * @returns {{ overdue: object[], today: object[], upcoming: object[], someday: object[], doneToday: object[] }}
   */
  function groupTodos(todos, today, { area = null } = {}) {
    const shown = area ? todos.filter((t) => t.area === area) : todos;
    const open = shown.filter(isOpen);
    return {
      overdue: open.filter((t) => t.due && t.due < today).sort(byDue),
      today: open.filter((t) => t.due === today),
      upcoming: open.filter((t) => t.due && t.due > today).sort(byDue),
      someday: open.filter((t) => !t.due),
      doneToday: shown.filter((t) => t.done === today),
    };
  }

  /**
   * Label for a due date relative to today (prototype dueLabel): `{ text, late }`. Overdue ones say how long
   * ("überfällig seit 2 Tagen"), within a week the weekday is named, later ones show "Mo., 3.11.".
   */
  function dueLabel(due, today) {
    const d = dates.dayNumber(due) - dates.dayNumber(today);
    if (d < 0)
      return { text: d === -1 ? "überfällig seit gestern" : `überfällig seit ${-d} Tagen`, late: true };
    if (d === 0) return { text: "heute", late: false };
    if (d === 1) return { text: "morgen", late: false };
    const n = dates.dayNumber(due);
    if (d < 7) return { text: dates.WDL[dates.weekday(n)], late: false };
    const [, month, day] = due.split("-").map(Number);
    return { text: `${dates.WD[dates.weekday(n)]}, ${day}.${month}.`, late: false };
  }

  /**
   * The due-date shortcuts as `[value, label]` (prototype dueOptions): none, today, tomorrow, weekend (next
   * Saturday), next week (next Monday). Shortcuts that resolve to the same date appear once, the first one
   * wins: on a Sunday "Nächste Woche" is tomorrow, so only "Morgen" is shown (SPEC-0003 "Editing").
   */
  function dueOptions(today) {
    const t = dates.dayNumber(today);
    const wd = dates.weekday(t);
    const saturday = t + ((5 - wd + 7) % 7 || 7);
    const monday = t + (7 - wd);
    const options = [
      ["", "Kein Datum"],
      [dates.dayKey(t), "Heute"],
      [dates.dayKey(t + 1), "Morgen"],
      [dates.dayKey(saturday), "Wochenende"],
      [dates.dayKey(monday), "Nächste Woche"],
    ];
    return options.filter(([v], i) => options.findIndex(([w]) => w === v) === i);
  }

  /** The parent members from a members list, in list order. */
  const parentMembers = (members) => members.filter((m) => m.role === "parent");

  /** "beide" or the parent's name. */
  function whoLabel(who, members) {
    if (who === BOTH) return "beide";
    const m = members.find((x) => x.id === who);
    return m ? m.name : "";
  }

  /**
   * Record for the quick add field (SPEC-0003 "Quick Add"). `assignee` is "me", "other" or "parents";
   * `area` is the area currently selected as filter, which the new to-do belongs to. Returns null for an empty
   * title (nothing is created).
   */
  function newTodo({ title, due = "", assignee = "me", me, other, area = null }) {
    const clean = String(title || "")
      .trim()
      .slice(0, TITLE_MAX);
    if (!clean) return null;
    let who = me;
    if (assignee === "parents") who = BOTH;
    else if (assignee === "other" && other) who = other;
    return { title: clean, who, due: due || "", area: area || "", done: "" };
  }

  /** Patch that completes an open to-do today or un-completes a done one. */
  const toggleDone = (todo, today) => ({ done: todo.done ? "" : today });

  /** Title patch for the inline editor: trimmed and capped; null when it would be empty (keep the old one). */
  function titlePatch(raw) {
    const title = String(raw || "")
      .trim()
      .slice(0, TITLE_MAX);
    return title ? { title } : null;
  }

  /** Number of open to-dos in an area (for the areas panel of the follow-up story). */
  const openInArea = (todos, area) => todos.filter((t) => t.area === area && isOpen(t)).length;

  return {
    BOTH,
    TITLE_MAX,
    GROUPS,
    visibleTo,
    groupTodos,
    dueLabel,
    dueOptions,
    parentMembers,
    whoLabel,
    newTodo,
    toggleDone,
    titlePatch,
    openInArea,
  };
});
