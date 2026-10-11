// Governing: ADR-0004 (configuration outside the public repo), SPEC-0007 REQ "Configuration Keys"
//
// Reads the environment for the dev scripts: an optional .env file in the repository root, overridden by the
// real process environment.

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../pb_hooks/lib/config.js");

const ROOT = path.resolve(__dirname, "..");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

function loadEnvironment() {
  const env = { ...readEnvFile(path.join(ROOT, ".env")), ...process.env };
  const config = loadConfig(env, {
    freshInstall: (dataDir) => !fs.existsSync(path.resolve(ROOT, dataDir, "data.db")),
  });
  return { env, config };
}

module.exports = { ROOT, readEnvFile, loadEnvironment };
