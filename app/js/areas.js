// Governing: ADR-0001 (areas live in the `areas` collection), SPEC-0003 REQ "Areas of Responsibility",
// REQ "Parents' Routines Today", REQ "Kids' Progress Glance", SPEC-0002 REQ "Today Board" (ticks), SPEC-0001
// REQ "Household Day and Time Zone" (days are household-day strings)
//
// Pure logic of the areas panel, the area filter, "Routine heute" and the kids' progress glance. No DOM, no clock:
// callers pass the household's `today`, so everything is unit-tested. An area is `{ id, emoji, name, owner }`
// (`owner` = parent member id or ""), a tick is a `routine_done` record `{ id, routine, member, day }`.

(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./todos.js"), require("./routines.js"));
  else (root.HH = root.HH || {}).areas = factory(root.HH.todos, root.HH.routines);
})(typeof self !== "undefined" ? self : this, function (T, R) {
  "use strict";

  const NAME_MAX = 80;
  const EMOJI_MAX = 16;
  const NEW_AREA = { emoji: "📌", name: "Neuer Bereich", owner: "" };

  /** Areas in a stable order (creation time, then id), the order the panel shows them. */
  const sortAreas = (areas) =>
    areas
      .slice()
      .sort(
        (a, b) =>
          String(a.created || "").localeCompare(String(b.created || "")) || String(a.id).localeCompare(b.id),
      );

  /**
   * One card per area for the panel: owner member (or null: "Wer ist zuständig?"), number of open to-dos,
   * whether `me` owns it and whether it is the selected filter.
   */
  function areaCards(areas, todos, members, me, selected = null) {
    return sortAreas(areas).map((area) => {
      const owner = (area.owner && members.find((m) => m.id === area.owner)) || null;
      return {
        area,
        owner,
        open: T.openInArea(todos, area.id),
        mine: !!owner && owner.id === me,
        selected: selected === area.id,
      };
    });
  }

  /** The owner line of a card: "🧔 Test-Papa · 2 offen" or "Wer ist zuständig? · 0 offen". */
  const cardLabel = (card) =>
    `${card.owner ? `${card.owner.emoji || ""} ${card.owner.name}`.trim() : "Wer ist zuständig?"} · ${card.open} offen`;

  /** Tapping the selected area clears the filter, any other one selects it (prototype data-area). */
  const toggleFilter = (current, id) => (current === id ? null : id);

  /** A stored filter id whose area is gone (deleted elsewhere) means no filter. */
  const effectiveFilter = (selected, areas) =>
    selected && areas.some((a) => a.id === selected) ? selected : null;

  /** Cleaned `{ emoji, name }` patch from the management inputs; null when the name would be empty. */
  function areaPatch({ emoji, name }) {
    const clean = String(name == null ? "" : name)
      .trim()
      .slice(0, NAME_MAX);
    if (!clean) return null;
    return {
      emoji: String(emoji == null ? "" : emoji)
        .trim()
        .slice(0, EMOJI_MAX),
      name: clean,
    };
  }

  /** The parents an area can be given to. */
  const ownerChoices = (members) => T.parentMembers(members);

  // ---- routine today (parents) ---------------------------------------------------------------------------

  /** The tick of a member for a routine on a day, or undefined. */
  const findTick = (ticks, routineId, memberId, day) =>
    ticks.find((t) => t.routine === routineId && t.member === memberId && t.day === day);

  /**
   * "Routine heute" of a parent: the routines due for them on the household day (assigned to them or to both
   * parents), each with whether this parent has ticked it today. Ticks are per parent and day.
   * @returns {{ routine: object, done: boolean, tick: object|undefined }[]}
   */
  function routineToday(routines, ticks, member, members, day) {
    if (!member || member.role !== "parent") return [];
    return R.dueFor(routines, member, members, day).map((routine) => {
      const tick = findTick(ticks, routine.id, member.id, day);
      return { routine, done: !!tick, tick };
    });
  }

  // ---- kids' progress ------------------------------------------------------------------------------------

  /** Done / total of one kid on a day: routines due for the kid and how many of them are ticked. */
  function dayProgress(routines, ticks, kid, members, day) {
    const due = R.dueFor(routines, kid, members, day);
    const done = due.filter((r) => findTick(ticks, r.id, kid.id, day)).length;
    return { done, total: due.length, pct: due.length ? Math.round((done / due.length) * 100) : 100 };
  }

  /** Progress of every kid, in creation order (the board's order). */
  const kidsProgress = (routines, ticks, members, day) =>
    R.kidsOf(members).map((kid) => ({ kid, ...dayProgress(routines, ticks, kid, members, day) }));

  return {
    NAME_MAX,
    EMOJI_MAX,
    NEW_AREA,
    sortAreas,
    areaCards,
    cardLabel,
    toggleFilter,
    effectiveFilter,
    areaPatch,
    ownerChoices,
    findTick,
    routineToday,
    dayProgress,
    kidsProgress,
  };
});
