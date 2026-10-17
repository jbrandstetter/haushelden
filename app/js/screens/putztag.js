// Governing: ADR-0001 (reads and writes go through the data layer; every write works offline via its outbox),
// ADR-0003 (a family device acts as the kid chosen on it), SPEC-0010 REQ "Cleaning Day List", REQ "Ticking Off",
// REQ "Standard Chores", REQ "Starting a Cleaning Day", REQ "Assigning and Adding Chores",
// SPEC-0001 REQ "Prototype as UI Reference", REQ "Offline Operation"
//
// Route #/putztag/<member id>: the chores of one cleaning day, grouped by person, which everybody sees in full, and for
// parents the standard chores. Parents tick, assign, add and delete anything; a child ticks only the chores assigned to
// the profile chosen on the device (the member in the route, or picked here). All text goes in through textContent:
// titles from the data store never become markup.

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(
    node ? require("../chores.js") : root.HH.chores,
    node ? require("../dates.js") : root.HH.dates,
    root,
  );
  if (node) module.exports = api;
  else root.HH.screens.putztag = api.screen;
})(typeof self !== "undefined" ? self : this, function (C, dates, root) {
  "use strict";

  const { h } = C;
  const accent = (member) => `var(--${(member && member.colour) || "green"})`;

  function screen(view, ctx) {
    const doc = view.ownerDocument;
    const host = h(doc, "div", "putztag essen"); // shares the Essen screen's header, tabs and form styles
    view.append(host);
    if (!ctx.data) {
      host.append(h(doc, "h1", "", "Putztag"), h(doc, "p", "muted", "Nicht angemeldet."));
      return;
    }
    const data = ctx.data;
    const auth = (ctx.auth && ctx.auth.record && ctx.auth.record()) || {};
    const isParent = auth.collectionName === "parents";
    const routeMember = (ctx.args && ctx.args[0]) || null;
    const ask = ctx.confirm || ((text) => (root.confirm ? root.confirm(text) : true));
    const today = () => ctx.clock.today();

    const model = { templates: [], chores: [], members: [] };
    const ui = {
      mode: "day", // "day" | "templates" (parents)
      day: null, // the shown cleaning day; null = the default one
      picked: null, // the kid chosen on a device that was opened without one
      edit: null, // the open form: { type: "chore" | "template", ... } with its draft values
      newDay: null, // { day } while the "start a cleaning day" panel is open
      importing: null, // { papa, mama } while the starter set is being mapped
      result: null,
      focus: null,
    };

    const memberById = (id) => model.members.find((m) => m.id === id) || null;
    const actorId = () => {
      if (isParent) return auth.member || null;
      const m = memberById(routeMember || ui.picked);
      return m && m.role === "kid" ? m.id : null;
    };
    const actor = () => ({ parent: isParent, memberId: actorId() });
    const shownDay = () => ui.day || C.defaultDay(model.chores, today());
    const say = (text, warn = false) => {
      ui.result = text ? { text, warn } : null;
      render();
    };
    const log = (what) => (err) => console.warn(`putztag: ${what} failed`, { message: String(err) });

    // ---- writing -------------------------------------------------------------------------------------------
    const tick = (chore) => {
      if (!C.canTick(chore, actor())) return;
      data.update("chores", chore.id, C.tickPatch(chore, actorId())).catch(log("tick"));
    };

    async function startDay(day) {
      const plan = C.planDay({
        day,
        templates: model.templates,
        chores: model.chores,
        members: model.members,
      });
      ui.newDay = null;
      for (const chore of plan.creates) await data.create("chores", chore);
      if (plan.creates.length || plan.existing) ui.day = day;
      say(C.startMessage(plan));
    }

    async function deleteDay(day) {
      const mine = C.choresOfDay(model.chores, day);
      if (!mine.length) return;
      if (!ask(`Den Putztag am ${C.dayHeading(day)} mit allen ${mine.length} Aufgaben löschen?`)) return;
      for (const c of mine) await data.delete("chores", c.id);
      ui.day = null;
      say("Der Putztag ist gelöscht.");
    }

    async function importStarter(mapping) {
      const existing = model.templates.length;
      for (const t of C.starterTemplates(mapping)) await data.create("chore_templates", t);
      ui.importing = null;
      say(
        existing
          ? "Die Standardliste ist ergänzt."
          : "Die Standardliste ist übernommen. Du kannst alles ändern.",
      );
    }

    // ---- editors -------------------------------------------------------------------------------------------
    function bind(input, name) {
      input.value = ui.edit[name] || "";
      input.addEventListener("input", () => {
        ui.edit[name] = input.value;
        ui.focus = name;
      });
      input.addEventListener("focus", () => (ui.focus = name));
      return input;
    }
    function labelled(label, control) {
      const wrap = h(doc, "label", "meal-field");
      wrap.append(h(doc, "span", "meal-label", label), control);
      return wrap;
    }
    function memberSelect(name, aria, options) {
      const sel = h(doc, "select", "", undefined, { "aria-label": aria, "data-field": name });
      for (const [value, label] of options) {
        const o = h(doc, "option", "", label);
        o.value = value;
        if (value === (ui.edit[name] || "")) o.setAttribute("selected", "");
        sel.append(o);
      }
      sel.value = ui.edit[name] || "";
      sel.addEventListener("change", () => (ui.edit[name] = sel.value));
      return sel;
    }
    const memberOptions = (none) => [
      ["", none],
      ...model.members.map((m) => [m.id, `${m.emoji || ""} ${m.name}`.trim()]),
    ];
    function actions(save, extra) {
      const row = h(doc, "div", "meal-actions");
      row.append(h(doc, "button", "btn primary", save, { type: "submit" }));
      if (extra) row.append(extra);
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel" });
      cancel.addEventListener("click", () => {
        ui.edit = null;
        render();
      });
      row.append(cancel);
      return row;
    }

    function choreEditor() {
      const e = ui.edit;
      const form = h(doc, "form", "panel meal-editor", undefined, {
        "aria-label": e.id ? "Aufgabe bearbeiten" : "Aufgabe hinzufügen",
      });
      const title = bind(
        h(doc, "input", "", undefined, { type: "text", maxlength: "200", autocomplete: "off" }),
        "title",
      );
      title.setAttribute("data-field", "title");
      title.setAttribute("aria-label", "Was ist zu tun?");
      const who = memberSelect("assignee", "Wer macht das?", memberOptions("Noch niemandem zugeteilt"));
      const err = h(doc, "p", "form-error", e.error || "", { role: "alert" });
      let del = null;
      if (e.id) {
        del = h(doc, "button", "btn", "Löschen", { type: "button", "data-act": "delete" });
        del.addEventListener("click", () => {
          data.delete("chores", e.id).catch(log("delete chore"));
          ui.edit = null;
          render();
        });
      }
      form.append(
        labelled("Was ist zu tun?", title),
        labelled("Wer macht das?", who),
        err,
        actions("Speichern", del),
      );
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const problem = C.checkTitle(e.title);
        if (problem) {
          e.error = problem;
          render();
          return;
        }
        const fields = { title: C.clean(e.title), assignee: e.assignee || "" };
        ui.edit = null;
        if (e.id) {
          const old = model.chores.find((c) => c.id === e.id);
          const patch = {};
          if (old && old.title !== fields.title) patch.title = fields.title;
          if (old && (old.assignee || "") !== fields.assignee)
            Object.assign(patch, { assignee: fields.assignee, done: false, done_by: "" });
          if (Object.keys(patch).length) data.update("chores", e.id, patch).catch(log("save chore"));
        } else {
          const day = shownDay();
          const sort = C.choresOfDay(model.chores, day).reduce((max, c) => Math.max(max, c.sort || 0), 0) + 1;
          data
            .create("chores", { day, ...fields, template: "", done: false, done_by: "", sort })
            .catch(log("add chore"));
        }
        render();
      });
      return form;
    }

    function templateEditor() {
      const e = ui.edit;
      const form = h(doc, "form", "panel meal-editor", undefined, {
        "aria-label": e.id ? "Standard-Aufgabe bearbeiten" : "Neue Standard-Aufgabe",
      });
      const title = bind(
        h(doc, "input", "", undefined, { type: "text", maxlength: "200", autocomplete: "off" }),
        "title",
      );
      title.setAttribute("data-field", "title");
      title.setAttribute("aria-label", "Was ist zu tun?");
      const who = memberSelect("who", "Für wen?", [["kids", "Jedes Kind"], ...memberOptions("Noch niemand")]);
      const every = memberSelect(
        "every",
        "Wie oft?",
        C.INTERVALS.map((i) => [String(i.days), i.label]),
      );
      const err = h(doc, "p", "form-error", e.error || "", { role: "alert" });
      let del = null;
      if (e.id) {
        del = h(doc, "button", "btn", "Löschen", { type: "button", "data-act": "delete" });
        del.addEventListener("click", () => {
          if (
            !ask(
              `„${e.title}“ aus den Standard-Aufgaben löschen? Schon angelegte Putztage bleiben, wie sie sind.`,
            )
          )
            return;
          data.delete("chore_templates", e.id).catch(log("delete template"));
          ui.edit = null;
          render();
        });
      }
      form.append(
        labelled("Was ist zu tun?", title),
        labelled("Für wen?", who),
        labelled("Wie oft?", every),
        err,
        actions("Speichern", del),
      );
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const problem = C.checkTitle(e.title);
        if (problem) {
          e.error = problem;
          render();
          return;
        }
        const fields = {
          title: C.clean(e.title),
          kids: e.who === "kids",
          assignee: e.who === "kids" ? "" : e.who || "",
          every_days: Number(e.every || 0),
        };
        ui.edit = null;
        const write = e.id
          ? data.update("chore_templates", e.id, fields)
          : data.create("chore_templates", {
              ...fields,
              sort: model.templates.reduce((m, t) => Math.max(m, t.sort || 0), 0) + 1,
            });
        write.catch(log("save template"));
        render();
      });
      return form;
    }

    // ---- the day -------------------------------------------------------------------------------------------
    function choreRow(chore) {
      const mayTick = C.canTick(chore, actor());
      const row = h(
        doc,
        "div",
        `chore${chore.done ? " done" : ""}${chore._pending ? " pending" : ""}`,
        undefined,
        {
          "data-chore": chore.id,
        },
      );
      if (ui.edit && ui.edit.type === "chore" && ui.edit.id === chore.id) {
        row.append(choreEditor());
        return row;
      }
      const box = h(doc, "button", "chore-check", chore.done ? "✓" : "", {
        type: "button",
        role: "checkbox",
        "aria-checked": String(Boolean(chore.done)),
        "aria-label": chore.title,
        "data-act": "tick",
      });
      if (mayTick) box.addEventListener("click", () => tick(chore));
      else box.setAttribute("disabled", "");
      row.append(box, h(doc, "span", "chore-title", chore.title));
      const by = memberById(chore.done_by);
      if (chore.done && by) row.append(C.avatar(doc, by, "by"));
      if (isParent) {
        const edit = h(doc, "button", "meal-edit", "✏️", {
          type: "button",
          "aria-label": `${chore.title} ändern`,
        });
        edit.addEventListener("click", () => {
          ui.edit = { type: "chore", id: chore.id, title: chore.title, assignee: chore.assignee || "" };
          ui.focus = "title";
          render();
        });
        row.append(edit);
      }
      return row;
    }

    function newDayPanel() {
      const panel = h(doc, "form", "panel meal-copy", undefined, { "aria-label": "Putztag anlegen" });
      const input = h(doc, "input", "", undefined, {
        type: "date",
        "data-field": "newday",
        "aria-label": "Datum",
        min: today(),
      });
      input.value = ui.newDay.day;
      input.addEventListener("input", () => (ui.newDay.day = input.value));
      const err = h(doc, "p", "form-error", ui.newDay.error || "", { role: "alert" });
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel" });
      cancel.addEventListener("click", () => ((ui.newDay = null), render()));
      const row = h(doc, "div", "meal-actions");
      row.append(h(doc, "button", "btn primary", "Anlegen", { type: "submit" }), cancel);
      panel.append(h(doc, "h3", "", "Putztag anlegen"), labelled("Datum", input), err, row);
      if (!model.templates.length) {
        panel.append(
          h(
            doc,
            "p",
            "muted",
            "Es gibt noch keine Standard-Aufgaben. Übernimm zuerst unter „Standard-Aufgaben“ die Standardliste.",
          ),
        );
      }
      panel.addEventListener("submit", (ev) => {
        ev.preventDefault();
        let problem = "";
        try {
          dates.dayNumber(ui.newDay.day);
          if (ui.newDay.day < today()) problem = "Der Tag liegt in der Vergangenheit.";
        } catch {
          problem = "Bitte ein Datum wählen.";
        }
        if (!model.templates.length) problem = problem || "Es gibt noch keine Standard-Aufgaben.";
        if (problem) {
          ui.newDay.error = problem;
          render();
          return;
        }
        startDay(ui.newDay.day).catch(log("start day"));
      });
      return panel;
    }

    function dayView() {
      const box = h(doc, "div", "chores");
      const day = shownDay();
      const days = C.daysWithChores(model.chores);
      if (isParent) {
        const tools = h(doc, "div", "meal-tools");
        const start = h(doc, "button", "btn primary", "Putztag anlegen", {
          type: "button",
          "data-act": "new-day",
        });
        start.addEventListener("click", () => {
          ui.newDay = { day: C.nextSaturday(today()) };
          render();
        });
        tools.append(start);
        box.append(tools);
        if (ui.newDay) box.append(newDayPanel());
      }
      if (!day) {
        box.append(
          h(
            doc,
            "div",
            "note",
            isParent ? "Noch kein Putztag. Leg den ersten an." : "Noch kein Putztag geplant.",
          ),
        );
        return box;
      }
      const i = days.indexOf(day);
      const nav = h(doc, "div", "meal-weeknav");
      const step = (label, aria, target, act) => {
        const b = h(doc, "button", "btn", label, { type: "button", "aria-label": aria, "data-act": act });
        if (target) b.addEventListener("click", () => ((ui.day = target), render()));
        else b.setAttribute("disabled", "");
        return b;
      };
      nav.append(
        step("‹", "Früherer Putztag", days[i - 1], "prev-day"),
        h(doc, "span", "meal-weeklabel", `${C.dayHeading(day)}${day === today() ? " · heute" : ""}`, {
          "aria-live": "polite",
        }),
        step("›", "Späterer Putztag", days[i + 1], "next-day"),
      );
      box.append(nav);

      const mine = C.choresOfDay(model.chores, day);
      const total = C.progress(mine);
      const bar = h(doc, "div", "chore-progress");
      const fill = h(doc, "div", "chore-bar", undefined, {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": String(total.total),
        "aria-valuenow": String(total.done),
        "aria-label": "Fortschritt",
      });
      if (fill.style && fill.style.setProperty)
        fill.style.setProperty("--p", `${total.total ? Math.round((100 * total.done) / total.total) : 0}%`);
      bar.append(fill, h(doc, "span", "chore-count", C.progressText(total)));
      box.append(bar);

      for (const g of C.groupsOfDay(model.chores, model.members, day)) {
        const sec = h(doc, "section", "chore-group", undefined, { "data-group": g.key });
        const head = h(doc, "div", "chore-grouphead");
        head.append(
          g.member ? C.avatar(doc, g.member, "by") : h(doc, "span", "by", "❔"),
          h(doc, "b", "", g.member ? g.member.name : "Noch niemandem zugeteilt"),
          h(doc, "span", "chore-groupcount", g.total ? `${g.done}/${g.total}` : "–"),
        );
        sec.append(head);
        for (const c of g.chores) sec.append(choreRow(c));
        box.append(sec);
      }

      if (isParent) {
        if (ui.edit && ui.edit.type === "chore" && !ui.edit.id) box.append(choreEditor());
        else {
          const add = h(doc, "button", "btn", "+ Aufgabe hinzufügen", {
            type: "button",
            "data-act": "add-chore",
          });
          add.addEventListener("click", () => {
            ui.edit = { type: "chore", id: null, title: "", assignee: "" };
            ui.focus = "title";
            render();
          });
          const del = h(doc, "button", "link", "Putztag löschen", {
            type: "button",
            "data-act": "delete-day",
          });
          del.addEventListener("click", () => deleteDay(day).catch(log("delete day")));
          const tools = h(doc, "div", "meal-tools");
          tools.append(add, del);
          box.append(tools);
        }
      }
      return box;
    }

    // ---- the standard chores (parents) -----------------------------------------------------------------------------
    function importPanel() {
      const panel = h(doc, "section", "panel meal-copy", undefined, {
        "aria-label": "Standardliste übernehmen",
      });
      panel.append(
        h(doc, "h3", "", "Standardliste übernehmen"),
        h(
          doc,
          "p",
          "",
          "Die Liste hat einen Teil für die Kinder und je einen für Papa und Mama. Wer übernimmt welche Liste? Danach kannst du alles ändern.",
        ),
      );
      const parents = model.members.filter((m) => m.role !== "kid");
      for (const [key, label] of [
        ["papa", "Papas Liste macht"],
        ["mama", "Mamas Liste macht"],
      ]) {
        const sel = h(doc, "select", "", undefined, { "aria-label": label, "data-field": key });
        sel.append(Object.assign(h(doc, "option", "", "Noch niemand"), { value: "" }));
        for (const m of parents)
          sel.append(
            Object.assign(h(doc, "option", "", `${m.emoji || ""} ${m.name}`.trim()), { value: m.id }),
          );
        sel.value = ui.importing[key] || "";
        sel.addEventListener("change", () => (ui.importing[key] = sel.value));
        panel.append(labelled(label, sel));
      }
      const go = h(doc, "button", "btn primary", "Übernehmen", { type: "button", "data-act": "import" });
      go.addEventListener("click", () => importStarter(ui.importing).catch(log("import")));
      const cancel = h(doc, "button", "link", "Abbrechen", { type: "button", "data-act": "cancel-import" });
      cancel.addEventListener("click", () => ((ui.importing = null), render()));
      const row = h(doc, "div", "meal-actions");
      row.append(go, cancel);
      panel.append(row);
      return panel;
    }

    function templatesView() {
      const box = h(doc, "div", "chore-templates");
      const parents = model.members.filter((m) => m.role !== "kid");
      if (ui.importing) box.append(importPanel());
      else if (!model.templates.length) {
        const first = h(doc, "button", "btn primary", "Standardliste übernehmen", {
          type: "button",
          "data-act": "start-import",
        });
        first.addEventListener("click", () => {
          ui.importing = { papa: (parents[0] || {}).id || "", mama: (parents[1] || {}).id || "" };
          render();
        });
        box.append(
          h(
            doc,
            "div",
            "note",
            "Noch keine Standard-Aufgaben. Übernimm die Liste mit den üblichen Aufgaben für den Putztag.",
          ),
          first,
        );
      }
      if (ui.edit && ui.edit.type === "template" && !ui.edit.id) box.append(templateEditor());
      else {
        const add = h(doc, "button", "btn", "Neue Standard-Aufgabe", {
          type: "button",
          "data-act": "new-template",
        });
        add.addEventListener("click", () => {
          ui.edit = { type: "template", id: null, title: "", who: "kids", every: "0" };
          ui.focus = "title";
          render();
        });
        box.append(add);
      }
      for (const t of [...model.templates].sort((a, b) => (a.sort || 0) - (b.sort || 0))) {
        const row = h(doc, "div", `chore${t._pending ? " pending" : ""}`, undefined, {
          "data-template": t.id,
        });
        if (ui.edit && ui.edit.type === "template" && ui.edit.id === t.id) {
          row.append(templateEditor());
          box.append(row);
          continue;
        }
        const info = h(doc, "div", "meal-dishinfo");
        info.append(
          h(doc, "b", "", t.title),
          h(doc, "small", "", `${C.forLabel(t, model.members)} · ${C.intervalLabel(t.every_days)}`),
        );
        const edit = h(doc, "button", "meal-edit", "✏️", {
          type: "button",
          "aria-label": `${t.title} ändern`,
        });
        edit.addEventListener("click", () => {
          ui.edit = {
            type: "template",
            id: t.id,
            title: t.title,
            who: t.kids ? "kids" : t.assignee || "",
            every: String(t.every_days || 0),
          };
          ui.focus = "title";
          render();
        });
        row.append(info, edit);
        box.append(row);
      }
      return box;
    }

    // ---- frame -------------------------------------------------------------------------------------------------
    function render() {
      host.textContent = "";
      const me = memberById(actorId());
      host.style && host.style.setProperty && host.style.setProperty("--c", accent(me));

      const top = h(doc, "div", "top");
      const back = h(doc, "a", "av", me ? me.emoji : "🧹", { href: "#/wer", "aria-label": "Zurück" });
      const hello = h(doc, "div", "hello");
      hello.append(
        h(doc, "b", "", "Putztag"),
        h(
          doc,
          "span",
          "",
          me && !isParent ? `Hallo ${me.name}! Hake ab, was du geschafft hast.` : "Wer putzt was?",
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

      if (isParent) {
        const tabs = h(doc, "div", "ltabs", undefined, { role: "group", "aria-label": "Ansicht" });
        for (const [mode, label] of [
          ["day", "Putztag"],
          ["templates", "Standard-Aufgaben"],
        ]) {
          const b = h(doc, "button", "", label, {
            type: "button",
            "data-mode": mode,
            "aria-pressed": String(ui.mode === mode),
          });
          b.addEventListener("click", () => {
            ui.mode = mode;
            ui.edit = null;
            ui.newDay = null;
            ui.importing = null;
            render();
          });
          tabs.append(b);
        }
        host.append(tabs);
      }

      host.append(
        h(
          doc,
          "div",
          `hint meal-result${ui.result && ui.result.warn ? " warn" : ""}`,
          ui.result ? ui.result.text : "",
          {
            role: "status",
            "aria-live": "polite",
          },
        ),
      );
      host.append(isParent && ui.mode === "templates" ? templatesView() : dayView());

      if (ui.focus) {
        const input = host.querySelector(`[data-field="${ui.focus}"]`);
        if (input && input.focus) {
          input.focus();
          const end = String(input.value || "").length;
          if (input.setSelectionRange && input.type !== "date" && input.tagName !== "SELECT")
            input.setSelectionRange(end, end);
        }
      }
    }

    const offs = [
      data.subscribe("chore_templates", (rows) => ((model.templates = rows), render())),
      data.subscribe("chores", (rows) => ((model.chores = rows), render())),
      data.subscribe("members", (rows) => ((model.members = rows), render())),
    ];
    render();
    return () => offs.forEach((off) => off());
  }

  return { screen };
});
