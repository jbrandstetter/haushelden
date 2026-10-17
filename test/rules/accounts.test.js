// Governing: ADR-0001, ADR-0003, SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Device
// Enrollment and Removal", REQ "Kid Access on Enrolled Devices", Security Requirements "Rate Limiting"
//
// Runs the /api/hh/ account routes against a real throwaway PocketBase: setup (with and without the token, after
// the first parent, with the placeholder), invites (single use, expiry, hashed at rest), device enrollment and
// removal, the parent PIN (session length, rate limit) and sign-in rate limits. Fake names and secrets only.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startPocketBase } = require("./pocketbase.js");
const { nodeSecurity } = require("../../scripts/seed/accounts.js");
const { hashPin } = require("../../pb_hooks/lib/pin.js");

const SETUP_TOKEN = "test-setup-token-not-a-placeholder";
const PW = "test-parent-password-1";
const PW2 = "test-parent-password-2";
const PIN = "246810";
const secret = () => crypto.randomBytes(32).toString("hex");
const rec = (c, id = "") => `/api/collections/${c}/records${id ? `/${id}` : ""}`;
const setupBody = (extra = {}) => ({
  token: SETUP_TOKEN,
  name: "Test-Papa",
  email: "test-papa@example.test",
  password: PW,
  ...extra,
});
const count = async (pb, c) =>
  (await pb.api("GET", `${rec(c)}?perPage=1`, { token: pb.superToken })).data.totalItems;

describe("first-run setup", () => {
  let pb;
  before(async () => {
    pb = await startPocketBase({ env: { HH_SETUP_TOKEN: SETUP_TOKEN } });
  });
  after(() => pb.stop());

  it("refuses without the token and creates nothing", async () => {
    const res = await pb.api("POST", "/api/hh/setup", { body: setupBody({ token: undefined }) });
    assert.equal(res.status, 403);
    assert.equal(await count(pb, "parents"), 0);
    assert.equal(await count(pb, "members"), 0);
  });

  it("refuses a wrong token, short passwords and bad e-mails", async () => {
    assert.equal(
      (await pb.api("POST", "/api/hh/setup", { body: setupBody({ token: "wrong" }) })).status,
      403,
    );
    assert.equal(
      (await pb.api("POST", "/api/hh/setup", { body: setupBody({ password: "short" }) })).status,
      400,
    );
    assert.equal((await pb.api("POST", "/api/hh/setup", { body: setupBody({ email: "nope" }) })).status, 400);
    assert.equal(await count(pb, "parents"), 0);
  });

  it("creates the first parent with the token, then refuses the same token for ever", async () => {
    const ok = await pb.api("POST", "/api/hh/setup", { body: setupBody() });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.ok(ok.data.token);
    assert.equal(ok.data.record.collectionName, "parents");
    assert.equal(await count(pb, "parents"), 1);
    const members = (await pb.api("GET", rec("members"), { token: pb.superToken })).data.items;
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "parent");
    assert.equal(members[0].name, "Test-Papa");
    // The new session works, and so does a normal sign-in.
    assert.equal((await pb.api("GET", rec("members"), { token: ok.data.token })).status, 200);
    await pb.signIn("parents", "test-papa@example.test", PW);

    const again = await pb.api("POST", "/api/hh/setup", {
      body: setupBody({ email: "test-mama@example.test", name: "Test-Mama" }),
    });
    assert.equal(again.status, 403);
    assert.equal(await count(pb, "parents"), 1);
  });
});

