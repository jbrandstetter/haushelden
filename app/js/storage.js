// Governing: SPEC-0001 REQ "Offline Operation" (the app shows the last synced data), design "Offline: service
// worker shell + local write queue" (IndexedDB mirror of the records the principal may read)
//
// Storage adapters for the sync layer: an in-memory one (tests, and the fallback when IndexedDB is unavailable,
// for example in some private windows) and an IndexedDB one. Same interface:
//   getAll(collection), replaceAll(collection, records), put(collection, record), remove(collection, id),
//   getMeta(key), setMeta(key, value), loadOutbox(), saveOutbox(entries), clearAll()
// `clearAll` is called on sign-out: the mirror holds household data and must not outlive the session.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).storage = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const OUTBOX_KEY = "outbox";

  function memoryStorage() {
    const records = new Map(); // collection -> Map(id -> record)
    const meta = new Map();
    const col = (c) => {
      if (!records.has(c)) records.set(c, new Map());
      return records.get(c);
    };
    const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    return {
      kind: "memory",
      async getAll(c) {
        return Array.from(col(c).values()).map(clone);
      },
      async replaceAll(c, list) {
        records.set(c, new Map(list.map((r) => [r.id, clone(r)])));
      },
      async put(c, record) {
        col(c).set(record.id, clone(record));
      },
      async remove(c, id) {
        col(c).delete(id);
      },
      async getMeta(key) {
        return clone(meta.get(key));
      },
      async setMeta(key, value) {
        meta.set(key, clone(value));
      },
      async loadOutbox() {
        return clone(meta.get(OUTBOX_KEY)) || [];
      },
      async saveOutbox(entries) {
        meta.set(OUTBOX_KEY, clone(entries));
      },
      async clearAll() {
        records.clear();
        meta.clear();
      },
    };
  }

  function idbStorage(indexedDBImpl, name = "haushelden") {
    let dbPromise = null;
    function open() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = indexedDBImpl.open(name, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            const store = db.createObjectStore("records", { keyPath: "_key" });
            store.createIndex("collection", "_collection");
            db.createObjectStore("meta");
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () =>
            reject(new Error(`failed to open IndexedDB: ${req.error && req.error.message}`));
        });
      }
      return dbPromise;
    }
    const wrap = (req) =>
      new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const done = (tx) =>
      new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      });
    const keyOf = (c, id) => `${c}/${id}`;
    const strip = ({ _key, _collection, ...rest }) => rest;

    return {
      kind: "indexeddb",
      async getAll(c) {
        const db = await open();
        const rows = await wrap(
          db.transaction("records").objectStore("records").index("collection").getAll(c),
        );
        return rows.map(strip);
      },
      async replaceAll(c, list) {
        const db = await open();
        const tx = db.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        const existing = await wrap(store.index("collection").getAllKeys(c));
        for (const k of existing) store.delete(k);
        for (const r of list) store.put({ ...r, _key: keyOf(c, r.id), _collection: c });
        await done(tx);
      },
      async put(c, record) {
        const db = await open();
        const tx = db.transaction("records", "readwrite");
        tx.objectStore("records").put({ ...record, _key: keyOf(c, record.id), _collection: c });
        await done(tx);
      },
      async remove(c, id) {
        const db = await open();
        const tx = db.transaction("records", "readwrite");
        tx.objectStore("records").delete(keyOf(c, id));
        await done(tx);
      },
      async getMeta(key) {
        const db = await open();
        return wrap(db.transaction("meta").objectStore("meta").get(key));
      },
      async setMeta(key, value) {
        const db = await open();
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").put(value, key);
        await done(tx);
      },
      async loadOutbox() {
        return (await this.getMeta(OUTBOX_KEY)) || [];
      },
      async saveOutbox(entries) {
        await this.setMeta(OUTBOX_KEY, entries);
      },
      async clearAll() {
        const db = await open();
        const tx = db.transaction(["records", "meta"], "readwrite");
        tx.objectStore("records").clear();
        tx.objectStore("meta").clear();
        await done(tx);
      },
    };
  }

  /** IndexedDB when it opens, else memory (the app then works online only, without a persistent mirror). */
  async function openStorage(indexedDBImpl) {
    if (!indexedDBImpl) return memoryStorage();
    try {
      const store = idbStorage(indexedDBImpl);
      await store.getMeta("probe");
      return store;
    } catch {
      return memoryStorage();
    }
  }

  return { memoryStorage, idbStorage, openStorage };
});
