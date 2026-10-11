// Governing: ADR-0004 (configuration outside the public repo), SPEC-0007 REQ "Configuration Keys"
//
// Stops PocketBase from starting in production mode when a required configuration key is missing, even when
// PocketBase is launched directly (for example by a service manager) instead of through scripts/start.js.

onBootstrap((e) => {
  const { loadConfig } = require(`${__hooks}/lib/config.js`);
  const env = {};
  for (const key of [
    "HH_MODE",
    "HH_PUBLIC_URL",
    "HH_BACKUP_TARGET",
    "HH_PB_VERSION",
    "HH_SETUP_TOKEN",
    "HH_DATA_DIR",
  ]) {
    env[key] = $os.getenv(key);
  }
  // First-run detection needs the data directory; the hook runs after PocketBase created it, so the
  // setup token is only enforced by scripts/start.js, which can see whether a database exists beforehand.
  loadConfig(env);
  e.next();
});
