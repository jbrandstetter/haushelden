// Governing: ADR-0004 (configuration outside the public repo), SPEC-0007 REQ "Configuration Keys"
//
// Pure configuration loader. CommonJS and free of Node-only APIs so the same file runs under Node (start
// script, unit tests) and inside PocketBase's JS hook runtime.

const DEFAULTS = {
  HH_TZ: "Europe/Berlin",
  HH_DATA_DIR: "./pb_data",
  HH_LISTEN: "127.0.0.1:8090",
  HH_BACKUP_RETENTION_DAYS: "14",
};

// Required in production mode. A value still starting with "change-me" (from .env.example) counts as not configured.
const REQUIRED_IN_PRODUCTION = ["HH_PUBLIC_URL", "HH_BACKUP_TARGET", "HH_PB_VERSION"];

// Required when no database exists yet (first-run setup).
const REQUIRED_ON_FRESH_INSTALL = ["HH_SETUP_TOKEN"];

// Values from .env.example that must never reach production.
const PLACEHOLDER = "change-me";

function isSet(env, key) {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Builds the configuration from an environment object.
 *
 * @param {Record<string, string | undefined>} env environment variables (process.env or a parsed env file)
 * @param {{ freshInstall?: (dataDir: string) => boolean }} [options]
 *   freshInstall reports whether the data directory holds no database yet.
 * @returns {Record<string, string> & { mode: string }}
 * @throws {Error} "missing configuration: KEY" for the first missing required key in production mode
 */
function loadConfig(env, options = {}) {
  const mode = isSet(env, "HH_MODE") ? env.HH_MODE.trim() : "development";
  if (mode !== "development" && mode !== "production") {
    throw new Error(`invalid configuration: HH_MODE must be development or production`);
  }

  const config = { mode };
  for (const key of Object.keys(env)) {
    if (key.startsWith("HH_") && isSet(env, key)) config[key] = env[key].trim();
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!isSet(env, key)) config[key] = value;
  }

  if (mode === "production") {
    const required = [...REQUIRED_IN_PRODUCTION];
    const freshInstall = options.freshInstall ? options.freshInstall(config.HH_DATA_DIR) : false;
    if (freshInstall) required.push(...REQUIRED_ON_FRESH_INSTALL);
    for (const key of required) {
      if (!isSet(env, key)) throw new Error(`missing configuration: ${key}`);
      if (env[key].trim().toLowerCase().startsWith(PLACEHOLDER)) {
        throw new Error(`placeholder configuration: ${key} still has the example value`);
      }
    }
  }
  return config;
}

module.exports = { loadConfig, DEFAULTS, REQUIRED_IN_PRODUCTION, REQUIRED_ON_FRESH_INSTALL };
