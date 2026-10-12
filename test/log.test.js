// Governing: SPEC-0007 REQ "Logging" (structured, UTC, no passwords/PINs/tokens/device secrets/request bodies;
// a failed sign-in records time, auth collection, client address and reason but not the password)
const test = require("node:test");
const assert = require("node:assert/strict");
const { formatLine, safePath, authCollection } = require("../pb_hooks/lib/log.js");

const FIXED = new Date("2026-03-04T05:06:07.089Z");

test("formatLine writes key=value with a UTC timestamp", () => {
  const line = formatLine(
    "warn",
    "sign-in failed",
    { auth_collection: "parents", client: "10.0.0.1", reason: "Failed to authenticate." },
    FIXED,
  );
  assert.equal(
    line,
    'ts=2026-03-04T05:06:07.089Z level=warn msg="sign-in failed" auth_collection=parents client=10.0.0.1 reason="Failed to authenticate."',
  );
});

test("formatLine redacts passwords, PINs, tokens, device secrets and bodies", () => {
  const fields = {
    password: "hunter2hunter2",
    pin: "1234",
    token: "abc.def.ghi",
    device_secret: "s3cret",
    Authorization: "Bearer xyz",
    request_body: '{"password":"x"}',
    path: "/api/x",
  };
  const line = formatLine("info", "request", fields, FIXED);
  for (const leaked of ["hunter2hunter2", "1234", "abc.def.ghi", "s3cret", "Bearer", "xyz", '{"password"'])
    assert.equal(line.includes(leaked), false, `${leaked} leaked`);
  assert.match(line, /password="?\[redacted\]/);
  assert.match(line, /path=\/api\/x/);
});

test("formatLine keeps one event on one line and ignores unsafe keys", () => {
  const line = formatLine("error", "multi\nline", { "bad key": "x", note: "a\r\nb" }, FIXED);
  assert.equal(line.split("\n").length, 1);
  assert.equal(line.includes("bad key"), false);
});

test("safePath drops the query string; authCollection finds the sign-in collection", () => {
  assert.equal(safePath("/api/files/x?token=secret"), "/api/files/x");
  assert.equal(authCollection("/api/collections/parents/auth-with-password"), "parents");
  assert.equal(authCollection("/api/collections/parents/records"), "");
});