describe("first-run setup: unusable configuration", () => {
  it("rejects the change-me placeholder token even when the caller sends it", async () => {
    const pb = await startPocketBase({ env: { HH_SETUP_TOKEN: "change-me" } });
    try {
      const res = await pb.api("POST", "/api/hh/setup", { body: setupBody({ token: "change-me" }) });
      assert.equal(res.status, 403);
      assert.equal(await count(pb, "parents"), 0);
    } finally {
      await pb.stop();
    }
  });

  it("rejects setup when no token is configured at all", async () => {
    const pb = await startPocketBase();
    try {
      for (const token of ["", "anything", undefined]) {
        const res = await pb.api("POST", "/api/hh/setup", { body: setupBody({ token }) });
        assert.equal(res.status, 403);
      }
      assert.equal(await count(pb, "parents"), 0);
    } finally {
      await pb.stop();
    }
  });
});

describe("rate limits", () => {
  it("stops setup after 5 wrong tokens, even for the right one", async () => {
    const pb = await startPocketBase({ env: { HH_SETUP_TOKEN: SETUP_TOKEN } });
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal(
          (await pb.api("POST", "/api/hh/setup", { body: setupBody({ token: `bad-${i}` }) })).status,
          403,
        );
      }
      assert.equal((await pb.api("POST", "/api/hh/setup", { body: setupBody() })).status, 429);
      assert.equal(await count(pb, "parents"), 0);
    } finally {
      await pb.stop();
    }
  });

  it("stops parent and device sign-in after 5 failures per account", async () => {
    const pb = await startPocketBase({ env: { HH_SETUP_TOKEN: SETUP_TOKEN } });
    try {
      await pb.api("POST", "/api/hh/setup", { body: setupBody() });
      const signIn = (identity, password) =>
        pb.api("POST", "/api/collections/parents/auth-with-password", { body: { identity, password } });
      for (let i = 0; i < 5; i++)
        assert.equal((await signIn("test-papa@example.test", "wrong-password-x")).status, 400);
      assert.equal((await signIn("test-papa@example.test", PW)).status, 429, "right password is refused too");
      // Another account is not affected.
      assert.notEqual((await signIn("test-other@example.test", PW)).status, 429);
    } finally {
      await pb.stop();
    }
  });
});

