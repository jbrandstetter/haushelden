// Governing: ADR-0001, SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Device Enrollment and Removal"
// (scenarios: "Changing a kid's colour", "Export", "Replaced iPad")
//
// Render and flow tests of the parents' settings screen (app/js/screens/einstellungen.js) in the shared fake
// DOM (test/helpers/fake-dom-nodes.js), with a stub data layer and a stub settings API. Fake names only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocument } = require("./helpers/fake-dom-nodes.js");
const einstellungen = require("../app/js/screens/einstellungen.js");

const members = [
  { id: "papa", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue", created: "1" },
  { id: "mama", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink", created: "2" },
  { id: "kid1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach", created: "3" },
  { id: "kid2", role: "kid", name: "Test-Kind-2", emoji: "🎨", colour: "teal", created: "4" },
];
const routines = [{ id: "r1", who: "member", member: "kid1", title: "Zähne putzen" }];
const devices = [
  { id: "d1", name: "Test-Tablet", last_seen: "" },
  { id: "d2", name: "Test-Telefon", last_seen: "2026-10-12 19:30:00.000Z" },
];
const settle = () => new Promise((r) => setTimeout(r, 0));

function stubData(initial) {
  const rows = { ...initial };
  const subs = {};
  const calls = [];
  return {
    calls,
    set(c, value) {
      rows[c] = value;
      (subs[c] || []).forEach((cb) => cb(value));
    },
    subscribe(c, cb) {
      (subs[c] ||= []).push(cb);
      cb(rows[c] || []);
      return () => {};
    },
    create: async (c, r) => calls.push(["create", c, r]),
    update: async (c, id, r) => calls.push(["update", c, id, r]),
    delete: async (c, id) => calls.push(["delete", c, id]),
  };
}

function stubApi(overrides = {}) {
  const calls = [];
  const rec =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };
  return {
    calls,
    listDevices: rec("listDevices", { ok: true, items: devices }),
    removeDevice: rec("removeDevice", { ok: true }),
    setPin: rec("setPin", { ok: true }),
    signOutEverywhere: rec("signOutEverywhere", { ok: true }),
    exportData: rec("exportData", {
      ok: true,
      text: '{"version":1}',
      doc: {
        version: 1,
        exported_at: "2026-10-12T20:00:00.000Z",
        collections: {
          members: members.map(() => ({})),
          routines: [{}],
          todos: [],
          areas: [],
          lists: [],
          purchases: [],
        },
      },
    }),
    ...overrides,
  };
}

function mount({
  data = stubData({ members, routines }),
  api = stubApi(),
  record,
  kind = "parent",
  ...ctx
} = {}) {
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  const auth = {
    record: () => (record === undefined ? { member: "papa", collectionName: "parents" } : record),
    token: () => "tok",
    cleared: 0,
    clear: async () => {
      auth.cleared += 1;
    },
  };
  const downloads = [];
  einstellungen.screen(view, {
    data,
    auth,
    api,
    kind,
    download: (name, text) => downloads.push([name, text]),
    ...ctx,
  });
  return { view, data, api, auth, downloads };
}

test("renders members, devices, sessions, export and the links to the other settings", async () => {
  const { view } = mount();
  await settle();
  assert.deepEqual(
    view.querySelectorAll("[data-member-row]").map((r) => r.getAttribute("data-member-row")),
    ["papa", "mama", "kid1", "kid2"],
  );
  assert.match(view.querySelector('[data-member-row="kid1"]').textContent, /Kind/);
  assert.match(view.querySelector('[data-member-row="papa"]').textContent, /Elternteil/);
  const rows = view.querySelectorAll("[data-device-row]");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Test-Tablet/);
  assert.match(rows[0].textContent, /noch nie benutzt/);
  assert.match(rows[1].textContent, /zuletzt benutzt/);
  assert.ok(view.querySelector('[data-role="sessions"] [data-role="sign-out-everywhere"]'));
  assert.ok(view.querySelector('[data-role="export"]'));
  assert.deepEqual(
    view.querySelectorAll("[data-link]").map((a) => a.getAttribute("data-link")),
    ["#/routinen", "#/maskottchen", "#/bereiche", "#/gelernt"],
  );
});

test("member names are text, never markup", () => {
  const evil = {
    id: "x",
    role: "kid",
    name: "<img src=x onerror=alert(1)>",
    emoji: "🙂",
    colour: "red",
    created: "9",
  };
  const { view } = mount({ data: stubData({ members: [members[0], evil], routines: [] }) });
  assert.equal(view.querySelector('[data-member-row="x"] [data-field="name"]').value, evil.name);
  assert.equal(view.querySelector("img"), null);
});

