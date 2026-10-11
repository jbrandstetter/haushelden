// Governing: ADR-0001 (PocketBase realtime), SPEC-0001 REQ "Shared State and Live Sync" (within 5 seconds),
// REQ "Offline Operation" (queue, replay, idempotent), REQ "Error Handling Standards" (server logs the
// rejection with member, record and reason), REQ "Installable Web App" (served shell), REQ "Household Day and
// Time Zone" (HH_TZ reaches signed-in clients)
//
// Runs the real data layer and PocketBase transport (app/js) against a throwaway PocketBase, using `members`
// as the collection, plus the hooks and the served shell.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { startPocketBase, ROOT } = require("./pocketbase.js");
const { createPocketBaseTransport } = require("../../app/js/pb.js");
const { createData } = require("../../app/js/data.js");
const { memoryStorage } = require("../../app/js/storage.js");

const PW = "change-me-parent-pw-1";
const SECRET = "change-me-device-secret-0123456789abcdef";
const quiet = { warn() {}, info() {} };

let pb;
let parentToken;
let otherParentToken;
let deviceToken;
let parentMemberId;

const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
};
const rec = (c, id = "") => `/api/collections/${c}/records${id ? `/${id}` : ""}`;

/** One simulated device: its own transport, storage and data layer, with a switch to cut its network. */
function makeDevice(token) {
  const gate = { offline: false };
  const fetchImpl = (url, init) => {
    if (gate.offline) return Promise.reject(new TypeError("fetch failed"));
    return fetch(url, init);
  };
  const transport = createPocketBaseTransport({
    baseUrl: pb.base,
    getToken: () => token,
    fetchImpl,
    backoffMs: [100, 200],
  });
  const data = createData({ transport, storage: memoryStorage(), logger: quiet, autoRetry: false });
  return { gate, transport, data };
}

