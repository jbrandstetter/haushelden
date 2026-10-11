// Governing: SPEC-0001 REQ "Prototype as UI Reference" (hash routes), REQ "Installable Web App"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseHash, findRoute } = require("../app/js/router.js");
const { ROUTES } = require("../app/js/routes.js");
const sse = require("../app/js/sse.js");

const APP = path.join(__dirname, "..", "app");

test("parseHash splits #/name/arg like the prototype", () => {
  assert.deepEqual(parseHash(""), { name: "", args: [] });
  assert.deepEqual(parseHash("#"), { name: "", args: [] });
  assert.deepEqual(parseHash("#/"), { name: "", args: [] });
  assert.deepEqual(parseHash("#/kind/ab12"), { name: "kind", args: ["ab12"] });
  assert.deepEqual(parseHash("#/einkauf/a%20b/x"), { name: "einkauf", args: ["a b", "x"] });
  assert.deepEqual(parseHash("#/eltern"), { name: "eltern", args: [] });
  assert.deepEqual(parseHash("#/%E0%A4%A"), { name: "%E0%A4%A", args: [] }, "malformed escapes do not throw");
});

test("findRoute matches the first path segment", () => {
  const routes = [
    ["", "js/screens/home.js"],
    ["kind", "js/screens/kind.js"],
  ];
  assert.deepEqual(findRoute(routes, "kind"), { path: "kind", script: "js/screens/kind.js" });
  assert.deepEqual(findRoute(routes, ""), { path: "", script: "js/screens/home.js" });
  assert.equal(findRoute(routes, "unbekannt"), null);
});

test("routes.js: unique paths, one script per route, each script exists and registers its screen", () => {
  assert.ok(ROUTES.length >= 1);
  assert.equal(new Set(ROUTES.map((r) => r[0])).size, ROUTES.length, "route paths must be unique");
  for (const [p, script] of ROUTES) {
    assert.match(script, /^js\/screens\/[a-z0-9-]+\.js$/, `${p}: screen scripts live in js/screens/`);
    const file = path.join(APP, script);
    assert.ok(fs.existsSync(file), `${script} is missing`);
    assert.ok(
      fs.readFileSync(file, "utf8").includes(`HH.screens.${p || "home"}`),
      `${script} must register HH.screens.${p || "home"}`,
    );
  }
});

test("SSE parser handles split chunks, CRLF, multi-line data and comments", () => {
  const p = sse.createParser();
  assert.deepEqual(p.push('event: PB_CONNECT\ndata: {"clientId":'), []);
  assert.deepEqual(p.push('"abc"}\n\n'), [{ event: "PB_CONNECT", data: '{"clientId":"abc"}', id: "" }]);
  assert.deepEqual(p.push(": keep-alive\r\n\r\nevent: members\r\ndata: a\r\ndata: b\r\n\r\n"), [
    { event: "members", data: "a\nb", id: "" },
  ]);
  assert.deepEqual(p.push("data: x\r"), []);
  assert.deepEqual(p.push("\n\n"), [{ event: "message", data: "x", id: "" }]);
});
