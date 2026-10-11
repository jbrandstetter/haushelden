// Governing: SPEC-0007 REQ "Configuration Keys"
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../pb_hooks/lib/config.js");

const production = {
  HH_MODE: "production",
  HH_PUBLIC_URL: "https://example.invalid",
  HH_BACKUP_TARGET: "/backups/example",
  HH_SETUP_TOKEN: "example-setup-token",
  HH_PB_VERSION: "0.0.0",
};

test("development mode needs no keys and applies defaults", () => {
  const config = loadConfig({});
  assert.equal(config.mode, "development");
  assert.equal(config.HH_TZ, "Europe/Berlin");
  assert.equal(config.HH_DATA_DIR, "./pb_data");
  assert.equal(config.HH_LISTEN, "127.0.0.1:8090");
  assert.equal(config.HH_BACKUP_RETENTION_DAYS, "14");
});

test("production without HH_PUBLIC_URL fails naming the key", () => {
  const { HH_PUBLIC_URL: _omitted, ...env } = production;
  assert.throws(() => loadConfig(env), { message: "missing configuration: HH_PUBLIC_URL" });
});

test("production treats a blank value as missing", () => {
  assert.throws(() => loadConfig({ ...production, HH_BACKUP_TARGET: "  " }), {
    message: "missing configuration: HH_BACKUP_TARGET",
  });
});

test("production requires the pinned PocketBase version", () => {
  const { HH_PB_VERSION: _omitted, ...env } = production;
  assert.throws(() => loadConfig(env), { message: "missing configuration: HH_PB_VERSION" });
});

test("production with all required keys loads", () => {
  assert.equal(loadConfig(production).HH_PUBLIC_URL, "https://example.invalid");
});

test("setup token is required on a fresh install only", () => {
  const { HH_SETUP_TOKEN: _omitted, ...withoutToken } = production;
  assert.throws(() => loadConfig(withoutToken, { freshInstall: () => true }), {
    message: "missing configuration: HH_SETUP_TOKEN",
  });
  assert.doesNotThrow(() => loadConfig(withoutToken, { freshInstall: () => false }));
  assert.doesNotThrow(() => loadConfig(production, { freshInstall: () => false }));
});

test("unknown mode is rejected", () => {
  assert.throws(() => loadConfig({ HH_MODE: "staging" }), /invalid configuration/);
});

test("production rejects a required key that still has the example placeholder", () => {
  for (const key of ["HH_BACKUP_TARGET", "HH_PUBLIC_URL", "HH_PB_VERSION"]) {
    assert.throws(() => loadConfig({ ...production, [key]: "change-me" }), {
      message: `placeholder configuration: ${key} still has the example value`,
    });
  }
  assert.throws(
    () => loadConfig({ ...production, HH_SETUP_TOKEN: "change-me" }, { freshInstall: () => true }),
    {
      message: "placeholder configuration: HH_SETUP_TOKEN still has the example value",
    },
  );
});

test("development mode accepts placeholders", () => {
  assert.doesNotThrow(() => loadConfig({ HH_BACKUP_TARGET: "change-me", HH_SETUP_TOKEN: "change-me" }));
});
