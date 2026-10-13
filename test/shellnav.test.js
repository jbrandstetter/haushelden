// Governing: SPEC-0001 REQ "Prototype as UI Reference", REQ "Kid Access on Enrolled Devices"
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const { navItems, render } = require("../app/js/shellnav.js");

const keys = (items) => items.map((i) => i.key);

test("signed out: only the public Hilfe entry, the brand leads to the sign-in screen", () => {
  assert.deepEqual(keys(navItems({ kind: null, hash: "#/anmelden" })), ["hilfe"]);
  const doc = createDocument();
  const nav = doc.createElement("nav");
  render(nav, { kind: null, hash: "#/anmelden" }, doc);
  assert.equal(nav.querySelectorAll("a").length, 2, "brand plus Hilfe");
  assert.equal(nav.querySelector("a.brand").getAttribute("href"), "#/anmelden");
});

test("a parent sees Wer bist du?, Aufgaben, Einkauf (for their own member), Einstellungen and Hilfe", () => {
  const items = navItems({ kind: "parent", memberId: "mem 1", hash: "#/eltern" });
  assert.deepEqual(keys(items), ["wer", "eltern", "einkauf", "einstellungen", "hilfe"]);
  assert.equal(items.find((i) => i.key === "einkauf").href, "#/einkauf/mem%201");
  assert.equal(items.find((i) => i.key === "eltern").current, true);
});

test("a PIN session on a family device is offered the same entries as a parent", () => {
  assert.deepEqual(keys(navItems({ kind: "pin", memberId: "m", hash: "#/" })), [
    "wer",
    "eltern",
    "einkauf",
    "einstellungen",
    "hilfe",
  ]);
});

test("a plain family device sees no parent entries (Aufgaben, Einstellungen)", () => {
  const items = navItems({ kind: "device", hash: "#/wer" });
  assert.deepEqual(keys(items), ["wer", "einkauf", "hilfe"]);
  assert.equal(items.find((i) => i.key === "einkauf").href, "#/einkauf", "a device has no member of its own");
});

test("sub-screens highlight their section: Bereiche, Routinen and Maskottchen under Einstellungen, Gelernt under Einkauf", () => {
  const current = (hash, kind = "parent") =>
    navItems({ kind, memberId: "m", hash }).find((i) => i.current)?.key;
  for (const hash of ["#/bereiche", "#/routinen", "#/maskottchen", "#/einstellungen"])
    assert.equal(current(hash), "einstellungen", hash);
  assert.equal(current("#/gelernt"), "einkauf");
  assert.equal(current("#/einkauf/abc"), "einkauf");
  assert.equal(current("#/kind/abc"), "wer");
  assert.equal(current("#/wer"), "wer");
  assert.equal(current("#/eltern"), "eltern");
});

test("render marks exactly the current page with aria-current and replaces the previous content", () => {
  const doc = createDocument();
  const nav = doc.createElement("nav");
  render(nav, { kind: "parent", memberId: "m", hash: "#/bereiche" }, doc);
  render(nav, { kind: "parent", memberId: "m", hash: "#/bereiche" }, doc);
  const links = nav.querySelectorAll("a");
  assert.equal(links.length, 6, "brand plus five entries, no duplicates after a second render");
  const current = links.filter((a) => a.getAttribute("aria-current") === "page");
  assert.deepEqual(
    current.map((a) => a.getAttribute("data-nav")),
    ["einstellungen"],
  );
  assert.equal(nav.querySelector("a.brand").getAttribute("href"), "#/wer");
});

test("every screen reachable from the navigation exists in the route list", () => {
  const { ROUTES } = require("../app/js/routes.js");
  const names = new Set(ROUTES.map(([name]) => name));
  for (const kind of ["parent", "pin", "device"])
    for (const item of navItems({ kind, memberId: "m", hash: "#/" })) {
      assert.ok(names.has(item.href.replace(/^#\//, "").split("/")[0]), `${item.href} has a route`);
    }
});

test("Hilfe is public: it is marked as the current page on its own route, signed in or not", () => {
  for (const kind of [null, "device", "parent"]) {
    const current = navItems({ kind, memberId: "m", hash: "#/hilfe" }).find((i) => i.current);
    assert.equal(current && current.key, "hilfe", String(kind));
  }
});
