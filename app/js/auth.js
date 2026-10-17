// Governing: ADR-0001, ADR-0003 (kid access via device accounts; the signed-in token is the credential),
// SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Device Enrollment and Removal",
// REQ "Kid Access on Enrolled Devices", REQ "Error Handling Standards"
//
// Client-side sign-in flow, free of the DOM so it is unit-tested with a fake server: parent sign-in, first-run
// setup, invite acceptance, family-device enrollment (the secret is generated here and never displayed), the
// parent PIN, sign-out, and the launch check that sends a removed device back to the sign-in screen.
// The session itself (token + record) is held by HH.auth in app.js; this module only decides what to do.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).authflow = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Routes that need no session (hash routes, see routes.js).
  const PUBLIC_ROUTES = ["setup", "anmelden", "einladung", "hilfe"];
  // Routes only parents open (a family device sends the visitor to "Wer bist du?" and its PIN prompt).
  // Parent-only screens: a plain family-device session is sent back to "Wer bist du?" (the server rules enforce it anyway).
  const PARENT_ROUTES = ["einstellungen", "eltern", "routinen", "maskottchen", "bereiche", "gelernt"];

  /** Reads the claims of a PocketBase token without verifying it (the server verifies). Null when unreadable. */
  function decodeToken(token) {
    try {
      const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(part));
    } catch {
      return null;
    }
  }

  /** "device" | "pin" (short parent session on a device) | "parent" | null. */
  function kindOf(session) {
    if (!session || !session.token || !session.record) return null;
    if (session.record.collectionName === "devices") return "device";
    const claims = decodeToken(session.token);
    return claims && claims.refreshable === false ? "pin" : "parent";
  }

  /** Seconds the short PIN session has left (0 when expired or not a PIN session). */
  function pinSecondsLeft(session, nowMs = Date.now()) {
    const claims = session && decodeToken(session.token);
    return claims && claims.exp ? Math.max(0, Math.floor(claims.exp - nowMs / 1000)) : 0;
  }

  /**
   * Which hash to show instead of the requested one, or null to keep it.
   * @param {string} hash the current location.hash
   * @param {"device"|"pin"|"parent"|null} kind the session kind
   */
  function guard(hash, kind) {
    const name = String(hash || "")
      .replace(/^#\/?/, "")
      .split("/")[0];
    if (!kind) return PUBLIC_ROUTES.includes(name) ? null : "#/anmelden";
    if (name === "anmelden" || name === "setup") return "#/wer";
    if (name === "ich") return "#/eltern"; // old address of the parents' view (prototype route, cached pages and bookmarks)
    if (kind === "device" && PARENT_ROUTES.includes(name)) return "#/wer";
    if (name === "") return "#/wer"; // everybody signed in starts at "Wer bist du?" (the shell's start page is only a placeholder)
    return null;
  }

  /** A secret of 32 random bytes as 64 hex characters. */
  function newDeviceSecret(cryptoImpl = globalThis.crypto) {
    const bytes = new Uint8Array(32);
    cryptoImpl.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * @param {{
   *   session: { get: () => ({token: string, record: object}|null), set: (token: string, record: object) => Promise<void>, clear: () => Promise<void> },
   *   deviceStore: { get: () => ({email: string, secret: string, name?: string}|null), set: (v: object) => void, clear: () => void },
   *   fetchImpl?: typeof fetch, cryptoImpl?: Crypto, now?: () => number }} options
   */
  function createAuthFlow({
    session,
    deviceStore,
    fetchImpl = (...a) => fetch(...a),
    cryptoImpl = globalThis.crypto,
    now = () => Date.now(),
  }) {
    /** One JSON request. Never throws: network trouble is `{ network: true }`. */
    async function call(method, path, { token, body } = {}) {
      const headers = { accept: "application/json" };
      if (token) headers.authorization = token;
      if (body !== undefined) headers["content-type"] = "application/json";
      let res;
      try {
        res = await fetchImpl(path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        return { network: true, status: 0, data: null };
      }
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: res.status, data };
    }

    /** Maps a failed call to what a screen shows. */
    function failure(res) {
      if (res.network) return { ok: false, error: "network", message: "Keine Verbindung zum Server." };
      const message = (res.data && res.data.message) || "Das hat nicht geklappt.";
      if (res.status === 429) return { ok: false, error: "limited", message };
      if (res.status >= 500) return { ok: false, error: "server", message: "Der Server hat ein Problem." };
      return { ok: false, error: "rejected", status: res.status, message };
    }

    async function adopt(res) {
      await session.set(res.data.token, res.data.record);
      return { ok: true };
    }

    const kind = () => kindOf(session.get());

    async function signInParent(email, password) {
      const res = await call("POST", "/api/collections/parents/auth-with-password", {
        body: { identity: String(email).trim(), password },
      });
      if (res.status === 200) return adopt(res);
      if (res.status === 400)
        return { ok: false, error: "credentials", message: "E-Mail oder Passwort stimmt nicht." };
      return failure(res);
    }

    async function setup({ token, name, email, password }) {
      const res = await call("POST", "/api/hh/setup", { body: { token, name, email, password } });
      return res.status === 200 ? adopt(res) : failure(res);
    }

    async function acceptInvite({ token, name, email, password }) {
      const res = await call("POST", "/api/hh/invite/accept", { body: { token, name, email, password } });
      return res.status === 200 ? adopt(res) : failure(res);
    }

    async function signInDevice(creds) {
      const res = await call("POST", "/api/collections/devices/auth-with-password", {
        body: { identity: creds.email, password: creds.secret },
      });
      if (res.status === 200) {
        await session.set(res.data.token, res.data.record);
        return { ok: true };
      }
      // 400 = the account does not exist (any more) or the secret is wrong: this device was removed.
      return { ...failure(res), removed: res.status === 400 };
    }

    /**
     * "Als Familiengerät einrichten": needs a parent session. Generates the secret here, registers the device,
     * stores its credentials on this device only, and replaces the parent session by the device session.
     */
    async function enrollDevice(name) {
      const s = session.get();
      if (kindOf(s) !== "parent")
        return { ok: false, error: "forbidden", message: "Bitte melde dich als Elternteil an." };
      const secret = newDeviceSecret(cryptoImpl);
      const res = await call("POST", "/api/hh/devices/enroll", { token: s.token, body: { name, secret } });
      if (res.status !== 200) return failure(res);
      const creds = { email: res.data.email, secret, name: res.data.name };
      const signedIn = await signInDevice(creds);
      if (!signedIn.ok) return signedIn;
      deviceStore.set(creds);
      return { ok: true };
    }

    /** A kid tapped a parent profile on a family device: asks the server for the 15-minute parent session. */
    async function unlockParent(memberId, pin) {
      const s = session.get();
      if (kindOf(s) !== "device")
        return { ok: false, error: "forbidden", message: "Nur auf einem Familiengerät." };
      if (!/^[0-9]{6}$/.test(String(pin)))
        return { ok: false, error: "rejected", message: "Die PIN besteht aus 6 Ziffern." };
      const res = await call("POST", "/api/hh/pin", { token: s.token, body: { member: memberId, pin } });
      if (res.status === 200) return adopt(res);
      if (res.status === 401 && res.data && /Falsche PIN/.test(res.data.message || ""))
        return { ok: false, error: "wrong-pin", message: "Falsche PIN." };
      if (res.status === 401)
        return { ok: false, error: "auth", message: "Das Gerät ist nicht mehr angemeldet." };
      return failure(res);
    }

    /** Back from a parent view on a family device (or after the 15 minutes): the device session again. */
    async function backToDevice() {
      const creds = deviceStore.get();
      if (!creds) {
        await session.clear();
        return { ok: true, state: "signed-out" };
      }
      const res = await signInDevice(creds);
      if (res.ok) return { ok: true, state: "device" };
      if (res.removed) deviceStore.clear();
      await session.clear();
      return { ok: false, state: res.network ? "offline" : "signed-out" };
    }

    /** Sign out. A family device keeps its own sign-in, so it falls back to "Wer bist du?". */
    async function signOut() {
      if (kind() === "device") {
        // Devices do not sign out; only a parent removes them in the device list.
        return { ok: true, state: "device" };
      }
      return backToDevice();
    }

    /**
     * Start-up check: refresh the stored session; a session the server no longer knows (revoked parent, removed
     * device, expired PIN session) is dropped and replaced by the enrolled device's own sign-in, if any.
     * @returns {Promise<{state: "device"|"pin"|"parent"|"signed-out"|"offline"}>}
     */
    async function launch() {
      const s = session.get();
      const k = kindOf(s);
      if (k === "pin") {
        if (pinSecondsLeft(s, now()) > 0) return { state: "pin" };
        const back = await backToDevice();
        return { state: back.state };
      }
      if (k) {
        const res = await call("POST", `/api/collections/${s.record.collectionName}/auth-refresh`, {
          token: s.token,
        });
        if (res.network) return { state: "offline" }; // keep working from the local mirror
        if (res.status === 200) {
          await session.set(res.data.token, res.data.record);
          return { state: k };
        }
        // A server hiccup (5xx, rate limit) says nothing about the session: keep it and work from the local mirror.
        if (res.status >= 500 || res.status === 429 || res.status === 0) return { state: "offline" };
        // The server no longer accepts the token: a revoked or expired parent session, or a device token that
        // expired or whose device was removed. The enrolled device's own sign-in decides what happens next.
        const back = await backToDevice();
        return { state: back.state };
      }
      if (deviceStore.get()) {
        const back = await backToDevice();
        return { state: back.state };
      }
      return { state: "signed-out" };
    }

    return {
      kind,
      signInParent,
      setup,
      acceptInvite,
      enrollDevice,
      unlockParent,
      backToDevice,
      signOut,
      launch,
    };
  }

  return {
    createAuthFlow,
    decodeToken,
    kindOf,
    pinSecondsLeft,
    guard,
    newDeviceSecret,
    PUBLIC_ROUTES,
    PARENT_ROUTES,
  };
});
