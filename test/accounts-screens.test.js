/* global location */
// Governing: ADR-0003, SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Device Enrollment and
// Removal", REQ "Kid Access on Enrolled Devices", Accessibility Requirements
//
// Render and flow tests for the account screens (setup, sign-in, invite, "Wer bist du?" with the PIN prompt and
// the device enrollment form) in a fake DOM against a scripted flow object. Scenario names from SPEC-0001 appear
// in the test names. A fake DOM is not a browser: layout, focus and real keyboards are not covered.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const dates = require("../app/js/dates.js");
const createUi = require("../app/js/auth-ui.js");

function docWithExtras() {
  const doc = createDocument();
  const make = doc.createElement;
  doc.createElement = (tag) => {
    const e = make(tag);
    // `id` is a property on real elements; mirror it into the attributes so selectors can find it.
    Object.defineProperty(e, "id", {
      get: () => e.attrs.id || "",
      set: (v) => {
        e.attrs.id = v;
      },
    });
    e.style = { setProperty() {} };
    e.focus = function () {
      doc.focused = this;
    };
    return e;
  };
  return doc;
}

/** Fires an event and waits for async handlers (the fake DOM's own dispatch does not). */
const fire = (el, type) =>
  Promise.all((el.listeners[type] || []).map((fn) => fn({ type, target: el, preventDefault() {} })));

/** Builds the screens with a scripted flow; `calls` records what the screens asked for. */
function setupUi(kind, results = {}) {
  globalThis.location = { hash: "" };
  const calls = [];
  const answer =
    (name) =>
    async (...args) => {
      calls.push([name, ...args]);
      return results[name] || { ok: true };
    };
  const flow = {
    kind: () => kind,
    setup: answer("setup"),
    signInParent: answer("signInParent"),
    acceptInvite: answer("acceptInvite"),
    unlockParent: answer("unlockParent"),
    enrollDevice: answer("enrollDevice"),
    signOut: answer("signOut"),
    backToDevice: answer("backToDevice"),
  };
  const ui = createUi({
    dates,
    get flow() {
      return flow;
    },
  });
  const doc = docWithExtras();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  current = view;
  return { ui, doc, view, calls };
}

const member = (id, role, name, emoji = "🙂") => ({ id, role, name, emoji, colour: "blue" });
const MEMBERS = [
  member("kind1", "kid", "Test-Kind-1", "⚽"),
  member("kind2", "kid", "Test-Kind-2", "🐴"),
  member("papa", "parent", "Test-Papa"),
  member("mama", "parent", "Test-Mama"),
];
const ctxFor = (record) => ({
  args: [],
  clock: { todayNumber: () => 20000, today: () => "2026-10-12" },
  data: {
    subscribe(collection, cb) {
      assert.equal(collection, "members");
      cb(MEMBERS);
      return () => {};
    },
  },
  auth: { record: () => record },
});

let current = null;
const byId = (_doc, id) => current.querySelector(`[id="${id}"]`);
const submit = (el) => fire(el, "submit");
const click = (el) => fire(el, "click");

test("First-run setup screen shows token, name, e-mail and password (12 characters) fields", () => {
  const { ui, doc, view } = setupUi(null);
  ui.setup(view, { args: [] });
  for (const id of ["setup-token", "setup-name", "setup-email", "setup-password"])
    assert.ok(byId(doc, id), id);
  assert.equal(byId(doc, "setup-token").getAttribute("type"), "password", "the token is not shown on screen");
  assert.equal(byId(doc, "setup-password").getAttribute("type"), "password");
  assert.match(view.textContent, /Mindestens 12 Zeichen/);
  assert.equal(doc.focused, byId(doc, "setup-token"));
});

test("Setup with the token, a name and a password: the form calls the flow and opens Wer bist du?", async () => {
  const { ui, doc, view, calls } = setupUi(null);
  ui.setup(view, { args: [] });
  byId(doc, "setup-token").value = "token-1";
  byId(doc, "setup-name").value = "Test-Papa";
  byId(doc, "setup-email").value = "test-papa@example.test";
  byId(doc, "setup-password").value = "test-password-12";
  await submit(view.querySelector("form"));
  assert.deepEqual(calls, [
    [
      "setup",
      { token: "token-1", name: "Test-Papa", email: "test-papa@example.test", password: "test-password-12" },
    ],
  ]);
  assert.equal(location.hash, "#/wer");
});

test("Setup without the setup token: the refusal is announced and nothing opens", async () => {
  const { ui, doc, view } = setupUi(null, {
    setup: { ok: false, error: "rejected", message: "Der Einrichtungs-Code stimmt nicht." },
  });
  ui.setup(view, { args: [] });
  await submit(view.querySelector("form"));
  const err = view.querySelector(".form-error");
  assert.equal(err.textContent, "Der Einrichtungs-Code stimmt nicht.");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(location.hash, "");
  assert.ok(doc);
});

