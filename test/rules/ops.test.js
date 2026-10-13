// Governing: SPEC-0007 REQ "Backup and Restore", REQ "Release and Deploy", REQ "Error Handling Standards";
// SPEC-0001 REQ "Backups" (restore into a scratch directory, live data unaffected)
//
// Real round trip against a throwaway PocketBase: data -> online backup -> restore -> identical data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const h = require("../helpers/pb-process.js");

const PORT = 8221;
const EMAIL = "ops@example.test";
const PASSWORD = "change-me-ops-test-pw";
const BACKUP = path.join(h.ROOT, "scripts", "backup.sh");
const RESTORE = path.join(h.ROOT, "scripts", "restore.sh");
// Runs in the PocketBase CI job (npm run test:rules): missing prerequisites fail loudly, they are never silently ignored.
test("prerequisites: pinned PocketBase binary (npm run pb:download) and the sqlite3 CLI are available", () => {
  assert.ok(h.hasBinary(), "run `npm run pb:download` first");
  assert.ok(h.hasSqlite(), "the sqlite3 CLI is required");
});

const run = (script, args, env) =>
  spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...require("../../scripts/no-browser.js").noBrowser().env, ...env },
  });
const snapshots = (dir) => fs.readdirSync(dir).filter((f) => /^haushelden-.*\.tar\.gz$/.test(f));

async function withServer(fn) {
  const dir = h.tmpDir("ops-data");
  h.upsertSuperuser(dir, EMAIL, PASSWORD);
  const server = h.serve(dir, PORT);
  try {
    await h.waitForHealth(PORT);
    await fn(dir, server);
  } finally {
    await h.stop(server);
    h.rmrf(dir);
  }
}

