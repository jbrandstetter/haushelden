// Governing: ADR-0004 (configuration outside the public repo), SPEC-0001 REQ "Household Day and Time Zone",
// SPEC-0007 REQ "Configuration Keys" (HH_TZ)
//
// GET /api/hh/config: the household time zone for signed-in clients. HH_TZ is deployment configuration, so the
// app learns it from the server instead of baking it into the public shell. Parents and enrolled devices only
// (SPEC-0001 Security Requirements: every endpoint is authenticated unless listed as public).

routerAdd(
  "GET",
  "/api/hh/config",
  (e) => {
    const tz = $os.getenv("HH_TZ");
    return e.json(200, { tz: tz && tz.trim() !== "" ? tz.trim() : "Europe/Berlin" });
  },
  $apis.requireAuth("parents", "devices"),
);
