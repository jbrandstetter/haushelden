// Helpers for tests that need a real throwaway PocketBase (operations tests). Each test file uses its own port.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const BINARY = path.join(ROOT, ".pb", "pocketbase");

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), `hh-${prefix}-`));
const rmrf = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const hasBinary = () => fs.existsSync(BINARY);
const hasSqlite = () => spawnSync("sqlite3", ["-version"]).status === 0;

function upsertSuperuser(dataDir, email, password) {
  const r = spawnSync(
    BINARY,
    [
      "superuser",
      "upsert",
      email,
      password,
      `--dir=${dataDir}`,
      `--migrationsDir=${path.join(ROOT, "pb_migrations")}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`superuser upsert failed: ${r.stderr}`);
}

const { noBrowser } = require("../../scripts/no-browser.js");

function serve(dataDir, port, env = {}) {
  const child = spawn(
    BINARY,
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${path.join(ROOT, "pb_migrations")}`,
      `--hooksDir=${path.join(ROOT, "pb_hooks")}`,
    ],
    { env: { ...noBrowser().env, ...env } }, // never launches a browser tab (see scripts/no-browser.js)
  );
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  return { child, output: () => output };
}

async function waitForHealth(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("PocketBase did not become healthy in time");
}

async function stop(proc) {
  if (!proc.child || proc.child.exitCode !== null) return;
  const exited = new Promise((resolve) => proc.child.once("exit", resolve));
  proc.child.kill("SIGTERM");
  await exited;
}

async function api(port, method, route, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function superuserToken(port, email, password) {
  const r = await api(port, "POST", "/api/collections/_superusers/auth-with-password", {
    body: { identity: email, password },
  });
  if (r.status !== 200) throw new Error("superuser sign-in failed");
  return r.json.token;
}

const sqliteJson = (db, sql) =>
  JSON.parse(spawnSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).stdout || "[]");

module.exports = {
  ROOT,
  BINARY,
  tmpDir,
  rmrf,
  hasBinary,
  hasSqlite,
  upsertSuperuser,
  serve,
  waitForHealth,
  stop,
  api,
  superuserToken,
  sqliteJson,
};
