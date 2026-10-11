// Governing: SPEC-0001 REQ "Error Handling Standards" (sentinel errors for failure modes callers must tell apart,
// context added at each layer boundary)
//
// Sentinel error kinds for the sync layer. Callers branch on `err.kind`, never on message text.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).errors = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KIND = Object.freeze({
    NETWORK: "network", // could not reach the server (or it is temporarily unavailable): keep queued, retry later
    REJECTED: "rejected", // the server refused the change: keep queued, show "nicht synchronisiert"
    AUTH: "auth", // signed out or token expired: keep queued until the user signs in again
    NOT_FOUND: "not-found",
    EXISTS: "exists", // create with an id the server already has (a replayed create)
  });

  class SyncError extends Error {
    constructor(kind, message, { cause, status, data } = {}) {
      super(message, cause ? { cause } : undefined);
      this.name = "SyncError";
      this.kind = kind;
      this.status = status;
      this.data = data;
    }
  }

  const isKind = (err, kind) => err instanceof SyncError && err.kind === kind;

  /** Adds context at a layer boundary: "failed to update members/ab12: <inner message>". */
  function wrap(err, context) {
    if (err instanceof SyncError) {
      return new SyncError(err.kind, `${context}: ${err.message}`, {
        cause: err,
        status: err.status,
        data: err.data,
      });
    }
    return new SyncError(KIND.REJECTED, `${context}: ${err && err.message ? err.message : String(err)}`, {
      cause: err,
    });
  }

  return { KIND, SyncError, isKind, wrap };
});
