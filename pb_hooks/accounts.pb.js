/* global TooManyRequestsError, BadRequestError, ForbiddenError, UnauthorizedError, DateTime,
   onRecordAuthWithPasswordRequest, onRecordAuthRefreshRequest */
// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Device Enrollment and Removal",
// REQ "Kid Access on Enrolled Devices", Security Requirements "Rate Limiting", "Request Body Size Limits"
//
// Custom routes under /api/hh/ (design "Custom routes"): setup, invite, invite/accept, devices/enroll, pin
// (verify) and PUT pin (set the own PIN), sessions/revoke; plus the sign-in failure limiter and the device
// last-use stamp. Handlers load their helpers with require() inside the handler (PocketBase runs each handler
// in its own JS scope).

const BODY_LIMIT = 64 * 1024; // SPEC-0001 "Request Body Size Limits": 64 KB default

// ---- sign-in failure limiter (parents and devices) ----------------------------------------------------
// 5 failed password sign-ins per account per 15 minutes. Unknown identities count against the client address
// so an attacker cannot grow the table with made-up accounts.
onRecordAuthWithPasswordRequest(
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const rl = hh.limiter();
    const id = e.record ? e.record.id : `ip-${e.realIP()}`;
    if (rl.blocked("signin", id)) throw new TooManyRequestsError(hh.TOO_MANY);
    try {
      e.next();
    } catch (err) {
      rl.fail("signin", id);
      throw err;
    }
    rl.clear("signin", id);
    if (e.record && e.collection.name === "devices") hh.stampDevice(e.record);
  },
  "parents",
  "devices",
);

// Parents' last-use is not tracked; a device's last use is what the device list shows (SPEC-0001 REQ
// "Device Enrollment and Removal").
onRecordAuthRefreshRequest((e) => {
  const hh = require(`${__hooks}/lib/server.js`);
  e.next();
  if (e.record) hh.stampDevice(e.record);
}, "devices");

// A PIN session ends after its 15 minutes: PocketBase would otherwise swap it for a regular 30-day token.
onRecordAuthRefreshRequest((e) => {
  const hh = require(`${__hooks}/lib/server.js`);
  if (hh.isPinSession(e)) throw new ForbiddenError("Die kurze PIN-Anmeldung lässt sich nicht verlängern.");
  e.next();
}, "parents");

// ---- POST /api/hh/setup ----------------------------------------------------------------------------------
// Public, but needs the one-time HH_SETUP_TOKEN, and works only while no parent exists.
routerAdd(
  "POST",
  "/api/hh/setup",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const rl = hh.limiter();
    const ip = e.realIP();
    if (rl.blocked("setup", ip)) throw new TooManyRequestsError(hh.TOO_MANY);

    const b = e.requestInfo().body || {};
    const problem = hh.validateAccount(b);
    if (problem) throw new BadRequestError(problem);

    // Order matters: once a parent exists the route says so without looking at the token at all.
    if ($app.countRecords("parents") > 0)
      throw new ForbiddenError("Die Einrichtung ist bereits abgeschlossen.");

    const expected = $os.getenv("HH_SETUP_TOKEN");
    if (!hh.setupTokenConfigured(expected)) {
      $app.logger().warn("setup refused: HH_SETUP_TOKEN is missing or still a placeholder");
      throw new ForbiddenError("Die Einrichtung ist auf diesem Server nicht freigeschaltet.");
    }
    const given = typeof b.token === "string" ? b.token.trim() : "";
    if (!$security.equal(given, expected.trim())) {
      rl.fail("setup", ip);
      throw new ForbiddenError("Der Einrichtungs-Code stimmt nicht.");
    }

    let account;
    try {
      $app.runInTransaction((tx) => {
        // Re-check inside the transaction: two simultaneous setups cannot both succeed.
        if (tx.countRecords("parents") > 0)
          throw new ForbiddenError("Die Einrichtung ist bereits abgeschlossen.");
        account = hh.createParentAccount(tx, { ...b, emoji: "🙂", colour: "blue" });
      });
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      throw hh.failedCreate(err);
    }
    rl.clear("setup", ip);
    return $apis.recordAuthResponse(e, account, "password");
  },
  $apis.bodyLimit(BODY_LIMIT),
);

