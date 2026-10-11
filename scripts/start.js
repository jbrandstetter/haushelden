#!/usr/bin/env node
// Governing: ADR-0001 (PocketBase as backend), ADR-0004 (configuration outside the public repo),
// SPEC-0007 REQ "Local Development", REQ "Configuration Keys"
//
// One command to run the app: validates configuration, downloads the pinned PocketBase if needed, and starts it
// with the committed migrations, hooks and app/ directory. In development mode it also makes sure a fake local
// superuser exists (credentials from .env, never real ones).

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadEnvironment } = require("./env.js");

function main() {
  let loaded;
  try {
    loaded = loadEnvironment();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { env, config } = loaded;

  const binary = path.join(ROOT, ".pb", "pocketbase");
  if (!fs.existsSync(binary)) {
    const download = spawnSync("bash", [path.join(ROOT, "scripts", "pb-download.sh")], {
      stdio: "inherit",
      env: { ...process.env, HH_PB_VERSION: config.HH_PB_VERSION || env.HH_PB_VERSION || "" },
    });
    if (download.status !== 0) process.exit(download.status || 1);
  }

  const common = [
    `--dir=${path.resolve(ROOT, config.HH_DATA_DIR)}`,
    `--migrationsDir=${path.join(ROOT, "pb_migrations")}`,
    `--hooksDir=${path.join(ROOT, "pb_hooks")}`,
  ];

  if (config.mode === "development" && config.HH_DEV_ADMIN_EMAIL && config.HH_DEV_ADMIN_PASSWORD) {
    const upsert = spawnSync(
      binary,
      ["superuser", "upsert", config.HH_DEV_ADMIN_EMAIL, config.HH_DEV_ADMIN_PASSWORD, ...common],
      { stdio: "inherit", env: { ...process.env, ...env } },
    );
    if (upsert.status !== 0) process.exit(upsert.status || 1);
  }

  const args = ["serve", `--http=${config.HH_LISTEN}`, ...common, `--publicDir=${path.join(ROOT, "app")}`];
  console.log(
    `Haushelden (${config.mode}) on http://${config.HH_LISTEN}  admin UI: http://${config.HH_LISTEN}/_/`,
  );
  const child = spawn(binary, args, { stdio: "inherit", env: { ...process.env, ...env } });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
