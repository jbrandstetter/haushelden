// Governing: SPEC-0001 REQ "Prototype as UI Reference", REQ "Household Day and Time Zone",
// REQ "Shared State and Live Sync"
//
// Start page of the shell: shows the household day and the live member list. It is deliberately small: it only
// proves that the shell, the household clock and the sync layer work. The "Wer bist du?" screen and the boards
// are feature stories.

(function () {
  "use strict";
  const WDL = HH.dates.WDL;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  HH.screens.home = function (view, ctx) {
    const title = el("h1", "", "Haushelden");
    const day = el("p", "muted");
    const today = ctx.clock.todayNumber();
    day.textContent = `Heute ist ${WDL[HH.dates.weekday(today)]}, ${ctx.clock.today()} (${ctx.clock.tz()})`;
    view.append(title, day);

    if (!ctx.data) {
      view.append(el("p", "muted", "Nicht angemeldet. Die Anmeldung kommt in einer späteren Version."));
      return;
    }

    const panel = el("section", "panel");
    panel.append(el("h3", "", "Familie"));
    const list = el("ul", "plain");
    list.setAttribute("aria-live", "polite");
    panel.append(list);
    view.append(panel);

    // Entry point to the shopping list (SPEC-0005 REQ "Entry Points"); the kid board, parent view and
    // "Wer bist du?" screens get the same button when those stories land.
    const shopEntry = HH.shop.entryButton({ data: ctx.data, who: (ctx.auth.record() || {}).member });
    view.append(shopEntry.el);

    const offMembers = ctx.data.subscribe("members", (members) => {
      list.textContent = "";
      if (members.length === 0) list.append(el("li", "muted", "Noch keine Mitglieder."));
      for (const m of members) {
        const item = el("li", m._pending ? "pending" : "", `${m.emoji || ""} ${m.name || ""}`.trim());
        if (m.colour) item.style.setProperty("--c", `var(--${m.colour})`);
        list.append(item);
      }
    });
    return () => {
      offMembers();
      shopEntry.dispose();
    };
  };
})();