test("Changing a kid's colour: tapping mauve saves it, and a live update shows the new colour", async () => {
  const { view, data } = mount();
  view.querySelector('[data-member-row="kid2"] [data-colour="mauve"]').click();
  await settle();
  assert.deepEqual(data.calls, [["update", "members", "kid2", { colour: "mauve" }]]);
  data.set(
    "members",
    members.map((m) => (m.id === "kid2" ? { ...m, colour: "mauve" } : m)),
  );
  const row = view.querySelector('[data-member-row="kid2"]');
  assert.equal(row.querySelector('[data-colour="mauve"]').getAttribute("aria-pressed"), "true");
  assert.equal(row.querySelector('[data-colour="teal"]').getAttribute("aria-pressed"), "false");
  assert.match(row.getAttribute("style"), /--mauve/);
});

test("renaming and changing the avatar save only what changed; an empty name is refused", async () => {
  const { view, data } = mount();
  const row = view.querySelector('[data-member-row="kid1"]');
  const name = row.querySelector('[data-field="name"]');
  name.value = "  Test-Kind-1b ";
  name.dispatch("change");
  row.querySelector('[data-avatar="🦄"]').click();
  await settle();
  const same = view.querySelector('[data-member-row="kid1"] [data-field="name"]');
  same.value = "   ";
  same.dispatch("change");
  await settle();
  assert.deepEqual(data.calls, [
    ["update", "members", "kid1", { name: "Test-Kind-1b" }],
    ["update", "members", "kid1", { emoji: "🦄" }],
  ]);
  assert.match(view.querySelector('[data-role="status"]').textContent, /Namen/);
  assert.equal(
    view.querySelector('[data-member-row="kid1"] [data-field="name"]').value,
    "Test-Kind-1",
    "stored value shown again",
  );
});

test("adding a kid creates a kid member with a free colour; there is no way to add a parent", async () => {
  const { view, data } = mount();
  view.querySelector('[data-role="add-kid"]').click();
  await settle();
  assert.deepEqual(data.calls, [
    ["create", "members", { role: "kid", name: "Neues Kind", emoji: "🙂", colour: "mauve" }],
  ]);
  assert.match(view.textContent, /Einladungs-Link/);
});

test("removing a kid asks first, says what is deleted, and only then deletes", async () => {
  const { view, data } = mount();
  view.querySelector('[data-member-row="kid1"] [data-role="remove-member"]').click();
  const confirm = view.querySelector('[data-member-row="kid1"] [data-role="confirm"]');
  assert.match(confirm.textContent, /Test-Kind-1 entfernen/);
  assert.match(confirm.textContent, /eigene Routine/);
  assert.deepEqual(data.calls, []);
  confirm.querySelector('[data-role="confirm-no"]').click();
  assert.equal(view.querySelector('[data-role="confirm"]'), null);
  view.querySelector('[data-member-row="kid1"] [data-role="remove-member"]').click();
  view.querySelector('[data-role="confirm-yes"]').click();
  await settle();
  assert.deepEqual(data.calls, [["delete", "members", "kid1"]]);
});

test("the last parent cannot be removed: no remove button, a reason instead", () => {
  const { view } = mount({ data: stubData({ members: [members[0], members[2]], routines: [] }) });
  const papa = view.querySelector('[data-member-row="papa"]');
  assert.equal(papa.querySelector('[data-role="remove-member"]'), null);
  assert.match(papa.querySelector('[data-role="remove-refused"]').textContent, /letzte Elternteil/);
  const withTwo = mount().view.querySelector('[data-member-row="mama"] [data-role="remove-refused"]');
  assert.match(withTwo.textContent, /Eltern-Konten/);
});

test("own PIN: six digits plus password go to the API; the answer is shown; the fields are cleared", async () => {
  const api = stubApi({ setPin: async () => ({ ok: false, message: "Das Passwort stimmt nicht." }) });
  const { view } = mount({ api });
  const form = view.querySelector('[data-role="pin"] form');
  view.querySelector('[data-field="pin"]').value = "246810";
  view.querySelector('[data-field="password"]').value = "wrong";
  form.dispatch("submit");
  await settle();
  assert.match(view.querySelector('[data-role="status"]').textContent, /Passwort stimmt nicht/);
  assert.equal(view.querySelector('[data-field="pin"]').value, "");
  const ok = mount();
  ok.view.querySelector('[data-field="pin"]').value = "246810";
  ok.view.querySelector('[data-field="password"]').value = "pw";
  ok.view.querySelector('[data-role="pin"] form').dispatch("submit");
  await settle();
  assert.deepEqual(
    ok.api.calls.find((c) => c[0] === "setPin"),
    ["setPin", "246810", "pw"],
  );
  assert.match(ok.view.querySelector('[data-role="status"]').textContent, /PIN gespeichert/);
});