before(async () => {
  pb = await startPocketBase({ publicDir: path.join(ROOT, "app") });
  const su = pb.superToken;
  const mk = async (body) => (await pb.api("POST", rec("members"), { token: su, body })).data;
  parentMemberId = (await mk({ role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" })).id;
  const mama = await mk({ role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink" });
  for (const [email, member] of [
    ["papa@example.test", parentMemberId],
    ["mama@example.test", mama.id],
  ]) {
    const r = await pb.api("POST", rec("parents"), {
      token: su,
      body: { email, password: PW, passwordConfirm: PW, member },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  await pb.api("POST", rec("devices"), {
    token: su,
    body: { email: "tablet@example.test", password: SECRET, passwordConfirm: SECRET, name: "Test-Tablet" },
  });
  parentToken = await pb.signIn("parents", "papa@example.test", PW);
  otherParentToken = await pb.signIn("parents", "mama@example.test", PW);
  deviceToken = await pb.signIn("devices", "tablet@example.test", SECRET);
});
after(async () => {
  if (pb) await pb.stop();
});

describe("live sync (real PocketBase)", () => {
  it("scenario: a member added on one device appears on the other within 5 seconds", async () => {
    const a = makeDevice(parentToken);
    const b = makeDevice(otherParentToken);
    let seenOnB = [];
    const offB = b.data.subscribe("members", (rows) => (seenOnB = rows));
    await until(() => seenOnB.length >= 2); // initial refresh
    const started = Date.now();
    const created = await a.data.create("members", {
      role: "kid",
      name: "Test-Kind-1",
      emoji: "⚽",
      colour: "peach",
    });
    await until(() => seenOnB.some((m) => m.id === created.id && !m._pending), 5000);
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
    offB();
    a.transport.close();
    b.transport.close();
  });

  it("a device account syncs members live and cannot write", async () => {
    const dev = makeDevice(deviceToken);
    let rows = [];
    const off = dev.data.subscribe("members", (r) => (rows = r));
    await until(() => rows.some((m) => m.name === "Test-Kind-1"));
    const parent = makeDevice(parentToken);
    await parent.data.refresh("members");
    const kid = (await parent.data.list("members")).find((m) => m.name === "Test-Kind-1");
    await parent.data.update("members", kid.id, { emoji: "🦄" });
    await until(() => rows.find((m) => m.id === kid.id)?.emoji === "🦄", 5000);
    // the device's own write is refused by the rules and stays queued, flagged
    await dev.data.update("members", kid.id, { name: "Umbenannt" });
    await dev.data.flush();
    assert.equal(dev.data.status().rejected, 1);
    const server = await pb.api("GET", rec("members", kid.id), { token: pb.superToken });
    assert.equal(server.data.name, "Test-Kind-1");
    off();
    dev.transport.close();
    parent.transport.close();
  });
});

describe("offline queue (real PocketBase)", () => {
  it("scenario: three changes made offline are applied once each after reconnecting", async () => {
    const a = makeDevice(parentToken);
    const names = ["Test-Aus-1", "Test-Aus-2", "Test-Aus-3"];
    a.gate.offline = true;
    await a.data.refresh("members"); // fails quietly: offline
    const ids = [];
    for (const name of names) {
      const r = await a.data.create("members", { role: "kid", name, emoji: "🙂", colour: "teal" });
      ids.push(r.id);
    }
    await a.data.flush();
    assert.equal(a.data.status().queued, 3);
    assert.equal(
      (await a.data.list("members")).filter((m) => names.includes(m.name)).length,
      3,
      "visible while offline",
    );
    let onServer = await pb.api(
      "GET",
      `${rec("members")}?filter=${encodeURIComponent('name ~ "Test-Aus-"')}`,
      { token: pb.superToken },
    );
    assert.equal(onServer.data.totalItems, 0);

    a.gate.offline = false;
    await a.data.flush();
    onServer = await pb.api(
      "GET",
      `${rec("members")}?filter=${encodeURIComponent('name ~ "Test-Aus-"')}&sort=name`,
      { token: pb.superToken },
    );
    assert.deepEqual(
      onServer.data.items.map((m) => m.name),
      names,
    );
    assert.deepEqual(
      onServer.data.items.map((m) => m.id).sort(),
      ids.sort(),
      "client ids became the record ids",
    );
    assert.equal(a.data.status().queued, 0);
    // replaying everything again must not duplicate (idempotent create)
    const replay = makeDevice(parentToken);
    for (const id of ids) {
      const res = await replay.transport
        .create("members", { id, role: "kid", name: "x", emoji: "🙂", colour: "teal" })
        .catch((e) => e);
      assert.equal(res.kind, "exists");
    }
    const count = await pb.api(
      "GET",
      `${rec("members")}?filter=${encodeURIComponent('name ~ "Test-Aus-"')}`,
      { token: pb.superToken },
    );
    assert.equal(count.data.totalItems, 3);
    a.transport.close();
    replay.transport.close();
  });

  it("a delete queued offline is idempotent against a record someone else already removed", async () => {
    const a = makeDevice(parentToken);
    const made = await pb.api("POST", rec("members"), {
      token: pb.superToken,
      body: { role: "kid", name: "Test-Weg", emoji: "🙂", colour: "red" },
    });
    await a.data.refresh("members");
    a.gate.offline = true;
    await a.data.delete("members", made.data.id);
    await a.data.flush();
    await pb.api("DELETE", rec("members", made.data.id), { token: pb.superToken });
    a.gate.offline = false;
    await a.data.flush();
    assert.equal(a.data.status().queued, 0);
    a.transport.close();
  });

  it("a server rejection keeps the change queued and the server logs member, record and reason", async () => {
    const dev = makeDevice(deviceToken);
    await dev.data.refresh("members");
    const kid = (await dev.data.list("members")).find((m) => m.name === "Test-Kind-1");
    await dev.data.update("members", kid.id, { name: "Heimlich umbenannt" });
    await dev.data.flush();
    assert.equal(dev.data.status().queued, 1);
    const parent = makeDevice(parentToken);
    // a parent whose change fails validation is logged with their member id
    await parent.data.create("members", {
      role: "kid",
      name: "Test-Ungültig",
      emoji: "🙂",
      colour: "hotpink",
    });
    await parent.data.flush();
    assert.equal(parent.data.status().rejected, 1);
    let line;
    await until(async () => {
      const logs = await pb.api(
        "GET",
        `/api/logs?perPage=100&filter=${encodeURIComponent('message = "sync write rejected"')}`,
        { token: pb.superToken },
      );
      line = logs.data.items
        .map((l) => l.data)
        .find((d) => d.principal_type === "parents" && d.method === "POST" && /colour/.test(d.detail));
      return !!line;
    }, 15000);
    assert.equal(line.member, parentMemberId);
    assert.equal(line.collection, "members");
    assert.equal(line.status, 400);
    assert.match(line.detail, /colour/);
    assert.ok("reason" in line && "record" in line);
    const deviceLine = (
      await pb.api(
        "GET",
        `/api/logs?perPage=100&filter=${encodeURIComponent('message = "sync write rejected"')}`,
        { token: pb.superToken },
      )
    ).data.items
      .map((l) => l.data)
      .find((d) => d.principal_type === "devices");
    assert.ok(deviceLine, "the device's rejected update is logged too");
    assert.equal(deviceLine.record, kid.id);
    dev.transport.close();
    parent.transport.close();
  });
});

describe("hooks and served shell", () => {
  it("GET /api/hh/config: household time zone for parents and devices only", async () => {
    assert.ok((await pb.api("GET", "/api/hh/config")).status >= 400);
    for (const token of [parentToken, deviceToken]) {
      const res = await pb.api("GET", "/api/hh/config", { token });
      assert.equal(res.status, 200);
      assert.equal(res.data.tz, "Europe/Berlin", "default when HH_TZ is not set");
    }
  });

  it("serves the shell, the service worker and the manifest with usable types", async () => {
    const fetchText = async (p) => {
      const res = await fetch(`${pb.base}${p}`);
      return { res, text: await res.text() };
    };
    const index = await fetchText("/");
    assert.equal(index.res.status, 200);
    assert.match(index.text, /rel="manifest"/);
    const sw = await fetchText("/sw.js");
    assert.equal(sw.res.status, 200);
    assert.match(sw.res.headers.get("content-type"), /javascript/);
    const manifest = await fetchText("/manifest.json");
    assert.equal(manifest.res.status, 200);
    assert.equal(JSON.parse(manifest.text).display, "standalone");
    for (const f of [
      "js/data.js",
      "js/routes.js",
      "js/screens/home.js",
      "css/app.css",
      "icon-192.png",
      "icon-180.png",
    ]) {
      assert.equal((await fetch(`${pb.base}/${f}`)).status, 200, f);
    }
    // the shell holds no household data: nothing from the API is reachable without a token
    assert.equal((await pb.api("GET", rec("members"))).data.totalItems, 0);
  });
});
