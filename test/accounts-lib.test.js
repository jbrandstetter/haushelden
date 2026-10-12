// Governing: SPEC-0001 REQ "First-Run Setup" (placeholder token), REQ "Kid Access on Enrolled Devices" (6-digit PIN),
// Security Requirements "Rate Limiting" (5 failed attempts per 15 minutes)
//
// Unit tests of the pure server-side helpers (validation, PIN hashing, failed-attempt limiter).

const test = require("node:test");
const assert = require("node:assert/strict");
const accounts = require("../pb_hooks/lib/accounts.js");
const { hashPin, verifyPin } = require("../pb_hooks/lib/pin.js");
const { createLimiter, WINDOW_MS } = require("../pb_hooks/lib/ratelimit.js");
const { nodeSecurity } = require("../scripts/seed/accounts.js");

test("setup token counts as configured only when set and not the change-me placeholder", () => {
  assert.equal(accounts.setupTokenConfigured(undefined), false);
  assert.equal(accounts.setupTokenConfigured(""), false);
  assert.equal(accounts.setupTokenConfigured("   "), false);
  assert.equal(accounts.setupTokenConfigured("change-me"), false);
  assert.equal(accounts.setupTokenConfigured("Change-Me-please"), false);
  assert.equal(accounts.setupTokenConfigured("a-real-looking-token"), true);
});

test("account validation: name, e-mail and a password of at least 12 characters", () => {
  const ok = { name: "Test-Papa", email: "test-papa@example.test", password: "x".repeat(12) };
  assert.equal(accounts.validateAccount(ok), "");
  assert.notEqual(accounts.validateAccount({ ...ok, password: "x".repeat(11) }), "");
  assert.notEqual(accounts.validateAccount({ ...ok, password: "x".repeat(201) }), "");
  assert.notEqual(accounts.validateAccount({ ...ok, email: "no-at-sign" }), "");
  assert.notEqual(accounts.validateAccount({ ...ok, name: "" }), "");
  assert.notEqual(accounts.validateAccount({ ...ok, name: "n".repeat(41) }), "");
  assert.notEqual(accounts.validateAccount({ ...ok, password: 123456789012 }), "");
});

test("device validation: a secret of at least 32 bytes (43 base64url or 64 hex characters)", () => {
  const hex = "a".repeat(64);
  const b64 = "A".repeat(43);
  assert.equal(accounts.validateDevice({ name: "Kinder-iPad", secret: hex }), "");
  assert.equal(accounts.validateDevice({ name: "Kinder-iPad", secret: b64 }), "");
  assert.notEqual(accounts.validateDevice({ name: "Kinder-iPad", secret: "a".repeat(42) }), "");
  assert.notEqual(accounts.validateDevice({ name: "Kinder-iPad", secret: `${"a".repeat(50)} !` }), "");
  assert.notEqual(accounts.validateDevice({ name: "", secret: hex }), "");
});

test("PIN hash is salted, verifies only the right 6 digits and rejects malformed input", () => {
  const a = hashPin(nodeSecurity, "246810");
  const b = hashPin(nodeSecurity, "246810");
  assert.notEqual(a, b, "salted");
  assert.match(a, /^v1\$[0-9a-f]{16}\$[0-9a-f]{64}$/);
  assert.equal(verifyPin(nodeSecurity, "246810", a), true);
  assert.equal(verifyPin(nodeSecurity, "246811", a), false);
  assert.equal(verifyPin(nodeSecurity, "24681", a), false);
  assert.equal(verifyPin(nodeSecurity, "2468100", a), false);
  assert.equal(verifyPin(nodeSecurity, "abcdef", a), false);
  assert.equal(verifyPin(nodeSecurity, 246810, a), false);
  assert.equal(verifyPin(nodeSecurity, "246810", ""), false);
  assert.equal(verifyPin(nodeSecurity, "246810", "garbage"), false);
});

test("rate limit: blocked after 5 failures, free again after 15 minutes, cleared on success, per key", () => {
  const data = new Map();
  const store = { get: (k) => data.get(k), set: (k, v) => data.set(k, v) };
  let t = 1_000_000;
  const rl = createLimiter(store, () => t);
  for (let i = 0; i < 4; i++) rl.fail("pin", "p1");
  assert.equal(rl.blocked("pin", "p1"), false);
  rl.fail("pin", "p1");
  assert.equal(rl.blocked("pin", "p1"), true);
  assert.equal(rl.blocked("pin", "p2"), false, "other account unaffected");
  assert.equal(rl.blocked("setup", "p1"), false, "other scope unaffected");
  t += WINDOW_MS - 1;
  assert.equal(rl.blocked("pin", "p1"), true, "still inside the window");
  t += 2;
  assert.equal(rl.blocked("pin", "p1"), false, "window passed");
  for (let i = 0; i < 3; i++) rl.fail("pin", "p1");
  rl.clear("pin", "p1");
  for (let i = 0; i < 4; i++) rl.fail("pin", "p1");
  assert.equal(rl.blocked("pin", "p1"), false);
});
