#!/usr/bin/env node
// Governing: SPEC-0007 REQ "Local Development" (committed migrations and hooks on a throwaway PocketBase),
// REQ "Configuration Keys" (production refuses to start without HH_PUBLIC_URL), ADR-0004 (placeholders only)
//
// Smoke test: boots a throwaway PocketBase with the committed migrations, hooks and app/, checks the health
// endpoint and the served start page, then checks that production mode without HH_PUBLIC_URL does not start.
// Needs the pinned binary at .pb/pocketbase (npm run pb:download).

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const BINARY = path.join(ROOT, ".pb", "pocketbase");
const PORT = process.env.HH_SMOKE_PORT || "8099";

function serve(dataDir, extraEnv) {
  const child = spawn(
    BINARY,
    [
      "serve",
      `--http=127.0.0.1:${PORT}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${path.join(ROOT, "pb_migrations")}`,
      `--hooksDir=${path.join(ROOT, "pb_hooks")}`,
      `--publicDir=${path.join(ROOT, "app")}`,
    ],
    { env: { PATH: process.env.PATH, ...extraEnv } },
  );
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited, output: () => output };
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.status === 200) return res;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("PocketBase did not become healthy in time");
}

async function main() {
  assert.ok(fs.existsSync(BINARY), "PocketBase binary missing: run npm run pb:download");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-smoke-"));

  const dev = serve(dataDir, { HH_MODE: "development" });
  try {
    const health = await waitForHealth(30000);
    assert.equal((await health.json()).code, 200);
    const page = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Haushelden/);
    console.log("ok: health endpoint and app/ start page");
    // The committed migrations ran: the household collections exist and give an anonymous caller nothing.
    for (const name of ["members", "parents", "devices", "settings"]) {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/collections/${name}/records`);
      assert.equal(res.status, 200, `${name}: collection missing (migrations did not run?)`);
      assert.equal((await res.json()).totalItems, 0, `${name}: anonymous caller must see no records`);
    }
    console.log("ok: household collections exist and are closed to anonymous callers");
  } finally {
    dev.child.kill("SIGTERM");
    await dev.exited;
  }

  const prod = serve(path.join(dataDir, "prod"), {
    HH_MODE: "production",
    HH_BACKUP_TARGET: "change-me",
    HH_PB_VERSION: "0",
  });
  const code = await prod.exited;
  assert.notEqual(code, 0, "production without HH_PUBLIC_URL must not start");
  assert.match(prod.output(), /missing configuration: HH_PUBLIC_URL/);
  console.log("ok: production without HH_PUBLIC_URL refuses to start");

  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
