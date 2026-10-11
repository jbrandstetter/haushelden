// Governing: SPEC-0001 REQ "Error Handling Standards" (Sync write fails: the server logs the rejection with
// member, record and reason as structured fields), REQ "Offline Operation"
//
// Logs every rejected record write (create, update, delete) with key-value fields, so a queued offline change
// that the server refuses can be traced afterwards. The response to the client is not changed.

routerUse((e) => {
  const method = e.request.method;
  if (method !== "POST" && method !== "PATCH" && method !== "DELETE") return e.next();
  const path = e.request.url.path;
  const match = /^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/.exec(path);
  if (!match) return e.next();

  try {
    return e.next();
  } catch (err) {
    let principalType = "anonymous";
    let principal = "";
    let member = "";
    if (e.auth) {
      principalType = e.auth.collection().name;
      principal = e.auth.id;
      if (principalType === "parents") member = e.auth.getString("member");
    }
    let status = 0;
    let reason = String(err);
    let detail = "";
    if (err && err.value) {
      status = err.value.status || 0;
      reason = err.value.message || reason;
      // Field-level validation errors, when there are any.
      detail = JSON.stringify(err.value.data || {});
    }
    $app
      .logger()
      .warn(
        "sync write rejected",
        "method",
        method,
        "collection",
        match[1],
        "record",
        match[2] || "",
        "principal_type",
        principalType,
        "principal",
        principal,
        "member",
        member,
        "status",
        status,
        "reason",
        reason,
        "detail",
        detail,
      );
    throw err;
  }
});
