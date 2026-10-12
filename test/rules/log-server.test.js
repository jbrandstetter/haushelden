// Governing: SPEC-0007 REQ "Logging" (a failed sign-in records time, auth collection, client address and reason,
// but not the password). Real PocketBase; runs in the PocketBase CI job (npm run test:rules).
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../helpers/pb-process.js");

test("prerequisites: pinned PocketBase binary (npm run pb:download) is available", () => {
  assert.ok(h.hasBinary(), "run `npm run pb:download` first");
});

test("scenario: a failed sign-in is logged without the password (real PocketBase)", async () => {
  const port = 8225; // ops.test.js uses 8221-8223; both run in parallel under test:rules
  const dir = h.tmpDir("log");
  const server = h.serve(dir, port);
  try {
    await h.waitForHealth(port);
    const secret = "never-log-this-password-0123";
    const res = await h.api(port, "POST", "/api/collections/parents/auth-with-password?token=query-secret", {
      body: { identity: "nobody@example.test", password: secret },
    });
    assert.equal(res.status, 400);
    await new Promise((r) => setTimeout(r, 300));
    const out = server.output();
    const line = out.split("\n").find((l) => l.includes('msg="sign-in failed"'));
    assert.ok(line, "a sign-in failed line is logged");
    assert.match(line, /ts=\d{4}-\d\d-\d\dT[\d:.]+Z/);
    assert.match(line, /auth_collection=parents/);
    assert.match(line, /client=127\.0\.0\.1/);
    assert.match(line, /reason="Failed to authenticate\."/);
    assert.equal(out.includes(secret), false);
    assert.equal(out.includes("query-secret"), false);
  } finally {
    await h.stop(server);
    h.rmrf(dir);
  }
});
