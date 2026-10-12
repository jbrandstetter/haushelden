// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Learned Overview" (parents see every
// learned item and can reset the history), REQ "Automatic Refill" (parents switch it off), SPEC-0001 REQ "Prototype
// as UI Reference" (the "Gelernt" settings panel)
//
// Route #/gelernt (parents only). The settings screen links here; until it exists the shopping screen does.
// The reset calls the parent-only endpoint POST /api/hh/purchases/reset (the server checks the role, hiding the
// button for devices is only courtesy). Purchases are read through the data API (parents may read them).

(function () {
  "use strict";
  const L = HH.shopLearning;

  HH.screens.gelernt = function (view, ctx) {
    const root = document.createElement("div");
    root.className = "shop gelernt";
    view.append(root);
    const title = document.createElement("h1");
    title.textContent = "Gelernt";
    const back = document.createElement("a");
    back.href = "#/einkauf";
    back.textContent = "‹ Einkaufsliste";
    root.append(back, title);
    const record = (ctx.auth && ctx.auth.record && ctx.auth.record()) || {};
    if (!ctx.data || record.collectionName !== "parents") {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = ctx.data ? "Das sehen nur die Eltern." : "Nicht angemeldet.";
      root.append(p);
      return;
    }
    const data = ctx.data;
    const state = { lists: [], purchases: [], settings: [] };
    const body = document.createElement("div");
    const status = document.createElement("div");
    status.className = "hint";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(status, body);

    function render() {
      body.textContent = "";
      const settings = state.settings[0];
      body.append(
        L.buildLearnedView(document, {
          lists: state.lists,
          entries: HH.rhythm.learn(state.purchases),
          autoRefill: settings ? !!settings.auto_refill : true,
          onToggleAuto: (on) => {
            const write = settings
              ? data.update("settings", settings.id, { auto_refill: on })
              : data.create("settings", { auto_refill: on });
            return write.catch((err) => console.warn("gelernt: switch failed", { message: String(err) }));
          },
          onReset: async () => {
            status.textContent = "";
            try {
              const res = await fetch("/api/hh/purchases/reset", {
                method: "POST",
                headers: { authorization: ctx.auth.token(), "content-type": "application/json" },
                body: "{}",
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              status.textContent = "Der Einkaufsverlauf ist gelöscht.";
              await data.refresh("purchases");
            } catch (err) {
              console.warn("gelernt: reset failed", { message: String(err) });
              status.textContent = "Das ging nicht. Bist du online?";
            }
          },
        }),
      );
    }

    const offs = [
      data.subscribe("lists", (rows) => ((state.lists = rows || []), render())),
      data.subscribe("purchases", (rows) => ((state.purchases = rows || []), render())),
      data.subscribe("settings", (rows) => ((state.settings = rows || []), render())),
    ];
    render();
    return () => offs.forEach((off) => off());
  };
})();
