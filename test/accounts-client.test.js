// Governing: ADR-0003 (kid access via device accounts), SPEC-0001 REQ "First-Run Setup", REQ "Parent
// Authentication", REQ "Device Enrollment and Removal", REQ "Kid Access on Enrolled Devices"
//
// Unit tests of the client sign-in flow (app/js/auth.js) against a scripted fake server. Scenario names follow the
// spec scenarios.

const test = require("node:test");
const assert = require("node:assert/strict");
const flowLib = require("../app/js/auth.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
const inSeconds = (s) => Math.floor(Date.now() / 1000) + s;

const parentRecord = { id: "par1", collectionName: "parents", member: "mem1" };
const deviceRecord = { id: "dev1", collectionName: "devices" };
const parentToken = () => jwt({ id: "par1", type: "auth", refreshable: true, exp: inSeconds(3600) });
const pinToken = (left = 900) => jwt({ id: "par1", type: "auth", refreshable: false, exp: inSeconds(left) });
const deviceToken = () => jwt({ id: "dev1", type: "auth", refreshable: true, exp: inSeconds(3600) });

/** An in-memory session and device store, and a fake fetch driven by a route table: "METHOD path" -> handler. */
function harness(routes, { session: initial = null, device: initialDevice = null } = {}) {
  let session = initial;
  let device = initialDevice;
  const log = [];
  const store = {
    session: {
      get: () => session,
      set: async (token, record) => {
        session = { token, record };
      },
      clear: async () => {
        session = null;
      },
    },
    deviceStore: {
      get: () => device,
      set: (v) => {
        device = v;
      },
      clear: () => {
        device = null;
      },
    },
  };
  const fetchImpl = async (path, init) => {
    const key = `${init.method} ${path}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push({ key, body, token: init.headers.authorization });
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    const out = await handler(body, init.headers.authorization);
    if (out === "network") throw new TypeError("fetch failed");
    return { ok: out.status < 400, status: out.status, text: async () => JSON.stringify(out.data ?? null) };
  };
  const flow = flowLib.createAuthFlow({ ...store, fetchImpl });
  return { flow, log, session: () => session, device: () => device };
}

const ok = (data) => ({ status: 200, data });

test("kindOf tells device, parent and short PIN session apart from the token", () => {
  assert.equal(flowLib.kindOf(null), null);
  assert.equal(flowLib.kindOf({ token: deviceToken(), record: deviceRecord }), "device");
  assert.equal(flowLib.kindOf({ token: parentToken(), record: parentRecord }), "parent");
  assert.equal(flowLib.kindOf({ token: pinToken(), record: parentRecord }), "pin");
  assert.equal(flowLib.kindOf({ token: "garbage", record: parentRecord }), "parent");
});

test("PIN session expiry: seconds left reach zero after the 15 minutes", () => {
  const s = { token: pinToken(900), record: parentRecord };
  assert.ok(flowLib.pinSecondsLeft(s) <= 900 && flowLib.pinSecondsLeft(s) > 890);
  assert.equal(flowLib.pinSecondsLeft(s, Date.now() + 901_000), 0);
  assert.equal(flowLib.pinSecondsLeft({ token: "garbage" }), 0);
});

test("Unenrolled device: only the sign-in screens are reachable without a session", () => {
  for (const h of ["", "#/", "#/wer", "#/kind/abc", "#/ich/abc", "#/liste"])
    assert.equal(flowLib.guard(h, null), "#/anmelden", h);
  for (const h of ["#/anmelden", "#/setup", "#/einladung/tok"]) assert.equal(flowLib.guard(h, null), null, h);
});

test("Enrolled iPad starts at Wer bist du?; signed-in users skip the sign-in screens", () => {
  assert.equal(flowLib.guard("", "device"), "#/wer");
  assert.equal(flowLib.guard("#/", "pin"), "#/wer");
  assert.equal(flowLib.guard("", "parent"), null);
  assert.equal(flowLib.guard("#/anmelden", "parent"), "#/wer");
  assert.equal(flowLib.guard("#/setup", "device"), "#/wer");
  assert.equal(flowLib.guard("#/wer", "device"), null);
});

test("the device secret is 32 random bytes as hex and differs on every call", () => {
  const a = flowLib.newDeviceSecret();
  const b = flowLib.newDeviceSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("Parent signs in on a new phone: the session is stored", async () => {
  const token = parentToken();
  const h = harness({
    "POST /api/collections/parents/auth-with-password": (body) => {
      assert.deepEqual(body, { identity: "test-papa@example.test", password: "test-password-123" });
      return ok({ token, record: parentRecord });
    },
  });
  const res = await h.flow.signInParent(" test-papa@example.test ", "test-password-123");
  assert.equal(res.ok, true);
  assert.equal(h.session().token, token);
  assert.equal(h.flow.kind(), "parent");
});

test("Parent sign-in: wrong password, rate limit and offline give distinct, German messages", async () => {
  const status = { v: 400 };
  const h = harness({
    "POST /api/collections/parents/auth-with-password": () =>
      status.v === 0 ? "network" : { status: status.v, data: { message: "Zu viele Versuche." } },
  });
  let r = await h.flow.signInParent("a@example.test", "pw");
  assert.deepEqual([r.ok, r.error], [false, "credentials"]);
  assert.match(r.message, /E-Mail oder Passwort/);
  status.v = 429;
  r = await h.flow.signInParent("a@example.test", "pw");
  assert.deepEqual([r.ok, r.error, r.message], [false, "limited", "Zu viele Versuche."]);
  status.v = 0;
  r = await h.flow.signInParent("a@example.test", "pw");
  assert.deepEqual([r.ok, r.error], [false, "network"]);
  assert.equal(h.session(), null);
});

test("First-run setup without the token: the server refusal is shown and nothing is stored", async () => {
  const h = harness({
    "POST /api/hh/setup": () => ({ status: 403, data: { message: "Der Einrichtungs-Code stimmt nicht." } }),
  });
  const r = await h.flow.setup({
    token: "",
    name: "Test-Papa",
    email: "a@example.test",
    password: "x".repeat(12),
  });
  assert.deepEqual([r.ok, r.error, r.message], [false, "rejected", "Der Einrichtungs-Code stimmt nicht."]);
  assert.equal(h.session(), null);
});

test("First-run setup with the token and invite acceptance sign the new parent in", async () => {
  const h = harness({
    "POST /api/hh/setup": () => ok({ token: parentToken(), record: parentRecord }),
    "POST /api/hh/invite/accept": (body) => {
      assert.equal(body.token, "invite-token");
      return ok({ token: parentToken(), record: { ...parentRecord, id: "par2" } });
    },
  });
  assert.equal(
    (await h.flow.setup({ token: "t", name: "n", email: "e@example.test", password: "p" })).ok,
    true,
  );
  assert.equal(h.session().record.id, "par1");
  assert.equal(
    (await h.flow.acceptInvite({ token: "invite-token", name: "n", email: "e2@example.test", password: "p" }))
      .ok,
    true,
  );
  assert.equal(h.session().record.id, "par2");
});

test("Enrolling the kids' iPad: secret generated on the device, sent once, never returned; device session replaces the parent's", async () => {
  let sentSecret = "";
  const dev = deviceToken();
  const h = harness(
    {
      "POST /api/hh/devices/enroll": (body, auth) => {
        assert.equal(auth, parentToken_);
        assert.equal(body.name, "Kinder-iPad");
        assert.match(body.secret, /^[0-9a-f]{64}$/);
        sentSecret = body.secret;
        return ok({ id: "dev1", email: "device-abc@devices.invalid", name: "Kinder-iPad" });
      },
      "POST /api/collections/devices/auth-with-password": (body) => {
        assert.equal(body.identity, "device-abc@devices.invalid");
        assert.equal(body.password, sentSecret);
        return ok({ token: dev, record: deviceRecord });
      },
    },
    { session: { token: (parentToken_ = parentToken()), record: parentRecord } },
  );
  const r = await h.flow.enrollDevice("Kinder-iPad");
  assert.equal(r.ok, true);
  assert.equal(h.flow.kind(), "device", "Wer bist du? from then on, the parent's session is gone");
  assert.equal(h.device().secret, sentSecret);
  assert.equal(JSON.stringify(r).includes(sentSecret), false, "the secret is never handed to a screen");
});
let parentToken_;

test("Enrolling needs a signed-in parent (not a device, not a PIN session)", async () => {
  for (const session of [
    null,
    { token: deviceToken(), record: deviceRecord },
    { token: pinToken(), record: parentRecord },
  ]) {
    const h = harness({}, { session });
    const r = await h.flow.enrollDevice("Kinder-iPad");
    assert.deepEqual([r.ok, r.error], [false, "forbidden"]);
    assert.equal(h.log.length, 0, "no request is made");
  }
});

test("Kid tries the parent view: the PIN is checked by the server and yields the short parent session", async () => {
  const pin = pinToken();
  const h = harness(
    {
      "POST /api/hh/pin": (body, auth) => {
        assert.equal(auth, dToken);
        assert.deepEqual(body, { member: "mem1", pin: "246810" });
        return ok({ token: pin, record: parentRecord });
      },
    },
    { session: { token: (dToken = deviceToken()), record: deviceRecord } },
  );
  assert.equal((await h.flow.unlockParent("mem1", "246810")).ok, true);
  assert.equal(h.flow.kind(), "pin");
});
let dToken;

test("PIN prompt: malformed PIN is not sent; wrong PIN and rate limit are told apart", async () => {
  const answer = { v: { status: 401, data: { message: "Falsche PIN." } } };
  const h = harness(
    { "POST /api/hh/pin": () => answer.v },
    { session: { token: deviceToken(), record: deviceRecord } },
  );
  assert.equal((await h.flow.unlockParent("mem1", "12345")).ok, false);
  assert.equal(h.log.length, 0);
  assert.equal((await h.flow.unlockParent("mem1", "123456")).error, "wrong-pin");
  answer.v = { status: 429, data: { message: "Zu viele Versuche." } };
  assert.equal((await h.flow.unlockParent("mem1", "123456")).error, "limited");
  assert.equal(h.flow.kind(), "device");
});

test("The PIN prompt is only for family devices", async () => {
  const h = harness({}, { session: { token: parentToken(), record: parentRecord } });
  assert.equal((await h.flow.unlockParent("mem1", "246810")).error, "forbidden");
});

test("PIN session expiry: launch with an expired PIN session returns to the device session", async () => {
  const dev = deviceToken();
  const h = harness(
    {
      "POST /api/collections/devices/auth-with-password": () => ok({ token: dev, record: deviceRecord }),
    },
    {
      session: { token: pinToken(-5), record: parentRecord },
      device: { email: "device-abc@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.deepEqual(await h.flow.launch(), { state: "device" });
  assert.equal(h.session().token, dev);
});

test("PIN session still valid at launch stays (no refresh is attempted)", async () => {
  const h = harness({}, { session: { token: pinToken(300), record: parentRecord } });
  assert.deepEqual(await h.flow.launch(), { state: "pin" });
  assert.equal(h.log.length, 0);
});

test("Replaced iPad: a removed device lands on the sign-in screen at launch and forgets its secret", async () => {
  const h = harness(
    {
      "POST /api/collections/devices/auth-refresh": () => ({
        status: 401,
        data: { message: "The request requires valid record authorization token." },
      }),
      "POST /api/collections/devices/auth-with-password": () => ({
        status: 400,
        data: { message: "Failed to authenticate." },
      }),
    },
    {
      session: { token: deviceToken(), record: deviceRecord },
      device: { email: "device-abc@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.deepEqual(await h.flow.launch(), { state: "signed-out" });
  assert.equal(h.session(), null);
  assert.equal(h.device(), null);
  assert.equal(flowLib.guard("#/wer", h.flow.kind()), "#/anmelden");
});

test("Device whose token merely expired signs in again with its secret", async () => {
  const fresh = deviceToken();
  const h = harness(
    {
      "POST /api/collections/devices/auth-refresh": () => ({ status: 401, data: null }),
      "POST /api/collections/devices/auth-with-password": () => ok({ token: fresh, record: deviceRecord }),
    },
    {
      session: { token: deviceToken(), record: deviceRecord },
      device: { email: "device-abc@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.deepEqual(await h.flow.launch(), { state: "device" });
  assert.equal(h.session().token, fresh);
});

test("Revoking a lost phone: a revoked parent session is dropped at launch; on a family device the device takes over", async () => {
  const noDevice = harness(
    { "POST /api/collections/parents/auth-refresh": () => ({ status: 401, data: null }) },
    { session: { token: parentToken(), record: parentRecord } },
  );
  assert.deepEqual(await noDevice.flow.launch(), { state: "signed-out" });
  assert.equal(noDevice.session(), null);

  const dev = deviceToken();
  const withDevice = harness(
    {
      "POST /api/collections/parents/auth-refresh": () => ({ status: 401, data: null }),
      "POST /api/collections/devices/auth-with-password": () => ok({ token: dev, record: deviceRecord }),
    },
    {
      session: { token: parentToken(), record: parentRecord },
      device: { email: "device-abc@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.deepEqual(await withDevice.flow.launch(), { state: "device" });
});

test("Launch refreshes a valid session and keeps working offline", async () => {
  const refreshed = parentToken();
  const h = harness(
    { "POST /api/collections/parents/auth-refresh": () => ok({ token: refreshed, record: parentRecord }) },
    { session: { token: parentToken(), record: parentRecord } },
  );
  assert.deepEqual(await h.flow.launch(), { state: "parent" });
  assert.equal(h.session().token, refreshed);

  const offline = harness(
    { "POST /api/collections/devices/auth-refresh": () => "network" },
    {
      session: { token: deviceToken(), record: deviceRecord },
      device: { email: "d@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.deepEqual(await offline.flow.launch(), { state: "offline" });
  assert.equal(offline.flow.kind(), "device", "the session is kept");
});

test("Sign-out: a parent on a family device falls back to the device; elsewhere to the sign-in screen; devices stay", async () => {
  const dev = deviceToken();
  const withDevice = harness(
    { "POST /api/collections/devices/auth-with-password": () => ok({ token: dev, record: deviceRecord }) },
    {
      session: { token: parentToken(), record: parentRecord },
      device: { email: "d@devices.invalid", secret: "s".repeat(64) },
    },
  );
  assert.equal((await withDevice.flow.signOut()).state, "device");
  assert.equal(withDevice.flow.kind(), "device");
  assert.equal((await withDevice.flow.signOut()).state, "device", "a device cannot sign itself out");

  const plain = harness({}, { session: { token: parentToken(), record: parentRecord } });
  assert.equal((await plain.flow.signOut()).state, "signed-out");
  assert.equal(plain.session(), null);
});

test("No session and no device: only the sign-in screen", async () => {
  const h = harness({});
  assert.deepEqual(await h.flow.launch(), { state: "signed-out" });
  assert.equal(h.log.length, 0);
});