// ---- POST /api/hh/invite ---------------------------------------------------------------------------------
// A parent creates a single-use invite link for the second parent, valid for 48 hours. The token is shown
// once in the response; only its hash is stored.
routerAdd(
  "POST",
  "/api/hh/invite",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const token = $security.randomString(40);
    const invite = new Record($app.findCollectionByNameOrId("invites"));
    invite.set("token_hash", $security.sha256(token));
    invite.set("created_by", e.auth.id);
    const expires = new Date(Date.now() + hh.INVITE_TTL_MS);
    invite.set("expires", expires.toISOString().replace("T", " "));
    $app.save(invite);
    const base = ($os.getenv("HH_PUBLIC_URL") || "").trim().replace(/\/+$/, "");
    return e.json(200, { token, link: `${base}/#/einladung/${token}`, expires: expires.toISOString() });
  },
  $apis.bodyLimit(BODY_LIMIT),
  $apis.requireAuth("parents"),
);

// ---- POST /api/hh/invite/accept --------------------------------------------------------------------------
// Public, but needs a valid, unused, unexpired invite token. Creates the second parent's member and account.
routerAdd(
  "POST",
  "/api/hh/invite/accept",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const rl = hh.limiter();
    const ip = e.realIP();
    if (rl.blocked("invite", ip)) throw new TooManyRequestsError(hh.TOO_MANY);

    const b = e.requestInfo().body || {};
    const problem = hh.validateAccount(b);
    if (problem) throw new BadRequestError(problem);

    const invalid = () => {
      rl.fail("invite", ip);
      return new BadRequestError("Diese Einladung ist ungültig oder abgelaufen.");
    };
    if (typeof b.token !== "string" || b.token.length < 20 || b.token.length > 100) throw invalid();

    let account;
    try {
      $app.runInTransaction((tx) => {
        let invite;
        try {
          invite = tx.findFirstRecordByData("invites", "token_hash", $security.sha256(b.token));
        } catch {
          throw invalid();
        }
        if (invite.getString("used") !== "") throw invalid();
        if (invite.getDateTime("expires").unix() * 1000 < Date.now()) throw invalid();
        invite.set("used", new DateTime());
        tx.save(invite);
        account = hh.createParentAccount(tx, { ...b, emoji: "🙂", colour: "pink" });
      });
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      throw hh.failedCreate(err);
    }
    rl.clear("invite", ip);
    return $apis.recordAuthResponse(e, account, "password");
  },
  $apis.bodyLimit(BODY_LIMIT),
);

// ---- POST /api/hh/devices/enroll -------------------------------------------------------------------------
// A signed-in parent turns the current device into a family device. The secret (>= 32 random bytes) was
// generated on the device; the server stores it as the device account's password and never returns it.
routerAdd(
  "POST",
  "/api/hh/devices/enroll",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const b = e.requestInfo().body || {};
    const problem = hh.validateDevice(b);
    if (problem) throw new BadRequestError(problem);
    if (hh.isPinSession(e)) throw new ForbiddenError("Dafür ist die Anmeldung mit Passwort nötig.");

    const device = new Record($app.findCollectionByNameOrId("devices"));
    // The e-mail is only the account's login name; the .invalid domain can never receive mail.
    const email = `device-${$security.randomStringWithAlphabet(14, "abcdefghijklmnopqrstuvwxyz0123456789")}@devices.invalid`;
    device.set("email", email);
    device.set("emailVisibility", false);
    device.setPassword(b.secret);
    device.set("name", b.name.trim());
    device.set("enrolled_by", e.auth.id);
    try {
      $app.save(device);
    } catch (err) {
      $app.logger().warn("device enrollment failed", "reason", String(err));
      throw new BadRequestError("Das Gerät konnte nicht eingerichtet werden.");
    }
    return e.json(200, { id: device.id, email, name: device.getString("name") });
  },
  $apis.bodyLimit(BODY_LIMIT),
  $apis.requireAuth("parents"),
);

