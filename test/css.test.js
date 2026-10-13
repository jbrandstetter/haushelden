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

/** Selectors of every rule that switches text selection off. */
const noSelectSelectors = (source) =>
  [
    ...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*user-select\s*:\s*none[^{}]*)\}/g),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

test("text is selectable: only controls and tap tiles switch selection off, never the page or its content", () => {
  const selectors = noSelectSelectors(css);
  for (const sel of selectors) {
    assert.equal(/^(html|body|main|\*|#view)(\s|$|\.|:)/.test(sel), false, `user-select: none on ${sel}`);
  }
  assert.ok(selectors.includes("button"), "buttons are still not selectable");
});

test("the navigation row of the parents' view is styled where it actually sits (not under .eltern)", () => {
  assert.ok(rule(".topnav"), "an unscoped .topnav rule exists");
  assert.equal(css.includes(".eltern .topnav"), false);
});

test("the stylesheet's braces are balanced", () => {
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
});
