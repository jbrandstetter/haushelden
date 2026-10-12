// Governing: SPEC-0007 REQ "Logging" (structured, UTC, no passwords/PINs/tokens/device secrets/request bodies,
// 14 days retention), REQ "Container" (events go to the service manager's journal), REQ "Error Handling Standards"
//
// Writes one key=value line per API request to stdout, which the init system's journal collects. A failed
// sign-in records time, auth collection, client address and reason - never the submitted credentials. The
// request body and the query string are never read. PocketBase's own request log is kept for 14 days too.

routerUse((e) => {
  const log = require(`${__hooks}/lib/log.js`);
  const path = log.safePath(e.request.url.path);
  if (!path.startsWith("/api/") || path === "/api/health") return e.next();

  const started = Date.now();
  const emit = (level, msg, extra) => {
    let principalType = "anonymous";
    if (e.auth) principalType = e.auth.collection().name;
    console.log(
      log.formatLine(
        level,
        msg,
        Object.assign(
          {
            method: e.request.method,
            path: path,
            principal_type: principalType,
            client: e.realIP(),
            duration_ms: Date.now() - started,
          },
          extra,
        ),
      ),
    );
  };

  try {
    const result = e.next();
    emit("info", "request", { status: e.status() });
    return result;
  } catch (err) {
    let status = 500;
    let reason = "internal error";
    if (err && err.value) {
      status = err.value.status || status;
      reason = err.value.message || reason;
    }
    const collection = log.authCollection(path);
    if (collection && path.indexOf("/auth-with-") >= 0) {
      emit("warn", "sign-in failed", { auth_collection: collection, status: status, reason: reason });
    } else {
      emit(status >= 500 ? "error" : "warn", "request failed", { status: status, reason: reason });
    }
    throw err;
  }
});

onBootstrap((e) => {
  e.next();
  // Keep PocketBase's own request log for 14 days (SPEC-0007 REQ "Logging").
  const settings = $app.settings();
  if (settings.logs.maxDays !== 14) {
    settings.logs.maxDays = 14;
    $app.save(settings);
  }
});
