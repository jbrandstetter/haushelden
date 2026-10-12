// Governing: SPEC-0001 REQ "Kid Access on Enrolled Devices" (parent PIN), SPEC-0007 REQ "Local Development",
// ADR-0004 (fake values only)
//
// Seed logic for the accounts story: gives the seeded parents a fake PIN (members.pin_hash) so the PIN prompt can
// be tried locally. The hash is computed with the same module the server uses (pb_hooks/lib/pin.js).

const crypto = require("node:crypto");
const { hashPin } = require("../../pb_hooks/lib/pin.js");

/** The subset of PocketBase's $security that pin.js needs, on top of node:crypto. */
const nodeSecurity = {
  hs256: (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("hex"),
  randomString: (n) => crypto.randomBytes(n).toString("hex").slice(0, n),
  equal: (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)),
};

/** Extra member fields for the seed: parents get the fake PIN, kids none. */
function pinFields(role, secrets) {
  return role === "parent" && secrets.parentPin ? { pin_hash: hashPin(nodeSecurity, secrets.parentPin) } : {};
}

module.exports = { pinFields, nodeSecurity };
