// Governing: SPEC-0001 REQ "Offline Operation" (queued changes are sent in order when the connection returns;
// tick-offs are idempotent), REQ "Error Handling Standards" (a rejected change stays queued, nothing is dropped
// silently), design "Offline: service worker shell + local write queue"
//
// Ordered outbox of record mutations. Pure logic over an injected storage ({ loadOutbox, saveOutbox }), so it is
// unit-tested without a browser. Entries replay strictly in order; a rejected entry stays queued and blocks only
// later entries for the same record, so unrelated changes still go out.
//
// Idempotency: a create carries the client-generated record id, a delete of a missing record counts as done, and
// an update only sets fields to values, so replaying any entry twice leaves the same result.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).outbox = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * @typedef {{ seq: number, op: "create"|"update"|"delete", collection: string, recordId: string,
   *             data?: object, base?: { updated?: string, values?: object }, createdAt: string,
   *             attempts: number, failed: null | { reason: string, at: string } }} Entry
   */

  const keyOf = (e) => `${e.collection}/${e.recordId}`;

  function createOutbox({ storage, now = () => new Date() }) {
    /** @type {Entry[]} */
    let entries = [];
    let nextSeq = 1;
    let inflightSeq = null;
    let flushing = null;
    let loaded = null;

    const persist = () => storage.saveOutbox(entries);

    function load() {
      if (!loaded) {
        loaded = storage.loadOutbox().then((stored) => {
          entries = Array.isArray(stored) ? stored : [];
          nextSeq = entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
        });
      }
      return loaded;
    }

    /** The last queued entry for a record that may still absorb a newer change (not sent, not rejected). */
    function openEntryFor(collection, recordId) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.collection === collection && e.recordId === recordId) {
          return e.seq !== inflightSeq && !e.failed ? e : null;
        }
      }
      return null;
    }

    /**
     * Queues a mutation. Consecutive changes to one record collapse: update+update merge their fields, a create
     * absorbs later updates, and create+delete cancel out. Order between different records is kept.
     */
    async function enqueue({ op, collection, recordId, data, base }) {
      await load();
      const open = openEntryFor(collection, recordId);
      if (open) {
        if (op === "update" && (open.op === "update" || open.op === "create")) {
          open.data = { ...open.data, ...data };
          await persist();
          return open;
        }
        if (op === "delete" && open.op === "create") {
          entries = entries.filter((e) => e !== open);
          await persist();
          return null;
        }
      }
      /** @type {Entry} */
      const entry = {
        seq: nextSeq++,
        op,
        collection,
        recordId,
        data: data ? { ...data } : undefined,
        base,
        createdAt: now().toISOString(),
        attempts: 0,
        failed: null,
      };
      entries.push(entry);
      await persist();
      return entry;
    }

    /**
     * Sends queued entries in order.
     *
     * `send(entry)` resolves to `{ status: "ok", record? }`, `{ status: "network" }` (stop, try again later) or
     * `{ status: "rejected", reason }` (keep queued, continue with other records). Only one flush runs at a
     * time; a call during a flush joins it.
     */
    function flush(send, { onApplied } = {}) {
      if (flushing) return flushing;
      flushing = (async () => {
        await load();
        const summary = { sent: 0, rejected: 0, stopped: null };
        const blocked = new Set(); // records with a rejected entry: later entries for them wait
        const tried = new Set(); // every entry is attempted at most once per flush, rejected ones included
        for (;;) {
          const entry = entries.find((e) => !tried.has(e.seq) && !blocked.has(keyOf(e)));
          if (!entry) break;
          tried.add(entry.seq);
          inflightSeq = entry.seq;
          let result;
          try {
            result = await send(entry);
          } catch (err) {
            result = { status: "rejected", reason: err && err.message ? err.message : String(err) };
          }
          inflightSeq = null;
          entry.attempts += 1;
          if (result.status === "ok") {
            entries = entries.filter((e) => e !== entry);
            summary.sent += 1;
            await persist();
            if (onApplied) onApplied(entry, result);
          } else if (result.status === "network") {
            summary.stopped = "network";
            break;
          } else {
            entry.failed = { reason: result.reason || "rejected", at: now().toISOString() };
            blocked.add(keyOf(entry));
            summary.rejected += 1;
            await persist();
          }
        }
        return summary;
      })().finally(() => {
        flushing = null;
        inflightSeq = null;
      });
      return flushing;
    }

    /** Removes a rejected entry the user gave up on. */
    async function discard(seq) {
      await load();
      entries = entries.filter((e) => e.seq !== seq);
      await persist();
    }

    return {
      load,
      enqueue,
      flush,
      discard,
      entries: () => entries.map((e) => ({ ...e })),
      forCollection: (collection) =>
        entries.filter((e) => e.collection === collection).map((e) => ({ ...e })),
      size: () => entries.length,
      failedCount: () => entries.filter((e) => e.failed).length,
    };
  }

  /**
   * Overlays queued entries on mirrored records, so the UI shows a change the moment it is made.
   * Returns new objects; `_pending: true` marks records with unsent changes.
   */
  function applyPending(records, entries) {
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const e of entries) {
      if (e.op === "create") {
        if (!byId.has(e.recordId)) byId.set(e.recordId, { id: e.recordId, ...e.data, _pending: true });
      } else if (e.op === "update") {
        const current = byId.get(e.recordId);
        if (current) byId.set(e.recordId, { ...current, ...e.data, _pending: true });
      } else if (e.op === "delete") {
        byId.delete(e.recordId);
      }
    }
    return Array.from(byId.values());
  }

  return { createOutbox, applyPending };
});
