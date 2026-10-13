// Governing: SPEC-0007 REQ "Local Development" (a throwaway PocketBase never touches the developer's desktop)
//
// PocketBase opens its "create the first admin" page in the default browser when it starts on a data directory
// without a superuser. That is what opened stray tabs on the developer's machine. This test starts exactly that
// situation and shows that the launch lands in the stub (scripts/no-browser.js), not in a real browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { noBrowser } = require("../../scripts/no-browser.js");
const h = require("../helpers/pb-process.js");
const { freePort } = require("./pocketbase.js");

test("prerequisites: pinned PocketBase binary (npm run pb:download) is available", () => {
  assert.ok(h.hasBinary(), "run `npm run pb:download` first");
});

test("a server started on an empty data directory asks for the installer page through the stub, never a real browser", async () => {
  const quiet = noBrowser();
  fs.rmSync(quiet.log, { force: true });
  const dir = h.tmpDir("no-browser");
  const port = await freePort();
  const server = h.serve(dir, port); // no superuser upserted on purpose
  try {
    await h.waitForHealth(port);
    // the launch is attempted right at startup; give it a moment to be recorded
    for (let i = 0; i < 30 && !fs.existsSync(quiet.log); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(quiet.log), "PocketBase tried to open a page, and it went to the stub");
    assert.match(fs.readFileSync(quiet.log, "utf8"), /127\.0\.0\.1:\d+\/_\/#\/pbinstall\//);
  } finally {
    await h.stop(server);
    h.rmrf(dir);
  }
});

test("the stub directory provides every launcher PocketBase may try on macOS, Linux and WSL", () => {
  const { dir, env } = noBrowser();
  for (const name of ["open", "xdg-open", "wslview"]) assert.ok(fs.existsSync(`${dir}/${name}`), name);
  assert.ok(env.PATH.startsWith(dir), "the stub directory comes first on the PATH");
});
