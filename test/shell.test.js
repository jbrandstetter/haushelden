// Governing: SPEC-0001 REQ "Installable Web App", REQ "Prototype as UI Reference", REQ "Offline Operation"
// (the shell opens offline: everything the page loads is precached), SPEC-0001 Security Requirements (no inline
// scripts, so the required Content-Security-Policy `script-src 'self'` works)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..", "app");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(APP, f), "utf8");

test("index.html references only files that exist and has no inline script", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(APP, ref)), `${ref} is missing in app/`);
  assert.equal(
    /<script(?![^>]*\bsrc=)[^>]*>/.test(html),
    false,
    "inline <script> would break script-src 'self'",
  );
  assert.match(html, /<html lang="de">/);
  for (const role of ["banner", "navigation", "main", "contentinfo"])
    assert.match(html, new RegExp(`role="${role}"`));
  assert.match(html, /id="syncstate"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("the service worker precaches every asset the page loads", () => {
  const sw = read("sw.js");
  const listed = new Set([...sw.matchAll(/^\s+"([^"]+)",?$/gm)].map((m) => m[1]));
  const html = read("index.html");
  const loaded = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]);
  for (const f of loaded)
    assert.ok(listed.has(f), `${f} is loaded by index.html but missing from the service worker FILES`);
  const { ROUTES } = require("../app/js/routes.js");
  for (const [, script] of ROUTES) assert.ok(listed.has(script), `${script} is a route but not precached`);
  for (const f of listed)
    if (f !== "./") assert.ok(fs.existsSync(path.join(APP, f)), `${f} is precached but missing`);
});

test("the service worker is network-first, never touches the API and revalidates with the server", () => {
  const sw = read("sw.js");
  assert.match(sw, /fetch\(e\.request, \{ cache: "no-cache" \}\)/);
  assert.match(sw, /\.catch\(\(\) => caches\.match/);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /method !== "GET"/);
});

test("manifest: installable, standalone, icons exist", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(m.display, "standalone");
  assert.equal(m.name, "Haushelden");
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(APP, i.src)), i.src);
  assert.ok(fs.existsSync(path.join(APP, "icon-180.png")));
});

test("CSS carries the prototype's Catppuccin Latte and Mocha tokens", () => {
  const css = read("css/app.css");
  const proto = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const hexes = (s) => new Set(s.match(/--[a-z0-9]+: #[0-9a-f]{6}/gi));
  const want = hexes(proto.slice(proto.indexOf("/* Catppuccin"), proto.indexOf("* { box-sizing")));
  const have = hexes(css);
  assert.ok(want.size > 30);
  for (const token of want) assert.ok(have.has(token), `${token} missing from app/css/app.css`);
});

test("the shell bundles no secrets or deployment values (ADR-0004)", () => {
  for (const f of fs.readdirSync(path.join(APP, "js")).filter((n) => n.endsWith(".js"))) {
    assert.doesNotMatch(read(`js/${f}`), /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.[a-z]{2,}/i, f);
  }
});
