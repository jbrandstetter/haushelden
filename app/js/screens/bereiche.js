// Governing: ADR-0001 (writes go through the data layer), SPEC-0003 REQ "Areas of Responsibility" (parents add,
// rename and delete areas and set owners; deleting keeps the to-dos), SPEC-0001 REQ "Prototype as UI Reference"
// (prototype settings panel "Bereiche & Zuständigkeiten")
//
// `#/bereiche`: the management panel for areas. The settings screen (#12) links here. `buildView` turns a plain
// model into DOM (rendered with a fake document in tests); `screen` wires it to the data layer. The server's
// rules are the authority: only parents write areas and the owner must be a parent.

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../areas.js") : root.HH.areas,
    typeof module === "object" && module.exports ? require("../todos.js") : root.HH.todos,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.HH.bereiche = api;
    root.HH.screens.bereiche = api.screen;
  }
})(typeof self !== "undefined" ? self : this, function (A, T) {
  "use strict";

  function h(doc, tag, className, text, attrs) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  /**
   * @param {Document} doc
   * @param {{ areas: object[], members: object[], todos: object[] }} m
   * @param {{ add: Function, save: Function, setOwner: Function, remove: Function }} a
   *   `save(area, { emoji, name })`, `setOwner(area, memberId | "")`, `remove(area)`
   */
  function buildView(doc, m, a) {
    const panel = h(doc, "div", "panel bereiche", undefined, { "data-role": "areas-editor" });
    panel.append(h(doc, "h3", "", "Bereiche & Zuständigkeiten"));
    const list = h(doc, "div", "ed");
    const owners = A.ownerChoices(m.members);
    for (const area of A.sortAreas(m.areas)) {
      const row = h(doc, "div", "edrow", undefined, { "data-area-row": area.id });
      const emoji = h(doc, "input", "emo", undefined, {
        type: "text",
        "data-field": "emoji",
        maxlength: String(A.EMOJI_MAX),
        "aria-label": "Symbol",
      });
      emoji.value = area.emoji || "";
      const name = h(doc, "input", "", undefined, {
        type: "text",
        "data-field": "name",
        maxlength: String(A.NAME_MAX),
        "aria-label": "Name",
      });
      name.value = area.name;
      const save = () => a.save(area, { emoji: emoji.value, name: name.value });
      emoji.addEventListener("change", save);
      name.addEventListener("change", save);

      const chips = h(doc, "div", "chips");
      for (const p of owners) {
        const b = h(doc, "button", "", `${p.emoji || ""} ${p.name}`.trim(), {
          type: "button",
          "aria-pressed": String(area.owner === p.id),
          "data-owner": p.id,
        });
        b.addEventListener("click", () => a.setOwner(area, p.id));
        chips.append(b);
      }
      const open = h(doc, "button", "", "Offen", {
        type: "button",
        "aria-pressed": String(!area.owner),
        "data-owner": "",
      });
      open.addEventListener("click", () => a.setOwner(area, ""));
      const del = h(doc, "button", "danger", "🗑", {
        type: "button",
        "data-role": "delete-area",
        "aria-label": `${area.name} löschen`,
      });
      del.addEventListener("click", () => a.remove(area));
      chips.append(open, del);

      const body = h(doc, "div");
      body.append(name, chips);
      const n = T.openInArea(m.todos, area.id);
      if (n)
        body.append(h(doc, "small", "muted", `${n} offen – bleiben beim Löschen erhalten, ohne Bereich`));
      row.append(emoji, body);
      list.append(row);
    }
    panel.append(list);
    const add = h(doc, "button", "btn", "+ Bereich", { type: "button", "data-role": "add-area" });
    add.addEventListener("click", () => a.add());
    panel.append(h(doc, "div", "", undefined, { style: "margin-top:10px" }), add);
    return panel;
  }

  function screen(view, ctx) {
    const doc = view.ownerDocument;
    view.append(h(doc, "h1", "", "Bereiche"));
    const record = ctx.auth && ctx.auth.record();
    if (!ctx.data || !record || !record.member) {
      view.append(h(doc, "p", "muted", "Nicht angemeldet. Die Anmeldung kommt in einer späteren Version."));
      return;
    }
    const data = ctx.data;
    const model = { areas: [], members: [], todos: [] };
    const host = h(doc, "div");
    const error = h(doc, "p", "rt-error", "", { role: "alert", "data-role": "error" });
    view.append(host, error);

    const run = async (work) => {
      error.textContent = "";
      try {
        await work();
      } catch {
        error.textContent = "Das hat nicht geklappt. Bitte noch einmal versuchen.";
      }
      render();
    };
    function render() {
      host.textContent = "";
      host.append(buildView(doc, model, actions));
    }
    const actions = {
      add: () => run(() => data.create("areas", { ...A.NEW_AREA })),
      save(area, raw) {
        const patch = A.areaPatch(raw);
        if (patch && (patch.name !== area.name || patch.emoji !== (area.emoji || "")))
          return run(() => data.update("areas", area.id, patch));
        render(); // empty or unchanged: show the stored values again
      },
      setOwner: (area, owner) => run(() => data.update("areas", area.id, { owner })),
      remove: (area) => run(() => data.delete("areas", area.id)),
    };

    const offs = ["members", "areas", "todos"].map((c) =>
      data.subscribe(c, (rows) => {
        model[c] = rows;
        render();
      }),
    );
    return () => offs.forEach((off) => off());
  }

  return { buildView, screen };
});
