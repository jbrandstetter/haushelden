/* global toString, TooManyRequestsError, BadRequestError, ForbiddenError, onRecordDeleteRequest */
// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Household and Members", Security Requirements
// "Authentication", "Rate Limiting", "Request Body Size Limits"
//
//  - GET /api/hh/export: every household collection as one JSON file, for signed-in parents only (devices and
//    anonymous callers are refused by requireAuth("parents")). Credentials never leave: parents, devices and
//    invites are not exported and every key that looks like a secret is scrubbed.
//  - Member guards on top of the collection rules (parents write members): parents are created only by invite,
//    a parent account keeps its role and is not removed here (so the last parent can never go).
// Handlers load their helpers with require() inside the handler (each handler has its own JS scope).

routerAdd(
  "GET",
  "/api/hh/export",
  (e) => {
    const hh = require(`${__hooks}/lib/server.js`);
    const s = require(`${__hooks}/lib/settings.js`);
    // Every export counts: at most 20 per 15 minutes per parent.
    if (!s.takeExportSlot($app.store(), e.auth.id)) throw new TooManyRequestsError(hh.TOO_MANY);

    const collections = {};
    for (const col of $app.findAllCollections("base")) {
      if (!s.exportable(col.name)) continue;
      const jsonFields = col.fields.filter((f) => f.type() === "json").map((f) => f.getName());
      collections[col.name] = $app.findAllRecords(col.name).map((r) => {
        const out = JSON.parse(JSON.stringify(r.publicExport()));
        // JSON fields come out of the round trip as byte arrays: decode them to real JSON.
        for (const f of jsonFields) {
          const raw = toString(r.get(f));
          out[f] = raw ? JSON.parse(raw) : null;
        }
        return out;
      });
    }
    const settings = collections.settings && collections.settings[0];
    const now = new Date();
    const doc = s.buildExport({
      tz: s.householdTz(settings && settings.tz, $os.getenv("HH_TZ")),
      now,
      collections,
    });
    e.response.header().set("Content-Disposition", `attachment; filename="${s.exportFileName(now)}"`);
    e.response.header().set("Cache-Control", "no-store");
    return e.json(200, doc);
  },
  $apis.bodyLimit(64 * 1024),
  $apis.requireAuth("parents"),
);

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next(); // operators (seed, restore) are not bound by the settings guards
  const s = require(`${__hooks}/lib/settings.js`);
  const problem = s.checkMemberCreate({ role: e.record.getString("role") });
  if (problem) throw new BadRequestError(problem);
  e.next();
}, "members");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const s = require(`${__hooks}/lib/settings.js`);
  const problem = s.checkMemberUpdate({
    before: { role: e.record.original().getString("role") },
    after: { role: e.record.getString("role") },
    hasAccount: s.hasAccount(e.app, e.record.id),
  });
  if (problem) throw new BadRequestError(problem);
  e.next();
}, "members");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const s = require(`${__hooks}/lib/settings.js`);
  const problem = s.checkMemberDelete({
    role: e.record.getString("role"),
    hasAccount: s.hasAccount(e.app, e.record.id),
    parentAccounts: e.app.countRecords("parents"),
  });
  if (problem) throw new ForbiddenError(problem);
  e.next();
}, "members");