test("Unenrolled device: the sign-in screen offers e-mail, password and the way to the first-run setup", async () => {
  const { ui, doc, view, calls } = setupUi(null, {
    signInParent: { ok: false, error: "credentials", message: "E-Mail oder Passwort stimmt nicht." },
  });
  ui.anmelden(view, { args: [] });
  assert.equal(byId(doc, "login-email").getAttribute("autocomplete"), "username");
  assert.equal(byId(doc, "login-password").getAttribute("autocomplete"), "current-password");
  assert.equal(view.querySelector("a").getAttribute("href") ?? view.querySelector("a").href, "#/setup");
  byId(doc, "login-email").value = "test-papa@example.test";
  byId(doc, "login-password").value = "wrong";
  await submit(view.querySelector("form"));
  assert.deepEqual(calls[0], ["signInParent", "test-papa@example.test", "wrong"]);
  assert.match(view.querySelector(".form-error").textContent, /E-Mail oder Passwort/);
  assert.equal(location.hash, "", "no navigation after a failed sign-in");
});

test("Parent signs in on a new phone: success opens Wer bist du?", async () => {
  const { ui, doc, view } = setupUi(null);
  ui.anmelden(view, { args: [] });
  byId(doc, "login-email").value = "test-papa@example.test";
  byId(doc, "login-password").value = "test-password-12";
  await submit(view.querySelector("form"));
  assert.equal(location.hash, "#/wer");
});

test("Invite screen takes the token from the link and creates the second parent's account", async () => {
  const { ui, doc, view, calls } = setupUi(null);
  ui.einladung(view, { args: ["invite-token-abc"] });
  assert.match(view.textContent, /48 Stunden/);
  byId(doc, "invite-name").value = "Test-Mama";
  byId(doc, "invite-email").value = "test-mama@example.test";
  byId(doc, "invite-password").value = "test-password-12";
  await submit(view.querySelector("form"));
  assert.deepEqual(calls, [
    [
      "acceptInvite",
      {
        token: "invite-token-abc",
        name: "Test-Mama",
        email: "test-mama@example.test",
        password: "test-password-12",
      },
    ],
  ]);
  assert.equal(location.hash, "#/wer");
});

test("Invite link used twice: the server message is shown and the form stays", async () => {
  const { ui, view } = setupUi(null, {
    acceptInvite: { ok: false, error: "rejected", message: "Diese Einladung ist ungültig oder abgelaufen." },
  });
  ui.einladung(view, { args: ["used"] });
  await submit(view.querySelector("form"));
  assert.match(view.querySelector(".form-error").textContent, /ungültig oder abgelaufen/);
  assert.equal(location.hash, "");
});

test("Kid opens their board: tapping a kid profile on an enrolled device asks for no credential", async () => {
  const { ui, doc, view } = setupUi("device");
  ui.wer(view, ctxFor({ id: "dev1", collectionName: "devices" }));
  assert.match(view.textContent, /Wer bist du\?/);
  const kids = view.querySelectorAll(".profiles .profile");
  assert.ok(kids.length >= 2);
  const kid =
    view.querySelector('button[data-member="kind1"]') ||
    kids.find((b) => b.getAttribute("data-member") === "kind1");
  await click(kid);
  assert.equal(location.hash, "#/kind/kind1");
  assert.equal(byId(doc, "pin-input"), null, "no PIN prompt for a kid");
});

test("Kid tries the parent view: tapping a parent profile asks for the PIN before anything opens", async () => {
  const { ui, doc, view, calls } = setupUi("device");
  ui.wer(view, ctxFor({ id: "dev1", collectionName: "devices" }));
  const parent = view
    .querySelectorAll(".adults .profile")
    .find((b) => b.getAttribute("data-member") === "papa");
  await click(parent);
  const pin = byId(doc, "pin-input");
  assert.ok(pin, "the PIN prompt appears");
  assert.equal(pin.getAttribute("inputmode"), "numeric");
  assert.equal(pin.getAttribute("maxlength"), "6");
  assert.equal(pin.getAttribute("type"), "password");
  assert.match(view.textContent, /PIN von Test-Papa/);
  assert.equal(location.hash, "", "nothing opened yet");
  assert.equal(calls.length, 0);
  assert.equal(doc.focused, pin);
});