test("scenario: backup of a live server, restored into a scratch dir, gives identical data", async () => {
  await withServer(async (dir) => {
    const token = await h.superuserToken(PORT, EMAIL, PASSWORD);
    for (const name of ["Test-Kind-1", "Test-Kind-2", "Test-Elternteil"]) {
      const r = await h.api(PORT, "POST", "/api/collections/members/records", {
        token,
        body: { name, role: name.includes("Kind") ? "kid" : "parent", emoji: "x", colour: "mauve" },
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    const before = h.sqliteJson(path.join(dir, "data.db"), "select * from members order by id");
    assert.equal(before.length, 3);

    const target = h.tmpDir("ops-target");
    const scratch = path.join(h.tmpDir("ops-scratch"), "pb_data");
    try {
      const b = run(BACKUP, [], { HH_DATA_DIR: dir, HH_BACKUP_TARGET: target });
      assert.equal(b.status, 0, b.stderr);
      assert.match(b.stdout, /level=info component=backup msg="backup written"/);
      const [snap] = snapshots(target);
      assert.ok(snap);
      assert.deepEqual(
        fs.readdirSync(target).filter((f) => f.startsWith(".staging")),
        [],
      );

      const r = run(RESTORE, [path.join(target, snap), scratch], {});
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(
        h.sqliteJson(path.join(scratch, "data.db"), "select * from members order by id"),
        before,
      );

      // The restored directory serves the same data; the live server is unaffected (SPEC-0001 "Backups").
      const second = h.serve(scratch, PORT + 1);
      try {
        await h.waitForHealth(PORT + 1);
        const t2 = await h.superuserToken(PORT + 1, EMAIL, PASSWORD);
        const list = await h.api(PORT + 1, "GET", "/api/collections/members/records", { token: t2 });
        assert.equal(list.json.totalItems, 3);
      } finally {
        await h.stop(second);
      }
      assert.equal((await h.api(PORT, "GET", "/api/health")).status, 200);
    } finally {
      h.rmrf(target);
      h.rmrf(path.dirname(scratch));
    }
  });
});

test("restore refuses a non-empty data dir without --force and moves data aside with it", async () => {
  await withServer(async (dir) => {
    const target = h.tmpDir("ops-target");
    const parent = h.tmpDir("ops-dest");
    try {
      assert.equal(run(BACKUP, [], { HH_DATA_DIR: dir, HH_BACKUP_TARGET: target }).status, 0);
      const snap = path.join(target, snapshots(target)[0]);
      const dest = path.join(parent, "pb_data");
      fs.mkdirSync(dest);
      fs.writeFileSync(path.join(dest, "keep.txt"), "existing");

      const refused = run(RESTORE, [snap, dest], {});
      assert.equal(refused.status, 2);
      assert.match(refused.stderr, /refusing to overwrite/);
      assert.equal(fs.readFileSync(path.join(dest, "keep.txt"), "utf8"), "existing");

      const forced = run(RESTORE, [snap, dest, "--force"], {});
      assert.equal(forced.status, 0, forced.stderr);
      assert.ok(fs.existsSync(path.join(dest, "data.db")));
      const aside = fs.readdirSync(parent).find((f) => f.startsWith("pb_data.before-restore-"));
      assert.ok(aside, "old files are moved aside, not deleted");
      assert.equal(fs.readFileSync(path.join(parent, aside, "keep.txt"), "utf8"), "existing");
    } finally {
      h.rmrf(target);
      h.rmrf(parent);
    }
  });
});

test("scenario: an unwritable backup target exits non-zero and logs the key, not the value", async () => {
  await withServer(async (dir) => {
    const root = h.tmpDir("ops-ro");
    try {
      const blocker = path.join(root, "file-not-dir");
      fs.writeFileSync(blocker, "x");
      const target = path.join(blocker, "secret-user:secret-pass@backups");
      const b = run(BACKUP, [], { HH_DATA_DIR: dir, HH_BACKUP_TARGET: target });
      assert.notEqual(b.status, 0);
      assert.match(
        b.stderr,
        /level=error component=backup msg="backup target is not writable" key=HH_BACKUP_TARGET/,
      );
      assert.equal((b.stdout + b.stderr).includes("secret-pass"), false);
      assert.match(b.stderr, /^ts=\d{4}-\d\d-\d\dT[\d:]+Z /);

      const unset = run(BACKUP, [], { HH_DATA_DIR: dir });
      assert.notEqual(unset.status, 0);
      assert.match(unset.stderr, /key=HH_BACKUP_TARGET/);
    } finally {
      h.rmrf(root);
    }
  });
});

test("scenario: retention removes snapshots older than HH_BACKUP_RETENTION_DAYS and keeps the rest", async () => {
  await withServer(async (dir) => {
    const target = h.tmpDir("ops-target");
    try {
      const day = 86400 * 1000;
      const old = path.join(target, "haushelden-20200101T000000Z.tar.gz");
      const recent = path.join(target, "haushelden-20200102T000000Z.tar.gz");
      const other = path.join(target, "unrelated-old-file.txt");
      for (const f of [old, recent, other]) fs.writeFileSync(f, "x");
      fs.utimesSync(old, new Date(Date.now() - 20 * day), new Date(Date.now() - 20 * day));
      fs.utimesSync(other, new Date(Date.now() - 20 * day), new Date(Date.now() - 20 * day));
      fs.utimesSync(recent, new Date(Date.now() - 3 * day), new Date(Date.now() - 3 * day));

      const b = run(BACKUP, [], {
        HH_DATA_DIR: dir,
        HH_BACKUP_TARGET: target,
        HH_BACKUP_RETENTION_DAYS: "14",
      });
      assert.equal(b.status, 0, b.stderr);
      assert.match(b.stdout, /msg="retention applied" pruned=1 retention_days=14/);
      assert.equal(fs.existsSync(old), false);
      assert.equal(fs.existsSync(recent), true);
      assert.equal(fs.existsSync(other), true, "files the script did not create are never deleted");
      assert.equal(snapshots(target).length, 2);
    } finally {
      h.rmrf(target);
    }
  });
});

test("scenario: deploy of a tag takes a pre-deploy backup, installs files, migrates and checks health", async () => {
  const work = h.tmpDir("ops-deploy");
  const data = path.join(work, "data");
  const install = path.join(work, "install");
  const target = path.join(work, "backups");
  const src = path.join(work, "src");
  const pid = path.join(work, "pb.pid");
  try {
    // A tiny repository with a tag that holds the committed app/, pb_migrations/ and pb_hooks/.
    fs.mkdirSync(src);
    for (const part of ["app", "pb_migrations", "pb_hooks"])
      fs.cpSync(path.join(h.ROOT, part), path.join(src, part), { recursive: true });
    const git = (...a) => spawnSync("git", ["-C", src, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "release");
    git("tag", "v1.0.1");

    // The "service": start/stop commands around a background PocketBase on the install directory.
    const start = path.join(work, "start.sh");
    fs.writeFileSync(
      start,
      `#!/bin/bash\nnohup "${h.BINARY}" serve --http=127.0.0.1:${PORT + 2} --dir="${data}" --migrationsDir="${install}/pb_migrations" --hooksDir="${install}/pb_hooks" >/dev/null 2>&1 &\necho $! > "${pid}"\n`,
      { mode: 0o755 },
    );
    const stopSh = path.join(work, "stop.sh");
    fs.writeFileSync(stopSh, `#!/bin/bash\n[ -f "${pid}" ] && kill "$(cat "${pid}")" ; sleep 1\n`, {
      mode: 0o755,
    });

    // Existing install and data (pre-deploy state).
    fs.mkdirSync(install);
    for (const part of ["app", "pb_migrations", "pb_hooks"])
      fs.cpSync(path.join(src, part), path.join(install, part), { recursive: true });
    fs.writeFileSync(path.join(install, "app", "OLD_MARKER"), "old");
    h.upsertSuperuser(data, EMAIL, PASSWORD);
    spawnSync("bash", [start]);
    await h.waitForHealth(PORT + 2);

    const env = {
      HH_SRC_DIR: src,
      HH_INSTALL_DIR: install,
      HH_PB_BIN: h.BINARY,
      HH_DATA_DIR: data,
      HH_BACKUP_TARGET: target,
      HH_HEALTH_URL: `http://127.0.0.1:${PORT + 2}/api/health`,
      HH_STOP_CMD: stopSh,
      HH_START_CMD: start,
    };
    const bad = run(path.join(h.ROOT, "scripts", "deploy.sh"), ["v9.9.9"], env);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /tag not found/);

    const d = run(path.join(h.ROOT, "scripts", "deploy.sh"), ["v1.0.1"], env);
    assert.equal(d.status, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /msg="deploy finished, service healthy" tag=v1\.0\.1/);
    assert.equal(snapshots(target).length, 1, "pre-deploy backup exists");
    assert.ok(d.stdout.indexOf("backup written") < d.stdout.indexOf("migrations applied"));
    assert.equal(
      fs.existsSync(path.join(install, "app", "OLD_MARKER")),
      false,
      "tagged files replace the old ones",
    );
    assert.equal((await h.api(PORT + 2, "GET", "/api/health")).status, 200);
  } finally {
    try {
      process.kill(Number(fs.readFileSync(pid, "utf8")), "SIGTERM");
    } catch {
      // already stopped
    }
    await new Promise((r) => setTimeout(r, 500));
    h.rmrf(work);
  }
});
