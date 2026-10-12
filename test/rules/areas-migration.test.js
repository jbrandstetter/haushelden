// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0003 REQ "Areas of Responsibility"
// (deleting an area keeps its to-dos), REQ "To-dos"
//
// The migration that turns `todos.area` (plain text id) into a relation to `areas` carries existing values over
// safely. The test boots a throwaway PocketBase with the migrations that existed before it, writes to-dos with
// a valid area id, a dangling id and no area, then lets the relation migration run on that data directory.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { ROOT, BINARY } = require("./pocketbase.js");

const RELATION = "1791765001_todos_area_relation.js";
const SUPERUSER = { email: "root@example.test", password: "change-me-test-only" };

let tmp;
let migrations;
let dataDir;

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const args = () => [
  `--dir=${dataDir}`,
  `--migrationsDir=${migrations}`,
  `--hooksDir=${path.join(ROOT, "pb_hooks")}`,
];

/** Serves the data directory until `fn` is done; returns an api(method, path, body) helper to it. */
async function withServer(fn) {
  const port = await freePort();
  const child = spawn(BINARY, ["serve", `--http=127.0.0.1:${port}`, ...args()], {
    env: { PATH: process.env.PATH, HH_MODE: "development" },
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("PocketBase did not become healthy");
    await new Promise((r) => setTimeout(r, 100));
  }
  let token;
  const api = async (method, urlPath, body) => {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  token = (
    await api("POST", "/api/collections/_superusers/auth-with-password", {
      identity: SUPERUSER.email,
      password: SUPERUSER.password,
    })
  ).data.token;
  try {
    return await fn(api);
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mig-"));
  dataDir = path.join(tmp, "data");
  migrations = path.join(tmp, "migrations");
  fs.mkdirSync(migrations);
  for (const f of fs.readdirSync(path.join(ROOT, "pb_migrations"))) {
    if (f !== RELATION) fs.copyFileSync(path.join(ROOT, "pb_migrations", f), path.join(migrations, f));
  }
  const upsert = spawnSync(BINARY, ["superuser", "upsert", SUPERUSER.email, SUPERUSER.password, ...args()], {
    env: { PATH: process.env.PATH, HH_MODE: "development" },
    encoding: "utf8",
  });
  assert.equal(upsert.status, 0, upsert.stderr);
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("todos.area text -> relation migration", () => {
  it("keeps a valid area id, drops a dangling one, leaves empty ones empty", async () => {
    const seeded = await withServer(async (api) => {
      const areas = (await api("GET", "/api/collections/areas/records?perPage=50")).data.items;
      const auto = areas.find((a) => a.name === "Auto");
      assert.ok(auto, "starter area Auto exists before the relation migration");
      const make = async (title, area) => {
        const res = await api("POST", "/api/collections/todos/records", { title, who: "parents", area });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        return res.data.id;
      };
      return {
        auto: auto.id,
        withArea: await make("Test-Aufgabe: mit Bereich", auto.id),
        dangling: await make("Test-Aufgabe: kaputt", "abcdefghijklmno"),
        none: await make("Test-Aufgabe: ohne", ""),
      };
    });

    fs.copyFileSync(path.join(ROOT, "pb_migrations", RELATION), path.join(migrations, RELATION));

    await withServer(async (api) => {
      const get = async (id) => (await api("GET", `/api/collections/todos/records/${id}`)).data;
      assert.equal((await get(seeded.withArea)).area, seeded.auto);
      assert.equal((await get(seeded.dangling)).area, "");
      assert.equal((await get(seeded.none)).area, "");
      assert.equal((await get(seeded.withArea)).title, "Test-Aufgabe: mit Bereich");
      // no leftover helper column, and deleting the area now keeps the to-do
      const col = (await api("GET", "/api/collections/todos")).data;
      assert.deepEqual(
        col.fields.map((f) => f.name).filter((n) => n.startsWith("area")),
        ["area"],
      );
      assert.equal(col.fields.find((f) => f.name === "area").type, "relation");
      assert.equal((await api("DELETE", `/api/collections/areas/records/${seeded.auto}`)).status, 204);
      const kept = await get(seeded.withArea);
      assert.equal(kept.area, "");
      assert.equal(kept.title, "Test-Aufgabe: mit Bereich");
    });
  });
});
