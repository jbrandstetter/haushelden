// Governing: SPEC-0001 REQ "Prototype as UI Reference" (the prototype always shows where you are and how to get
// back), REQ "Kid Access on Enrolled Devices" (a family device sees no parent entries),
// SPEC-0009 REQ "Navigation and Help" (Essen for parents, PIN sessions and family devices)
//
// The navigation bar in the page header: it is built from the session kind and the current page, so every
// screen has it. Pure `navItems` (tested) plus a small DOM `render`.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.HH = root.HH || {};
    root.HH.shellnav = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Which entry a page belongs to (so e.g. "Bereiche" highlights "Einstellungen").
  const SECTION = {
    wer: "wer",
    kind: "wer",
    eltern: "eltern",
    ich: "eltern",
    einkauf: "einkauf",
    gelernt: "einkauf",
    essen: "essen",
    einstellungen: "einstellungen",
    routinen: "einstellungen",
    maskottchen: "einstellungen",
    bereiche: "einstellungen",
    hilfe: "hilfe",
  };

  const routeName = (hash) =>
    String(hash || "")
      .replace(/^#\/?/, "")
      .split("/")[0];

  /**
   * @param {{ kind: "device"|"pin"|"parent"|null, memberId?: string, hash?: string }} state
   * @returns {{ key: string, label: string, href: string, current: boolean }[]} only "Hilfe" while signed out
   */
  function navItems({ kind, memberId, hash }) {
    const here = SECTION[routeName(hash)] || "";
    const help = { key: "hilfe", label: "Hilfe", href: "#/hilfe" }; // public: also for visitors who are not signed in
    if (!kind) return [{ ...help, current: help.key === here }];
    const parentLike = kind === "parent" || kind === "pin";
    const items = [{ key: "wer", label: "Wer bist du?", href: "#/wer" }];
    if (parentLike) items.push({ key: "eltern", label: "Aufgaben", href: "#/eltern" });
    items.push({
      key: "einkauf",
      label: "Einkauf",
      href: memberId ? `#/einkauf/${encodeURIComponent(memberId)}` : "#/einkauf",
    });
    // Everybody plans and votes (SPEC-0009 REQ "Navigation and Help"); the route guard keeps it off the public list.
    items.push({
      key: "essen",
      label: "Essen",
      href: memberId ? `#/essen/${encodeURIComponent(memberId)}` : "#/essen",
    });
    if (parentLike) items.push({ key: "einstellungen", label: "Einstellungen", href: "#/einstellungen" });
    items.push(help);
    return items.map((i) => ({ ...i, current: i.key === here }));
  }

  /** Fills the header's <nav>: the brand link first, then the entries; the current page gets aria-current. */
  function render(nav, state, doc = nav.ownerDocument) {
    nav.textContent = "";
    const brand = doc.createElement("a");
    brand.className = "brand";
    brand.textContent = "Haushelden";
    brand.setAttribute("href", state.kind ? "#/wer" : "#/anmelden");
    nav.append(brand);
    for (const item of navItems(state)) {
      const a = doc.createElement("a");
      a.textContent = item.label;
      a.setAttribute("href", item.href);
      a.setAttribute("data-nav", item.key);
      if (item.current) a.setAttribute("aria-current", "page");
      nav.append(a);
    }
  }

  return { navItems, render, routeName };
});
