// Governing: ADR-0001 (reads and writes go through the data layer; every write works offline via its outbox),
// ADR-0003 (a family device acts as the kid chosen on it), SPEC-0009 REQ "Week View", REQ "Plan Entries",
// REQ "Dish Library", REQ "Thumbs Up and Down", REQ "Ingredients to the Shopping List", REQ "Copy and Clear",
// SPEC-0001 REQ "Prototype as UI Reference", REQ "Offline Operation"
//
// Route #/essen/<member id>: the week (Monday to Sunday) with a lunch and a dinner row per day, and the dish
// library. Parents (and PIN sessions) change everything; a child adds to empty slots, changes their own entries and
// dishes and sees a parent's entries read-only; everybody votes. The member in the route is the profile the screen
// was opened from (the kid chosen on a family device); a parent always acts as themselves. Replacing a meal deletes
// the entry and creates a new one, so the votes on the old meal go with it (the server cascades them).
// All text goes in through textContent: titles and notes from the data store never become markup.

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(
    node ? require("../meals.js") : root.HH.meals,
    node ? require("../dates.js") : root.HH.dates,
    root,
  );
  if (node) module.exports = api;
  else root.HH.screens.essen = api.screen;
})(typeof self !== "undefined" ? self : this, function (M, dates, root) {
  "use strict";

  const { h } = M;
  const accent = (member) => `var(--${(member && member.colour) || "green"})`;

  function screen(view, ctx) {
    const doc = view.ownerDocument;
    const host = h(doc, "div", "essen");
    view.append(host);
    if (!ctx.data) {
      host.append(h(doc, "h1", "", "Essen"), h(doc, "p", "muted", "Nicht angemeldet."));
      return;
    }
    const data = ctx.data;
    const auth = (ctx.auth && ctx.auth.record && ctx.auth.record()) || {};
    const isParent = auth.collectionName === "parents";
    const routeMember = (ctx.args && ctx.args[0]) || null;
    const ask = ctx.confirm || ((text) => (root.confirm ? root.confirm(text) : true));
    const fetchImpl = ctx.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    const today = () => ctx.clock.today();

    const model = { dishes: [], entries: [], votes: [], members: [] };
    // What the screen shows besides the data; kept across live updates so typing is never lost.
    const ui = {
      mode: "week", // "week" | "dishes"
      week: M.weekStart(today()),
      picked: null, // the kid chosen on a device that was opened without one
      edit: null, // the open form: { type: "entry" | "dish", ... } with its draft values
      copy: null, // { target: Monday of the target week } while the copy panel is open
      result: null, // { text, warn } the last message
      focus: null,
    };

    const memberById = (id) => model.members.find((m) => m.id === id) || null;
    const actorId = () => {
      if (isParent) return auth.member || null;
      const m = memberById(routeMember || ui.picked);
      return m && m.role === "kid" ? m.id : null;
    };
    const actor = () => ({ parent: isParent, memberId: actorId() });
    const say = (text, warn = false) => {
      ui.result = text ? { text, warn } : null;
      render();
    };
    const log = (what) => (err) => console.warn(`essen: ${what} failed`, { message: String(err) });

    // ---- writing ---------------------------------------------------------------------------------------------
    /** Sets, changes or replaces the entry of a slot. A different meal replaces the entry (and its votes). */
    async function saveEntry({ date, slot, existing, title, dish, cook, note }) {
      const fields = { title: M.clean(title), dish: dish || "", cook: cook || "", note: M.clean(note) };
      if (!existing) return data.create("meal_plan", { date, slot, ...fields, added_by: actorId() });
      if (existing.title === fields.title && (existing.dish || "") === fields.dish) {
        const patch = {};
        for (const f of ["cook", "note"]) if ((existing[f] || "") !== fields[f]) patch[f] = fields[f];
        if (Object.keys(patch).length) await data.update("meal_plan", existing.id, patch);
        return null;
      }
      await data.delete("meal_plan", existing.id);
      return data.create("meal_plan", { date, slot, ...fields, added_by: actorId() });
    }

    async function runShopping(body) {
      say("Einen Moment …");
      const res = await M.requestShopping({
        fetchImpl,
        token: ctx.auth && ctx.auth.token && ctx.auth.token(),
        body,
      });
      say(res.ok ? M.shoppingMessage(res) : res.message, !res.ok);
    }

    async function runCopy(mode) {
      const target = ui.copy.target;
      const plan = M.copyPlan({
        entries: model.entries,
        fromStart: ui.week,
        toStart: target,
        mode,
        actorId: actorId(),
      });
      ui.copy = null;
      // Only now, after the parent chose, anything is deleted.
      for (const id of plan.deletes) await data.delete("meal_plan", id);
      for (const entry of plan.creates) await data.create("meal_plan", entry);
      ui.week = target;
      const n = plan.creates.length;
      say(
        n
          ? `${n} ${n === 1 ? "Eintrag" : "Einträge"} kopiert.`
          : "Nichts zu kopieren: alles ist schon so geplant.",
      );
    }

    async function clearWeek() {
      const ids = M.clearPlan(model.entries, ui.week);
      if (!ids.length) return;
      if (!ask(`Alle ${ids.length} ${ids.length === 1 ? "Eintrag" : "Einträge"} dieser Woche löschen?`))
        return;
      for (const id of ids) await data.delete("meal_plan", id);
      say("Die Woche ist leer.");
    }

    // ---- editors ---------------------------------------------------------------------------------------------
    /** Wires an input to its draft field, remembering the focus across re-renders. */
    function bind(input, name, onChange) {
      input.value = ui.edit[name] || "";
      input.addEventListener("input", () => {
        ui.edit[name] = input.value;
        ui.focus = name;
        if (onChange) onChange();
      });
      input.addEventListener("focus", () => (ui.focus = name));
      return input;
    }
    function labelled(label, control) {
      const wrap = h(doc, "label", "meal-field");
      wrap.append(h(doc, "span", "meal-label", label), control);
      return wrap;
    }
    const field = (tag, attrs) => {
      const e = h(doc, tag, "", undefined, attrs);
      return e;
    };

    function entryEditor() {
      const e = ui.edit;
      const form = h(doc, "form", "panel meal-editor", undefined, {
        "aria-label": `${M.slotLabel(e.slot)} bearbeiten`,
      });
      const title = bind(
        field("input", { type: "text", maxlength: "200", autocomplete: "off" }),
        "title",
        () => {
          const linked = model.dishes.find((d) => d.id === e.dish);
          if (linked && M.keyOf(linked.name) !== M.keyOf(e.title)) e.dish = "";
          renderSuggestions();
        },
      );
      title.setAttribute("data-field", "title");
      title.setAttribute("aria-label", "Was gibt es?");
      const sugg = h(doc, "div", "meal-sugg", undefined, { "aria-label": "Vorschläge aus den Gerichten" });
      function renderSuggestions() {
        sugg.textContent = "";
        for (const { dish, label } of M.suggest(model.dishes, e.title, today()).slice(0, 6)) {
          const b = h(doc, "button", `sugg${e.dish === dish.id ? " picked" : ""}`, undefined, {
            type: "button",
            "data-dish": dish.id,
          });
          b.append(
            h(doc, "span", "", `${dish.emoji || M.DEFAULT_EMOJI} ${dish.name}`),
            h(doc, "small", "", label),
          );
          b.addEventListener("click", () => {
            e.title = dish.name;
            e.dish = dish.id;
            ui.focus = null;
            render();
          });
          sugg.append(b);
        }
      }
      renderSuggestions();
      const cook = field("select", {});
      cook.setAttribute("aria-label", "Wer kocht?");
      const none = h(doc, "option", "", "Egal / noch offen");
      none.value = "";
      cook.append(none);
      for (const m of model.members) {
        const o = h(doc, "option", "", `${m.emoji || ""} ${m.name}`.trim());
        o.value = m.id;
        if (m.id === e.cook) o.setAttribute("selected", "");
        cook.append(o);
      }
      cook.value = e.cook || "";
      cook.addEventListener("change", () => (e.cook = cook.value));
      const note = bind(field("input", { type: "text", maxlength: "300", autocomplete: "off" }), "note");
      note.setAttribute("data-field", "note");
      const err = h(doc, "p", "form-error", e.error || "", { role: "alert" });
      const save = h(doc, "button", "btn primary", "Speichern", { type: "submit" });
      const row = h(doc, "div", "meal-actions");
      row.append(save);
      const existing = e.id ? model.entries.find((x) => x.id === e.id) : null;
      if (existing && M.canChange(existing, actor())) {
        const clear = h(doc, "button", "btn", "Leeren", { type: "button", "data-act": "clear" });
        clear.addEventListener("click", () => {
          data.delete("meal_plan", existing.id).catch(log("clear"));
          ui.edit = null;
          render();
        });
        row.append(clear);
      }
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel" });
      cancel.addEventListener("click", () => {
        ui.edit = null;
        render();
      });
      row.append(cancel);
      form.append(
        labelled("Was gibt es?", title),
        sugg,
        labelled("Wer kocht?", cook),
        labelled("Notiz", note),
        err,
        row,
      );
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const problem = M.checkEntry(e);
        if (problem) {
          e.error = problem;
          render();
          return;
        }
        const dish = e.dish || (M.findDish(model.dishes, e.title) || {}).id || "";
        const done = {
          date: e.date,
          slot: e.slot,
          existing,
          title: e.title,
          dish,
          cook: e.cook,
          note: e.note,
        };
        ui.edit = null;
        saveEntry(done).catch(log("save"));
        render();
      });
      return form;
    }

    function dishEditor() {
      const e = ui.edit;
      const form = h(doc, "form", "panel meal-editor dish-editor", undefined, {
        "aria-label": e.id ? "Gericht bearbeiten" : "Neues Gericht",
      });
      const emoji = bind(field("input", { type: "text", maxlength: "16", autocomplete: "off" }), "emoji");
      emoji.setAttribute("aria-label", "Symbol");
      emoji.setAttribute("data-field", "emoji");
      const name = bind(field("input", { type: "text", maxlength: "200", autocomplete: "off" }), "name");
      name.setAttribute("data-field", "name");
      const ingredients = bind(field("textarea", { rows: "5" }), "ingredients");
      ingredients.setAttribute("data-field", "ingredients");
      ingredients.setAttribute("aria-label", "Zutaten");
      const err = h(doc, "p", "form-error", e.error || "", { role: "alert" });
      const save = h(doc, "button", "btn primary", "Speichern", { type: "submit" });
      const row = h(doc, "div", "meal-actions");
      row.append(save);
      const existing = e.id ? model.dishes.find((x) => x.id === e.id) : null;
      if (existing && M.canChange(existing, actor())) {
        const del = h(doc, "button", "btn", "Löschen", { type: "button", "data-act": "delete" });
        del.addEventListener("click", () => {
          if (
            !ask(`„${existing.name}“ aus den Gerichten löschen? Geplante Mahlzeiten bleiben als Text stehen.`)
          )
            return;
          data.delete("dishes", existing.id).catch(log("delete dish"));
          ui.edit = null;
          render();
        });
        row.append(del);
      }
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel" });
      cancel.addEventListener("click", () => {
        ui.edit = null;
        render();
      });
      row.append(cancel);
      form.append(
        labelled("Symbol", emoji),
        labelled("Name", name),
        labelled("Zutaten (eine pro Zeile, nur Namen)", ingredients),
        err,
        row,
      );
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const problem = M.checkDish(e);
        if (problem) {
          e.error = problem;
          render();
          return;
        }
        const fields = {
          name: M.clean(e.name),
          emoji: M.clean(e.emoji) || M.DEFAULT_EMOJI,
          ingredients: M.ingredientLines(e.ingredients).join("\n"),
        };
        ui.edit = null;
        const write = existing
          ? data.update("dishes", existing.id, fields)
          : data.create("dishes", { ...fields, last_planned: "", added_by: actorId() });
        write.catch(log("save dish"));
        render();
      });
      return form;
    }

    // ---- week ------------------------------------------------------------------------------------------------
    function thumbsFor(entry) {
      return M.thumbs(doc, {
        entry,
        votes: model.votes,
        members: model.members,
        who: actorId(),
        onVote: (value) => M.castVote(data, model.votes, entry.id, actorId(), value).catch(log("vote")),
      });
    }

    function slotEl(date, slot) {
      const el = h(doc, "div", "meal-slot", undefined, { "data-date": date, "data-slot": slot.key });
      el.append(h(doc, "span", "meal-slotname", slot.label));
      const entry = M.entryAt(model.entries, date, slot.key);
      const editing =
        ui.edit && ui.edit.type === "entry" && ui.edit.date === date && ui.edit.slot === slot.key;
      if (editing) {
        el.append(entryEditor());
        return el;
      }
      if (!entry) {
        const add = h(doc, "button", "meal-add", "+ eintragen", {
          type: "button",
          "aria-label": `${slot.label} am ${M.dayHeading(date)} eintragen`,
        });
        add.addEventListener("click", () => {
          if (!actorId()) return say("Wähle zuerst oben, wer du bist.", true);
          ui.edit = {
            type: "entry",
            date,
            slot: slot.key,
            id: null,
            title: "",
            dish: "",
            cook: "",
            note: "",
          };
          ui.focus = "title";
          render();
        });
        el.append(add);
        return el;
      }
      const dish = model.dishes.find((d) => d.id === entry.dish);
      const body = h(doc, "div", `meal-entry${entry._pending ? " pending" : ""}`, undefined, {
        "data-entry": entry.id,
      });
      const line = h(doc, "div", "meal-line");
      line.append(
        h(doc, "span", "meal-emoji", (dish && dish.emoji) || M.DEFAULT_EMOJI, { "aria-hidden": "true" }),
        h(doc, "span", "meal-title", entry.title),
        M.avatar(doc, memberById(entry.added_by)),
      );
      const cook = memberById(entry.cook);
      if (cook) {
        const c = M.avatar(doc, cook, "cook");
        c.setAttribute("title", `Kocht: ${cook.name}`);
        line.append(c);
      }
      if (M.canChange(entry, actor())) {
        const edit = h(doc, "button", "meal-edit", "✏️", {
          type: "button",
          "aria-label": `${slot.label} am ${M.dayHeading(date)} ändern`,
        });
        edit.addEventListener("click", () => {
          ui.edit = {
            type: "entry",
            date,
            slot: slot.key,
            id: entry.id,
            title: entry.title,
            dish: entry.dish || "",
            cook: entry.cook || "",
            note: entry.note || "",
          };
          ui.focus = "title";
          render();
        });
        line.append(edit);
      }
      body.append(line);
      if (entry.note) body.append(h(doc, "div", "meal-note", entry.note));
      body.append(thumbsFor(entry));
      el.append(body);
      return el;
    }

    function dayEl(date) {
      const isToday = date === today();
      const el = h(doc, "section", `meal-day${isToday ? " today" : ""}`, undefined, { "data-date": date });
      if (isToday) el.setAttribute("aria-current", "date");
      const head = h(doc, "div", "meal-dayhead");
      head.append(h(doc, "b", "", M.dayHeading(date)));
      if (isToday) head.append(h(doc, "span", "meal-todaytag", "heute"));
      if (isParent && ["lunch", "dinner"].some((s) => (M.entryAt(model.entries, date, s) || {}).dish)) {
        const b = h(doc, "button", "link meal-shop", "🛒 Zutaten", {
          type: "button",
          "data-act": "day-ingredients",
          "aria-label": `Zutaten für ${M.dayHeading(date)} auf die Liste`,
        });
        b.addEventListener("click", () => runShopping({ from: date, to: date }).catch(log("ingredients")));
        head.append(b);
      }
      el.append(head);
      for (const slot of M.SLOTS) el.append(slotEl(date, slot));
      return el;
    }

    function copyPanel() {
      const panel = h(doc, "section", "panel meal-copy", undefined, { "aria-label": "Woche kopieren" });
      const source = M.entriesOfWeek(model.entries, ui.week);
      panel.append(h(doc, "h3", "", "Woche kopieren"));
      const pick = h(doc, "div", "meal-weeknav");
      const prev = h(doc, "button", "link", "‹", {
        type: "button",
        "aria-label": "Frühere Zielwoche",
        "data-act": "prev-target",
      });
      const next = h(doc, "button", "link", "›", {
        type: "button",
        "aria-label": "Spätere Zielwoche",
        "data-act": "next-target",
      });
      prev.addEventListener("click", () => ((ui.copy.target = M.shiftWeek(ui.copy.target, -1)), render()));
      next.addEventListener("click", () => ((ui.copy.target = M.shiftWeek(ui.copy.target, 1)), render()));
      pick.append(prev, h(doc, "span", "meal-weeklabel", `Auf ${M.weekLabel(ui.copy.target)}`), next);
      panel.append(pick);
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel-copy" });
      cancel.addEventListener("click", () => ((ui.copy = null), render()));
      if (ui.copy.target === ui.week) {
        panel.append(h(doc, "p", "muted", "Wähle eine andere Woche als Ziel."), cancel);
        return panel;
      }
      if (!source.length) {
        panel.append(h(doc, "p", "muted", "Diese Woche ist leer, es gibt nichts zu kopieren."), cancel);
        return panel;
      }
      const conflicts = M.copyPlan({
        entries: model.entries,
        fromStart: ui.week,
        toStart: ui.copy.target,
        mode: "fill",
        actorId: actorId(),
      }).conflicts;
      const row = h(doc, "div", "meal-actions");
      const go = (label, mode, primary, act) => {
        const b = h(doc, "button", primary ? "btn primary" : "btn", label, {
          type: "button",
          "data-act": act,
        });
        b.addEventListener("click", () => runCopy(mode).catch(log("copy")));
        return b;
      };
      if (conflicts === 0) {
        row.append(go("Kopieren", "fill", true, "copy"), cancel);
      } else {
        panel.append(
          h(
            doc,
            "p",
            "",
            `In der Zielwoche ${conflicts === 1 ? "ist" : "sind"} schon ${conflicts} ${conflicts === 1 ? "Platz" : "Plätze"} belegt. Was soll passieren?`,
          ),
        );
        row.append(
          go("Ersetzen", "replace", false, "copy-replace"),
          go("Nur freie Plätze füllen", "fill", true, "copy-fill"),
          cancel,
        );
      }
      panel.append(row);
      return panel;
    }

    function weekView() {
      const box = h(doc, "div", "meal-week");
      const nav = h(doc, "div", "meal-weeknav");
      const step = (label, aria, weeks, act) => {
        const b = h(doc, "button", "btn", label, { type: "button", "aria-label": aria, "data-act": act });
        b.addEventListener("click", () => ((ui.week = M.shiftWeek(ui.week, weeks)), render()));
        return b;
      };
      const current = h(doc, "button", "link", "Diese Woche", { type: "button", "data-act": "current" });
      current.addEventListener("click", () => ((ui.week = M.weekStart(today())), render()));
      nav.append(
        step("‹", "Vorige Woche", -1, "prev-week"),
        h(doc, "span", "meal-weeklabel", M.weekLabel(ui.week), { "aria-live": "polite" }),
        step("›", "Nächste Woche", 1, "next-week"),
        current,
      );
      box.append(nav);
      if (isParent) {
        const tools = h(doc, "div", "meal-tools");
        const week = h(doc, "button", "btn", "🛒 Zutaten für die Woche", {
          type: "button",
          "data-act": "week-ingredients",
        });
        week.addEventListener("click", () =>
          runShopping({ from: ui.week, to: dates.addDays(ui.week, 6) }).catch(log("ingredients")),
        );
        const copy = h(doc, "button", "btn", "Woche kopieren", { type: "button", "data-act": "copy-week" });
        copy.addEventListener("click", () => {
          ui.copy = { target: M.shiftWeek(ui.week, 1) };
          render();
        });
        const clear = h(doc, "button", "link", "Woche leeren", { type: "button", "data-act": "clear-week" });
        clear.addEventListener("click", () => clearWeek().catch(log("clear week")));
        tools.append(week, copy, clear);
        box.append(tools);
        if (ui.copy) box.append(copyPanel());
      }
      for (const date of M.weekDays(ui.week)) box.append(dayEl(date));
      return box;
    }

    // ---- dish library ------------------------------------------------------------------------------------------
    function dishRow(dish) {
      const editing = ui.edit && ui.edit.type === "dish" && ui.edit.id === dish.id;
      const row = h(doc, "div", `meal-dish${dish._pending ? " pending" : ""}`, undefined, {
        "data-dish": dish.id,
      });
      if (editing) {
        row.append(dishEditor());
        return row;
      }
      const t = M.dishTally(model.entries, model.votes, dish.id);
      const lines = M.ingredientLines(dish.ingredients).length;
      const info = h(doc, "div", "meal-dishinfo");
      info.append(
        h(doc, "b", "", `${dish.emoji || M.DEFAULT_EMOJI} ${dish.name}`),
        h(
          doc,
          "small",
          "",
          `${M.lastPlannedLabel(dish, today())} · ${lines} ${lines === 1 ? "Zutat" : "Zutaten"}`,
        ),
      );
      const score = h(doc, "span", "meal-tally", `👍 ${t.up} · 👎 ${t.down}`, {
        "aria-label": `${t.up} mal Daumen hoch, ${t.down} mal Daumen runter`,
      });
      row.append(info, score, M.avatar(doc, memberById(dish.added_by)));
      if (isParent) {
        const b = h(doc, "button", "btn", "Zutaten auf die Liste", {
          type: "button",
          "data-act": "dish-ingredients",
        });
        b.addEventListener("click", () => runShopping({ dish: dish.id }).catch(log("ingredients")));
        row.append(b);
      }
      if (M.canChange(dish, actor())) {
        const edit = h(doc, "button", "meal-edit", "✏️", {
          type: "button",
          "aria-label": `${dish.name} ändern`,
        });
        edit.addEventListener("click", () => {
          ui.edit = {
            type: "dish",
            id: dish.id,
            name: dish.name,
            emoji: dish.emoji || "",
            ingredients: dish.ingredients || "",
          };
          ui.focus = "name";
          render();
        });
        row.append(edit);
      }
      return row;
    }

    function dishesView() {
      const box = h(doc, "div", "meal-dishes");
      const adding = ui.edit && ui.edit.type === "dish" && !ui.edit.id;
      if (adding) box.append(dishEditor());
      else {
        const add = h(doc, "button", "btn primary", "Neues Gericht", {
          type: "button",
          "data-act": "new-dish",
        });
        add.addEventListener("click", () => {
          if (!actorId()) return say("Wähle zuerst oben, wer du bist.", true);
          ui.edit = { type: "dish", id: null, name: "", emoji: "", ingredients: "" };
          ui.focus = "name";
          render();
        });
        box.append(add);
      }
      if (!model.dishes.length) box.append(h(doc, "div", "note", "Noch keine Gerichte. Leg das erste an."));
      else box.append(h(doc, "div", "section", "Lange nicht gekocht zuerst"));
      for (const dish of M.rotation(model.dishes)) box.append(dishRow(dish));
      return box;
    }

    // ---- frame -----------------------------------------------------------------------------------------------
    function render() {
      host.textContent = "";
      const me = memberById(actorId());
      host.style && host.style.setProperty && host.style.setProperty("--c", accent(me));

      const top = h(doc, "div", "top");
      const back = h(doc, "a", "av", me ? me.emoji : "🍽️", { href: "#/wer", "aria-label": "Zurück" });
      const hello = h(doc, "div", "hello");
      hello.append(
        h(doc, "b", "", "Essen"),
        h(
          doc,
          "span",
          "",
          me && !isParent ? `Hallo ${me.name}! Schlag vor, was es gibt.` : "Was kocht ihr diese Woche?",
        ),
      );
      top.append(back, hello);
      host.append(top);

      if (!isParent && !actorId() && model.members.length) {
        const chips = h(doc, "div", "whochips", undefined, { role: "group", "aria-label": "Wer bist du?" });
        for (const m of model.members.filter((x) => x.role === "kid")) {
          const b = h(doc, "button", "", `${m.emoji} ${m.name}`, { type: "button", "aria-pressed": "false" });
          b.addEventListener("click", () => ((ui.picked = m.id), render()));
          chips.append(b);
        }
        host.append(chips);
      }

      const tabs = h(doc, "div", "ltabs", undefined, { role: "group", "aria-label": "Ansicht" });
      for (const [mode, label] of [
        ["week", "Woche"],
        ["dishes", "Gerichte"],
      ]) {
        const b = h(doc, "button", "", label, {
          type: "button",
          "data-mode": mode,
          "aria-pressed": String(ui.mode === mode),
        });
        b.addEventListener("click", () => {
          ui.mode = mode;
          ui.edit = null;
          ui.copy = null;
          render();
        });
        tabs.append(b);
      }
      host.append(tabs);

      const status = h(
        doc,
        "div",
        `hint meal-result${ui.result && ui.result.warn ? " warn" : ""}`,
        ui.result ? ui.result.text : "",
        {
          role: "status",
          "aria-live": "polite",
        },
      );
      host.append(status);
      host.append(ui.mode === "week" ? weekView() : dishesView());

      if (ui.focus) {
        const input = host.querySelector(`[data-field="${ui.focus}"]`);
        if (input && input.focus) {
          input.focus();
          const end = String(input.value || "").length;
          if (input.setSelectionRange) input.setSelectionRange(end, end);
        }
      }
    }

    const offs = [
      data.subscribe("dishes", (rows) => ((model.dishes = rows), render())),
      data.subscribe("meal_plan", (rows) => ((model.entries = rows), render())),
      data.subscribe("meal_votes", (rows) => {
        // (votes of an entry that is gone are ignored until the server's cascade reaches the mirror)
        model.votes = rows;
        render();
      }),
      data.subscribe("members", (rows) => ((model.members = rows), render())),
    ];
    render();
    return () => offs.forEach((off) => off());
  }

  return { screen };
});
