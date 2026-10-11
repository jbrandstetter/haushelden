// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (the signed-in token is the credential),
// SPEC-0001 REQ "Installable Web App", REQ "Shared State and Live Sync", REQ "Offline Operation",
// REQ "Household Day and Time Zone", REQ "Error Handling Standards"
//
// Bootstrap: wires storage, transport, data API, router, clock, sync hint and the service worker. Browser only;
// the logic it calls is in the modules next to it and unit-tested there.

(function () {
  "use strict";
  const HH = (window.HH = window.HH || {});
  HH.screens = HH.screens || {};

  // ---- auth token (sign-in screens arrive with the authentication stories) -------------------------------
  const AUTH_KEY = "hh.auth";
  const readAuth = () => {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY)) || null;
    } catch {
      return null;
    }
  };
  HH.auth = {
    token: () => (readAuth() || {}).token || null,
    record: () => (readAuth() || {}).record || null,
    signedIn: () => !!(readAuth() || {}).token,
    set(token, record) {
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token, record }));
      } catch (err) {
        console.warn("auth: could not persist the session", { message: String(err) });
      }
      return HH.app.connect();
    },
    async clear() {
      try {
        localStorage.removeItem(AUTH_KEY);
      } catch {
        // storage unavailable: nothing persisted, nothing to remove
      }
      await HH.app.disconnect();
    },
  };

  // ---- household clock ------------------------------------------------------------------------------------
  // The time zone comes from the settings record (override) or GET /api/hh/config (HH_TZ), cached for offline.
  const clockState = { tz: HH.dates.DEFAULT_TZ, override: "", configured: "" };
  const previewOffset = parseInt(new URLSearchParams(location.search).get("tag"), 10) || 0; // ?tag=2, as in the prototype
  const updateTz = () => {
    clockState.tz = HH.dates.resolveTimeZone(clockState.override || clockState.configured);
  };
  HH.clock = {
    tz: () => clockState.tz,
    now: () => new Date(),
    today: () => HH.dates.dayKey(HH.dates.todayNumber(new Date(), clockState.tz, previewOffset)),
    todayNumber: () => HH.dates.todayNumber(new Date(), clockState.tz, previewOffset),
  };

  // ---- sync hint -------------------------------------------------------------------------------------------
  function showHint(status) {
    const el = document.getElementById("syncstate");
    if (!el) return;
    const text = HH.data.syncHint(status);
    el.textContent = text;
    el.classList.toggle("hidden", text === "");
    el.classList.toggle("warn", status.queued > 0);
  }

  // ---- connection ------------------------------------------------------------------------------------------
  let data = null;
  let transport = null;
  let storage = null;
  const offTz = [];

  async function connect() {
    if (!HH.auth.signedIn()) return;
    if (!transport) {
      transport = HH.pb.createPocketBaseTransport({ getToken: HH.auth.token });
      data = HH.data.createData({ transport, storage });
      data.configureMerge; // feature stories register their merge rules at their own start-up
      data.onStatus(showHint);
      HH.app.data = data;
    }
    transport.reconnect();
    const cachedTz = await storage.getMeta("tz");
    if (cachedTz) clockState.configured = cachedTz;
    updateTz();
    offTz.push(
      data.subscribe("settings", (rows) => {
        clockState.override = (rows[0] && rows[0].tz) || "";
        updateTz();
      }),
    );
    try {
      const cfg = await transport.config();
      if (cfg && cfg.tz) {
        clockState.configured = cfg.tz;
        await storage.setMeta("tz", cfg.tz);
        updateTz();
      }
    } catch (err) {
      console.warn("clock: using the cached household time zone", { message: String(err) });
    }
    await data.start();
    HH.app.rerender();
  }

  async function disconnect() {
    while (offTz.length) offTz.pop()();
    if (transport) transport.close();
    if (data) await data.reset();
    transport = null;
    data = null;
    HH.app.data = null;
    HH.app.rerender();
  }

  // ---- start -----------------------------------------------------------------------------------------------
  let router = null;
  HH.app = {
    data: null,
    connect,
    disconnect,
    rerender: () => router && router.render(),
  };

  function scheduleMidnight() {
    const wait = HH.dates.msUntilNextDay(new Date(), clockState.tz);
    let shown = HH.clock.today();
    setTimeout(function tick() {
      const now = HH.clock.today();
      if (now !== shown) {
        shown = now;
        HH.app.rerender();
      }
      setTimeout(tick, Math.min(HH.dates.msUntilNextDay(new Date(), clockState.tz), 60 * 60 * 1000));
    }, wait);
  }

  async function start() {
    storage = await HH.storage.openStorage(window.indexedDB);
    router = HH.router.createRouter({
      routes: HH.ROUTES,
      view: document.getElementById("view"),
      screens: HH.screens,
      context: () => ({ data: HH.app.data, clock: HH.clock, auth: HH.auth }),
    });
    await router.start();
    window.addEventListener("online", () => data && data.setOnline(true) && data.flush());
    window.addEventListener("offline", () => data && data.setOnline(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !data) return;
      transport.reconnect();
      data.refreshAll().then(() => data.flush());
    });
    scheduleMidnight();
    await connect();
    if (navigator.onLine) router.preload();
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch((err) => {
      console.warn("service worker: registration failed", { message: String(err) });
    });
  }

  start().catch((err) => {
    console.error("app: start failed", { message: String(err) });
    const view = document.getElementById("view");
    if (view) view.textContent = "Die App konnte nicht gestartet werden.";
  });
})();
