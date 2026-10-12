// Governing: ADR-0001 (PocketBase as the household backend), ADR-0003 (kid access via device accounts),
// SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Device Enrollment and Removal", REQ "Parent
// Authentication"
//
// The logic behind the settings screen (js/screens/einstellungen.js), free of the DOM so it is unit-tested:
// member validation and the removal guard, device last-use wording, the list of links to the other settings
// screens, and a small API client for the routes that are not plain records (devices, own PIN, sign out
// everywhere, export). The server enforces every rule again; these helpers only give friendly answers early.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).settings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAME_MAX = 40;
  const EMOJI_MAX = 16;
  // Colours the `members.colour` field accepts (Catppuccin accents); the screen offers the prototype's ten.
  const COLOURS = [
    "rosewater",
    "flamingo",
    "pink",
    "mauve",
    "red",
    "maroon",
    "peach",
    "yellow",
    "green",
    "teal",
    "sky",
    "sapphire",
    "blue",
    "lavender",
  ];
  const PALETTE = ["peach", "mauve", "blue", "green", "teal", "pink", "yellow", "red", "sky", "lavender"];
  const AVATARS = [
    "🦁",
    "🦊",
    "🐯",
    "🐼",
    "🦄",
    "🐸",
    "🐨",
    "🐙",
    "🦖",
    "🐬",
    "🦋",
    "⚽",
    "🐴",
    "🎹",
    "🧔",
    "👩",
    "👨",
    "👱‍♀️",
    "🧑‍💻",
    "🏋️",
  ];
  const NEW_KID = { role: "kid", name: "Neues Kind", emoji: "🙂" };
  const PIN_PATTERN = /^[0-9]{6}$/;

  // The other settings screens, as one small list. Capability stories append a line when their route exists.
  const SETTINGS_LINKS = [
    { hash: "#/routinen", label: "Routinen", emoji: "🗓️" },
    { hash: "#/maskottchen", label: "Maskottchen", emoji: "🦊" },
    { hash: "#/bereiche", label: "Bereiche & Zuständigkeiten", emoji: "🏠" },
    { hash: "#/gelernt", label: "Gelernte Artikel", emoji: "🧠" },
  ];

  const runes = (s) => Array.from(String(s)).length;

  /** Cleans and checks the editable fields of a member. Returns { ok, value } or { ok: false, message }. */
  function validateMember(raw) {
    const name = String(raw.name === undefined ? "" : raw.name)
      .replace(/\s+/g, " ")
      .trim();
    const emoji = String(raw.emoji === undefined ? "" : raw.emoji).trim();
    const colour = raw.colour;
    if (!name) return { ok: false, message: "Bitte einen Namen eingeben." };
    if (runes(name) > NAME_MAX)
      return { ok: false, message: `Der Name darf höchstens ${NAME_MAX} Zeichen haben.` };
    if (!emoji) return { ok: false, message: "Bitte ein Symbol wählen." };
    if (runes(emoji) > EMOJI_MAX) return { ok: false, message: "Das Symbol ist zu lang." };
    if (!COLOURS.includes(colour)) return { ok: false, message: "Diese Farbe gibt es nicht." };
    return { ok: true, value: { name, emoji, colour } };
  }

  /**
   * The patch to send for an edit, or `null` when nothing changed. `raw` holds the fields the user touched
   * (any of name, emoji, colour); the rest keeps the member's current value.
   * @returns {{ ok: true, patch: object|null } | { ok: false, message: string }}
   */
  function memberPatch(member, raw) {
    const checked = validateMember({
      name: member.name,
      emoji: member.emoji,
      colour: member.colour,
      ...raw,
    });
    if (!checked.ok) return checked;
    const patch = {};
    for (const key of ["name", "emoji", "colour"])
      if (checked.value[key] !== member[key]) patch[key] = checked.value[key];
    return { ok: true, patch: Object.keys(patch).length ? patch : null };
  }

  /** The first colour of the palette no member uses yet (else the first of the palette). */
  function nextColour(members) {
    const used = new Set(members.map((m) => m.colour));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[0];
  }

  /** The fields of a new kid (parents come in by invitation, never from this list). */
  const newKid = (members) => ({ ...NEW_KID, colour: nextColour(members) });

  /**
   * May this member be removed from the settings screen? Parent accounts are not removed here in v1 (the last
   * one never can be); kids can.
   * @returns {{ allowed: boolean, reason: string }}
   */
  function removalGuard(member, members) {
    if (member.role !== "parent") return { allowed: true, reason: "" };
    const parents = members.filter((m) => m.role === "parent").length;
    return {
      allowed: false,
      reason:
        parents <= 1
          ? "Das letzte Elternteil lässt sich nicht entfernen."
          : "Eltern-Konten lassen sich hier nicht entfernen.",
    };
  }

  /** What the confirm step says before a kid is removed (German, the family's language). */
  function removalWarning(member, routines) {
    const own = routines.filter((r) => r.who === "member" && r.member === member.id).length;
    const routinePart = own
      ? ` Die ${own === 1 ? "eigene Routine" : `${own} eigenen Routinen`} und alle Haken`
      : " Alle Haken";
    return `${member.name} entfernen?${routinePart} von ${member.name} werden gelöscht. Einkaufslisten und Bereiche bleiben bestehen.`;
  }

  /** "zuletzt benutzt: vor 3 Std." for the device list. `last` is PocketBase's date string or empty. */
  function lastUseLabel(last, now = Date.now()) {
    if (!last) return "noch nie benutzt";
    const t = Date.parse(String(last).replace(" ", "T"));
    if (Number.isNaN(t)) return "noch nie benutzt";
    const minutes = Math.max(0, Math.floor((now - t) / 60000));
    if (minutes < 1) return "zuletzt benutzt: gerade eben";
    if (minutes < 60) return `zuletzt benutzt: vor ${minutes} Min.`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `zuletzt benutzt: vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    return `zuletzt benutzt: vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  }

  /** Counts per collection of an export document, for the "exported" note. */
  function exportSummary(doc) {
    const c = (doc && doc.collections) || {};
    const n = (name) => (Array.isArray(c[name]) ? c[name].length : 0);
    return `${n("members")} Mitglieder, ${n("routines")} Routinen, ${n("todos")} Aufgaben, ${n("areas")} Bereiche, ${n("lists")} Listen, ${n("purchases")} Einkäufe`;
  }

  /** File name for the download: the server's export day when present, else today's. */
  function exportFileName(doc, now = new Date()) {
    const day =
      doc && /^\d{4}-\d{2}-\d{2}/.test(String(doc.exported_at))
        ? doc.exported_at.slice(0, 10)
        : now.toISOString().slice(0, 10);
    return `haushelden-export-${day}.json`;
  }

  /**
   * Client for the routes that are not plain records. Every call resolves to `{ ok, ... }` and never throws.
   * @param {{ token: () => string|null, fetchImpl?: typeof fetch }} options
   */
  function createSettingsApi({ token, fetchImpl = (...a) => fetch(...a) }) {
    async function call(method, path, body) {
      const headers = { accept: "application/json" };
      const t = token();
      if (t) headers.authorization = t;
      if (body !== undefined) headers["content-type"] = "application/json";
      let res;
      try {
        res = await fetchImpl(path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        return { ok: false, status: 0, message: "Keine Verbindung zum Server." };
      }
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (res.ok) return { ok: true, status: res.status, data };
      let message = (data && data.message) || "Das hat nicht geklappt.";
      if (res.status >= 500) message = "Der Server hat ein Problem.";
      if (res.status === 401 || res.status === 403)
        message = (data && data.message) || "Dafür fehlt die Berechtigung.";
      return { ok: false, status: res.status, message };
    }

    return {
      /** Enrolled devices, newest first: `[{ id, name, last_seen }]`. */
      async listDevices() {
        const res = await call("GET", "/api/collections/devices/records?perPage=100&sort=-created");
        if (!res.ok) return res;
        const items = ((res.data && res.data.items) || []).map((d) => ({
          id: d.id,
          name: d.name,
          last_seen: d.last_seen || "",
        }));
        return { ok: true, items };
      },
      /** Removes a device; its sessions end with it ("Replaced iPad"). */
      removeDevice: (id) => call("DELETE", `/api/collections/devices/records/${encodeURIComponent(id)}`),
      /** Sets the signed-in parent's own PIN; needs the password again. */
      setPin(pin, password) {
        if (!PIN_PATTERN.test(String(pin))) {
          return Promise.resolve({ ok: false, status: 400, message: "Die PIN besteht aus genau 6 Ziffern." });
        }
        return call("PUT", "/api/hh/pin", { pin, password });
      },
      /** Ends every session of the own parent account (tokens are stateless, so there is no per-session list). */
      signOutEverywhere: () => call("POST", "/api/hh/sessions/revoke", {}),
      /** The export document as parsed JSON plus its raw text (what is saved to the file). */
      async exportData() {
        const t = token();
        let res;
        try {
          res = await fetchImpl("/api/hh/export", { headers: t ? { authorization: t } : {} });
        } catch {
          return { ok: false, status: 0, message: "Keine Verbindung zum Server." };
        }
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let message =
            res.status === 429
              ? "Zu viele Exporte. Bitte später noch einmal."
              : "Der Export hat nicht geklappt.";
          try {
            if (res.status === 429 && JSON.parse(text).message) message = JSON.parse(text).message;
          } catch {
            // keep the generic message
          }
          return { ok: false, status: res.status, message };
        }
        try {
          return { ok: true, text, doc: JSON.parse(text) };
        } catch {
          return { ok: false, status: res.status, message: "Der Export hat nicht geklappt." };
        }
      },
    };
  }

  return {
    NAME_MAX,
    EMOJI_MAX,
    COLOURS,
    PALETTE,
    AVATARS,
    PIN_PATTERN,
    SETTINGS_LINKS,
    validateMember,
    memberPatch,
    nextColour,
    newKid,
    removalGuard,
    removalWarning,
    lastUseLabel,
    exportSummary,
    exportFileName,
    createSettingsApi,
  };
});
