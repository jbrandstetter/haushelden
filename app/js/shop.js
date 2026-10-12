// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Adding Items", REQ "Shopping Flow",
// REQ "Entry Points", SPEC-0001 REQ "Offline Operation" (ticks queue offline; bought stays bought),
// REQ "Database Operation Standards"
//
// Shopping logic shared by the shopping screen and the "Einkaufsliste" entry button: name normalisation (the
// server applies the same rule), counts, the add / tick / finish operations over the data API, the merge rule
// for `bought`, and the reusable entry button. The purchase itself is recorded by the server hook
// (pb_hooks/shopping.pb.js) when `bought` changes; the client only sets the household day.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).shop = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_NAME = 80;

  /** Display form: trimmed, inner whitespace collapsed (same rule as the server). */
  const normalizeName = (name) =>
    String(name == null ? "" : name)
      .replace(/\s+/g, " ")
      .trim();
  /** Identity of a name on a list. */
  const nameKey = (name) => normalizeName(name).toLowerCase();

  const isBought = (item) => !!item.bought;
  const forList = (items, listId) => items.filter((i) => i.list === listId);
  const openItems = (items, listId) => forList(items, listId).filter((i) => !isBought(i));
  const cartItems = (items, listId) => forList(items, listId).filter(isBought);
  const openCount = (items, listId) => openItems(items, listId).length;
  const totalOpen = (items) => items.filter((i) => !isBought(i)).length;

  /** The open item of that name on the list, if any (case- and whitespace-insensitive). */
  function findDuplicate(items, listId, name) {
    const key = nameKey(name);
    return openItems(items, listId).find((i) => nameKey(i.name) === key) || null;
  }

  /**
   * Adds an item. Resolves to `{ ok: true, item }` or `{ ok: false, reason }` with reason `empty`, `too_long`,
   * `no_member` or `duplicate` (nothing is created then). `items` is the current list of shop_items.
   */
  async function addItem(data, items, { list, name, by }) {
    const clean = normalizeName(name);
    if (!clean) return { ok: false, reason: "empty" };
    if (clean.length > MAX_NAME) return { ok: false, reason: "too_long" };
    if (!by) return { ok: false, reason: "no_member" };
    const dup = findDuplicate(items, list, clean);
    if (dup) return { ok: false, reason: "duplicate", item: dup };
    const item = await data.create("shop_items", { list, name: clean, by, auto: false, bought: "" });
    return { ok: true, item };
  }

  /** Ticks (day = the household day) or un-ticks (day = "") an item; the server records or removes the purchase. */
  const setBought = (data, item, day) => data.update("shop_items", item.id, { bought: day });

  /** "Einkauf fertig": removes every ticked item of the list (the server keeps each purchase). */
  async function finishShopping(data, items, listId) {
    const cart = cartItems(items, listId);
    for (const item of cart) await data.delete("shop_items", item.id);
    return cart.length;
  }

  /** Once the server holds a purchase day, a concurrent change (an un-tick, another day) loses. */
  const stickyBought = ({ local, server }) => (server ? server : local);

  /** Registers the client-side merge rule for replayed offline updates (SPEC-0001 "Offline Operation"). */
  function registerMerge(data) {
    data.configureMerge("shop_items", "bought", stickyBought);
  }

  const listLabel = (list) => `${list.emoji} ${list.name}`;

  /** Text under the entry button title. */
  const entrySummary = (openTotal) => (openTotal ? `${openTotal} Sachen drauf` : "Leer");

  /**
   * The reusable "Einkaufsliste" entry button (prototype `shopButton`): a link to #/einkauf/<member id>, with the
   * number of open items, live. `who` is the member the shopping screen should attribute new items to (the
   * profile it is opened from). Returns `{ el, dispose }`.
   */
  function entryButton({ data, who, doc = document }) {
    const a = doc.createElement("a");
    a.className = "shopbtn";
    a.href = who ? `#/einkauf/${encodeURIComponent(who)}` : "#/einkauf";
    const icon = doc.createElement("span");
    icon.className = "ic";
    icon.textContent = "🛒";
    const text = doc.createElement("span");
    text.style.flex = "1";
    const title = doc.createElement("b");
    title.textContent = "Einkaufsliste";
    const sub = doc.createElement("span");
    sub.textContent = entrySummary(0);
    text.append(title, sub);
    const chevron = doc.createElement("span");
    chevron.textContent = "›";
    chevron.style.cssText = "font-size:22px;color:var(--overlay)";
    a.append(icon, text, chevron);
    let off = () => {};
    if (data) {
      off = data.subscribe("shop_items", (items) => {
        sub.textContent = entrySummary(totalOpen(items));
      });
    }
    return { el: a, dispose: () => off() };
  }

  return {
    MAX_NAME,
    normalizeName,
    nameKey,
    openItems,
    cartItems,
    openCount,
    totalOpen,
    findDuplicate,
    addItem,
    setBought,
    finishShopping,
    stickyBought,
    registerMerge,
    listLabel,
    entrySummary,
    entryButton,
  };
});
