// Governing: ADR-0003 (kid access via device accounts), SPEC-0002 REQ "Mascot Choice"; SPEC-0001 REQ
// "Household Settings", REQ "Prototype as UI Reference"
//
// Mascot picker (prototype renderParents, panel "Maskottchen"), route `#/maskottchen`. A parent (ideally with the
// kids) picks the animal and its name; it is stored in `settings.mascot` as { emoji, name } and every board reads
// it from there. The settings screen links here.

(function () {
  "use strict";
  const R = HH.routines;

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

.pets { display: flex; flex-wrap: wrap; gap: 8px; }
.pets .chip { font-size: 30px; min-width: 56px; min-height: 56px; }
.mc-name { display: grid; gap: 8px; margin-top: 12px; }
.mc-preview { font-size: 28px; font-weight: 800; }
.mc-name input { font: inherit; border: 0; border-radius: 10px; padding: 10px; background: var(--mantle); color: var(--text); }
`;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  HH.screens.maskottchen = function (view, ctx) {
    addStyle("mc-style", CSS);
    const back = el("a", "link", "‹ Zurück");
    back.href = "#/einstellungen";
    view.append(back, el("h1", "", "Maskottchen"));

    const rec = ctx.auth && ctx.auth.record && ctx.auth.record();
    if (!ctx.data) {
      view.append(el("p", "muted", "Nicht angemeldet."));
      return;
    }
    if (rec && rec.collectionName && rec.collectionName !== "parents") {
      view.append(el("p", "muted", "Nur Eltern können das Maskottchen ändern."));
      return;
    }

    view.append(el("p", "muted", "Lasst die Kinder Tier und Namen aussuchen."));
    const panel = el("section", "panel");
    const pets = el("div", "pets");
    pets.setAttribute("role", "group");
    pets.setAttribute("aria-label", "Tier");
    const preview = el("div", "mc-preview");
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 24;
    nameInput.name = "mascot-name";
    nameInput.setAttribute("aria-label", "Name des Maskottchens");
    const error = el("small", "rt-error");
    error.setAttribute("role", "alert");
    const save = el("button", "btn primary", "Speichern");
    save.type = "button";
    const status = el("small", "muted");
    status.setAttribute("role", "status");

    let current = { ...R.DEFAULT_MASCOT };
    let chosen = current.emoji;
    let settingsRecord = null;
    let dirty = false;

    function paint() {
      for (const b of pets.children) b.setAttribute("aria-pressed", String(b.dataset.pet === chosen));
      preview.textContent = `${chosen} ${nameInput.value.trim()}`.trim();
    }

    for (const m of R.MASCOTS) {
      const b = el("button", "chip", m.emoji);
      b.type = "button";
      b.dataset.pet = m.emoji;
      b.title = m.name;
      b.setAttribute("aria-label", m.name);
      b.addEventListener("click", () => {
        // Picking a new animal suggests its name unless the parent already typed their own.
        const suggested = R.MASCOTS.find((x) => x.emoji === chosen);
        if (!dirty || !nameInput.value.trim() || (suggested && nameInput.value === suggested.name)) {
          nameInput.value = m.name;
        }
        chosen = m.emoji;
        dirty = true;
        status.textContent = "";
        paint();
      });
      pets.append(b);
    }
    nameInput.addEventListener("input", () => {
      dirty = true;
      status.textContent = "";
      paint();
    });

    save.addEventListener("click", async () => {
      const result = R.validateMascot({ emoji: chosen, name: nameInput.value });
      error.textContent = result.error;
      if (!result.ok) return;
      if (settingsRecord) await ctx.data.update("settings", settingsRecord.id, { mascot: result.mascot });
      else {
        await ctx.data.create("settings", { tz: "", mascot: result.mascot, auto_refill: true });
      }
      dirty = false;
      status.textContent = "Gespeichert";
    });

    const nameRow = el("div", "mc-name");
    nameRow.append(preview, nameInput);
    panel.append(pets, nameRow, error, el("div", "rt-actions"));
    panel.lastChild.append(save, status);
    view.append(panel);

    return ctx.data.subscribe("settings", (rows) => {
      settingsRecord = rows[0] || null;
      if (dirty) return; // do not overwrite what the parent is choosing
      current = R.mascotOf(settingsRecord);
      chosen = current.emoji;
      nameInput.value = current.name;
      paint();
    });
  };
})();
