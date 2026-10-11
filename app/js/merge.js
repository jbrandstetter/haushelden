// Governing: SPEC-0001 REQ "Offline Operation" (later change by server receipt wins per field, except that a
// shopping item marked bought stays bought), design "Offline: service worker shell + local write queue"
//
// Generic per-field merge for replayed offline updates. Without a rule a field is simply sent: the server applies
// it on receipt, so the later receipt wins per field. A feature story registers a rule for a field that must not
// lose a concurrent change (the shopping story registers `sticky(true)` for shop_items.bought).
//
// A change is "concurrent" when the record changed on the server after the device last saw it: the update's
// recorded base version (`base.updated`) differs from the server's current `updated`.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).merge = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }

  /**
   * Decides what to send for an update.
   *
   * @param {{ patch: object, base?: { updated?: string, values?: object }, server?: object,
   *           rules?: Record<string, (c: { field: string, base: any, local: any, server: any }) => any> }} args
   * @returns {{ patch: object, dropped: string[] }} the fields to send and the fields whose change was discarded
   */
  function resolveUpdate({ patch, base, server, rules = {} }) {
    const out = {};
    const dropped = [];
    const concurrent = !!server && (!base || !base.updated || base.updated !== server.updated);
    for (const [field, local] of Object.entries(patch)) {
      const rule = rules[field];
      if (!rule || !concurrent) {
        out[field] = local;
        continue;
      }
      const value = rule({
        field,
        base: base && base.values ? base.values[field] : undefined,
        local,
        server: server[field],
      });
      if (deepEqual(value, server[field])) dropped.push(field);
      else out[field] = value;
    }
    return { patch: out, dropped };
  }

  /** Rule: once the server holds `value`, a concurrent change away from it loses. */
  const sticky =
    (value) =>
    ({ local, server }) =>
      deepEqual(server, value) ? server : local;

  /** Registry of rules per collection and field, filled by feature stories. */
  function createMergeRegistry() {
    const rules = new Map();
    return {
      register(collection, field, rule) {
        if (typeof rule !== "function") throw new TypeError("merge rule must be a function");
        if (!rules.has(collection)) rules.set(collection, {});
        rules.get(collection)[field] = rule;
      },
      rulesFor: (collection) => rules.get(collection) || {},
      hasRules: (collection) => rules.has(collection),
    };
  }

  return { deepEqual, resolveUpdate, sticky, createMergeRegistry };
});
