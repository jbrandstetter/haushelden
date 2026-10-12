// Governing: SPEC-0001 REQ "Kid Access on Enrolled Devices" (6-digit parent PIN), design "Risks" (the PIN only
// guards against curious kids; attempts are rate-limited)
//
// PIN hashing for members.pin_hash: salted, iterated HMAC-SHA256, "v1$<salt>$<hex>". The crypto functions are
// injected ($security in PocketBase, a small Node adapter in tests).

const ROUNDS = 20000;
const PIN_PATTERN = /^[0-9]{6}$/;

function derive(security, pin, salt) {
  let digest = pin;
  for (let i = 0; i < ROUNDS; i++) digest = security.hs256(digest, salt);
  return digest;
}

function hashPin(security, pin) {
  const salt = security.randomString(16);
  return `v1$${salt}$${derive(security, pin, salt)}`;
}

function verifyPin(security, pin, stored) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) return false;
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  return security.equal(derive(security, pin, parts[1]), parts[2]);
}

module.exports = { hashPin, verifyPin, PIN_PATTERN, ROUNDS };
