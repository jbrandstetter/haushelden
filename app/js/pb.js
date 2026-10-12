// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (device accounts; the token is the
// credential), SPEC-0001 REQ "Shared State and Live Sync" (realtime), REQ "Error Handling Standards"
//
// PocketBase transport for the data API: REST for records, a fetch-based SSE stream for realtime. The only
// module that knows PocketBase's wire format; feature code uses data.js. Every failure becomes a SyncError whose
// `kind` says what the sync layer should do (retry later, keep queued and flag, sign in again, ...).

(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./errors.js"), require("./sse.js"));
  else (root.HH = root.HH || {}).pb = factory(root.HH.errors, root.HH.sse);
})(typeof self !== "undefined" ? self : this, function (errors, sse) {
  "use strict";

  const { KIND, SyncError } = errors;
  const PAGE = 200;

  function describe(data, fallback) {
    if (!data || typeof data !== "object") return fallback;
    const fields = data.data
      ? Object.entries(data.data)
          .map(([k, v]) => `${k}: ${v && v.message ? v.message : v}`)
          .join(", ")
      : "";
    return [data.message || fallback, fields].filter(Boolean).join(" (") + (fields ? ")" : "");
  }

  function classify(status, data, op) {
    const message = describe(data, `HTTP ${status}`);
    if (status === 401) return new SyncError(KIND.AUTH, `not signed in: ${message}`, { status, data });
    if (status === 404) return new SyncError(KIND.NOT_FOUND, `not found: ${message}`, { status, data });
    if (op === "create" && status === 400 && data && data.data && data.data.id) {
      return new SyncError(KIND.EXISTS, `record id already exists: ${message}`, { status, data });
    }
    if (status === 408 || status === 429 || status >= 500) {
      return new SyncError(KIND.NETWORK, `server unavailable: ${message}`, { status, data });
    }
    return new SyncError(KIND.REJECTED, `server rejected the request: ${message}`, { status, data });
  }

  /**
   * @param {{ baseUrl?: string, getToken: () => string|null, fetchImpl?: typeof fetch,
   *           setTimeoutImpl?: typeof setTimeout, backoffMs?: number[] }} options
   */
  function createPocketBaseTransport({
    baseUrl = "",
    getToken,
    fetchImpl = (...a) => fetch(...a),
    setTimeoutImpl = (...a) => setTimeout(...a),
    backoffMs = [1000, 2000, 5000, 10000, 15000],
  }) {
    async function request(op, method, path, body, extraHeaders) {
      const headers = { accept: "application/json", ...extraHeaders };
      const token = getToken();
      if (token) headers.authorization = token;
      if (body !== undefined) headers["content-type"] = "application/json";
      let res;
      try {
        res = await fetchImpl(baseUrl + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        throw new SyncError(KIND.NETWORK, `${method} ${path} failed: network error`, { cause });
      }
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) throw classify(res.status, data, op);
      return data;
    }

    const recordPath = (c, id = "") =>
      `/api/collections/${encodeURIComponent(c)}/records${id ? `/${encodeURIComponent(id)}` : ""}`;

    // ---- realtime ------------------------------------------------------------------------------------------
    const handlers = new Map(); // collection -> Set(handler)
    const connectListeners = new Set();
    let clientId = null;
    let abort = null;
    let running = false;
    let attempt = 0;

    async function postSubscriptions() {
      if (!clientId) return;
      await request("subscribe", "POST", "/api/realtime", {
        clientId,
        subscriptions: Array.from(handlers.keys()),
      });
    }

    async function runStream() {
      if (running) return;
      running = true;
      while (handlers.size > 0) {
        abort = new AbortController();
        try {
          const headers = { accept: "text/event-stream" };
          const res = await fetchImpl(baseUrl + "/api/realtime", { headers, signal: abort.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const parser = sse.createParser();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
              if (ev.event === "PB_CONNECT") {
                clientId = JSON.parse(ev.data).clientId;
                attempt = 0;
                await postSubscriptions();
                for (const cb of connectListeners) cb();
              } else {
                const set = handlers.get(ev.event);
                if (set) {
                  let payload;
                  try {
                    payload = JSON.parse(ev.data);
                  } catch {
                    continue; // a malformed event is skipped; the next refresh repairs the mirror
                  }
                  for (const h of set) h(payload);
                }
              }
            }
          }
        } catch (err) {
          if (abort && abort.signal.aborted && handlers.size === 0) break;
          void err; // network loss: retry below with backoff; the next PB_CONNECT triggers a full refresh
        }
        clientId = null;
        if (handlers.size === 0) break;
        const wait = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        attempt += 1;
        await new Promise((r) => setTimeoutImpl(r, wait));
      }
      running = false;
    }

    return {
      async list(collection) {
        const items = [];
        for (let page = 1; ; page++) {
          const data = await request(
            "list",
            "GET",
            `${recordPath(collection)}?perPage=${PAGE}&page=${page}&skipTotal=0`,
          );
          items.push(...data.items);
          if (page >= data.totalPages) break;
        }
        return items;
      },
      get: (collection, id) => request("get", "GET", recordPath(collection, id)),
      create: (collection, data) => request("create", "POST", recordPath(collection), data),
      // `seen` (the record version the change was made against) travels as X-HH-Seen: hooks may refuse a stale
      // change that would undo a sticky field (shopping: bought stays bought).
      update: (collection, id, patch, { seen } = {}) =>
        request(
          "update",
          "PATCH",
          recordPath(collection, id),
          patch,
          seen ? { "x-hh-seen": seen } : undefined,
        ),
      async remove(collection, id) {
        await request("delete", "DELETE", recordPath(collection, id));
      },

      /** Subscribes to realtime events of one collection. Returns an unsubscribe function. */
      subscribe(collection, handler) {
        if (!handlers.has(collection)) handlers.set(collection, new Set());
        handlers.get(collection).add(handler);
        if (running && clientId) postSubscriptions().catch(() => {});
        else void runStream();
        return () => {
          const set = handlers.get(collection);
          if (!set) return;
          set.delete(handler);
          if (set.size === 0) handlers.delete(collection);
          if (handlers.size === 0 && abort) abort.abort();
          else postSubscriptions().catch(() => {});
        };
      },
      /** Called after every (re)connect of the realtime stream; the data layer refreshes and flushes then. */
      onConnect(cb) {
        connectListeners.add(cb);
        return () => connectListeners.delete(cb);
      },
      /** Drops the stream and reconnects (after sign-in or when the page becomes visible again). */
      reconnect() {
        if (abort) abort.abort();
        clientId = null;
        if (!running) void runStream();
      },
      close() {
        handlers.clear();
        if (abort) abort.abort();
      },
      /** GET /api/hh/config (household time zone). */
      config: () => request("config", "GET", "/api/hh/config"),
    };
  }

  return { createPocketBaseTransport, classify };
});