test("a short PIN session sees no PIN form (the server needs the password)", () => {
  const { view } = mount({ kind: "pin" });
  assert.equal(view.querySelector('[data-role="pin"] form'), null);
  assert.match(view.querySelector('[data-role="pin"]').textContent, /Passwort/);
});

test("Replaced iPad: removing a device asks first, then removes it and drops the row", async () => {
  const { view, api } = mount();
  await settle();
  view.querySelector('[data-device-row="d1"] [data-role="remove-device"]').click();
  assert.match(
    view.querySelector('[data-device-row="d1"] [data-role="confirm"]').textContent,
    /sofort abgemeldet/,
  );
  assert.equal(api.calls.filter((c) => c[0] === "removeDevice").length, 0);
  view.querySelector('[data-role="confirm-yes"]').click();
  await settle();
  assert.deepEqual(
    api.calls.find((c) => c[0] === "removeDevice"),
    ["removeDevice", "d1"],
  );
  assert.equal(view.querySelector('[data-device-row="d1"]'), null);
  assert.ok(view.querySelector('[data-device-row="d2"]'));
});

test("a failing device removal shows the error and keeps the row", async () => {
  const api = stubApi({
    removeDevice: async () => ({ ok: false, message: "Dafür fehlt die Berechtigung." }),
  });
  const { view } = mount({ api });
  await settle();
  view.querySelector('[data-device-row="d1"] [data-role="remove-device"]').click();
  view.querySelector('[data-role="confirm-yes"]').click();
  await settle();
  assert.match(view.querySelector('[data-role="status"]').textContent, /Berechtigung/);
  assert.ok(view.querySelector('[data-device-row="d1"]'));
});

test("a device list that cannot be loaded says so instead of showing an empty list", async () => {
  const api = stubApi({ listDevices: async () => ({ ok: false, message: "Keine Verbindung zum Server." }) });
  const { view } = mount({ api });
  await settle();
  assert.match(view.querySelector('[data-role="devices"]').textContent, /Keine Verbindung/);
});

test("sign out everywhere asks first, calls the revoke route and clears this device's session", async () => {
  const { view, api, auth } = mount();
  view.querySelector('[data-role="sign-out-everywhere"]').click();
  assert.equal(api.calls.filter((c) => c[0] === "signOutEverywhere").length, 0);
  view.querySelector('[data-role="confirm-yes"]').click();
  await settle();
  assert.equal(api.calls.filter((c) => c[0] === "signOutEverywhere").length, 1);
  assert.equal(auth.cleared, 1);
});

test("Export: tapping Export downloads one JSON file named by day and says what it holds", async () => {
  const { view, downloads } = mount();
  view.querySelector('[data-role="export"]').click();
  await settle();
  assert.deepEqual(downloads, [["haushelden-export-2026-10-12.json", '{"version":1}']]);
  const note = view.querySelector('[data-role="status"]').textContent;
  assert.match(note, /Export gespeichert/);
  assert.match(note, /4 Mitglieder, 1 Routinen/);
});

test("a failed export downloads nothing and shows the reason", async () => {
  const api = stubApi({
    exportData: async () => ({ ok: false, message: "Zu viele Exporte. Bitte später noch einmal." }),
  });
  const { view, downloads } = mount({ api });
  view.querySelector('[data-role="export"]').click();
  await settle();
  assert.deepEqual(downloads, []);
  assert.match(view.querySelector('[data-role="status"]').textContent, /Zu viele Exporte/);
});

test("without a parent session the screen shows the refusal and no panels", () => {
  for (const record of [null, { id: "dev", collectionName: "devices" }]) {
    const { view } = mount({ record });
    assert.equal(view.querySelector('[data-role="members"]'), null);
    assert.equal(view.querySelector('[data-role="export"]'), null);
    assert.match(view.textContent, /nur für Eltern/);
    assert.equal(view.querySelector("a").getAttribute("href"), "#/wer");
  }
});

test("the screen stops listening when it is left", () => {
  let off = 0;
  const data = stubData({ members, routines });
  const subscribe = data.subscribe;
  data.subscribe = (c, cb) => {
    subscribe(c, cb);
    return () => off++;
  };
  const doc = createDocument();
  const view = doc.createElement("div");
  view.ownerDocument = doc;
  const cleanup = einstellungen.screen(view, {
    data,
    auth: { record: () => ({ member: "papa", collectionName: "parents" }), token: () => "t" },
    api: stubApi(),
    kind: "parent",
  });
  cleanup();
  assert.equal(off, 2);
});
