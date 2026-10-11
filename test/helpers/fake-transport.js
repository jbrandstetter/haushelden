// Test double for the data layer's transport: an in-memory "server" with versioned records, realtime fan-out and
// a switch to simulate losing the network. Several transports can share one fake server (several devices).

const { SyncError, KIND } = require("../../app/js/errors.js");

function createFakeServer() {
  let clock = 0;
  const collections = new Map();
  const listeners = new Set();
  const log = [];
  const col = (c) => {
    if (!collections.has(c)) collections.set(c, new Map());
    return collections.get(c);
  };
  const stamp = () => String(++clock).padStart(6, "0");
  const server = {
    log,
    col,
    /** Simulates a change made by another device, with realtime delivery. */
    apply(c, action, record) {
      if (action === "delete") col(c).delete(record.id);
      else col(c).set(record.id, record);
      for (const l of listeners) l(c, action, record);
    },
    seed(c, record) {
      const full = { created: stamp(), updated: stamp(), ...record };
      col(c).set(full.id, full);
      return full;
    },
    stamp,
    addListener: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  return server;
}

function createFakeTransport(server, { rejectWhen } = {}) {
  const state = { online: true, subs: new Map(), connectCbs: new Set() };
  const down = () => {
    if (!state.online) throw new SyncError(KIND.NETWORK, "network error");
  };
  const off = server.addListener((c, action, record) => {
    if (!state.online) return;
    for (const h of state.subs.get(c) || []) h({ action, record });
  });
  const t = {
    state,
    setOnline(v) {
      state.online = v;
      if (v) for (const cb of state.connectCbs) cb();
    },
    async list(c) {
      down();
      return Array.from(server.col(c).values()).map((r) => ({ ...r }));
    },
    async get(c, id) {
      down();
      const r = server.col(c).get(id);
      if (!r) throw new SyncError(KIND.NOT_FOUND, "not found", { status: 404 });
      return { ...r };
    },
    async create(c, data) {
      down();
      server.log.push(["create", c, data.id]);
      if (rejectWhen && rejectWhen("create", c, data)) {
        throw new SyncError(KIND.REJECTED, "server rejected the request: not allowed", { status: 403 });
      }
      if (server.col(c).has(data.id))
        throw new SyncError(KIND.EXISTS, "record id already exists", { status: 400 });
      const record = { ...data, created: server.stamp(), updated: server.stamp() };
      server.apply(c, "create", record);
      return { ...record };
    },
    async update(c, id, patch) {
      down();
      server.log.push(["update", c, id, { ...patch }]);
      if (rejectWhen && rejectWhen("update", c, patch)) {
        throw new SyncError(KIND.REJECTED, "server rejected the request: not allowed", { status: 403 });
      }
      const current = server.col(c).get(id);
      if (!current) throw new SyncError(KIND.NOT_FOUND, "not found", { status: 404 });
      const record = { ...current, ...patch, updated: server.stamp() };
      server.apply(c, "update", record);
      return { ...record };
    },
    async remove(c, id) {
      down();
      server.log.push(["delete", c, id]);
      const current = server.col(c).get(id);
      if (!current) throw new SyncError(KIND.NOT_FOUND, "not found", { status: 404 });
      server.apply(c, "delete", current);
    },
    subscribe(c, handler) {
      if (!state.subs.has(c)) state.subs.set(c, new Set());
      state.subs.get(c).add(handler);
      return () => state.subs.get(c).delete(handler);
    },
    onConnect(cb) {
      state.connectCbs.add(cb);
      return () => state.connectCbs.delete(cb);
    },
    dispose: off,
  };
  return t;
}

const quietLogger = { warn() {}, info() {} };
const tick = () => new Promise((r) => setImmediate(r));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not met in time");
}

module.exports = { createFakeServer, createFakeTransport, quietLogger, tick, until };
