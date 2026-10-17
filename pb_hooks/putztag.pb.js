// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0010 REQ "Ticking Off", REQ "Assigning and Adding
// Chores", Security Requirements "Authorisation" and "Input"
//
// Request hooks for `chores` and `chore_templates` (the collection rules do the authorisation, see the migration):
//  - titles are stored trimmed and whitespace-collapsed; `day` must be a real calendar day
//  - `done` and `done_by` stay consistent: done needs a `done_by` (a parent ticking without naming anyone is recorded as
//    themselves), not done has none; reassigning a chore clears its tick
//  - a replayed create (the first response was lost) is reported as "id already exists"; the client treats that as done
// (Handlers run in isolated scopes: helpers live in lib/putztag.js.)

onRecordCreateRequest((e) => {
  const c = require(`${__hooks}/lib/putztag.js`);
  c.checkNewRecord(e, "chores");
  c.checkChore(e, null);
  e.next();
}, "chores");

onRecordUpdateRequest((e) => {
  const c = require(`${__hooks}/lib/putztag.js`);
  const before = e.record.original();
  c.checkChore(e, before);
  e.next();
}, "chores");

onRecordCreateRequest((e) => {
  const c = require(`${__hooks}/lib/putztag.js`);
  c.checkNewRecord(e, "chore_templates");
  c.cleanTitle(e.record);
  e.next();
}, "chore_templates");

onRecordUpdateRequest((e) => {
  const c = require(`${__hooks}/lib/putztag.js`);
  c.cleanTitle(e.record);
  e.next();
}, "chore_templates");
