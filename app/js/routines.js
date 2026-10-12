// Governing: ADR-0003 (kid access via device accounts), SPEC-0002 REQ "Routine Items", REQ "Alternating
// Assignment", REQ "Mascot Choice"; SPEC-0001 design "Day boundaries in household time"
//
// Pure routine logic shared by the parent screens and the boards: which routines are due for a member on a
// household date (port of the prototype's itemsFor), the deterministic alternation, form validation and the mascot
// choice. No DOM, no network: unit-tested in Node. Dates are `YYYY-MM-DD` household days (js/dates.js).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dates.js"));
  else (root.HH = root.HH || {}).routines = factory(root.HH.dates);
})(typeof self !== "undefined" ? self : this, function (dates) {
  "use strict";

  const KINDS = ["chore", "hobby"];
  const WHO = ["member", "kids", "kids_alternating", "parents"];
  const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

  // The prototype's mascot choices (PETS) plus two more: the UI offers at least eight (SPEC-0002 "Mascot Choice").
  const MASCOTS = [
    { emoji: "🐱", name: "Mochi" },
    { emoji: "🦊", name: "Fuchsi" },
    { emoji: "🐉", name: "Drako" },
    { emoji: "🐼", name: "Panda" },
    { emoji: "🦉", name: "Eule Ole" },
    { emoji: "🐶", name: "Bello" },
    { emoji: "🐧", name: "Pingu" },
    { emoji: "🤖", name: "Robo" },
    { emoji: "🐸", name: "Quaki" },
    { emoji: "🦄", name: "Funki" },
  ];
  const DEFAULT_MASCOT = MASCOTS[0];

  const byCreated = (a, b) =>
    String(a.created || "￿").localeCompare(String(b.created || "￿")) ||
    String(a.id).localeCompare(String(b.id));

  /** Kids in creation order: the order the alternation walks through. */
  const kidsOf = (members) => members.filter((m) => m.role === "kid").sort(byCreated);

  /** The weekdays of a routine as numbers, Monday = 0. Tolerates strings ("1") as stored by the server. */
  const daysOf = (routine) =>
    (Array.isArray(routine.days) ? routine.days : [])
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

  /**
   * The kid whose turn an alternating routine is on a household day: kids[dayNumber mod kidCount].
   * Returns null without kids.
   */
  function alternatingKid(members, dayKey) {
    const kids = kidsOf(members);
    if (kids.length === 0) return null;
    return kids[dates.dayNumber(dayKey) % kids.length];
  }

  /** Does this routine occur on the day and fall to this member? (prototype itemsFor, SPEC-0002 behaviour) */
  function isDue(routine, member, members, dayKey) {
    if (!member || !daysOf(routine).includes(dates.weekdayOfKey(dayKey))) return false;
    const isKid = member.role === "kid";
    switch (routine.who) {
      case "kids":
        return isKid;
      case "parents":
        return member.role === "parent";
      case "kids_alternating": {
        const turn = alternatingKid(members, dayKey);
        return isKid && !!turn && turn.id === member.id;
      }
      case "member":
        return !!routine.member && routine.member === member.id;
      default:
        return false;
    }
  }

  /** Routines due for a member on a household day, in the order given. */
  const dueFor = (routines, member, members, dayKey) =>
    routines.filter((r) => isDue(r, member, members, dayKey));

  /** The tile tag of a due routine: "Heute du" for alternating, "17:00 Uhr" / "Hobby" for hobbies (prototype). */
  function tileTag(routine) {
    if (routine.who === "kids_alternating") return "Heute du";
    if (routine.kind === "hobby") return routine.time ? `${routine.time} Uhr` : "Hobby";
    return "";
  }

  /** German label of an assignment, for the routine list. */
  function assignmentLabel(routine, members) {
    switch (routine.who) {
      case "kids":
        return "Beide Kinder";
      case "kids_alternating":
        return "Kinder im Wechsel";
      case "parents":
        return "Beide Eltern";
      case "member": {
        const m = members.find((x) => x.id === routine.member);
        return m ? `${m.emoji} ${m.name}` : "Niemand (Person entfernt)";
      }
      default:
        return "";
    }
  }

  /**
   * Assignment choices for the editor: the three group choices and one per member. Value is the string
   * "kids" | "kids_alternating" | "parents" | "member:<id>".
   */
  function assignmentOptions(members) {
    const people = members.slice().sort(byCreated);
    return [
      { value: "kids", label: "Beide Kinder" },
      { value: "kids_alternating", label: "Kinder im Wechsel" },
      ...people
        .filter((m) => m.role === "kid")
        .map((m) => ({ value: `member:${m.id}`, label: `${m.emoji} ${m.name}` })),
      { value: "parents", label: "Beide Eltern" },
      ...people
        .filter((m) => m.role === "parent")
        .map((m) => ({ value: `member:${m.id}`, label: `${m.emoji} ${m.name}` })),
    ];
  }

  const assignmentValue = (routine) => (routine.who === "member" ? `member:${routine.member}` : routine.who);

  /** "member:<id>" | "kids" | ... -> { who, member } for the record. */
  function parseAssignment(value) {
    if (typeof value === "string" && value.startsWith("member:") && value.length > 7) {
      return { who: "member", member: value.slice(7) };
    }
    if (WHO.includes(value) && value !== "member") return { who: value, member: "" };
    return null;
  }

  /**
   * Validates the editor's form values and returns `{ ok, errors, record }`. `record` is the normalised data
   * to store; the server's collection rules are the authority, this gives the parent a message first.
   */
  function validateRoutine(form, members = []) {
    const errors = {};
    const emoji = String(form.emoji || "").trim();
    const title = String(form.title || "").trim();
    const hint = String(form.hint || "").trim();
    const time = String(form.time || "").trim();
    if (!emoji || emoji.length > 16) errors.emoji = "Bitte ein Emoji wählen.";
    if (!title) errors.title = "Bitte einen Titel eingeben.";
    else if (title.length > 80) errors.title = "Der Titel ist zu lang (höchstens 80 Zeichen).";
    if (hint.length > 120) errors.hint = "Der Hinweis ist zu lang (höchstens 120 Zeichen).";
    if (time && !TIME_RE.test(time)) errors.time = "Bitte eine Uhrzeit im Format 17:00 angeben.";
    if (!KINDS.includes(form.kind)) errors.kind = "Bitte Aufgabe oder Hobby wählen.";
    const days = Array.from(new Set((form.days || []).map(Number))).sort((a, b) => a - b);
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.days = "Ungültiger Wochentag.";
    const assignment = parseAssignment(form.assignment);
    if (!assignment) errors.assignment = "Bitte auswählen, wer die Aufgabe hat.";
    else if (assignment.who === "member" && !members.some((m) => m.id === assignment.member)) {
      errors.assignment = "Diese Person gibt es nicht (mehr).";
    }
    if (Object.keys(errors).length) return { ok: false, errors, record: null };
    return {
      ok: true,
      errors,
      record: {
        emoji,
        title,
        hint,
        time,
        kind: form.kind,
        days: days.map(String),
        who: assignment.who,
        member: assignment.member,
      },
    };
  }

  /** The household mascot from the settings record; tolerates a missing or older-shaped value. */
  function mascotOf(settings) {
    const m = settings && settings.mascot;
    const emoji = m && typeof m.emoji === "string" && m.emoji ? m.emoji : "";
    const name = m && typeof m.name === "string" ? m.name.trim() : "";
    if (!emoji) return { ...DEFAULT_MASCOT };
    return { emoji, name: name || (MASCOTS.find((x) => x.emoji === emoji) || DEFAULT_MASCOT).name };
  }

  /** Validates a mascot choice -> { ok, error, mascot }. The animal must be one of the offered ones. */
  function validateMascot({ emoji, name }) {
    const clean = String(name || "").trim();
    if (!MASCOTS.some((m) => m.emoji === emoji))
      return { ok: false, error: "Bitte ein Tier wählen.", mascot: null };
    if (!clean) return { ok: false, error: "Bitte dem Tier einen Namen geben.", mascot: null };
    if (clean.length > 24)
      return { ok: false, error: "Der Name ist zu lang (höchstens 24 Zeichen).", mascot: null };
    return { ok: true, error: "", mascot: { emoji, name: clean } };
  }

  return {
    KINDS,
    WHO,
    MASCOTS,
    DEFAULT_MASCOT,
    kidsOf,
    daysOf,
    alternatingKid,
    isDue,
    dueFor,
    tileTag,
    assignmentLabel,
    assignmentOptions,
    assignmentValue,
    parseAssignment,
    validateRoutine,
    mascotOf,
    validateMascot,
  };
});
