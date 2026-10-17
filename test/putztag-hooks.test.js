// Governing: SPEC-0010 REQ "Ticking Off", REQ "Assigning and Adding Chores"
// The pure helper of the cleaning day hooks (the hooks themselves run against PocketBase in test/rules/chores.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTick } = require("../pb_hooks/lib/putztag.js");

test("a chore that is not done has nobody who did it", () => {
  assert.deepEqual(
    normalizeTick({ done: false, doneBy: "kind1", assignee: "kind1", previousAssignee: "kind1", actor: "" }),
    { done: false, doneBy: "" },
  );
});

test("a tick keeps the member named, else the ticking parent, else the assignee", () => {
  assert.deepEqual(
    normalizeTick({ done: true, doneBy: "kind1", assignee: "kind1", previousAssignee: "kind1", actor: "" }),
    { done: true, doneBy: "kind1" },
  );
  assert.deepEqual(
    normalizeTick({ done: true, doneBy: "", assignee: "kind1", previousAssignee: "kind1", actor: "mama" }),
    { done: true, doneBy: "mama" },
  );
  assert.deepEqual(
    normalizeTick({ done: true, doneBy: "", assignee: "kind1", previousAssignee: "kind1", actor: "" }),
    { done: true, doneBy: "kind1" },
  );
});

test("reassigning clears the tick; creating does not count as reassigning", () => {
  assert.deepEqual(
    normalizeTick({
      done: true,
      doneBy: "kind1",
      assignee: "kind2",
      previousAssignee: "kind1",
      actor: "mama",
    }),
    { done: false, doneBy: "" },
  );
  assert.deepEqual(
    normalizeTick({ done: true, doneBy: "", assignee: "kind2", previousAssignee: null, actor: "mama" }),
    { done: true, doneBy: "mama" },
  );
});
