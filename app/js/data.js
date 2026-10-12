// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0001 REQ "Shared State and Live Sync",
// REQ "Offline Operation", REQ "Error Handling Standards", design "Offline: service worker shell + local write
// queue"
//
// The data API every feature story uses: list, get, subscribe, create, update, delete (plus configureMerge for
// per-field conflict rules). Features never talk to PocketBase directly. Reads come from the local mirror
// (IndexedDB) with unsent changes laid over it; writes go to the ordered outbox first and are sent right away
// when online; realtime events and refreshes keep the mirror current. The transport and storage are injected, so
// all of this is unit-tested without a browser or a server.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./errors.js"), require("./merge.js"), require("./outbox.js"));
  } else {
    (root.HH = root.HH || {}).data = factory(root.HH.errors, root.HH.merge, root.HH.outbox);
  }
})(typeof self !== "undefined" ? self : this, function (errors, merge, outboxModule) {
  "use strict";

  const { KIND, isKind, wrap } = errors;

  // PocketBase ids: 15 characters from [a-z0-9]. Client-generated for creates, which makes a replayed create
  // idempotent (the server already has that id).
  const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  function randomId(cryptoImpl = globalThis.crypto) {
    const bytes = new Uint8Array(15);
    cryptoImpl.getRandomValues(bytes);
    return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
  }

  const byCreated = (a, b) =>
    String(a.created || "￿").localeCompare(String(b.created || "￿")) || a.id.localeCompare(b.id);

  /**
   * The non-blocking hint for the footer (SPEC-0001 "Sync write fails"): shown while queued changes have not
   * reached the server, not during a send in progress.
   */
  function syncHint(status) {
    if (status.queued > 0 && !status.syncing) {
      return `nicht synchronisiert (${status.queued} ${status.queued === 1 ? "Änderung" : "Änderungen"})`;
    }
    if (!status.online) return "offline";
    return "";
  }

  /**
   * @param {{ transport: object, storage: object, outbox?: object, registry?: object,
   *           logger?: { warn: Function, info?: Function }, makeId?: () => string, autoRetry?: boolean,
   *           retryMs?: number[], setTimeoutImpl?: Function }} options
   */
  function createData({
    transport,
    storage,
    registry = merge.createMergeRegistry(),
    outbox = outboxModule.createOutbox({ storage }),
    logger = console,
    makeId = randomId,
    autoRetry = true,
    retryMs = [5000, 10000, 30000, 60000],
    setTimeoutImpl = (...a) => setTimeout(...a),
  }) {
    const cache = new Map(); // collection -> Map(id -> server record)
    const loading = new Map();
    const listeners = new Map(); // collection -> Set(cb)
    const unsubscribers = new Map();
    const statusListeners = new Set();
    const status = { online: true, queued: 0, rejected: 0, syncing: false, lastError: null };
    let wake = 0; // counts "the connection is back" signals, so a flush that raced with one runs again
    let retryAttempt = 0;
    let retryTimer = null;

    // ---- status ------------------------------------------------------------------------------------------
    function publishStatus() {
      status.queued = outbox.size();
      status.rejected = outbox.failedCount();
      const snapshot = { ...status };
      for (const cb of statusListeners) cb(snapshot);
    }
    function setOnline(online) {
      if (online) wake += 1;
      if (status.online === online) return;
      status.online = online;
      publishStatus();
    }

    // ---- mirror ------------------------------------------------------------------------------------------
    function ensureLoaded(collection) {
      if (!loading.has(collection)) {
        loading.set(
          collection,
          storage.getAll(collection).then((rows) => {
            cache.set(collection, new Map(rows.map((r) => [r.id, r])));
          }),
        );
      }
      return loading.get(collection);
    }
    const mirror = (collection) => cache.get(collection) || new Map();

    function view(collection) {
      const records = outboxModule.applyPending(
        Array.from(mirror(collection).values()),
        outbox.forCollection(collection),
      );
      return records.sort(byCreated);
    }
    function notify(collection) {
      const set = listeners.get(collection);
      if (!set || set.size === 0) return;
      const records = view(collection);
      for (const cb of set) cb(records);
    }

    async function putMirror(collection, record) {
      await ensureLoaded(collection);
      const current = mirror(collection).get(record.id);
      if (current && current.updated && record.updated && current.updated > record.updated) return false; // stale event
      mirror(collection).set(record.id, record);
      await storage.put(collection, record);
      return true;
    }
    async function removeMirror(collection, id) {
      await ensureLoaded(collection);
      mirror(collection).delete(id);
      await storage.remove(collection, id);
    }

    // ---- sync --------------------------------------------------------------------------------------------
    /** Replaces the mirror of one collection with the server's records. */
    async function refresh(collection) {
      await ensureLoaded(collection);
      let records;
      try {
        records = await transport.list(collection);
      } catch (err) {
        noteTransportError(err, `failed to refresh ${collection}`);
        return false;
      }
      cache.set(collection, new Map(records.map((r) => [r.id, r])));
      await storage.replaceAll(collection, records);
      setOnline(true);
      notify(collection);
      return true;
    }

    function noteTransportError(err, context) {
      const wrapped = wrap(err, context);
      status.lastError = wrapped.message;
      if (isKind(err, KIND.NETWORK)) setOnline(false);
      else
        logger.warn("sync: request failed", { kind: err.kind, status: err.status, message: wrapped.message });
      publishStatus();
    }

    /** Sends one outbox entry. Maps transport errors to the outbox's three outcomes. */
    async function send(entry) {
      const { op, collection, recordId } = entry;
      const context = `failed to ${op} ${collection}/${recordId}`;
      try {
        if (op === "create") {
          let record = null;
          try {
            record = await transport.create(collection, { ...entry.data, id: recordId });
          } catch (err) {
            if (!isKind(err, KIND.EXISTS)) throw err; // replayed create whose first response was lost: already done
          }
          return { status: "ok", record };
        }
        if (op === "delete") {
          try {
            await transport.remove(collection, recordId);
          } catch (err) {
            if (!isKind(err, KIND.NOT_FOUND)) throw err; // already gone: delete is idempotent
          }
          return { status: "ok", deleted: true };
        }
        // update: apply the collection's per-field merge rules against the current server record
        let patch = entry.data;
        let seen = entry.base && entry.base.updated; // the version this change was made against
        const rules = registry.rulesFor(collection);
        if (Object.keys(patch).some((f) => rules[f])) {
          const server = await transport.get(collection, recordId);
          seen = server.updated; // the merge below judged against this version; the server re-checks it
          const resolved = merge.resolveUpdate({ patch, base: entry.base, server, rules });
          if (resolved.dropped.length) {
            logger.info?.("sync: concurrent change kept", {
              collection,
              record: recordId,
              fields: resolved.dropped,
            });
          }
          patch = resolved.patch;
          if (Object.keys(patch).length === 0) return { status: "ok", record: server };
        }
        return { status: "ok", record: await transport.update(collection, recordId, patch, { seen }) };
      } catch (err) {
        const wrapped = wrap(err, context);
        if (isKind(err, KIND.NETWORK)) {
          status.lastError = wrapped.message;
          return { status: "network" };
        }
        const reason = isKind(err, KIND.AUTH) ? "Anmeldung abgelaufen" : wrapped.message;
        // Structured client-side log; the server logs the rejection with member, record and reason itself.
        logger.warn("sync: change rejected, kept queued", {
          collection,
          record: recordId,
          op,
          kind: err.kind,
          reason,
        });
        status.lastError = wrapped.message;
        return { status: "rejected", reason };
      }
    }

    async function onApplied(entry, result) {
      if (result.deleted) await removeMirror(entry.collection, entry.recordId);
      else if (result.record) await putMirror(entry.collection, result.record);
    }

    /** Replays the outbox. Safe to call at any time; concurrent calls share one run. */
    async function flush() {
      await outbox.load();
      if (outbox.size() === 0) {
        publishStatus();
        return { sent: 0, rejected: 0, stopped: null };
      }
      status.syncing = true;
      publishStatus();
      const seen = wake;
      let summary;
      try {
        summary = await outbox.flush(send, { onApplied });
      } finally {
        status.syncing = false;
      }
      if (summary.stopped === "network" && wake !== seen) return flush(); // connectivity returned mid-run
      if (summary.stopped === "network") {
        setOnline(false);
        scheduleRetry();
      } else {
        setOnline(true);
        retryAttempt = 0;
      }
      publishStatus();
      for (const c of cache.keys()) notify(c);
      return summary;
    }

    function scheduleRetry() {
      if (!autoRetry || retryTimer || outbox.size() === 0) return;
      const wait = retryMs[Math.min(retryAttempt, retryMs.length - 1)];
      retryAttempt += 1;
      retryTimer = setTimeoutImpl(() => {
        retryTimer = null;
        flush().catch((err) => logger.warn("sync: flush failed", { message: String(err) }));
      }, wait);
    }
    const flushSoon = () => {
      if (status.online) flush().catch((err) => logger.warn("sync: flush failed", { message: String(err) }));
      else scheduleRetry();
    };

    // ---- realtime ----------------------------------------------------------------------------------------
    async function onEvent(collection, event) {
      const record = event && event.record;
      if (!record || !record.id) return;
      if (event.action === "delete") await removeMirror(collection, record.id);
      else await putMirror(collection, record);
      notify(collection);
    }

    transport.onConnect?.(() => {
      setOnline(true);
      // A (re)connect may have missed events: reload what is subscribed, then send what is queued.
      void Promise.all(Array.from(listeners.keys()).map(refresh))
        .then(flush)
        .catch((err) => logger.warn("sync: resync failed", { message: String(err) }));
    });

    // ---- public API --------------------------------------------------------------------------------------
    async function mutate(op, collection, recordId, data) {
      await ensureLoaded(collection);
      await outbox.load();
      let base;
      if (op === "update") {
        const current = mirror(collection).get(recordId);
        base = {
          updated: current && current.updated,
          values: current ? Object.fromEntries(Object.keys(data).map((f) => [f, current[f]])) : {},
        };
      }
      await outbox.enqueue({ op, collection, recordId, data, base });
      publishStatus();
      notify(collection);
      flushSoon();
    }

    /** Records of a collection from the local mirror, with unsent changes applied. */
    async function list(collection, { filter, sort } = {}) {
      await ensureLoaded(collection);
      await outbox.load();
      let records = view(collection);
      if (filter) records = records.filter(filter);
      if (sort) records = records.sort(sort);
      return records;
    }

    return {
      list,
      async get(collection, id) {
        return (await list(collection)).find((r) => r.id === id) || null;
      },
      /**
       * Calls `cb(records)` now and after every change (local, queued or live from the server), until the
       * returned function is called. The first subscriber of a collection starts its realtime subscription.
       */
      subscribe(collection, cb) {
        if (!listeners.has(collection)) listeners.set(collection, new Set());
        const set = listeners.get(collection);
        set.add(cb);
        const first = set.size === 1;
        void (async () => {
          await ensureLoaded(collection);
          await outbox.load();
          cb(view(collection));
          if (first && !unsubscribers.has(collection)) {
            unsubscribers.set(
              collection,
              transport.subscribe(collection, (ev) => onEvent(collection, ev)),
            );
            await refresh(collection);
          }
        })();
        return () => {
          set.delete(cb);
          if (set.size === 0 && unsubscribers.has(collection)) {
            unsubscribers.get(collection)();
            unsubscribers.delete(collection);
          }
        };
      },
      /** Creates a record with a client-generated id; resolves once it is queued (and shown), not once sent. */
      async create(collection, data) {
        const id = makeId();
        await mutate("create", collection, id, data);
        return { id, ...data, _pending: true };
      },
      /** Changes fields of a record (only the given fields are sent). */
      async update(collection, id, patch) {
        await mutate("update", collection, id, patch);
      },
      async delete(collection, id) {
        await mutate("delete", collection, id);
      },
      /** Registers a per-field conflict rule for replayed offline updates, e.g. `merge.sticky(true)`. */
      configureMerge: (collection, field, rule) => registry.register(collection, field, rule),

      // ---- plumbing for the app shell ----
      start: async () => {
        await outbox.load();
        publishStatus();
        await flush();
      },
      flush,
      refresh,
      refreshAll: () => Promise.all(Array.from(listeners.keys()).map(refresh)),
      setOnline,
      onStatus(cb) {
        statusListeners.add(cb);
        cb({ ...status, queued: outbox.size(), rejected: outbox.failedCount() });
        return () => statusListeners.delete(cb);
      },
      status: () => ({ ...status, queued: outbox.size(), rejected: outbox.failedCount() }),
      /** Sign-out: forget the mirror and the queue. */
      async reset() {
        for (const un of unsubscribers.values()) un();
        unsubscribers.clear();
        cache.clear();
        loading.clear();
        await storage.clearAll();
        for (const e of outbox.entries()) await outbox.discard(e.seq);
        publishStatus();
      },
    };
  }

  return { createData, randomId, syncHint };
});