describe("accounts: invites, devices, PIN", () => {
  let pb;
  let papa; // token
  let papaMember;
  let papaId;
  let device; // { token, id, email, secret }

  before(async () => {
    pb = await startPocketBase({
      env: { HH_SETUP_TOKEN: SETUP_TOKEN, HH_PUBLIC_URL: "http://example.test" },
    });
    const res = await pb.api("POST", "/api/hh/setup", { body: setupBody() });
    papa = res.data.token;
    papaId = res.data.record.id;
    papaMember = res.data.record.member;
  });
  after(() => pb.stop());

  async function enroll(name = "Test-Tablet", token = papa) {
    const s = secret();
    const res = await pb.api("POST", "/api/hh/devices/enroll", { token, body: { name, secret: s } });
    return { res, secret: s };
  }
  async function deviceSignIn(email, s) {
    return pb.api("POST", "/api/collections/devices/auth-with-password", {
      body: { identity: email, password: s },
    });
  }

  describe("invites", () => {
    let invite;
    it("needs a signed-in parent to create one", async () => {
      assert.equal((await pb.api("POST", "/api/hh/invite", { body: {} })).status, 401);
    });

    it("creates a link; only its hash is stored; it expires after 48 hours", async () => {
      const res = await pb.api("POST", "/api/hh/invite", { token: papa, body: {} });
      assert.equal(res.status, 200);
      invite = res.data;
      assert.match(invite.link, /^http:\/\/example\.test\/#\/einladung\/.{20,}$/);
      const stored = (await pb.api("GET", rec("invites"), { token: pb.superToken })).data.items.at(-1);
      assert.notEqual(stored.token_hash, invite.token);
      assert.equal(stored.token_hash, crypto.createHash("sha256").update(invite.token).digest("hex"));
      const hours = (Date.parse(stored.expires.replace(" ", "T")) - Date.now()) / 36e5;
      assert.ok(hours > 47.9 && hours <= 48, `expiry in ${hours}h`);
      // No client, parent included, can read the invites.
      assert.ok([403, 200].includes((await pb.api("GET", rec("invites"), { token: papa })).status));
      assert.equal((await pb.api("GET", rec("invites"), { token: papa })).data?.totalItems ?? 0, 0);
    });

    it("accepts once, creates the second parent, and refuses reuse", async () => {
      const body = { token: invite.token, name: "Test-Mama", email: "test-mama@example.test", password: PW2 };
      const ok = await pb.api("POST", "/api/hh/invite/accept", { body });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(await count(pb, "parents"), 2);
      await pb.signIn("parents", "test-mama@example.test", PW2);
      const again = await pb.api("POST", "/api/hh/invite/accept", {
        body: { ...body, email: "test-other@example.test" },
      });
      assert.equal(again.status, 400);
      assert.equal(await count(pb, "parents"), 2);
    });

    it("refuses an expired invite and an invented token", async () => {
      const fresh = (await pb.api("POST", "/api/hh/invite", { token: papa, body: {} })).data;
      const row = (await pb.api("GET", rec("invites"), { token: pb.superToken })).data.items.find(
        (r) => r.token_hash === crypto.createHash("sha256").update(fresh.token).digest("hex"),
      );
      await pb.api("PATCH", rec("invites", row.id), {
        token: pb.superToken,
        body: { expires: new Date(Date.now() - 1000).toISOString().replace("T", " ") },
      });
      const acc = { name: "Test-Oma", email: "test-oma@example.test", password: PW2 };
      assert.equal(
        (await pb.api("POST", "/api/hh/invite/accept", { body: { ...acc, token: fresh.token } })).status,
        400,
      );
      assert.equal(
        (await pb.api("POST", "/api/hh/invite/accept", { body: { ...acc, token: "x".repeat(40) } })).status,
        400,
      );
      assert.equal(await count(pb, "parents"), 2);
    });

    it("limits invalid invite attempts per client address", async () => {
      const acc = { name: "Test-Oma", email: "test-oma@example.test", password: PW2 };
      let last = 0;
      for (let i = 0; i < 8; i++) {
        last = (await pb.api("POST", "/api/hh/invite/accept", { body: { ...acc, token: `${i}`.repeat(40) } }))
          .status;
      }
      assert.equal(last, 429);
    });
  });

  describe("device enrollment and removal", () => {
    it("needs a parent: anonymous and short secrets are refused", async () => {
      const anon = await enroll("Test-Tablet", null);
      assert.ok(anon.res.status === 401 || anon.res.status === 403);
      const short = await pb.api("POST", "/api/hh/devices/enroll", {
        token: papa,
        body: { name: "x", secret: "short" },
      });
      assert.equal(short.status, 400);
      assert.equal(await count(pb, "devices"), 0);
    });

    it("enrolls a device that signs in with its secret and sees the household, not the parent data", async () => {
      const { res, secret: s } = await enroll("Kinder-iPad");
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(JSON.stringify(res.data).includes(s), false, "the secret is never returned");
      const signed = await deviceSignIn(res.data.email, s);
      assert.equal(signed.status, 200);
      device = { token: signed.data.token, id: res.data.id, email: res.data.email, secret: s };
      assert.equal((await pb.api("GET", rec("members"), { token: device.token })).status, 200);
      const parents = await pb.api("GET", rec("parents"), { token: device.token });
      assert.ok(parents.status >= 400 || parents.data.totalItems === 0, "device must not read parents");
      const todos = await pb.api("GET", rec("todos"), { token: device.token });
      assert.ok(todos.status === 404 || todos.status === 403 || todos.data.totalItems === 0);
      // A device cannot create invites, enroll devices or set PINs.
      assert.ok((await pb.api("POST", "/api/hh/invite", { token: device.token, body: {} })).status >= 400);
      assert.ok((await enroll("Zweites", device.token)).res.status >= 400);
      // last use is recorded
      const row = (await pb.api("GET", rec("devices", device.id), { token: papa })).data;
      assert.equal(row.name, "Kinder-iPad");
      assert.ok(row.last_seen, "last_seen is set on sign-in");
    });

    it("refreshes its token on launch, even after the parent's session ends", async () => {
      await pb.api("POST", "/api/hh/sessions/revoke", { token: papa, body: {} });
      const refreshed = await pb.api("POST", "/api/collections/devices/auth-refresh", {
        token: device.token,
      });
      assert.equal(refreshed.status, 200);
      device.token = refreshed.data.token;
      papa = await pb.signIn("parents", "test-papa@example.test", PW);
    });

    it("lists devices for parents and treats a removed device as signed out", async () => {
      const list = await pb.api("GET", rec("devices"), { token: papa });
      assert.ok(list.data.items.some((d) => d.name === "Kinder-iPad"));
      assert.equal(
        (await pb.api("DELETE", rec("devices", device.id), { token: device.token })).status >= 400,
        true,
      );
      assert.equal((await pb.api("DELETE", rec("devices", device.id), { token: papa })).status, 204);
      // Old token: refresh fails, and the household is not readable (guest).
      assert.ok(
        (await pb.api("POST", "/api/collections/devices/auth-refresh", { token: device.token })).status >=
          400,
      );
      const members = await pb.api("GET", rec("members"), { token: device.token });
      assert.ok(members.status >= 400 || members.data.totalItems === 0);
      // The secret does not sign in any more either.
      assert.equal((await deviceSignIn(device.email, device.secret)).status, 400);
    });
  });

  describe("parent session refresh", () => {
    it("renews a password session on launch (a 500 here logged everybody out)", async () => {
      const res = await pb.api("POST", "/api/collections/parents/auth-refresh", { token: papa });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.ok(res.data.token);
      assert.equal(res.data.record.id, papaId);
    });
  });

  describe("parent PIN", () => {
    let dev;
    before(async () => {
      const { res, secret: s } = await enroll("PIN-iPad");
      dev = (await deviceSignIn(res.data.email, s)).data.token;
    });
    const pinReq = (token, body) => pb.api("POST", "/api/hh/pin", { token, body });

    it("is set by the parent with the password and never readable", async () => {
      assert.equal(
        (
          await pb.api("PUT", "/api/hh/pin", {
            token: papa,
            body: { pin: PIN, password: "wrong-password-xyz" },
          })
        ).status,
        401,
      );
      assert.equal(
        (await pb.api("PUT", "/api/hh/pin", { token: papa, body: { pin: "12ab56", password: PW } })).status,
        400,
      );
      assert.equal(
        (await pb.api("PUT", "/api/hh/pin", { token: papa, body: { pin: PIN, password: PW } })).status,
        200,
      );
      const member = (await pb.api("GET", rec("members", papaMember), { token: papa })).data;
      assert.equal("pin_hash" in member, false);
      const stored = (await pb.api("GET", rec("members", papaMember), { token: pb.superToken })).data;
      assert.equal(JSON.stringify(stored).includes(PIN), false);
      // Hash format matches the seed's helper (same module), so a seeded PIN verifies on the server.
      assert.match(hashPin(nodeSecurity, PIN), /^v1\$[0-9a-f]{16}\$[0-9a-f]{64}$/);
    });

    it("needs a device; a parent session cannot use the route", async () => {
      assert.ok((await pinReq(papa, { member: papaMember, pin: PIN })).status >= 400);
      assert.ok((await pinReq(undefined, { member: papaMember, pin: PIN })).status >= 400);
    });

    it("gives the device a parent session of at most 15 minutes that cannot be refreshed or elevated", async () => {
      const res = await pinReq(dev, { member: papaMember, pin: PIN });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const claims = JSON.parse(Buffer.from(res.data.token.split(".")[1], "base64url"));
      assert.ok(claims.exp - Date.now() / 1000 <= 15 * 60 + 5, "at most 15 minutes");
      assert.equal(claims.refreshable, false);
      assert.equal(claims.id, papaId);
      assert.equal((await pb.api("GET", rec("parents"), { token: res.data.token })).status, 200);
      assert.equal(
        (await pb.api("POST", "/api/collections/parents/auth-refresh", { token: res.data.token })).status,
        403,
      );
      assert.equal((await enroll("Dritt", res.data.token)).res.status, 403);
      assert.equal(
        (await pb.api("PUT", "/api/hh/pin", { token: res.data.token, body: { pin: "111111", password: PW } }))
          .status,
        403,
      );
      // Revoking the parent's sessions ends this short session as well.
      await pb.api("POST", "/api/hh/sessions/revoke", { token: papa, body: {} });
      assert.equal((await pb.api("GET", "/api/hh/config", { token: res.data.token })).status, 401);
      papa = await pb.signIn("parents", "test-papa@example.test", PW);
    });

    it("refuses wrong PINs, unknown members and kids; then rate-limits after 5 failures", async () => {
      const kid = (
        await pb.api("POST", rec("members"), {
          token: papa,
          body: { role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" },
        })
      ).data;
      assert.equal((await pinReq(dev, { member: kid.id, pin: PIN })).status, 401);
      assert.equal((await pinReq(dev, { member: "nope", pin: PIN })).status, 401);
      assert.equal((await pinReq(dev, { member: papaMember, pin: "12345" })).status, 401);
      for (let i = 0; i < 4; i++)
        assert.equal((await pinReq(dev, { member: papaMember, pin: "000000" })).status, 401);
      assert.equal(
        (await pinReq(dev, { member: papaMember, pin: PIN })).status,
        429,
        "right PIN refused while limited",
      );
    });
  });

  describe("seeded PIN", () => {
    it("a PIN hashed by the seed helper verifies on the server (same hash format and algorithm)", async () => {
      const members = (await pb.api("GET", rec("members"), { token: pb.superToken })).data.items;
      const mama = members.find((m) => m.name === "Test-Mama");
      await pb.api("PATCH", rec("members", mama.id), {
        token: pb.superToken,
        body: { pin_hash: hashPin(nodeSecurity, "135790") },
      });
      const { res, secret: s } = await enroll("Seed-iPad");
      const devToken = (await deviceSignIn(res.data.email, s)).data.token;
      const ok = await pb.api("POST", "/api/hh/pin", {
        token: devToken,
        body: { member: mama.id, pin: "135790" },
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.record.member, mama.id);
      const bad = await pb.api("POST", "/api/hh/pin", {
        token: devToken,
        body: { member: mama.id, pin: "135791" },
      });
      assert.equal(bad.status, 401);
    });
  });

  describe("revoking sessions", () => {
    it("rejects every later request from the revoked account's tokens", async () => {
      const mama = await pb.signIn("parents", "test-mama@example.test", PW2);
      const mamaId = (await pb.api("GET", rec("parents"), { token: papa })).data.items.find(
        (p) => p.id !== papaId,
      ).id;
      assert.equal((await pb.api("GET", rec("members"), { token: mama })).status, 200);
      assert.equal(
        (await pb.api("POST", "/api/hh/sessions/revoke", { token: papa, body: { parent: mamaId } })).status,
        200,
      );
      assert.equal((await pb.api("GET", "/api/hh/config", { token: mama })).status, 401);
      assert.equal(
        (await pb.api("GET", rec("members"), { token: mama })).data.totalItems,
        0,
        "treated as a guest",
      );
      assert.ok(
        (await pb.api("POST", "/api/collections/parents/auth-refresh", { token: mama })).status >= 400,
      );
      // Papa's own token is untouched.
      assert.equal((await pb.api("GET", "/api/hh/config", { token: papa })).status, 200);
    });
  });
});
