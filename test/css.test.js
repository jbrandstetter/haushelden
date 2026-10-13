// Guards against two regressions seen in the parents' view: text that could not be selected (a global
// `user-select: none`) and a navigation row styled under a container it is not inside, so none of its rules applied.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "app", "css", "app.css"), "utf8");
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  return at === -1 ? null : css.slice(at, css.indexOf("}", at) + 1);
};

test("text is selectable: the page body does not switch selection off", () => {
  const body = rule("body");
  assert.ok(body, "a body rule exists");
  assert.equal(/user-select\s*:\s*none/.test(body), false);
});

test("the navigation row of the parents' view is styled where it actually sits (not under .eltern)", () => {
  assert.ok(rule(".topnav"), "an unscoped .topnav rule exists");
  assert.equal(css.includes(".eltern .topnav"), false);
});

test("the stylesheet's braces are balanced", () => {
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
});
