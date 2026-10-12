#!/usr/bin/env node
// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only, local PocketBase only)
//
// Seeds a running local PocketBase with the fake household. Idempotent per step: a step whose collection already
// holds records is left alone. Steps for collections that do not exist yet are skipped.

const { loadEnvironment } = require("./env.js");
const { steps } = require("./seed/steps.js");
const { defaultSecrets } = require("./seed/fixtures.js");

async function api(base, path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Runs the steps against a PocketBase base URL. Returns a list of `{ collection, outcome }`. */
async function runSeed({
  base,
  email,
  password,
  secrets = defaultSecrets,
  steps: seedSteps = steps,
  log = console.log,
}) {
  const auth = await api(base, "/api/collections/_superusers/auth-with-password", {
    method: "POST",
    body: { identity: email, password },
  });
  if (auth.status !== 200) throw new Error(`seed: superuser sign-in failed (HTTP ${auth.status})`);
  const token = auth.data.token;

  const ctx = { ids: {}, secrets };
  const results = [];
  for (const step of seedSteps) {
    const col = await api(base, `/api/collections/${step.collection}`, { token });
    if (col.status === 404) {
      log(`skip ${step.collection}: collection does not exist yet`);
      results.push({ collection: step.collection, outcome: "skipped" });
      continue;
    }
    if (col.status !== 200) throw new Error(`seed: reading ${step.collection} failed (HTTP ${col.status})`);

    const existing = await api(base, `/api/collections/${step.collection}/records?perPage=1`, { token });
    if (existing.data && existing.data.totalItems > 0) {
      if (step.identify) {
        // Rebuild the id map so steps that follow can still reference this collection's records.
        const all = await api(base, `/api/collections/${step.collection}/records?perPage=200`, { token });
        ctx.ids[step.collection] = {};
        for (const record of all.data.items) {
          const key = step.identify(record);
          if (key) ctx.ids[step.collection][key] = record.id;
        }
      }
      log(`keep ${step.collection}: already has records`);
      results.push({ collection: step.collection, outcome: "kept" });
      continue;
    }
    ctx.ids[step.collection] = {};
    for (const { [step.key || "key"]: key, ...record } of step.records(ctx)) {
      const created = await api(base, `/api/collections/${step.collection}/records`, {
        method: "POST",
        token,
        body: record,
      });
      if (created.status !== 200) {
        throw new Error(`seed: creating ${step.collection} record failed (HTTP ${created.status})`);
      }
      if (key) ctx.ids[step.collection][key] = created.data.id;
    }
    log(`seeded ${step.collection}`);
    results.push({ collection: step.collection, outcome: "seeded" });
  }
  return results;
}

async function main() {
  const { config } = loadEnvironment();
  if (config.mode === "production") throw new Error("seed: refusing to seed in production mode");
  const base = `http://${config.HH_LISTEN}`;
  await runSeed({
    base,
    email: config.HH_DEV_ADMIN_EMAIL,
    password: config.HH_DEV_ADMIN_PASSWORD,
    secrets: {
      parentPassword: config.HH_DEV_PARENT_PASSWORD || defaultSecrets.parentPassword,
      deviceSecret: config.HH_DEV_DEVICE_SECRET || defaultSecrets.deviceSecret,
      parentPin: config.HH_DEV_PARENT_PIN || defaultSecrets.parentPin,
    },
  });
  console.log("Seed done (fake household; collections that do not exist yet were skipped).");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { runSeed };
