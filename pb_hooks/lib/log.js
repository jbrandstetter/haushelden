// Governing: SPEC-0007 REQ "Logging", REQ "Error Handling Standards", SPEC-0001 Security Requirements
//
// Structured log line helper. CommonJS and free of Node-only APIs so the same file runs under Node (tests)
// and inside PocketBase's JS hook runtime. Lines are key=value with a UTC timestamp. Secrets never reach a line:
// values of sensitive keys are replaced, and request bodies and query strings are not logged at all.

// Keys whose values are never written (matched case-insensitively as a substring).
const SENSITIVE = /pass|pin|token|secret|authorization|cookie|credential|key|body/i;
const REDACTED = "[redacted]";

function redactValue(key, value) {
  return SENSITIVE.test(key) ? REDACTED : value;
}

function quote(text) {
  const s = String(text).replace(/[\r\n]+/g, " ");
  return /^[A-Za-z0-9_.:/@+-]+$/.test(s) ? s : `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Formats one log line: ts, level, msg, then the given fields in order.
 *
 * @param {string} level info, warn or error
 * @param {string} msg short event description
 * @param {Record<string, unknown>} [fields] flat key/value pairs; sensitive keys are redacted
 * @param {Date} [now] injectable clock
 * @returns {string}
 */
function formatLine(level, msg, fields = {}, now = new Date()) {
  const parts = [`ts=${now.toISOString()}`, `level=${level}`, `msg=${quote(msg)}`];
  for (const key of Object.keys(fields)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = fields[key];
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${quote(redactValue(key, value))}`);
  }
  return parts.join(" ");
}

// Only the path is logged: record ids are not secrets, but query strings can carry tokens.
function safePath(rawPath) {
  return String(rawPath || "").split("?")[0];
}

// /api/collections/<name>/auth-with-password and similar auth endpoints: the collection being signed in to.
function authCollection(path) {
  const match = /^\/api\/collections\/([^/]+)\/(auth-[a-z-]+|request-[a-z-]+|confirm-[a-z-]+)$/.exec(path);
  return match ? match[1] : "";
}

module.exports = { formatLine, redactValue, safePath, authCollection, SENSITIVE, REDACTED };