test("Parent PIN: a wrong PIN is announced and cleared; the right one opens the parent view", async () => {
  const results = { unlockParent: { ok: false, error: "wrong-pin", message: "Falsche PIN." } };
  const { ui, doc, view, calls } = setupUi("device", results);
  ui.wer(view, ctxFor({ id: "dev1", collectionName: "devices" }));
  await click(
    view.querySelectorAll(".adults .profile").find((b) => b.getAttribute("data-member") === "mama"),
  );
  byId(doc, "pin-input").value = "000000";
  await submit(view.querySelector("form"));
  assert.deepEqual(calls[0], ["unlockParent", "mama", "000000"]);
  assert.equal(view.querySelector(".form-error").textContent, "Falsche PIN.");
  assert.equal(byId(doc, "pin-input").value, "", "the PIN field is emptied");
  assert.equal(location.hash, "");

  results.unlockParent = { ok: true };
  byId(doc, "pin-input").value = "246810";
  await submit(view.querySelector("form"));
  assert.equal(location.hash, "#/eltern");
});

test("Parent PIN: cancelling closes the prompt without opening anything", async () => {
  const { ui, doc, view } = setupUi("device");
  ui.wer(view, ctxFor({ id: "dev1", collectionName: "devices" }));
  await click(view.querySelectorAll(".adults .profile")[0]);
  const cancel = view.querySelectorAll("button").find((b) => b.textContent === "Abbrechen");
  await click(cancel);
  assert.equal(view.querySelector(".overlay").children.length, 0);
  assert.equal(doc.focused, view.querySelectorAll(".adults .profile")[0], "focus returns to the profile");
  assert.equal(location.hash, "");
});

test("Enrolling the kids' iPad: a signed-in parent sees the button, names the device and the flow enrolls it", async () => {
  const { ui, doc, view, calls } = setupUi("parent");
  ui.wer(view, ctxFor({ id: "par1", collectionName: "parents", member: "papa" }));
  // A signed-in parent sees their own profile, not the other parent's, and no PIN prompt for it.
  const adults = view.querySelectorAll(".adults .profile").map((b) => b.getAttribute("data-member"));
  assert.deepEqual(adults, ["papa"]);
  const enroll = view
    .querySelectorAll("button")
    .find((b) => b.textContent === "Als Familiengerät einrichten");
  assert.ok(enroll);
  await click(enroll);
  assert.match(view.textContent, /Gerätename/);
  byId(doc, "device-name").value = "  Kinder-iPad ";
  await submit(view.querySelector("form"));
  assert.deepEqual(calls, [["enrollDevice", "Kinder-iPad"]]);
  assert.equal(location.hash, "#/wer");
});

test("Parent sign-out falls back through the flow and shows the sign-in screen", async () => {
  const { ui, view, calls } = setupUi("parent");
  ui.wer(view, ctxFor({ id: "par1", collectionName: "parents", member: "papa" }));
  await click(view.querySelectorAll("button").find((b) => b.textContent === "Abmelden"));
  assert.deepEqual(calls, [["signOut"]]);
  assert.equal(location.hash, "#/anmelden");
});

test("PIN session: the parent view can be left with one tap, back to the device", async () => {
  const { ui, view, calls } = setupUi("pin");
  ui.wer(view, ctxFor({ id: "par1", collectionName: "parents", member: "papa" }));
  assert.equal(
    view.querySelectorAll("button").some((b) => b.textContent === "Als Familiengerät einrichten"),
    false,
    "a short PIN session cannot enroll devices",
  );
  await click(view.querySelectorAll("button").find((b) => /Fertig/.test(b.textContent)));
  assert.deepEqual(calls, [["backToDevice"]]);
});

test("Unenrolled device: nothing of the household is rendered while the data layer is not connected", () => {
  const { ui, view } = setupUi("parent");
  ui.wer(view, { ...ctxFor({ id: "par1", collectionName: "parents", member: "papa" }), data: null });
  assert.equal(view.querySelectorAll(".profile").length, 0);
  assert.match(view.textContent, /Wird geladen/);
});

test("member names are shown as text, never parsed as markup", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "js", "auth-ui.js"), "utf8");
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(src), false);
  const { ui, view } = setupUi("device");
  const ctx = ctxFor({ id: "dev1", collectionName: "devices" });
  ctx.data.subscribe = (_c, cb) => (cb([member("x", "kid", "<img src=x onerror=alert(1)>")]), () => {});
  ui.wer(view, ctx);
  assert.match(view.textContent, /<img src=x onerror=alert\(1\)>/);
});

test("Signed-in parent: their own profile opens the parents' view (#/eltern), the other parent is not offered", async () => {
  const { ui, view } = setupUi("parent");
  ui.wer(view, ctxFor({ id: "par1", collectionName: "parents", member: "papa" }));
  const profiles = view.querySelectorAll(".adults .profile");
  assert.deepEqual(
    profiles.map((b) => b.getAttribute("data-member")),
    ["papa"],
  );
  await click(profiles[0]);
  assert.equal(location.hash, "#/eltern");
});
