// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003, SPEC-0001 REQ "Household Settings",
// REQ "Data Export", REQ "Household and Members", REQ "Device Enrollment and Removal"
//
// Pure helpers for pb_hooks/settings.pb.js (no PocketBase globals, unit-tested under Node): the member guards
// (what a parent may change about a member, the last-parent rule) and the shape of the data export.

const EXPORT_VERSION = 1;
const EXPORT_LIMIT_PER_WINDOW = 20; // exports per parent per 15 minutes (SPEC-0001 "Rate Limiting")
const EXPORT_WINDOW_MS = 15 * 60 * 1000;

// Base collections that never leave the server in an export (invite tokens are credentials).
const EXCLUDED_COLLECTIONS = ["invites"];
// Keys (lower case) that must never appear anywhere in an export, whatever a future collection adds.
const SENSITIVE_KEYS = ["pin_hash", "password", "passwordhash", "tokenkey", "token_hash", "token", "secret"];

const LAST_PARENT = "Das letzte Elternteil lässt sich nicht entfernen.";
const NOT_REMOVABLE = "Eltern-Konten lassen sich hier nicht entfernen.";
const ROLE_FIXED = "Die Rolle lässt sich nicht ändern. Eltern kommen über eine Einladung dazu.";
const NO_NEW_PARENT = "Neue Eltern kommen über eine Einladung, nicht über diese Liste.";

/** Removes sensitive keys at any depth. Returns a new value; the input is not changed. */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) continue;
      out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

/** True when a base collection belongs in the export (not an internal `_` collection, not excluded). */
function exportable(name) {
  return (
    typeof name === "string" && name !== "" && !name.startsWith("_") && !EXCLUDED_COLLECTIONS.includes(name)
  );
}

/** The household time zone: the settings override, else the deployment's HH_TZ, else Europe/Berlin. */
function householdTz(settingsTz, envTz) {
  for (const tz of [settingsTz, envTz]) if (typeof tz === "string" && tz.trim() !== "") return tz.trim();
  return "Europe/Berlin";
}

/**
 * The export document. `collections` maps a collection name to its list of plain records.
 * @param {{ tz: string, now: Date, collections: Record<string, object[]> }} input
 */
function buildExport({ tz, now, collections }) {
  const out = {};
  for (const name of Object.keys(collections).filter(exportable).sort()) out[name] = scrub(collections[name]);
  return { app: "haushelden", version: EXPORT_VERSION, exported_at: now.toISOString(), tz, collections: out };
}

/** File name offered for the download. */
function exportFileName(now) {
  return `haushelden-export-${now.toISOString().slice(0, 10)}.json`;
}

/** Returns a German message when a new member must be refused, else "". Parents are created only by invite. */
function checkMemberCreate({ role }) {
  return role === "parent" ? NO_NEW_PARENT : "";
}

/**
 * Returns a German message when the change must be refused, else "". A member with a parent account keeps role
 * `parent`; a member without one cannot become a parent. That keeps "the last parent cannot be demoted" true by
 * construction.
 */
function checkMemberUpdate({ before, after, hasAccount }) {
  if (before.role === after.role) return "";
  if (hasAccount) return ROLE_FIXED;
  if (after.role === "parent") return NO_NEW_PARENT;
  return "";
}

/**
 * Returns a German message when the member must not be removed, else "". Parent accounts are not removed from
 * the settings screen in v1 (no route deletes a `parents` record), so any parent is refused; the last one gets
 * its own message.
 * @param {{ role: string, hasAccount: boolean, parentAccounts: number }} input parentAccounts = accounts in total
 */
function checkMemberDelete({ role, hasAccount, parentAccounts }) {
  if (!hasAccount && role !== "parent") return "";
  return parentAccounts <= 1 ? LAST_PARENT : NOT_REMOVABLE;
}

/**
 * Counts one export for `id` in a store with get/set (PocketBase's `$app.store()`); returns false when the
 * parent already used up the window. Exports are cheap to ask for and costly to build, so every call counts.
 */
function takeExportSlot(store, id, now = Date.now()) {
  const key = `hh.rl.export.${id}`;
  let list = [];
  try {
    list = JSON.parse(store.get(key) || "[]").filter((t) => now - t < EXPORT_WINDOW_MS);
  } catch {
    list = [];
  }
  if (list.length >= EXPORT_LIMIT_PER_WINDOW) return false;
  list.push(now);
  store.set(key, JSON.stringify(list));
  return true;
}

/** PocketBase side: true when a `parents` account belongs to the member. */
function hasAccount(app, memberId) {
  try {
    app.findFirstRecordByData("parents", "member", memberId);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  hasAccount,
  EXPORT_VERSION,
  EXPORT_LIMIT_PER_WINDOW,
  takeExportSlot,
  EXCLUDED_COLLECTIONS,
  SENSITIVE_KEYS,
  scrub,
  exportable,
  householdTz,
  buildExport,
  exportFileName,
  checkMemberCreate,
  checkMemberUpdate,
  checkMemberDelete,
};
