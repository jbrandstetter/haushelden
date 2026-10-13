// Governing: SPEC-0008 REQ "Family Help Page" (public, German, nothing internal), ADR-0004
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const { SECTIONS, INTRO, buildHelp, screen } = require("../app/js/screens/hilfe.js");
const { ROUTES } = require("../app/js/routes.js");
const { PUBLIC_ROUTES } = require("../app/js/auth.js");

const texts = () =>
  SECTIONS.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => b.p || b.note || b.steps || b.list || [])]);

test("the help page has titled sections with unique ids and no empty text", () => {
  assert.ok(SECTIONS.length >= 8);
  assert.equal(new Set(SECTIONS.map((s) => s.id)).size, SECTIONS.length, "unique ids");
  for (const t of texts()) assert.ok(typeof t === "string" && t.trim().length > 5, `text: ${t}`);
});

test("it covers the topics a family needs: installing, signing in, kids' list, shopping, offline, problems, privacy", () => {
  const ids = SECTIONS.map((s) => s.id);
  for (const id of [
    "installieren",
    "anmelden",
    "tagesliste",
    "einkaufen",
    "offline",
    "probleme",
    "datenschutz",
  ])
    assert.ok(ids.includes(id), id);
  const all = texts().join("\n");
  assert.match(all, /Zum Home-Bildschirm/);
  assert.match(all, /Als Familiengerät einrichten/);
  assert.match(all, /Einkauf fertig/);
  assert.match(all, /nicht synchronisiert/);
});

test("nothing internal in a page anyone can open: no addresses, hosts, e-mails, secrets or real names", () => {
  const all = [INTRO, ...texts()].join("\n");
  assert.equal(/https?:|www\.|localhost|\b\d{1,3}(\.\d{1,3}){3}\b|@\w|\.local\b|\.test\b/i.test(all), false);
  assert.equal(/passwort\s*[:=]|token\s*[:=]/i.test(all), false);
  for (const name of ["Kathrin", "Julian", "Franziska", "Test-Papa", "Test-Mama"])
    assert.equal(all.includes(name), false, name);
});

test("it renders as headings and native details sections, the first one open, and appends to the view", () => {
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  screen(view);
  assert.equal(view.querySelector("h1").textContent, "Hilfe");
  const sections = view.querySelectorAll("details");
  assert.equal(sections.length, SECTIONS.length);
  assert.notEqual(sections[0].getAttribute("open"), null);
  assert.equal(
    sections.slice(1).some((d) => d.getAttribute("open") !== null),
    false,
  );
  assert.equal(
    view.querySelector('[data-section="installieren"] ol').querySelectorAll("li").length >= 3,
    true,
  );
  assert.equal(buildHelp(doc).querySelectorAll("summary").length, SECTIONS.length);
});

test("the route exists and is public (reachable signed out)", () => {
  assert.ok(ROUTES.some(([name, script]) => name === "hilfe" && script === "js/screens/hilfe.js"));
  assert.ok(PUBLIC_ROUTES.includes("hilfe"));
});
