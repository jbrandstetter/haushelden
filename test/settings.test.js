// Governing: ADR-0001, SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Device Enrollment and Removal"
//
// Unit tests of the pure settings logic (app/js/settings.js), the client for the settings routes with a fake
// fetch, the parent-only route guard (app/js/auth.js) and the server-side export/member helpers
// (pb_hooks/lib/settings.js). Fake names only.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/js/settings.js");
const { guard } = require("../app/js/auth.js");
const L = require("../pb_hooks/lib/settings.js");

const kid = { id: "k1", role: "kid", name: "Test-Kind-1", emoji: "⚽", colour: "peach" };
const papa = { id: "p1", role: "parent", name: "Test-Papa", emoji: "🧔", colour: "blue" };
const mama = { id: "p2", role: "parent", name: "Test-Mama", emoji: "👩", colour: "pink" };

test("member validation trims, bounds and checks the colour", () => {
  assert.deepEqual(S.validateMember({ name: "  Test-Kind-1  ", emoji: "⚽", colour: "mauve" }), {
    ok: true,
    value: { name: "Test-Kind-1", emoji: "⚽", colour: "mauve" },
  });
  assert.equal(S.validateMember({ name: "   ", emoji: "⚽", colour: "mauve" }).ok, false);
  assert.equal(S.validateMember({ name: "x".repeat(41), emoji: "⚽", colour: "mauve" }).ok, false);
  assert.equal(S.validateMember({ name: "x", emoji: "", colour: "mauve" }).ok, false);
  assert.equal(S.validateMember({ name: "x", emoji: "⚽", colour: "neon" }).ok, false);
  // a family emoji is several code points but one avatar: 16 code points are allowed
  assert.equal(S.validateMember({ name: "x", emoji: "👩‍👩‍👧‍👦", colour: "red" }).ok, true);
});

test("member patch holds only the changed fields; nothing changed gives null", () => {
  assert.deepEqual(S.memberPatch(kid, { colour: "mauve" }), { ok: true, patch: { colour: "mauve" } });
  assert.deepEqual(S.memberPatch(kid, { name: " Test-Kind-1 ", emoji: "⚽" }), { ok: true, patch: null });
  assert.equal(S.memberPatch(kid, { name: "" }).ok, false);
});

test("a new kid gets the first unused palette colour and never the parent role", () => {
  const k = S.newKid([papa, kid]);
  assert.equal(k.role, "kid");
  assert.equal(k.colour, "mauve", "peach and blue are taken");
  assert.equal(S.nextColour(S.PALETTE.map((c) => ({ colour: c }))), S.PALETTE[0]);
});

test("removal guard: kids can go, parents cannot, and the last parent has its own message", () => {
  assert.equal(S.removalGuard(kid, [papa, kid]).allowed, true);
  const two = S.removalGuard(mama, [papa, mama, kid]);
  assert.equal(two.allowed, false);
  assert.match(two.reason, /Eltern-Konten/);
  const last = S.removalGuard(papa, [papa, kid]);
  assert.equal(last.allowed, false);
  assert.match(last.reason, /letzte Elternteil/);
});

test("removal warning names what is deleted and what stays", () => {
  const text = S.removalWarning(kid, [
    { id: "r1", who: "member", member: "k1" },
    { id: "r2", who: "kids" },
  ]);
  assert.match(text, /Test-Kind-1 entfernen/);
  assert.match(text, /eigene Routine/);
  assert.match(text, /Einkaufslisten und Bereiche bleiben/);
  assert.match(S.removalWarning(kid, []), /Alle Haken/);
});

test("device last use reads as relative German text", () => {
  const now = Date.parse("2026-10-12T20:00:00Z");
  assert.equal(S.lastUseLabel("", now), "noch nie benutzt");
  assert.equal(S.lastUseLabel("2026-10-12 19:59:50.000Z", now), "zuletzt benutzt: gerade eben");
  assert.equal(S.lastUseLabel("2026-10-12 19:30:00.000Z", now), "zuletzt benutzt: vor 30 Min.");
  assert.equal(S.lastUseLabel("2026-10-12 15:00:00.000Z", now), "zuletzt benutzt: vor 5 Std.");
  assert.equal(S.lastUseLabel("2026-10-11 19:00:00.000Z", now), "zuletzt benutzt: vor 1 Tag");
  assert.equal(S.lastUseLabel("2026-10-09 19:00:00.000Z", now), "zuletzt benutzt: vor 3 Tagen");
});

test("settings links are one data array of existing hash routes", () => {
  const { ROUTES } = require("../app/js/routes.js");
  const names = ROUTES.map((r) => r[0]);
  for (const l of S.SETTINGS_LINKS) assert.ok(names.includes(l.hash.replace("#/", "")), l.hash);
  assert.ok(names.includes("einstellungen"));
});

test("route guard: settings are for parents; a family device is sent to Wer bist du?", () => {
  assert.equal(guard("#/einstellungen", "device"), "#/wer");
  assert.equal(guard("#/einstellungen", "parent"), null);
  assert.equal(guard("#/einstellungen", "pin"), null);
  assert.equal(guard("#/einstellungen", null), "#/anmelden");
});

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers, body: init.body });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return {
      ok: r.status < 400,
      status: r.status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")),
    };
  };
  return { impl, calls };
}

