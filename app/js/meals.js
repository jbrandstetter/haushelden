// Governing: ADR-0001 (reads and writes go through the data layer), SPEC-0009 REQ "Week View", REQ "Plan Entries",
// REQ "Dish Library", REQ "Thumbs Up and Down", REQ "Copy and Clear", REQ "What Is for Dinner Today",
// REQ "Ingredients to the Shopping List"
//
// Meal plan logic shared by the Essen screen (js/screens/essen.js), the kid board and "Wer bist du?": week
// arithmetic (Monday to Sunday, computed from dates; no week records exist), the rotation hint, vote handling,
// copy and clear plans, the request for the ingredient route, and the read-only "Heute" line with its thumbs.
// Everything that decides something is a pure function (unit-tested); the DOM parts take `doc` and the data API.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./dates.js"));
  else (root.HH = root.HH || {}).meals = factory(root.HH.dates);
})(typeof self !== "undefined" ? self : this, function (dates) {
  "use strict";

  const SLOTS = [
    { key: "lunch", label: "Mittagessen", short: "Mittag" },
    { key: "dinner", label: "Abendessen", short: "Abend" },
  ];
  // Input limits (SPEC-0009 Security Requirements "Input"); the server enforces the same ones.
  const MAX = { title: 80, note: 200, ingredient: 60, ingredients: 40, name: 80 };
  const DEFAULT_EMOJI = "🍽️";

  /** Whitespace collapsed and trimmed, like the shopping list's names. */
  const clean = (text) =>
    String(text == null ? "" : text)
      .replace(/\s+/g, " ")
      .trim();
  const keyOf = (text) => clean(text).toLowerCase();

  // ---- weeks -----------------------------------------------------------------------------------------------
  /** The Monday of the week containing `day` (`YYYY-MM-DD`). */
  function weekStart(day) {
    const n = dates.dayNumber(day);
    return dates.dayKey(n - dates.weekday(n));
  }
  const weekDays = (start) => Array.from({ length: 7 }, (_, i) => dates.addDays(start, i));
  const shiftWeek = (start, weeks) => dates.addDays(start, weeks * 7);
  const inWeek = (day, start) => day >= start && day <= dates.addDays(start, 6);

  const dm = (day) => `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}.`;
  /** "Montag 2.11." */
  const dayHeading = (day) => `${dates.WDL[dates.weekdayOfKey(day)]} ${dm(day)}`;

  /** ISO week number of the week starting on `start` (a Monday): the week of its Thursday. */
  function isoWeek(start) {
    const thursday = dates.dayNumber(start) + 3;
    const year = Number(dates.dayKey(thursday).slice(0, 4));
    const jan1 = dates.dayNumber(`${year}-01-01`);
    return Math.floor((thursday - jan1) / 7) + 1;
  }
  /** "KW 45 · 2.11. – 8.11." */
  const weekLabel = (start) => `KW ${isoWeek(start)} · ${dm(start)} – ${dm(dates.addDays(start, 6))}`;

  // ---- entries and dishes ----------------------------------------------------------------------------------
  const entryAt = (entries, date, slot) => entries.find((e) => e.date === date && e.slot === slot) || null;
  const entriesOfWeek = (entries, start) => entries.filter((e) => inWeek(e.date, start));
  const slotLabel = (slot) => (SLOTS.find((s) => s.key === slot) || SLOTS[1]).label;

  /** Whole days since the dish was last planned (negative when it is planned for a later day); null if never. */
  function daysSince(dish, today) {
    if (!dish.last_planned) return null;
    return dates.dayNumber(today) - dates.dayNumber(dish.last_planned);
  }

  /** "zuletzt vor 21 Tagen" (the rotation hint), "noch nie geplant", "heute geplant", "geplant am 5.11.". */
  function lastPlannedLabel(dish, today) {
    const n = daysSince(dish, today);
    if (n === null) return "noch nie geplant";
    if (n < 0) return `geplant am ${dm(dish.last_planned)}`;
    if (n === 0) return "heute geplant";
    return `zuletzt vor ${n} ${n === 1 ? "Tag" : "Tagen"}`;
  }

  /**
   * The dishes in rotation order: never planned first, then the longest ago, then those planned for later days;
   * ties by name. Thumbs down never hides a dish (SPEC-0009 "Thumbs Up and Down").
   */
  function rotation(dishes) {
    return dishes
      .slice()
      .sort(
        (a, b) =>
          (a.last_planned || "").localeCompare(b.last_planned || "") ||
          clean(a.name).localeCompare(clean(b.name), "de"),
      );
  }

  /** Suggestions for what has been typed: dishes whose name contains it, in rotation order, with their hint. */
  function suggest(dishes, typed, today) {
    const q = keyOf(typed);
    return rotation(dishes)
      .filter((d) => !q || keyOf(d.name).includes(q))
      .map((dish) => ({ dish, label: lastPlannedLabel(dish, today) }));
  }

  /** The library dish whose name is exactly the typed title (case and whitespace insensitive), or null. */
  const findDish = (dishes, title) => dishes.find((d) => keyOf(d.name) === keyOf(title)) || null;

  /** Ingredient lines as the server counts them: trimmed, empty lines dropped. */
  const ingredientLines = (text) =>
    String(text == null ? "" : text)
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

  /** A German message when a dish form is not acceptable, else "". */
  function checkDish({ name, ingredients }) {
    if (!clean(name)) return "Das Gericht braucht einen Namen.";
    if (clean(name).length > MAX.name) return `Der Name darf höchstens ${MAX.name} Zeichen haben.`;
    const lines = ingredientLines(ingredients);
    if (lines.length > MAX.ingredients) return `Höchstens ${MAX.ingredients} Zutaten pro Gericht.`;
    if (lines.some((l) => l.length > MAX.ingredient)) {
      return `Eine Zutat darf höchstens ${MAX.ingredient} Zeichen lang sein.`;
    }
    return "";
  }

  /** A German message when an entry form is not acceptable, else "". */
  function checkEntry({ title, note }) {
    if (!clean(title)) return "Schreib auf, was es gibt.";
    if (clean(title).length > MAX.title) return `Der Titel darf höchstens ${MAX.title} Zeichen haben.`;
    if (clean(note).length > MAX.note) return `Die Notiz darf höchstens ${MAX.note} Zeichen haben.`;
    return "";
  }

  /**
   * May the acting member change or clear this entry or dish? Parents may change everything; a child only what
   * they added themselves (the server enforces the kid level, never a parent's record; the screen narrows it to
   * the child's own records).
   * @param {{ parent: boolean, memberId: string|null }} actor
   */
  function canChange(record, actor) {
    if (!actor || !actor.memberId) return false;
    return actor.parent || record.added_by === actor.memberId;
  }

  // ---- votes -----------------------------------------------------------------------------------------------
  const votesOf = (votes, entryId) => votes.filter((v) => v.entry === entryId);

  /** `{ up: [member ids], down: [member ids] }` of one entry. */
  function tally(votes, entryId) {
    const out = { up: [], down: [] };
    for (const v of votesOf(votes, entryId)) (v.value === "down" ? out.down : out.up).push(v.member);
    return out;
  }

  const myVote = (votes, entryId, memberId) =>
    votesOf(votes, entryId).find((v) => v.member === memberId) || null;

  /** Votes on all entries of a dish, for the library's favourites. */
  function dishTally(entries, votes, dishId) {
    const total = { up: 0, down: 0 };
    for (const e of entries) {
      if (e.dish !== dishId) continue;
      const t = tally(votes, e.id);
      total.up += t.up.length;
      total.down += t.down.length;
    }
    return total;
  }

  /**
   * What a tap on a thumb does: the same value again takes the vote back, the other value changes it, no vote
   * creates one. One vote per member and entry, so a member never counts twice.
   */
  function voteAction(votes, entryId, memberId, value) {
    const mine = myVote(votes, entryId, memberId);
    if (!mine) return { op: "create", data: { entry: entryId, member: memberId, value } };
    if (mine.value === value) return { op: "delete", id: mine.id };
    return { op: "update", id: mine.id, patch: { value } };
  }

  /** Applies a tap on a thumb through the data API. */
  async function castVote(data, votes, entryId, memberId, value) {
    const action = voteAction(votes, entryId, memberId, value);
    if (action.op === "create") await data.create("meal_votes", action.data);
    else if (action.op === "update") await data.update("meal_votes", action.id, action.patch);
    else await data.delete("meal_votes", action.id);
    return action;
  }

  // ---- copy and clear --------------------------------------------------------------------------------------
  /**
   * What copying one week onto another does. `mode` "replace" overwrites the target slots the source fills,
   * "fill" keeps them. Nothing in `deletes` may run before the parent chose the mode; `conflicts` is how many
   * target slots already hold an entry that the copy would touch (so the screen knows whether to ask).
   * New entries are added by `actorId`; votes are not copied.
   */
  function copyPlan({ entries, fromStart, toStart, mode, actorId }) {
    const offset = dates.dayNumber(toStart) - dates.dayNumber(fromStart);
    const plan = { creates: [], deletes: [], skipped: 0, conflicts: 0 };
    for (const source of entriesOfWeek(entries, fromStart)) {
      const date = dates.dayKey(dates.dayNumber(source.date) + offset);
      const existing = entryAt(entries, date, source.slot);
      if (existing) plan.conflicts++;
      if (existing && mode !== "replace") {
        plan.skipped++;
        continue;
      }
      if (existing && existing.title === source.title && (existing.dish || "") === (source.dish || "")) {
        plan.skipped++; // already the same meal: replacing it would only drop its votes
        continue;
      }
      if (existing) plan.deletes.push(existing.id);
      plan.creates.push({
        date,
        slot: source.slot,
        title: source.title,
        dish: source.dish || "",
        cook: source.cook || "",
        note: source.note || "",
        added_by: actorId,
      });
    }
    return plan;
  }

  const clearPlan = (entries, start) => entriesOfWeek(entries, start).map((e) => e.id);

  // ---- today -----------------------------------------------------------------------------------------------
  /** Today's entries, lunch before dinner. */
  function todaysMeals(entries, today) {
    return SLOTS.map((s) => entryAt(entries, today, s.key)).filter(Boolean);
  }

  // ---- ingredients -----------------------------------------------------------------------------------------
  /** "3 neu auf der Einkaufsliste, 2 standen schon drauf." */
  function shoppingMessage(result) {
    const added = Number(result && result.added) || 0;
    const existing = Number(result && result.existing) || 0;
    if (added === 0 && existing === 0) return "Keine Zutaten gefunden. Plane Gerichte mit Zutaten ein.";
    if (added === 0)
      return `Nichts Neues: ${existing === 1 ? "die Zutat steht" : `alle ${existing} Zutaten stehen`} schon auf der Liste.`;
    const neu = `${added} ${added === 1 ? "Zutat" : "Zutaten"} neu auf der Einkaufsliste`;
    if (existing === 0) return `${neu}.`;
    return `${neu}, ${existing} ${existing === 1 ? "stand" : "standen"} schon drauf.`;
  }

  /**
   * POST /api/hh/mealplan/shopping with `{ from, to }` or `{ dish }`. Never throws:
   * `{ ok: true, added, existing }` or `{ ok: false, message }`. Needs a connection: the server does the work.
   */
  async function requestShopping({ fetchImpl, token, body }) {
    if (!fetchImpl || !token) return { ok: false, message: "Nicht angemeldet." };
    let res;
    try {
      res = await fetchImpl("/api/hh/mealplan/shopping", {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, message: "Keine Verbindung. Die Zutaten gehen nur mit Internet auf die Liste." };
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok && json) return { ok: true, added: json.added, existing: json.existing };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Das dürfen nur die Eltern." };
    }
    return { ok: false, message: (json && json.message) || "Das hat nicht geklappt." };
  }

  // ---- DOM pieces ------------------------------------------------------------------------------------------
  function h(doc, tag, className, text, attrs) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  const memberOf = (members, id) => members.find((m) => m.id === id) || null;

  /** A member's face; the name is its tooltip. */
  function avatar(doc, member, className = "by") {
    const a = h(doc, "span", className, member ? member.emoji || "🙂" : "");
    if (member) a.setAttribute("title", member.name || "");
    return a;
  }

  /**
   * The thumbs of one entry: a button per direction with its count (pressed when it is the viewer's vote) and the
   * faces of who voted. Without `who` (a device with no profile chosen) the counts are shown but not tappable.
   * `onVote(value)` does the writing.
   */
  function thumbs(doc, { entry, votes, members, who, onVote }) {
    const t = tally(votes, entry.id);
    const mine = who ? myVote(votes, entry.id, who) : null;
    const box = h(doc, "div", "thumbs", undefined, {
      role: "group",
      "aria-label": `Daumen für ${entry.title}`,
    });
    for (const [value, icon, word] of [
      ["up", "👍", "hoch"],
      ["down", "👎", "runter"],
    ]) {
      const count = t[value].length;
      const label = `Daumen ${word}${count ? `, ${count}` : ""}`;
      if (who) {
        const b = h(doc, "button", `thumb ${value}`, `${icon} ${count || ""}`.trim(), {
          type: "button",
          "data-value": value,
          "aria-pressed": String(!!mine && mine.value === value),
          "aria-label": label,
        });
        b.addEventListener("click", () => onVote(value));
        box.append(b);
      } else {
        box.append(
          h(doc, "span", `thumb ${value}`, `${icon} ${count || ""}`.trim(), { "aria-label": label }),
        );
      }
    }
    const voters = h(doc, "span", "voters");
    for (const [value, ids] of [
      ["up", t.up],
      ["down", t.down],
    ]) {
      for (const id of ids) {
        const m = memberOf(members, id);
        const face = avatar(doc, m, "voter");
        if (m) face.setAttribute("title", `${m.name}: ${value === "up" ? "👍" : "👎"}`);
        voters.append(face);
      }
    }
    box.append(voters);
    return box;
  }

  /**
   * The read-only "Heute: Pizza" line for the kids' board and "Wer bist du?", live. Shows nothing when nothing is
   * planned. `who` is the member voting from here (a kid's board, a signed-in parent) or null. Returns `{ el, dispose }`.
   * @param {{ data: object, doc: object, today: () => string, who?: string|null }} options
   */
  function todayLine({ data, doc, today, who = null }) {
    const plan = who ? `#/essen/${encodeURIComponent(who)}` : "#/essen";
    const el = h(doc, "div", "mealtoday hidden", undefined, { "aria-live": "polite" });
    const state = { entries: [], votes: [], members: [], dishes: [] };
    function render() {
      el.textContent = "";
      const meals = todaysMeals(state.entries, today());
      el.className = meals.length ? "mealtoday" : "mealtoday hidden";
      meals.forEach((entry) => {
        const dish = state.dishes.find((d) => d.id === entry.dish);
        const prefix =
          meals.length > 1 ? `Heute ${SLOTS.find((s) => s.key === entry.slot).short}: ` : "Heute: ";
        const row = h(doc, "div", "mealtoday-row");
        row.setAttribute("data-slot", entry.slot);
        row.append(
          h(doc, "span", "mt-emoji", (dish && dish.emoji) || DEFAULT_EMOJI, { "aria-hidden": "true" }),
          h(doc, "span", "mt-text", `${prefix}${entry.title}`),
          thumbs(doc, {
            entry,
            votes: state.votes,
            members: state.members,
            who,
            onVote: (value) =>
              castVote(data, state.votes, entry.id, who, value).catch((err) =>
                console.warn("meals: vote failed", { message: String(err) }),
              ),
          }),
        );
        row.append(h(doc, "a", "mt-link", "Essensplan ›", { href: plan }));
        el.append(row);
      });
    }
    const offs = [
      data.subscribe("meal_plan", (rows) => ((state.entries = rows), render())),
      data.subscribe("meal_votes", (rows) => ((state.votes = rows), render())),
      data.subscribe("members", (rows) => ((state.members = rows), render())),
      data.subscribe("dishes", (rows) => ((state.dishes = rows), render())),
    ];
    return { el, dispose: () => offs.forEach((off) => off()) };
  }

  return {
    SLOTS,
    MAX,
    DEFAULT_EMOJI,
    clean,
    keyOf,
    weekStart,
    weekDays,
    shiftWeek,
    inWeek,
    dm,
    dayHeading,
    isoWeek,
    weekLabel,
    entryAt,
    entriesOfWeek,
    slotLabel,
    daysSince,
    lastPlannedLabel,
    rotation,
    suggest,
    findDish,
    ingredientLines,
    checkDish,
    checkEntry,
    canChange,
    votesOf,
    tally,
    myVote,
    dishTally,
    voteAction,
    castVote,
    copyPlan,
    clearPlan,
    todaysMeals,
    shoppingMessage,
    requestShopping,
    h,
    memberOf,
    avatar,
    thumbs,
    todayLine,
  };
});
