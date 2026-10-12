// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Automatic Refill" (marked items with
// their reason; refill requested when a list is opened), REQ "Suggestions While Typing", REQ "Learned Overview"
// (rows, reset by a second tap), SPEC-0001 REQ "Prototype as UI Reference" (the "Gelernt" panel)
//
// DOM building for the shopping learning, kept out of the screens so it can be rendered in tests with the fake
// document: the reason line of an automatic item, suggestion chips, the call that asks the server to refill a list,
// and the learned overview (route #/gelernt). The numbers come from rhythm.js, the same module the server uses.

(function (root, factory) {
  const rhythm = typeof module === "object" && module.exports ? require("./rhythm.js") : root.HH.rhythm;
  const api = factory(rhythm);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HH.shopLearning = api;
})(typeof self !== "undefined" ? self : this, function (rhythm) {
  "use strict";

  function h(doc, tag, className, text) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** "✨ automatisch · etwa alle 5 Tage · zuletzt vor 4 Tagen" for an automatic item, else null. */
  function reasonText(item, today) {
    if (!item || !item.auto) return null;
    const detail =
      item.auto_rhythm > 0 && item.auto_last
        ? ` · ${rhythm.reasonText(item.auto_rhythm, item.auto_last, today)}`
        : "";
    return `✨ automatisch${detail}`;
  }

  function reasonEl(doc, item, today) {
    const text = reasonText(item, today);
    return text ? h(doc, "small", "why", text) : null;
  }

  /**
   * Chips for the quick-add row: what to suggest for the typed text on a list. `entries` are the learned entries
   * of the list, `taken` the keys that are open or in the cart. With automatic refill off, due items come first
   * (marked), as the spec asks. Returns `[{ name, due, count }]`.
   */
  function chipsFor({ entries, typed, taken, today, autoRefill, limit = 6 }) {
    const out = [];
    const seen = new Set();
    const q = String(typed || "").trim();
    if (!autoRefill) {
      const due = entries.filter((e) => !taken.has(e.key) && rhythm.isDue(e, today));
      for (const e of rhythm.suggest(due, q, taken, limit)) {
        out.push({ name: e.name, due: true, count: e.count });
        seen.add(e.key);
      }
    }
    for (const e of rhythm.suggest(entries, q, taken, limit + out.length)) {
      if (seen.has(e.key)) continue;
      out.push({ name: e.name, due: false, count: e.count });
    }
    return out.slice(0, limit);
  }

  /** Fills `box` with one-tap chips; `onPick(name)` adds the item. */
  function renderChips(doc, box, chips, onPick) {
    box.textContent = "";
    for (const chip of chips) {
      const b = h(doc, "button", `chip${chip.due ? " due" : ""}`, chip.due ? `⏰ ${chip.name}` : chip.name);
      b.setAttribute("type", "button");
      b.setAttribute("aria-label", `${chip.name} hinzufügen${chip.due ? " (fällig)" : ""}`);
      b.addEventListener("click", () => onPick(chip.name));
      box.append(b);
    }
  }

  /** Asks the server to refill the list now (fire and forget; offline or refused is fine, the hourly job runs). */
  async function requestRefill({ fetchImpl, token, listId }) {
    if (!fetchImpl || !token || !listId) return null;
    try {
      const res = await fetchImpl("/api/hh/refill", {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify({ list: listId }),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** "🛒 Milch — alle ~5 Tage — 6× gekauft" */
  const learnedRow = (list, entry) =>
    `${list.emoji} ${entry.name} — ${rhythm.rhythmLabel(entry.rhythm)} — ${entry.count}× gekauft`;

  /**
   * The learned overview: the automatic-refill switch, one row per learned item (grouped by the order of the
   * lists, most purchases first) and "Einkaufsverlauf zurücksetzen", which needs a second tap to confirm.
   * `onToggleAuto(bool)` and `onReset()` do the work; `armMs` is how long the confirmation stays armed.
   */
  function buildLearnedView(doc, { lists, entries, autoRefill, onToggleAuto, onReset, armMs = 5000 }) {
    const root = h(doc, "section", "panel learned");
    root.append(h(doc, "h2", "", "Gelernt"));
    root.append(
      h(
        doc,
        "p",
        "muted",
        "Die Liste merkt sich, was ihr kauft, und setzt Dinge automatisch wieder drauf, wenn sie fällig sind.",
      ),
    );

    const label = h(doc, "label", "switch");
    const box = h(doc, "input");
    box.setAttribute("type", "checkbox");
    box.checked = !!autoRefill;
    box.addEventListener("change", () => onToggleAuto(!!box.checked));
    label.append(box, h(doc, "span", "", " Automatisch nachfüllen"));
    root.append(label);

    const rows = h(doc, "div", "rows");
    rows.setAttribute("role", "list");
    let any = false;
    for (const list of lists) {
      const mine = entries
        .filter((e) => e.list === list.id)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
      for (const entry of mine) {
        any = true;
        const row = h(doc, "div", "row", learnedRow(list, entry));
        row.setAttribute("role", "listitem");
        rows.append(row);
      }
    }
    if (!any)
      rows.append(h(doc, "div", "note", "Noch nichts gelernt. Sobald ihr einkauft, erscheint es hier."));
    root.append(rows);

    const reset = h(doc, "button", "btn", "Einkaufsverlauf zurücksetzen");
    reset.setAttribute("type", "button");
    let armed = null;
    reset.addEventListener("click", () => {
      if (armed === null) {
        reset.textContent = "Wirklich alles vergessen? Nochmal tippen";
        reset.className = "btn danger";
        armed = setTimeout(() => {
          armed = null;
          reset.textContent = "Einkaufsverlauf zurücksetzen";
          reset.className = "btn";
        }, armMs);
        if (armed && armed.unref) armed.unref();
        return;
      }
      clearTimeout(armed);
      armed = null;
      reset.textContent = "Einkaufsverlauf zurücksetzen";
      reset.className = "btn";
      return onReset();
    });
    root.append(reset);
    return root;
  }

  return { reasonText, reasonEl, chipsFor, renderChips, requestRefill, learnedRow, buildLearnedView };
});