// ---- POST /api/hh/pin ------------------------------------------------------------------------------------
// A family device sends a parent member's PIN. On success it gets a parent session of at most 15 minutes: a
// regular parents token (so revoking the parent's sessions also kills it) that is short-lived and not
// refreshable.
routerAdd(
  "POST",
  "/api/hh/pin",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const rl = hh.limiter();
    const b = e.requestInfo().body || {};
    if (typeof b.member !== "string" || b.member.length < 1 || b.member.length > 40)
      throw new BadRequestError("Bitte wähle eine Person.");

    let parent;
    let member;
    try {
      member = $app.findRecordById("members", b.member);
      if (member.getString("role") !== "parent") throw new Error("not a parent");
      parent = $app.findFirstRecordByData("parents", "member", member.id);
    } catch {
      throw new UnauthorizedError("Falsche PIN.");
    }
    if (rl.blocked("pin", parent.id)) throw new TooManyRequestsError(hh.TOO_MANY);

    const stored = member.getString("pin_hash");
    if (stored === "") throw new BadRequestError("Für diese Person ist noch keine PIN eingerichtet.");
    if (!hh.pins.verifyPin($security, b.pin, stored)) {
      rl.fail("pin", parent.id);
      throw new UnauthorizedError("Falsche PIN.");
    }
    rl.clear("pin", parent.id);

    const col = parent.collection();
    const token = $security.createJWT(
      { id: parent.id, type: "auth", collectionId: col.id, refreshable: false },
      parent.tokenKey() + col.authToken.secret,
      hh.PIN_SESSION_SECONDS,
    );
    return e.json(200, { token, record: parent, expires_in: hh.PIN_SESSION_SECONDS });
  },
  $apis.bodyLimit(BODY_LIMIT),
  $apis.requireAuth("devices"),
);

// ---- PUT /api/hh/pin -------------------------------------------------------------------------------------
// A parent sets their own 6-digit PIN (the full settings UI is a later story). Needs the password again, so
// neither a short PIN session nor a stolen unlocked phone can change it.
routerAdd(
  "PUT",
  "/api/hh/pin",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const rl = hh.limiter();
    const b = e.requestInfo().body || {};
    if (typeof b.pin !== "string" || !hh.pins.PIN_PATTERN.test(b.pin))
      throw new BadRequestError("Die PIN besteht aus genau 6 Ziffern.");
    if (hh.isPinSession(e)) throw new ForbiddenError("Dafür ist die Anmeldung mit Passwort nötig.");
    if (rl.blocked("pinset", e.auth.id)) throw new TooManyRequestsError(hh.TOO_MANY);
    if (typeof b.password !== "string" || !e.auth.validatePassword(b.password)) {
      rl.fail("pinset", e.auth.id);
      throw new UnauthorizedError("Das Passwort stimmt nicht.");
    }
    rl.clear("pinset", e.auth.id);
    const member = $app.findRecordById("members", e.auth.getString("member"));
    member.set("pin_hash", hh.pins.hashPin($security, b.pin));
    $app.save(member);
    return e.json(200, { ok: true });
  },
  $apis.bodyLimit(BODY_LIMIT),
  $apis.requireAuth("parents"),
);

// ---- POST /api/hh/sessions/revoke ------------------------------------------------------------------------
// Either parent can end every session of a parent account (default: their own), e.g. a lost phone. All tokens
// of that account stop working at once. (The settings screen that lists sessions is a later story.)
routerAdd(
  "POST",
  "/api/hh/sessions/revoke",
  (e) => {
    const b = e.requestInfo().body || {};
    const targetId = typeof b.parent === "string" && b.parent !== "" ? b.parent : e.auth.id;
    let target;
    try {
      target = $app.findRecordById("parents", targetId);
    } catch {
      throw new BadRequestError("Dieses Konto gibt es nicht.");
    }
    target.refreshTokenKey();
    $app.save(target);
    return e.json(200, { ok: true });
  },
  $apis.bodyLimit(BODY_LIMIT),
  $apis.requireAuth("parents"),
);
