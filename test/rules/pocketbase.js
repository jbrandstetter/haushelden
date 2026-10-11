// Governing: SPEC-0007 REQ "Local Development" (throwaway PocketBase), ADR-0004 (fake data, placeholders only)
//
// Test helper: boots a throwaway PocketBase from the committed migrations and hooks on its own free port and a
// temp data directory (never the developer's pb_data) and offers a tiny JSON API client. Needs the pinned binary
// at .pb/pocketbase (npm run pb:download); the rules tests fail loudly without it, they never skip silently.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const BINARY = path.join(ROOT, ".pb", "pocketbase");

// Fake local-only credentials; they exist only inside the throwaway instance.
const SUPERUSER = { email: "root@example.test", password: "change-me-test-only" };

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function dirsArgs(dataDir) {
  return [
    `--dir=${dataDir}`,
    `--migrationsDir=${path.join(ROOT, "pb_migrations")}`,
    `--hooksDir=${path.join(ROOT, "pb_hooks")}`,
  ];
}

async function startPocketBase({ publicDir } = {}) {
  if (!fs.existsSync(BINARY)) throw new Error("PocketBase binary missing: run npm run pb:download");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-"));
  const env = { PATH: process.env.PATH, HH_MODE: "development" };
  const upsert = spawnSync(
    BINARY,
    ["superuser", "upsert", SUPERUSER.email, SUPERUSER.password, ...dirsArgs(dataDir)],
    {
      env,
      encoding: "utf8",
    },
  );
  if (upsert.status !== 0) throw new Error(`superuser upsert failed: ${upsert.stderr}`);

  const port = await freePort();
  const args = ["serve", `--http=127.0.0.1:${port}`, ...dirsArgs(dataDir)];
  if (publicDir) args.push(`--publicDir=${publicDir}`);
  const child = spawn(BINARY, args, { env });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const exited = new Promise((resolve) => child.on("exit", resolve));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`PocketBase did not become healthy:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const server = {
    base,
    dataDir,
    port,
    output: () => output,
    /** JSON request. Resolves to { status, data } and never throws on HTTP errors. */
    async api(method, urlPath, { token, body } = {}) {
      const res = await fetch(`${base}${urlPath}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    async signIn(collection, identity, password) {
      const res = await server.api("POST", `/api/collections/${collection}/auth-with-password`, {
        body: { identity, password },
      });
      if (res.status !== 200) throw new Error(`sign-in as ${collection} failed (HTTP ${res.status})`);
      return res.data.token;
    },
    async stop() {
      child.kill("SIGTERM");
      await exited;
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  server.superToken = await server.signIn("_superusers", SUPERUSER.email, SUPERUSER.password);
  return server;
}

module.exports = { startPocketBase, ROOT, BINARY };
