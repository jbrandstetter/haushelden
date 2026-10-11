// Governing: SPEC-0007 REQ "Local Development"
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { runSeed } = require("../scripts/seed.js");
const fixtures = require("../scripts/seed/fixtures.js");

test("fixtures use obviously fake names", () => {
  assert.equal(fixtures.members.filter((m) => m.role === "parent").length, 2);
  assert.equal(fixtures.members.filter((m) => m.role === "kid").length, 2);
  for (const m of fixtures.members) assert.match(m.name, /^Test-/);
});

test("seed skips steps whose collection does not exist and seeds those that do", async () => {
  const created = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.url.endsWith("/auth-with-password")) return json(200, { token: "t" });
      if (req.url === "/api/collections/members") return json(200, {});
      if (req.url.startsWith("/api/collections/members/records") && req.method === "GET")
        return json(200, { totalItems: 0 });
      if (req.url === "/api/collections/members/records" && req.method === "POST") {
        created.push(JSON.parse(body));
        return json(200, { id: `id${created.length}` });
      }
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const results = await runSeed({
      base,
      email: "a@example.test",
      password: "x",
      log: () => {},
      steps: [
        { collection: "members", key: "key", records: () => fixtures.members },
        { collection: "routines", records: () => [] },
      ],
    });
    assert.deepEqual(results, [
      { collection: "members", outcome: "seeded" },
      { collection: "routines", outcome: "skipped" },
    ]);
    assert.equal(created.length, 4);
  } finally {
    server.close();
  }
});
