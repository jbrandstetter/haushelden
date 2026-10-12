// Governing: ADR-0001 (reads and writes go through the data layer; offline creates use its outbox),
// SPEC-0003 REQ "To-dos", REQ "Quick Add", REQ "List Grouping", REQ "Editing", SPEC-0001 REQ "Prototype as UI
// Reference" (prototype renderAdult, list mode), REQ "Household Day and Time Zone"
//
// The parents' view (`#/eltern`), list mode. `buildView` turns a plain model into DOM and is the part tests
// render with a fake document; the screen function at the bottom wires it to the data layer.
//
// Extension points for the follow-up stories (add to the marked places, do not restructure):
//  - areas (SPEC-0003 "Areas of Responsibility"): fill `model.areas` and `model.state.areaFilter`; `buildView`
//    already shows the filter bar and the editor's area row when `areas` is non-empty, and quick add already
//    puts new to-dos into `state.areaFilter`. Add the areas panel under the marked comment in `buildView`.
//  - calendar mode (SPEC-0004): `state.mode` is "list"; add a mode switch at the marked comment, render the
//    calendar instead of `listSections`, and keep `quickAdd` shared.

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../todos.js") : root.HH.todos,
    typeof module === "object" && module.exports ? require("../dates.js") : root.HH.dates,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.HH.eltern = api;
    root.HH.screens.eltern = api.screen;
  }
})(typeof self !== "undefined" ? self : this, function (T, dates) {
  "use strict";

  function h(doc, tag, className, text, attrs) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function chip(doc, label, pressed, onClick, attrs) {
    const b = h(doc, "button", "", label, { type: "button", "aria-pressed": String(pressed), ...attrs });
    b.addEventListener("click", onClick);
    return b;
  }

  /** Quick add: one text field, due chips (none/today/tomorrow), assignee chips (me/other/both). */
  function quickAdd(doc, m, a) {
    const { state, today, members, me } = m;
    const other = T.parentMembers(members).find((p) => p.id !== me);
    const area = state.areaFilter && m.areas.find((x) => x.id === state.areaFilter);
    const frag = doc.createDocumentFragment();

    const form = h(doc, "form", "qa", undefined, { "data-role": "quick-add" });
    const input = h(doc, "input", "", undefined, {
      type: "text",
      "data-key": "quick-title",
      maxlength: String(T.TITLE_MAX),
      placeholder: `Neue Aufgabe${area ? ` für ${area.name}` : ""}…`,
      autocomplete: "off",
      "aria-label": "Neue Aufgabe",
    });
    input.value = state.draft || "";
    input.addEventListener("input", () => a.draft(input.value));
    const add = h(doc, "button", "", "+", { type: "submit", "aria-label": "Hinzufügen" });
    form.append(input, add);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      a.add(input.value);
    });

    const dueRow = h(doc, "div", "chips", undefined, { "data-role": "quick-due" });
    for (const [value, label] of T.dueOptions(today).slice(0, 3)) {
      dueRow.append(
        chip(doc, label, (state.addDue || "") === value, () => a.setAddDue(value), { "data-due": value }),
      );
    }
    const whoRow = h(doc, "div", "chips", undefined, { "data-role": "quick-who" });
    whoRow.append(
      chip(doc, "Für mich", state.addWho === "me", () => a.setAddWho("me"), { "data-who": "me" }),
    );
    if (other) {
      whoRow.append(
        chip(doc, `Für ${other.name}`, state.addWho === "other", () => a.setAddWho("other"), {
          "data-who": "other",
        }),
      );
    }
    whoRow.append(
      chip(doc, "Für uns beide", state.addWho === "parents", () => a.setAddWho("parents"), {
        "data-who": "parents",
      }),
    );
    frag.append(form, dueRow, whoRow);
    return frag;
  }

  /** The inline editor of one to-do (SPEC-0003 "Editing"). */
  function editor(doc, todo, m, a) {
    const { today, members } = m;
    const box = h(doc, "div", "editbox", undefined, { "data-role": "editor", "data-box": todo.id });
    const title = h(doc, "input", "", undefined, {
      type: "text",
      "data-key": `edit-title-${todo.id}`,
      maxlength: String(T.TITLE_MAX),
      "aria-label": "Titel",
    });
    title.value = todo.title;
    title.addEventListener("change", () => a.setTitle(todo, title.value));

    const dueRow = h(doc, "div", "chips", undefined, { "data-role": "edit-due" });
    for (const [value, label] of T.dueOptions(today)) {
      dueRow.append(
        chip(doc, label, (todo.due || "") === value, () => a.patch(todo, { due: value }), {
          "data-due": value,
        }),
      );
    }
    const date = h(doc, "input", "", undefined, {
      type: "date",
      "data-role": "edit-date",
      "aria-label": "Datum",
    });
    date.value = todo.due || "";
    date.addEventListener("change", () => a.patch(todo, { due: date.value }));
    dueRow.append(date);

    const whoRow = h(doc, "div", "chips", undefined, { "data-role": "edit-who" });
    for (const p of T.parentMembers(members)) {
      whoRow.append(
        chip(doc, p.name, todo.who === p.id, () => a.patch(todo, { who: p.id }), { "data-who": p.id }),
      );
    }
    whoRow.append(
      chip(doc, "Beide", todo.who === T.BOTH, () => a.patch(todo, { who: T.BOTH }), { "data-who": T.BOTH }),
    );

    box.append(title, dueRow, whoRow);
    if (m.areas.length) {
      const areaRow = h(doc, "div", "chips", undefined, { "data-role": "edit-area" });
      areaRow.append(
        chip(doc, "Kein Bereich", !todo.area, () => a.patch(todo, { area: "" }), { "data-area": "" }),
      );
      for (const r of m.areas) {
        areaRow.append(
          chip(
            doc,
            `${r.emoji || ""} ${r.name}`.trim(),
            todo.area === r.id,
            () => a.patch(todo, { area: r.id }),
            {
              "data-area": r.id,
            },
          ),
        );
      }
      box.append(areaRow);
    }
    const actions = h(doc, "div", "chips");
    const close = h(doc, "button", "primary", "Fertig", { type: "button", "data-role": "close" });
    close.addEventListener("click", () => a.edit(null));
    const del = h(doc, "button", "danger", "🗑 Löschen", { type: "button", "data-role": "delete" });
    del.addEventListener("click", () => a.remove(todo));
    actions.append(close, del);
    box.append(actions);
    return box;
  }

  function row(doc, todo, m, a) {
    const { today, me, members, state } = m;
    const wrap = h(doc, "div", "todowrap", undefined, { "data-todo": todo.id });
    const line = h(doc, "div", `todo${todo.done ? " done" : ""}${todo._pending ? " pending" : ""}`);
    const cb = h(doc, "button", "cb", undefined, {
      type: "button",
      "aria-label": todo.done ? "Wieder öffnen" : "Erledigt",
      "aria-pressed": String(!!todo.done),
      "data-role": "check",
    });
    cb.addEventListener("click", () => a.toggle(todo));
    const tx = h(doc, "div", "tx", undefined, { "data-role": "open-editor", role: "button", tabindex: "0" });
    tx.append(h(doc, "div", "tt", todo.title));
    const meta = h(doc, "div", "meta");
    const parts = [];
    const area = todo.area && m.areas.find((r) => r.id === todo.area);
    if (area) parts.push(h(doc, "span", "", `${area.emoji || ""} ${area.name}`.trim()));
    if (todo.due) {
      const l = T.dueLabel(todo.due, today);
      parts.push(h(doc, "span", l.late ? "late" : "", l.text));
    }
    if (todo.who !== me) parts.push(h(doc, "span", "", `für ${T.whoLabel(todo.who, members)}`));
    parts.forEach((p, i) => {
      if (i) meta.append(doc.createTextNode(" · "));
      meta.append(p);
    });
    if (parts.length) tx.append(meta);
    const toggleEditor = () => a.edit(state.editing === todo.id ? null : todo.id);
    tx.addEventListener("click", toggleEditor);
    tx.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleEditor();
      }
    });
    line.append(cb, tx);
    wrap.append(line);
    if (state.editing === todo.id) wrap.append(editor(doc, todo, m, a));
    return wrap;
  }

  /** The grouped list: Überfällig / Heute / Demnächst / Irgendwann, then "Heute erledigt". */
  function listSections(doc, m, a) {
    const frag = doc.createDocumentFragment();
    const mine = T.visibleTo(m.todos, m.me);
    const groups = T.groupTodos(mine, m.today, { area: m.state.areaFilter });
    const section = (key, title, todos) => {
      if (!todos.length) return;
      frag.append(h(doc, "div", "section", title, { "data-group": key }));
      const list = h(doc, "div", "todos", undefined, { "data-group-list": key });
      for (const t of todos) list.append(row(doc, t, m, a));
      frag.append(list);
    };
    for (const [key, title] of T.GROUPS) section(key, title, groups[key]);
    const anyOpen = T.GROUPS.some(([key]) => groups[key].length);
    if (!anyOpen) {
      frag.append(
        h(doc, "div", "note", `Nichts offen${m.state.areaFilter ? " in diesem Bereich" : ""}. 🎉`, {
          "data-role": "empty",
        }),
      );
    }
    section("doneToday", "Heute erledigt", groups.doneToday);
    return frag;
  }

  /**
   * @param {Document} doc
   * @param {{ today: string, me: string, members: object[], todos: object[], areas: object[], state: object }} m
   * @param {object} a actions: add, draft, setAddDue, setAddWho, toggle, edit, patch, setTitle, remove, clearArea
   */
  function buildView(doc, m, a) {
    const root = h(doc, "div", "eltern");
    const meMember = m.members.find((x) => x.id === m.me);
    const day = dates.dayNumber(m.today);
    const [, month, dayOfMonth] = m.today.split("-").map(Number);
    const top = h(doc, "div", "top");
    top.append(
      h(doc, "div", "av", meMember ? meMember.emoji || "🙂" : "🙂", { "aria-hidden": "true" }),
      (() => {
        const hello = h(doc, "div", "hello");
        hello.append(
          h(doc, "b", "", meMember ? meMember.name : "Eltern"),
          h(doc, "span", "", `${dates.WDL[dates.weekday(day)]}, ${dayOfMonth}.${month}.`),
        );
        return hello;
      })(),
    );
    root.append(top);
    // [extension point: kids' progress glance (SPEC-0003), mode switch list/calendar (SPEC-0004)]
    root.append(quickAdd(doc, m, a));

    const area = m.state.areaFilter && m.areas.find((x) => x.id === m.state.areaFilter);
    if (area) {
      const bar = h(doc, "div", "filterbar", `${area.emoji || ""} ${area.name}`.trim());
      const clear = h(doc, "button", "", "Alle zeigen", { type: "button", "data-role": "clear-area" });
      clear.addEventListener("click", () => a.clearArea());
      bar.append(clear);
      root.append(bar);
    }
    root.append(listSections(doc, m, a));
    // [extension point: areas panel "Bereiche" (SPEC-0003 "Areas of Responsibility")]
    return root;
  }

  // ---- screen --------------------------------------------------------------------------------------------
  function message(view, text) {
    view.append(h(view.ownerDocument, "p", "muted", text));
  }

  function screen(view, ctx) {
    const doc = view.ownerDocument;
    view.append(h(doc, "h1", "", "Aufgaben"));
    const record = ctx.auth && ctx.auth.record();
    if (!ctx.data || !record || !record.member) {
      message(view, "Nicht angemeldet. Die Anmeldung kommt in einer späteren Version.");
      return;
    }
    const data = ctx.data;
    const me = record.member;
    const state = { addDue: "", addWho: "me", draft: "", editing: null, areaFilter: null, mode: "list" };
    const model = { members: [], todos: [], areas: [] };
    const host = h(doc, "div");
    view.append(host);

    function render() {
      const active = doc.activeElement;
      const key = active && active.getAttribute && active.getAttribute("data-key");
      const caret = key && typeof active.selectionStart === "number" ? active.selectionStart : null;
      host.textContent = "";
      host.append(buildView(doc, { ...model, today: ctx.clock.today(), me, state }, actions));
      if (key) {
        const again = host.querySelector(`[data-key="${key}"]`);
        if (again) {
          again.focus();
          if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret);
        }
      }
    }

    const actions = {
      draft(value) {
        state.draft = value;
      },
      setAddDue(value) {
        state.addDue = value;
        render();
      },
      setAddWho(value) {
        state.addWho = value;
        render();
      },
      async add(title) {
        const other = T.parentMembers(model.members).find((p) => p.id !== me);
        const record = T.newTodo({
          title,
          due: state.addDue,
          assignee: state.addWho,
          me,
          other: other && other.id,
          area: state.areaFilter,
        });
        if (!record) return;
        state.draft = "";
        render();
        await data.create("todos", record);
        const input = host.querySelector('[data-key="quick-title"]');
        if (input) input.focus();
      },
      toggle: (todo) => data.update("todos", todo.id, T.toggleDone(todo, ctx.clock.today())),
      edit(id) {
        state.editing = id;
        render();
      },
      patch: (todo, patch) => data.update("todos", todo.id, patch),
      setTitle(todo, raw) {
        const patch = T.titlePatch(raw);
        if (patch && patch.title !== todo.title) return data.update("todos", todo.id, patch);
        render(); // empty or unchanged: show the stored title again
      },
      async remove(todo) {
        state.editing = null;
        await data.delete("todos", todo.id);
      },
      clearArea() {
        state.areaFilter = null;
        render();
      },
    };

    const offs = [
      data.subscribe("members", (rows) => {
        model.members = rows;
        render();
      }),
      data.subscribe("todos", (rows) => {
        model.todos = rows;
        render();
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  return { buildView, quickAdd, editor, listSections, screen };
});
