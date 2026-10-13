// Governing: ADR-0003 (kid access via device accounts), SPEC-0002 REQ "Routine Items", REQ "Routine Management",
// REQ "Alternating Assignment"; SPEC-0001 REQ "Prototype as UI Reference"
//
// Parent routine editor (prototype renderParents, panel "Routine-Aufgaben"), route `#/routinen`. The settings
// screen links here. Lists every routine and lets a parent add, edit and delete items. Boards read the
// records on their next render, ticks already recorded are kept (they are separate records). The server's rules
// are the authority: a kid session cannot write routines.

(function () {
  "use strict";
  const R = HH.routines;
  const WD = HH.dates.WD;

  function addStyle(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.append(s);
  }
  const CSS = `
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { border: 0; border-radius: 12px; min-width: 44px; min-height: 44px; padding: 6px 12px; font-size: 16px; font-weight: 650;
  background: var(--mantle); color: var(--text); }
.chip[aria-pressed="true"] { background: var(--mauve); color: var(--on-accent); }
.rt-error { display: block; color: var(--red); min-height: 1em; }
.rt-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; }

.rt-card input, .rt-card select { width: 100%; font: inherit; border: 0; border-radius: 10px; padding: 10px; background: var(--mantle); color: var(--text); }
.rt-top { display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: start; }
.rt-emoji { text-align: center; font-size: 26px; }
.rt-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.rt-field { display: block; }
`;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function field(label, input, errorId) {
    const wrap = el("label", "rt-field");
    wrap.append(el("span", "muted", label), input);
    const err = el("small", "rt-error");
    err.setAttribute("role", "alert");
    err.dataset.error = errorId;
    wrap.append(err);
    return wrap;
  }

  /** One routine as an editable card. `onSave(record)` / `onDelete()` talk to the data API. */
  function buildCard(routine, members, { onSave, onDelete }) {
    const card = el("form", "panel rt-card");
    card.dataset.id = routine.id;
    card.setAttribute("aria-label", `Aufgabe ${routine.title || ""}`.trim());
    card.noValidate = true;

    const emoji = el("input", "rt-emoji");
    emoji.type = "text";
    emoji.value = routine.emoji || "";
    emoji.maxLength = 16;
    emoji.name = "emoji";
    const title = el("input");
    title.type = "text";
    title.value = routine.title || "";
    title.maxLength = 80;
    title.name = "title";
    const hint = el("input");
    hint.type = "text";
    hint.value = routine.hint || "";
    hint.maxLength = 120;
    hint.name = "hint";
    hint.placeholder = "Hinweis (optional)";
    const time = el("input");
    time.type = "time";
    time.value = routine.time || "";
    time.name = "time";

    const kind = el("select");
    kind.name = "kind";
    for (const [value, label] of [
      ["chore", "Aufgabe"],
      ["hobby", "Hobby"],
    ]) {
      const o = el("option", "", label);
      o.value = value;
      kind.append(o);
    }
    kind.value = routine.kind || "chore";

    const assignment = el("select");
    assignment.name = "assignment";
    for (const opt of R.assignmentOptions(members)) {
      const o = el("option", "", opt.label);
      o.value = opt.value;
      assignment.append(o);
    }
    assignment.value = R.assignmentValue(routine);

    const days = el("div", "chips");
    days.setAttribute("role", "group");
    days.setAttribute("aria-label", "Wochentage");
    const selected = new Set(R.daysOf(routine));
    WD.forEach((label, i) => {
      const b = el("button", "chip", label);
      b.type = "button";
      b.dataset.day = String(i);
      b.setAttribute("aria-pressed", String(selected.has(i)));
      b.addEventListener("click", () => {
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        b.setAttribute("aria-pressed", String(selected.has(i)));
        markDirty();
      });
      days.append(b);
    });

    const top = el("div", "rt-top");
    top.append(emoji, field("Titel", title, "title"));
    const row = el("div", "rt-row");
    row.append(
      field("Uhrzeit (optional)", time, "time"),
      field("Art", kind, "kind"),
      field("Wer?", assignment, "assignment"),
    );
    const save = el("button", "btn primary", "Speichern");
    save.type = "submit";
    const del = el("button", "btn", "🗑 Löschen");
    del.type = "button";
    del.setAttribute("aria-label", `${routine.title || "Aufgabe"} löschen`);
    const status = el("small", "muted");
    status.setAttribute("role", "status");
    const actions = el("div", "rt-actions");
    actions.append(save, del, status);

    card.append(top, field("Hinweis", hint, "hint"), row, days, actions);
    const dayError = el("small", "rt-error");
    dayError.setAttribute("role", "alert");
    dayError.dataset.error = "days";
    card.append(dayError);

    card.dirty = false;
    function markDirty() {
      card.dirty = true;
      status.textContent = "";
    }
    for (const input of [emoji, title, hint, time, kind, assignment]) {
      input.addEventListener("input", markDirty);
    }

    function showErrors(errors) {
      for (const e of card.querySelectorAll("[data-error]")) e.textContent = errors[e.dataset.error] || "";
    }

    card.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const result = R.validateRoutine(
        {
          emoji: emoji.value,
          title: title.value,
          hint: hint.value,
          time: time.value,
          kind: kind.value,
          days: Array.from(selected),
          assignment: assignment.value,
        },
        members,
      );
      showErrors(result.errors);
      if (!result.ok) return;
      await onSave(result.record);
      card.dirty = false;
      status.textContent = "Gespeichert";
    });

    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        del.textContent = "Wirklich löschen?";
        return;
      }
      await onDelete();
    });
    return card;
  }

  HH.screens.routinen = function (view, ctx) {
    addStyle("rt-style", CSS);
    const back = el("a", "link", "‹ Zurück");
    back.href = "#/einstellungen";
    view.append(back, el("h1", "", "Routine-Aufgaben"));

    const rec = ctx.auth && ctx.auth.record && ctx.auth.record();
    if (!ctx.data) {
      view.append(el("p", "muted", "Nicht angemeldet."));
      return;
    }
    if (rec && rec.collectionName && rec.collectionName !== "parents") {
      view.append(el("p", "muted", "Nur Eltern können Routine-Aufgaben ändern."));
      return;
    }

    view.append(
      el(
        "p",
        "muted",
        "Änderungen gelten ab dem nächsten Aufbau der Tafeln. Bereits abgehakte Aufgaben bleiben erhalten.",
      ),
    );
    const list = el("div", "rt-list");
    list.setAttribute("aria-live", "polite");
    const add = el("button", "btn", "+ Aufgabe");
    add.type = "button";
    view.append(list, add);

    let members = [];
    let routines = [];
    const cards = new Map(); // id -> { node, updated }

    function render() {
      const ids = new Set(routines.map((r) => r.id));
      for (const [id, c] of cards) {
        if (!ids.has(id)) {
          c.node.remove();
          cards.delete(id);
        }
      }
      if (routines.length === 0 && !list.querySelector(".rt-empty")) {
        list.prepend(el("p", "muted rt-empty", "Noch keine Routine-Aufgaben."));
      } else if (routines.length > 0) {
        const empty = list.querySelector(".rt-empty");
        if (empty) empty.remove();
      }
      for (const r of routines) {
        const known = cards.get(r.id);
        if (known && (known.node.dirty || known.updated === r.updated) && known.members === members.length) {
          continue; // keep a card the parent is typing in
        }
        const node = buildCard(r, members, {
          onSave: (record) => ctx.data.update("routines", r.id, record),
          onDelete: () => ctx.data.delete("routines", r.id),
        });
        if (known) known.node.replaceWith(node);
        else list.append(node);
        cards.set(r.id, { node, updated: r.updated, members: members.length });
      }
    }

    add.addEventListener("click", () => {
      const kids = R.kidsOf(members);
      void ctx.data.create("routines", {
        emoji: "⭐",
        title: "Neue Aufgabe",
        hint: "",
        time: "",
        kind: "chore",
        days: ["0", "1", "2", "3", "4"],
        who: kids.length ? "kids" : "parents",
        member: "",
      });
    });

    const offs = [
      ctx.data.subscribe("members", (rows) => {
        members = rows;
        render();
      }),
      ctx.data.subscribe("routines", (rows) => {
        routines = rows;
        render();
      }),
    ];
    return () => offs.forEach((off) => off());
  };
})();
