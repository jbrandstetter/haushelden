// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Device Enrollment and Removal",
// REQ "Kid Access on Enrolled Devices"
//
// Pure validation helpers for the /api/hh/ account routes (no PocketBase globals, unit-tested under Node).

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 200;
// 32 random bytes as hex (64 chars) or base64url (43 chars); never shown to anyone.
const MIN_DEVICE_SECRET = 43;
const MAX_DEVICE_SECRET = 200;
const DEVICE_SECRET = /^[A-Za-z0-9_+/=-]+$/;
const PLACEHOLDER = "change-me";
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // SPEC-0001 REQ "First-Run Setup": valid for 48 hours
const PIN_SESSION_SECONDS = 15 * 60; // SPEC-0001 REQ "Kid Access on Enrolled Devices": at most 15 minutes
const TOO_MANY = "Zu viele Versuche. Bitte versuche es in 15 Minuten noch einmal.";

function str(value) {
  return typeof value === "string" ? value : "";
}

/** Returns an error message (German, shown to the user) or "" when the account fields are fine. */
function validateAccount({ name, email, password }) {
  const n = str(name).trim();
  if (n.length < 1 || n.length > 40) return "Bitte gib einen Namen mit 1 bis 40 Zeichen ein.";
  if (!EMAIL.test(str(email).trim())) return "Bitte gib eine gültige E-Mail-Adresse ein.";
  const pw = str(password);
  if (pw.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (pw.length > MAX_PASSWORD) return "Das Passwort ist zu lang.";
  return "";
}

function validateDevice({ name, secret }) {
  const n = str(name).trim();
  if (n.length < 1 || n.length > 60) return "Bitte gib einen Gerätenamen mit 1 bis 60 Zeichen ein.";
  const s = str(secret);
  if (s.length < MIN_DEVICE_SECRET || s.length > MAX_DEVICE_SECRET || !DEVICE_SECRET.test(s))
    return "Das Gerätegeheimnis ist ungültig.";
  return "";
}

/** The deployment's setup token counts as configured only when set and not the example placeholder. */
function setupTokenConfigured(token) {
  const t = str(token).trim();
  return t !== "" && !t.toLowerCase().startsWith(PLACEHOLDER);
}

module.exports = {
  validateAccount,
  validateDevice,
  setupTokenConfigured,
  MIN_PASSWORD,
  MIN_DEVICE_SECRET,
  INVITE_TTL_MS,
  PIN_SESSION_SECONDS,
  TOO_MANY,
};
