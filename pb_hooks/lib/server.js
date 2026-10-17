/* global Record, DateTime, BadRequestError, $app, $security */
// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003, SPEC-0001 REQ "First-Run Setup",
// REQ "Device Enrollment and Removal"
//
// PocketBase-side helpers for pb_hooks/accounts.pb.js. Lives in a module because a PocketBase handler cannot see
// the top-level functions of its own hook file. Everything else (validation, PIN hashing, limiter) is in the
// pure modules next to it.

const accounts = require("./accounts.js");
const { createLimiter } = require("./ratelimit.js");
const pins = require("./pin.js");

const limiter = () => createLimiter($app.store());

/** Creates a parent member and its account; call inside a transaction. */
function createParentAccount(txApp, { name, email, password, emoji, colour }) {
  const member = new Record(txApp.findCollectionByNameOrId("members"));
  member.set("role", "parent");
  member.set("name", String(name).trim());
  member.set("emoji", emoji);
  member.set("colour", colour);
  txApp.save(member);
  const account = new Record(txApp.findCollectionByNameOrId("parents"));
  account.set("email", String(email).trim());
  account.setPassword(password);
  account.set("emailVisibility", true);
  account.set("member", member.id);
  txApp.save(account);
  return account;
}

/** One generic 400 for any failure while creating an account (duplicate e-mail, ...); the cause is only logged. */
function failedCreate(err) {
  $app.logger().warn("account creation failed", "reason", String(err));
  return new BadRequestError(
    "Das Konto konnte nicht angelegt werden. Ist die E-Mail-Adresse schon vergeben?",
  );
}

/** Stamps a device's last use (shown in the device list). A failure here never blocks the sign-in. */
function stampDevice(record) {
  try {
    record.set("last_seen", new DateTime());
    $app.save(record);
  } catch (err) {
    $app.logger().warn("device last_seen not updated", "device", record.id, "reason", String(err));
  }
}

/** True when the request carries a short PIN session (a non-refreshable token) instead of a password session. */
function isPinSession(e) {
  const header = (e.requestInfo().headers || {})["authorization"] || "";
  try {
    return $security.parseUnverifiedJWT(header.replace(/^Bearer\s+/i, "")).refreshable === false;
  } catch {
    return false;
  }
}

module.exports = {
  ...accounts,
  pins,
  limiter,
  createParentAccount,
  failedCreate,
  stampDevice,
  isPinSession,
};
