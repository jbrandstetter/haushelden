// Governing: ADR-0001 (reads and writes go through the data layer), ADR-0003 (a family device acts as the kid chosen on
// it), SPEC-0010 REQ "Cleaning Day List", REQ "Ticking Off", REQ "Standard Chores", REQ "Starting a Cleaning Day",
// REQ "Assigning and Adding Chores", REQ "Cleaning Day on the Kid Board"
//
// Cleaning day logic shared by the Putztag screen (js/screens/putztag.js), the kid board and "Wer bist du?": which
// cleaning day to show, the grouping by person and the progress, who may tick what, how a new day is built from the
// standard chores (the interval rule, "for each child", no duplicates), the German starter set, and the read-only
// "Putztag heute" line. Everything that decides something is a pure function (unit-tested); the DOM part takes `doc`
// and the data API. A cleaning day is a date that has chores; no record exists for the day itself.

(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./dates.js"), require("./meals.js"));
  else (root.HH = root.HH || {}).chores = factory(root.HH.dates, root.HH.meals);
})(typeof self !== "undefined" ? self : this, function (dates, meals) {
  "use strict";

  const { h, avatar, clean } = meals;
  // Input limit (SPEC-0010 Security Requirements "Input"); the collection enforces the same one.
  const MAX_TITLE = 80;

  /** How often a standard chore is due: every cleaning day, or not again until `days` after it was last done. */
  const INTERVALS = [
    { days: 0, label: "Bei jedem Putztag" },
    { days: 14, label: "Alle 2 Wochen" },
    { days: 30, label: "Monatlich" },
  ];
  const intervalLabel = (days) =>
    (INTERVALS.find((i) => i.days === Number(days || 0)) || { label: `Alle ${days} Tage` }).label;

  /**
   * The starter set: Kathrin's checklist in German. "kids" is for each child; "papa" and "mama" are the two parents'
   * parts, which a parent maps to the two parents when importing (the app does not know who is who).
   */
  const STARTER = {
    kids: [
      { title: "Bettwäsche abziehen und in die Waschküche bringen" },
      { title: "Mülleimer im Schlafzimmer und im Bad leeren" },
      { title: "Spielzeug im Zimmer und im ganzen Haus einsammeln" },
      { title: "Eigene Sachen im ganzen Haus einsammeln" },
      { title: "Bad: Waschbecken, Spiegel abwischen und Toilette putzen" },
      { title: "Bett frisch beziehen und machen, wenn die Wäsche fertig ist" },
      { title: "Schlafzimmer und Bad saugen" },
    ],
    papa: [
      { title: "Bettwäsche abziehen und in die Waschküche bringen" },
      { title: "Mülleimer in Küche, Schlafzimmer und Bad leeren" },
      { title: "Arbeitsflächen in Küche und Waschküche und den Küchentisch abwischen" },
      { title: "Kaffeemaschine und Mikrowelle reinigen" },
      { title: "Küchenfronten und Geräte abwischen" },
      { title: "Katzenklo reinigen" },
      { title: "Elternbad putzen: Toilette, Waschbecken, Spiegel" },
      { title: "Büro und Schreibtisch aufräumen und putzen" },
    ],
    mama: [
      { title: "Alle Räume abstauben" },
      { title: "Duschen und Badewannen schrubben" },
      { title: "Böden saugen" },
      { title: "Böden wischen" },
      { title: "Staubsaugerfilter reinigen", every_days: 30 },
      { title: "Gemeinschaftsräume aufräumen" },
      { title: "Fenster in den Gemeinschaftsräumen putzen" },
      { title: "Handtücher und Putzlappen waschen" },
    ],
  };
  const STARTER_GROUPS = [
    { key: "kids", label: "Kinder (jedes Kind bekommt sie)" },
    { key: "papa", label: "Papas Liste" },
    { key: "mama", label: "Mamas Liste" },
  ];

  // ---- checks ----------------------------------------------------------------------------------------------
  /** A German message when the title cannot be saved, else "". */
  function checkTitle(title) {
    const t = clean(title);
    if (!t) return "Bitte schreib auf, was zu tun ist.";
    if (t.length > MAX_TITLE) return `Höchstens ${MAX_TITLE} Zeichen.`;
    return "";
  }

  // ---- days ------------------------------------------------------------------------------------------------
  const choresOfDay = (chores, day) => chores.filter((c) => c.day === day);
  /** The cleaning days that exist, ascending. */
  const daysWithChores = (chores) => [...new Set(chores.map((c) => c.day))].sort();

  /** Today if it is a cleaning day, else the next one, else the latest past one, else null. */
  function defaultDay(chores, today) {
    const days = daysWithChores(chores);
    if (!days.length) return null;
    if (days.includes(today)) return today;
    return days.find((d) => d > today) || days[days.length - 1];
  }

  /** The Saturday on or after `today` (what the new-day form opens on). */
  function nextSaturday(today) {
    const n = dates.dayNumber(today);
    return dates.dayKey(n + ((5 - dates.weekday(n) + 7) % 7));
  }

  const dm = (day) => `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}.`;
  /** "Samstag 8.11." */
  const dayHeading = (day) => `${dates.WDL[dates.weekdayOfKey(day)]} ${dm(day)}`;

  // ---- people, groups and progress ---------------------------------------------------------------------------
  const kidsOf = (members) => members.filter((m) => m.role === "kid");
  const progress = (chores) => ({ done: chores.filter((c) => c.done).length, total: chores.length });
  const progressText = ({ done, total }) => `${done} von ${total} erledigt`;
  const bySort = (a, b) =>
    (a.sort || 0) - (b.sort || 0) ||
    String(a.created || "").localeCompare(String(b.created || "")) ||
    a.id.localeCompare(b.id);

  /**
   * The chores of one day grouped by assignee: kids first, then parents (each in member order), then the chores nobody
   * has yet ("Noch niemandem zugeteilt"; also those of a removed member). Empty groups of members are kept, so a child
   * with nothing to do is visible. `member` is null for the unassigned group.
   * @returns {{ key: string, member: object|null, chores: object[], done: number, total: number }[]}
   */
  function groupsOfDay(chores, members, day) {
    const mine = choresOfDay(chores, day).sort(bySort);
    const order = [...members.filter((m) => m.role === "kid"), ...members.filter((m) => m.role !== "kid")];
    const known = new Set(order.map((m) => m.id));
    const groups = order.map((member) => ({
      key: member.id,
      member,
      chores: mine.filter((c) => c.assignee === member.id),
    }));
    groups.push({
      key: "none",
      member: null,
      chores: mine.filter((c) => !c.assignee || !known.has(c.assignee)),
    });
    return groups.filter((g) => g.member || g.chores.length).map((g) => ({ ...g, ...progress(g.chores) }));
  }

  // ---- ticking -----------------------------------------------------------------------------------------------
  /** Parents tick anything; a kid ticks the chores assigned to the profile chosen on the device. */
  function canTick(chore, actor) {
    if (actor.parent) return true;
    return Boolean(actor.memberId) && chore.assignee === actor.memberId;
  }
  /** Only parents manage chores (assign, add, change, delete). */
  const canManage = (actor) => Boolean(actor.parent);

  /** The change one tap makes: tick (recording who) or un-tick. */
  const tickPatch = (chore, actorId) =>
    chore.done ? { done: false, done_by: "" } : { done: true, done_by: actorId };

  // ---- building a day from the standard chores -----------------------------------------------------------------
  /** The day a template's chore was last done on before `day`, or null. */
  function lastDone(chores, templateId, day) {
    let last = null;
    for (const c of chores)
      if (c.template === templateId && c.done && c.day < day && (!last || c.day > last)) last = c.day;
    return last;
  }

  /**
   * What starting `day` creates. A template for each child gives one chore per kid, a template for a named member one
   * chore for them, a template for nobody an unassigned chore. A chore whose template has an interval is left out when it
   * was done fewer than `every_days` days earlier. A chore that already exists on the day from the same template and
   * person is not created again. `creates` is in template order (its `sort`).
   * @returns {{ creates: object[], existing: number, tooSoon: number }}
   */
  function planDay({ day, templates, chores, members }) {
    const onDay = choresOfDay(chores, day);
    const memberIds = new Set(members.map((m) => m.id));
    const creates = [];
    let existing = 0;
    let tooSoon = 0;
    let sort = onDay.reduce((max, c) => Math.max(max, c.sort || 0), 0);
    for (const t of [...templates].sort(bySort)) {
      const people = t.kids
        ? kidsOf(members).map((m) => m.id)
        : [t.assignee && memberIds.has(t.assignee) ? t.assignee : ""];
      if (t.every_days > 0) {
        const last = lastDone(chores, t.id, day);
        if (last && dates.dayNumber(day) - dates.dayNumber(last) < t.every_days) {
          tooSoon += people.length;
          continue;
        }
      }
      for (const assignee of people) {
        if (onDay.some((c) => c.template === t.id && (c.assignee || "") === assignee)) {
          existing++;
          continue;
        }
        sort += 1;
        creates.push({
          day,
          title: clean(t.title),
          assignee,
          template: t.id,
          done: false,
          done_by: "",
          sort,
        });
      }
    }
    return { creates, existing, tooSoon };
  }

  /** "12 Aufgaben angelegt." and what was left out. */
  function startMessage({ creates, existing, tooSoon }) {
    const n = creates.length;
    const parts = [n ? `${n} ${n === 1 ? "Aufgabe" : "Aufgaben"} angelegt.` : "Nichts Neues anzulegen."];
    if (existing) parts.push(`${existing} gab es schon.`);
    if (tooSoon) parts.push(`${tooSoon} sind noch nicht wieder dran.`);
    return parts.join(" ");
  }

  /**
   * The standard chores to create from the starter set. `mapping` names the member that takes "papa" and "mama"
   * (a missing one gives chores for nobody yet). Kids' chores are "for each child".
   */
  function starterTemplates(mapping = {}) {
    const out = [];
    let sort = 0;
    for (const group of ["kids", "papa", "mama"]) {
      for (const c of STARTER[group]) {
        sort += 1;
        out.push({
          title: c.title,
          kids: group === "kids",
          assignee: group === "kids" ? "" : mapping[group] || "",
          every_days: c.every_days || 0,
          sort,
        });
      }
    }
    return out;
  }

  /** "Jedes Kind", the member's name, or "Noch niemand". */
  function forLabel(template, members) {
    if (template.kids) return "Jedes Kind";
    const m = members.find((x) => x.id === template.assignee);
    return m ? m.name : "Noch niemand";
  }

  // ---- "Putztag heute" -----------------------------------------------------------------------------------------
  /**
   * What the line says: for a child their open chores, for nobody in particular the whole day's progress. null when
   * today has no chores.
   */
  function lineText(chores, today, who) {
    const day = choresOfDay(chores, today);
    if (!day.length) return null;
    if (who) {
      const mine = day.filter((c) => c.assignee === who);
      const open = mine.filter((c) => !c.done).length;
      if (!mine.length) return "Heute ist Putztag. Für dich gibt es keine eigene Aufgabe.";
      if (!open) return "Putztag: Du hast alles geschafft! 🎉";
      return `Putztag heute: ${open} von ${mine.length} deiner Aufgaben ${open === 1 ? "ist" : "sind"} noch offen.`;
    }
    return `Putztag heute: ${progressText(progress(day))}.`;
  }

  /** The read-only line for the kid board and "Wer bist du?" with a link to the screen. */
  function todayLine({ data, doc, today, who = null }) {
    const link = who ? `#/putztag/${encodeURIComponent(who)}` : "#/putztag";
    const el = h(doc, "div", "cleantoday hidden", undefined, { "aria-live": "polite" });
    const state = { chores: [] };
    function render() {
      el.textContent = "";
      const text = lineText(state.chores, today(), who);
      el.className = text ? "cleantoday" : "cleantoday hidden";
      if (!text) return;
      el.append(
        h(doc, "span", "ct-emoji", "🧹", { "aria-hidden": "true" }),
        h(doc, "span", "ct-text", text),
        h(doc, "a", "ct-link", "Zum Putztag ›", { href: link }),
      );
    }
    const offs = [data.subscribe("chores", (rows) => ((state.chores = rows), render()))];
    return { el, dispose: () => offs.forEach((off) => off()) };
  }

  return {
    MAX_TITLE,
    INTERVALS,
    STARTER,
    STARTER_GROUPS,
    intervalLabel,
    checkTitle,
    choresOfDay,
    daysWithChores,
    defaultDay,
    nextSaturday,
    dm,
    dayHeading,
    kidsOf,
    progress,
    progressText,
    groupsOfDay,
    canTick,
    canManage,
    tickPatch,
    planDay,
    startMessage,
    starterTemplates,
    forLabel,
    lineText,
    todayLine,
    avatar,
    h,
    clean,
  };
});