test("API client: devices list, removal, PIN, sign out everywhere use the right routes and the token", async () => {
  const f = fakeFetch([
    { status: 200, body: { items: [{ id: "d1", name: "Test-Tablet", last_seen: "", token: "no" }] } },
    { status: 204, body: "" },
    { status: 200, body: { ok: true } },
    { status: 401, body: { message: "Das Passwort stimmt nicht." } },
    { status: 200, body: { ok: true } },
  ]);
  const api = S.createSettingsApi({ token: () => "tok", fetchImpl: f.impl });
  assert.deepEqual(await api.listDevices(), {
    ok: true,
    items: [{ id: "d1", name: "Test-Tablet", last_seen: "" }],
  });
  assert.equal((await api.removeDevice("d1")).ok, true);
  assert.equal((await api.setPin("123456", "pw")).ok, true);
  const bad = await api.setPin("123456", "wrong");
  assert.deepEqual([bad.ok, bad.message], [false, "Das Passwort stimmt nicht."]);
  assert.equal((await api.signOutEverywhere()).ok, true);
  assert.deepEqual(
    f.calls.map((c) => [c.method, c.url]),
    [
      ["GET", "/api/collections/devices/records?perPage=100&sort=-created"],
      ["DELETE", "/api/collections/devices/records/d1"],
      ["PUT", "/api/hh/pin"],
      ["PUT", "/api/hh/pin"],
      ["POST", "/api/hh/sessions/revoke"],
    ],
  );
  assert.ok(f.calls.every((c) => c.headers.authorization === "tok"));
  assert.deepEqual(JSON.parse(f.calls[2].body), { pin: "123456", password: "pw" });
  assert.equal(
    (await S.createSettingsApi({ token: () => "t", fetchImpl: fakeFetch([]).impl }).setPin("12", "pw")).ok,
    false,
  );
});

test("API client: export returns text and parsed document; failures become friendly messages", async () => {
  const doc = {
    version: 1,
    exported_at: "2026-10-12T20:00:00.000Z",
    collections: { members: [{}, {}], todos: [] },
  };
  const f = fakeFetch([
    { status: 200, body: doc },
    { status: 429, body: { message: "Zu viele Versuche." } },
    { status: 500, body: "" },
    { status: 200, body: "not json" },
    new Error("offline"),
  ]);
  const api = S.createSettingsApi({ token: () => "tok", fetchImpl: f.impl });
  const ok = await api.exportData();
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.doc, doc);
  assert.equal(JSON.parse(ok.text).version, 1);
  assert.equal(S.exportFileName(ok.doc), "haushelden-export-2026-10-12.json");
  assert.match(S.exportSummary(ok.doc), /^2 Mitglieder, 0 Routinen, 0 Aufgaben/);
  assert.match((await api.exportData()).message, /Zu viele/);
  assert.match((await api.exportData()).message, /Export hat nicht geklappt/);
  assert.equal((await api.exportData()).ok, false);
  assert.match((await api.exportData()).message, /Keine Verbindung/);
});

// ---- server-side helpers (pb_hooks/lib/settings.js) -------------------------------------------------------
test("export shape: version, time zone, sorted collections, no credentials anywhere", () => {
  const doc = L.buildExport({
    tz: "Europe/Berlin",
    now: new Date("2026-10-12T20:00:00Z"),
    collections: {
      members: [{ id: "m1", name: "Test-Papa", pin_hash: "v1$x", nested: { tokenKey: "t", ok: 1 } }],
      invites: [{ token_hash: "h" }],
      _superusers: [{ password: "x" }],
      todos: [],
    },
  });
  assert.equal(doc.version, 1);
  assert.equal(doc.tz, "Europe/Berlin");
  assert.deepEqual(Object.keys(doc.collections), ["members", "todos"]);
  assert.doesNotMatch(JSON.stringify(doc), /pin_hash|tokenKey|token_hash|password/i);
  assert.equal(doc.collections.members[0].nested.ok, 1);
  assert.equal(L.exportFileName(new Date("2026-10-12T20:00:00Z")), "haushelden-export-2026-10-12.json");
  assert.equal(L.householdTz("", "Europe/Vienna"), "Europe/Vienna");
  assert.equal(L.householdTz("", ""), "Europe/Berlin");
});

test("member guards: no new parents, no role change of an account, no removal of parents", () => {
  assert.match(L.checkMemberCreate({ role: "parent" }), /Einladung/);
  assert.equal(L.checkMemberCreate({ role: "kid" }), "");
  assert.match(
    L.checkMemberUpdate({ before: { role: "parent" }, after: { role: "kid" }, hasAccount: true }),
    /Rolle/,
  );
  assert.match(
    L.checkMemberUpdate({ before: { role: "kid" }, after: { role: "parent" }, hasAccount: false }),
    /Einladung/,
  );
  assert.equal(
    L.checkMemberUpdate({ before: { role: "kid" }, after: { role: "kid" }, hasAccount: false }),
    "",
  );
  assert.match(
    L.checkMemberDelete({ role: "parent", hasAccount: true, parentAccounts: 1 }),
    /letzte Elternteil/,
  );
  assert.match(L.checkMemberDelete({ role: "parent", hasAccount: true, parentAccounts: 2 }), /Eltern-Konten/);
  assert.equal(L.checkMemberDelete({ role: "kid", hasAccount: false, parentAccounts: 1 }), "");
});

test("export rate limit: twenty per window, then refused until the window passes", () => {
  const store = new Map();
  const s = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const t0 = 1_000_000;
  for (let i = 0; i < L.EXPORT_LIMIT_PER_WINDOW; i++) assert.equal(L.takeExportSlot(s, "p1", t0 + i), true);
  assert.equal(L.takeExportSlot(s, "p1", t0 + 100), false);
  assert.equal(L.takeExportSlot(s, "p2", t0 + 100), true, "per parent");
  assert.equal(L.takeExportSlot(s, "p1", t0 + 16 * 60 * 1000), true);
});
