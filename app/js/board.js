// Governing: ADR-0003 (kid access via device accounts), SPEC-0002 REQ "Today Board", REQ "Tomorrow Preview",
// REQ "Week Strip and Streak", REQ "Mascot Feedback", REQ "No Competitive or Reward Mechanics by Default";
// SPEC-0001 design "Day boundaries in household time", REQ "Version 1 Scope"
//
// Pure logic of the kid board, ported from the prototype's dayProgress / weekHTML / streak / tap / LINES: ticks
// per member and day, progress, the Monday-to-Sunday week strip, the streak, the speech cadence and the built-in
// mascot lines. No DOM, no network, no clock of its own: every function takes household-day strings
// (`YYYY-MM-DD`, js/dates.js) and, where randomness is involved, an injectable `random`. Unit-tested in Node.
// It only ever looks at ONE member: nothing here compares members, ranks them or counts points.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./dates.js"), require("./routines.js"));
  } else (root.HH = root.HH || {}).board = factory(root.HH.dates, root.HH.routines);
})(typeof self !== "undefined" ? self : this, function (dates, routines) {
  "use strict";

  // ---- ticks and progress -------------------------------------------------------------------------------
  const tickKey = (routineId, memberId, day) => `${routineId}|${memberId}|${day}`;

  /** A lookup of the member's ticks: `set.has(tickKey(...))`. Ticks of other members are ignored. */
  function tickIndex(ticks, memberId) {
    const set = new Set();
    for (const t of ticks || []) if (t.member === memberId) set.add(tickKey(t.routine, t.member, t.day));
    return set;
  }

  /** The routine_done record of one tile today (or undefined): what an un-tick deletes. */
  const findTick = (ticks, routineId, memberId, day) =>
    (ticks || []).find((t) => t.routine === routineId && t.member === memberId && t.day === day);

  /** { total, done } of the member's due routines on a household day. */
  function dayProgress({ routines: all, member, members, ticks, day }) {
    const due = routines.dueFor(all, member, members, day);
    const index = tickIndex(ticks, member.id);
    return { total: due.length, done: due.filter((r) => index.has(tickKey(r.id, member.id, day))).length };
  }

  /** "empty" is "nothing done" (also a future day with items), "none" is a day without items. */
  const dayStatus = (p) => (!p.total ? "none" : p.done === p.total ? "full" : p.done ? "part" : "empty");

  /**
   * The current week, Monday to Sunday, one marker per day. Statuses: full (all done), part (partly done),
   * empty (nothing done), none (no items). A day after today with items is "empty" (not yet missed).
   */
  function weekStrip(input) {
    const today = dates.dayNumber(input.today);
    const monday = today - dates.weekday(today);
    return dates.WD.map((label, i) => {
      const n = monday + i;
      const day = dates.dayKey(n);
      const p = dayProgress({ ...input, day });
      return { label, day, isToday: n === today, future: n > today, ...p, status: dayStatus(p) };
    });
  }

  /**
   * The streak: consecutive days, ending today or yesterday, with every due item done. A day without items is
   * skipped (neither breaks nor extends); today counts once complete, and an unfinished today does not break
   * the streak yet. `progressOf(day) -> { total, done }`; looks back at most `limit` days.
   */
  function streakOf(progressOf, today, limit = 400) {
    const n = dates.dayNumber(today);
    let count = 0;
    const first = progressOf(today);
    if (first.total && first.done === first.total) count += 1;
    for (let i = 1; i <= limit; i++) {
      const p = progressOf(dates.dayKey(n - i));
      if (!p.total) continue;
      if (p.done < p.total) break;
      count += 1;
    }
    return count;
  }

  /** The member's streak from the raw collections. */
  const streak = (input) => streakOf((day) => dayProgress({ ...input, day }), input.today);

  /** Tomorrow's hobby items (with hints) for the "Morgen" note. */
  const tomorrowHobbies = ({ routines: all, member, members, today }) =>
    routines.dueFor(all, member, members, dates.addDays(today, 1)).filter((r) => r.kind === "hobby");

  // ---- mascot lines (built-in pool) -------------------------------------------------------------------------
  // v1 uses only this pool (SPEC-0001 "Version 1 Scope"). The prototype's pool, kept as is.
  const LINES = {
    greetMorning: [
      "Guten Morgen, {name}! Heute schaffen wir das.",
      "Morgen, {name}! Ich bin schon wach. Du auch?",
    ],
    greetDay: ["Hallo {name}! Schön, dass du da bist.", "Hey {name}! Schauen wir mal, was heute ansteht."],
    greetEvening: [
      "Guten Abend, {name}! Nur noch ein paar Sachen.",
      "Hallo {name}! Der Abend gehört gleich dir.",
    ],
    tick: [
      "Abgehakt!",
      "Zack, erledigt!",
      "Super!",
      "Weiter so!",
      "Stark!",
      "Läuft bei dir!",
      "Eins weniger!",
      "Yes!",
    ],
    bag: [
      "Tasche gepackt – morgen früh hast du keinen Stress.",
      "Gepackt! Dein Morgen-Ich sagt danke.",
      "Stundenplan gecheckt? Profi!",
    ],
    homework: [
      "Hausaufgaben erledigt! Jetzt ist der Kopf frei.",
      "Das war die schwerste Aufgabe – und du hast sie geschafft.",
      "Hausaufgaben: check. Respekt!",
    ],
    dishes: [
      "Die Küche sagt danke!",
      "Spülmaschine? Erledigt. Mama und Papa freuen sich.",
      "Ordnung muss sein – und du hast sie gemacht.",
    ],
    hobby: [
      "Viel Spaß heute! Gib alles.",
      "Ich drück dir die Daumen!",
      "Hast du alles eingepackt? Dann los!",
    ],
    half: ["Schon die Hälfte geschafft!", "Halbzeit! Der Rest geht auch noch."],
    last: ["Nur noch eins, {name}!", "Eine Sache noch – dann bist du fertig."],
    allDone: [
      "Alles geschafft, {name}! Du bist ein echter Haushelden-Profi.",
      "Fertig für heute! Jetzt ist Freizeit.",
      "Alles erledigt! Ich mache einen Freudentanz.",
    ],
    streak: [
      "{streak} Tage am Stück alles geschafft. Wahnsinn!",
      "Das ist schon dein {streak}. Tag in Folge. Weiter so!",
    ],
    idle: ["Tipp auf eine Karte, wenn du etwas erledigt hast.", "Na, was machst du als Nächstes?"],
    free: ["Heute steht nichts an. Genieß den Tag, {name}!"],
  };

  /**
   * SEAM (SPEC-0006, a later story): the assistant's approved lines for this kid and day. v1 has none, so the
   * board always uses LINES. When the approved-lines store exists, return `{ trigger: [text, ...] }` here (same
   * keys as LINES) and `linePool` prefers them per trigger, falling back to the built-in pool when a key is empty.
   */
  // eslint-disable-next-line no-unused-vars
  const approvedLines = (memberId, day) => null;

  /** The pool for one trigger: approved lines for it if any, else the built-in lines. */
  function linePool(trigger, approved = null) {
    const own = approved && Array.isArray(approved[trigger]) ? approved[trigger].filter(Boolean) : [];
    return own.length ? own : LINES[trigger] || [];
  }

  const pick = (pool, random = Math.random) =>
    pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];

  /** Replaces {name} and {streak}. */
  const fill = (text, vars) =>
    String(text)
      .replace(/\{name\}/g, vars.name || "")
      .replace(/\{streak\}/g, String(vars.streak ?? 0));

  /** Greeting by local hour of the household (0-23). */
  const greetingTrigger = (hour) => (hour < 11 ? "greetMorning" : hour < 17 ? "greetDay" : "greetEvening");

  /** The line shown when the board opens (not spoken, see speechDecision). */
  function openingLine({ progress, hour, firstVisit, vars, approved, random }) {
    let trigger;
    if (firstVisit) trigger = greetingTrigger(hour);
    else if (progress.total && progress.done === progress.total) trigger = "allDone";
    else if (!progress.total) trigger = "free";
    else trigger = "idle";
    return fill(pick(linePool(trigger, approved), random), vars);
  }

  /** Topic of a routine's own line (prototype: bag / homework / dishes by item), hobby by kind. */
  function routineTrigger(routine) {
    const title = String(routine.title || "");
    if (/tasche/i.test(title)) return "bag";
    if (/hausaufgabe/i.test(title)) return "homework";
    if (/spülmaschine|brotdose/i.test(title)) return "dishes";
    return routine.kind === "hobby" ? "hobby" : "tick";
  }

  /** The line of a (non-completing) tick: "last" when one is left, "half" at halftime, else the routine's own. */
  function tickLine({ routine, progress, vars, approved, random }) {
    const remaining = progress.total - progress.done;
    const trigger =
      remaining === 1
        ? "last"
        : progress.total > 2 && progress.done * 2 === progress.total
          ? "half"
          : routineTrigger(routine);
    return fill(pick(linePool(trigger, approved), random), vars);
  }

  /** The completion line: the streak line sometimes when the streak is longer than one day (prototype celebrate). */
  function celebrationLine({ streak: s, vars, approved, random = Math.random }) {
    const trigger = s > 1 && random() < 0.6 ? "streak" : "allDone";
    return fill(pick(linePool(trigger, approved), random), { ...vars, streak: s });
  }

  // ---- speech cadence ---------------------------------------------------------------------------------------
  const CHANCE = 0.25; // chance of speaking on an ordinary tick once the mascot kept quiet at least once
  const MAX_SILENT = 3; // an ordinary tick speaks after this many silent ones in a row

  /**
   * Should the mascot SPEAK on this tick (it always reacts visually)? Always on the first tick of the day and
   * on completion; otherwise roughly one in three: never straight after speaking, with a chance of CHANCE
   * afterwards and certainly after MAX_SILENT silent ticks. `silentRun` = ticks since the mascot last spoke.
   * Returns the decision and the new `silentRun` for the caller to keep.
   */
  function speechDecision({ firstOfDay, completed, silentRun, random = Math.random }) {
    let speak;
    if (firstOfDay || completed) speak = true;
    else if (silentRun >= MAX_SILENT) speak = true;
    else speak = silentRun >= 1 && random() < CHANCE;
    return { speak, silentRun: speak ? 0 : silentRun + 1 };
  }

  /** Speech text: dashes become commas so the voice pauses instead of reading them out (prototype say). */
  const speechText = (text) => String(text).replace(/[–—]/g, ",");

  return {
    tickKey,
    tickIndex,
    findTick,
    dayProgress,
    dayStatus,
    weekStrip,
    streakOf,
    streak,
    tomorrowHobbies,
    LINES,
    approvedLines,
    linePool,
    pick,
    fill,
    greetingTrigger,
    openingLine,
    routineTrigger,
    tickLine,
    celebrationLine,
    CHANCE,
    MAX_SILENT,
    speechDecision,
    speechText,
  };
});
