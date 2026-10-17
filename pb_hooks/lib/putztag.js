// Governing: SPEC-0010 REQ "Ticking Off", REQ "Assigning and Adding Chores", Security Requirements "Input"
//
// Helpers for pb_hooks/putztag.pb.js. The pure part (`normalizeTick`) is unit-tested under Node
// (test/putztag-hooks.test.js); the request-hook part runs against a real server in test/rules/chores.test.js.

const shopping = require("./shopping.js");

/**
 * The tick state a chore may be stored in. `done` without `done_by` is completed with `actor` (the ticking member, a
 * parent); a chore that is not done has no `done_by`; a changed assignee clears the tick.
 * @returns {{ done: boolean, doneBy: string }}
 */
function normalizeTick({ done, doneBy, assignee, previousAssignee, actor }) {
  if (previousAssignee !== null && assignee !== previousAssignee) return { done: false, doneBy: "" };
  if (!done) return { done: false, doneBy: "" };
  return { done: true, doneBy: doneBy || actor || assignee || "" };
}

function recordExists(app, collection, id) {
  if (!id) return false;
  try {
    app.findRecordById(collection, id);
    return true;
  } catch {
    return false;
  }
}

/** A replayed create answers "id already exists" (the client treats that as done). */
function checkNewRecord(e, collection) {
  if (recordExists(e.app, collection, e.record.id)) {
    throw shopping.invalid("id", "validation_not_unique", "Dieser Eintrag existiert schon.");
  }
}

function cleanTitle(record) {
  record.set("title", shopping.normalizeName(record.getString("title")));
}

/** Validates and normalises a chore on create (`before` null) or update (`before` the stored record). */
function checkChore(e, before) {
  const record = e.record;
  if (Number.isNaN(shopping.dayNumber(record.getString("day")))) {
    throw shopping.invalid("day", "invalid_day", "Ungültiges Datum.");
  }
  cleanTitle(record);
  if (record.getString("title") === "")
    throw shopping.invalid("title", "validation_required", "Titel fehlt.");
  const actor = e.auth && e.auth.collection().name === "parents" ? e.auth.getString("member") : "";
  const tick = normalizeTick({
    done: record.getBool("done"),
    doneBy: record.getString("done_by"),
    assignee: record.getString("assignee"),
    previousAssignee: before ? before.getString("assignee") : null,
    actor,
  });
  record.set("done", tick.done);
  record.set("done_by", tick.doneBy);
}

module.exports = { normalizeTick, recordExists, checkNewRecord, cleanTitle, checkChore };
