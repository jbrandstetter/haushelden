// Governing: ADR-0001 (writes go through the data layer, the server's rules are the authority), ADR-0003 (kid
// access via device accounts), SPEC-0001 REQ "Household Settings", REQ "Data Export", REQ "Device Enrollment and
// Removal", REQ "Prototype as UI Reference" (prototype renderParents, panel "Familie")
//
// `#/einstellungen`: the parents' settings screen. Panels: members (name, avatar, colour; add and remove kids),
// the own PIN, enrolled devices, sign out everywhere, export, and links to the other settings screens. Only
// parents reach it (js/auth.js guard on the client, collection rules and the export route on the server).
// `buildView` turns a plain model into DOM (rendered with a fake document in tests); `screen` wires it up.
// All text goes in through textContent, so member names cannot inject markup.

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../settings.js") : root.HH.settings,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.HH.einstellungen = api;
    root.HH.screens.einstellungen = api.screen;
  }
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  function h(doc, tag, className, text, attrs) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  const btn = (doc, label, role, onClick, className = "", extra = {}) => {
    const b = h(doc, "button", className, label, { type: "button", "data-role": role, ...extra });
    b.addEventListener("click", onClick);
    return b;
  };

  /** Confirm step shown in place of the row's buttons (no browser dialogs: they are blocked in installed apps). */
  function confirmBox(doc, text, onYes, onNo, yesLabel) {
    const box = h(doc, "div", "confirm", undefined, { role: "alertdialog", "data-role": "confirm" });
    box.append(
      h(doc, "p", "", text),
      btn(doc, yesLabel, "confirm-yes", onYes, "danger"),
      btn(doc, "Abbrechen", "confirm-no", onNo),
    );
    return box;
  }

  function memberRow(doc, m, model, a) {
    const row = h(doc, "div", "member", undefined, {
      "data-member-row": m.id,
      style: `--c:var(--${m.colour})`,
    });
    const emoji = h(doc, "input", "emo", undefined, {
      type: "text",
      "data-field": "emoji",
      maxlength: String(S.EMOJI_MAX),
      "aria-label": `Symbol von ${m.name}`,
    });
    emoji.value = m.emoji || "";
    const name = h(doc, "input", "", undefined, {
      type: "text",
      "data-field": "name",
      maxlength: String(S.NAME_MAX),
      "aria-label": "Name",
    });
    name.value = m.name;
    const save = () => a.saveMember(m, { name: name.value, emoji: emoji.value });
    emoji.addEventListener("change", save);
    name.addEventListener("change", save);

    const body = h(doc, "div");
    body.append(name, h(doc, "small", "muted", m.role === "parent" ? "Elternteil" : "Kind"));
    const swatches = h(doc, "div", "swatches");
    for (const c of S.PALETTE) {
      const sw = h(doc, "button", "", "", {
        type: "button",
        "data-colour": c,
        "aria-pressed": String(m.colour === c),
        "aria-label": c,
        style: `background:var(--${c})`,
      });
      sw.addEventListener("click", () => a.saveMember(m, { colour: c }));
      swatches.append(sw);
    }
    const pets = h(doc, "div", "pets");
    for (const av of S.AVATARS) {
      const b = h(doc, "button", "", av, {
        type: "button",
        "data-avatar": av,
        "aria-pressed": String(m.emoji === av),
      });
      b.addEventListener("click", () => a.saveMember(m, { emoji: av }));
      pets.append(b);
    }
    body.append(swatches, pets);

    const guard = S.removalGuard(m, model.members);
    if (!guard.allowed) {
      body.append(h(doc, "small", "muted", guard.reason, { "data-role": "remove-refused" }));
    } else if (model.confirm && model.confirm.type === "member" && model.confirm.id === m.id) {
      body.append(
        confirmBox(
          doc,
          S.removalWarning(m, model.routines),
          () => a.confirmRemoveMember(m),
          () => a.cancel(),
          "Ja, entfernen",
        ),
      );
    } else {
      body.append(
        btn(doc, "Entfernen", "remove-member", () => a.askRemoveMember(m), "danger", {
          "aria-label": `${m.name} entfernen`,
        }),
      );
    }
    row.append(emoji, body);
    return row;
  }

  function membersPanel(doc, model, a) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "members" });
    panel.append(h(doc, "h3", "", "Familie"));
    for (const m of model.members) panel.append(memberRow(doc, m, model, a));
    panel.append(
      btn(doc, "+ Kind", "add-kid", () => a.addKid(), "btn"),
      h(doc, "p", "note", "Weitere Eltern kommen über einen Einladungs-Link dazu, nicht über diese Liste."),
    );
    return panel;
  }

  function pinPanel(doc, model, a) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "pin" });
    panel.append(h(doc, "h3", "", "Meine PIN"));
    if (!model.canPin) {
      panel.append(
        h(
          doc,
          "p",
          "muted",
          "Die PIN lässt sich nur nach der Anmeldung mit Passwort ändern, nicht in einer PIN-Sitzung.",
        ),
      );
      return panel;
    }
    panel.append(
      h(doc, "p", "muted", "Mit der PIN öffnest du deine Ansicht auf einem Familiengerät. 6 Ziffern."),
    );
    const form = h(doc, "form");
    form.setAttribute("novalidate", "");
    const pin = h(doc, "input", "pin-input", undefined, {
      type: "password",
      inputmode: "numeric",
      maxlength: "6",
      autocomplete: "off",
      "data-field": "pin",
      "aria-label": "Neue PIN (6 Ziffern)",
      placeholder: "Neue PIN",
    });
    const pw = h(doc, "input", "", undefined, {
      type: "password",
      autocomplete: "current-password",
      "data-field": "password",
      "aria-label": "Passwort",
      placeholder: "Passwort zur Bestätigung",
    });
    const submit = h(doc, "button", "btn", "PIN speichern", { type: "submit", "data-role": "save-pin" });
    form.append(pin, pw, submit);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      a.setPin(pin.value, pw.value);
      pin.value = "";
      pw.value = "";
    });
    panel.append(form);
    return panel;
  }

  function devicesPanel(doc, model, a) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "devices" });
    panel.append(h(doc, "h3", "", "Familiengeräte"));
    if (model.devices === null) {
      panel.append(h(doc, "p", "muted", model.devicesError || "Wird geladen …"));
      return panel;
    }
    if (model.devices.length === 0) {
      panel.append(
        h(
          doc,
          "p",
          "muted",
          "Noch kein Gerät eingerichtet. Das geht unter „Wer bist du?“ mit „Als Familiengerät einrichten“.",
        ),
      );
    }
    for (const d of model.devices) {
      const row = h(doc, "div", "device", undefined, { "data-device-row": d.id });
      const info = h(doc, "div");
      info.append(h(doc, "b", "", d.name), h(doc, "small", "muted", S.lastUseLabel(d.last_seen, model.now)));
      row.append(info);
      if (model.confirm && model.confirm.type === "device" && model.confirm.id === d.id) {
        row.append(
          confirmBox(
            doc,
            `${d.name} entfernen? Das Gerät wird sofort abgemeldet und braucht eine neue Einrichtung.`,
            () => a.confirmRemoveDevice(d),
            () => a.cancel(),
            "Ja, entfernen",
          ),
        );
      } else {
        row.append(
          btn(doc, "Entfernen", "remove-device", () => a.askRemoveDevice(d), "danger", {
            "aria-label": `${d.name} entfernen`,
          }),
        );
      }
      panel.append(row);
    }
    return panel;
  }

  function sessionsPanel(doc, model, a) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "sessions" });
    panel.append(h(doc, "h3", "", "Meine Anmeldungen"));
    panel.append(
      h(
        doc,
        "p",
        "muted",
        "Einzelne Sitzungen lassen sich nicht auflisten. Mit „Überall abmelden“ endet jede Anmeldung deines Kontos, auch diese. Danach meldest du dich neu an.",
      ),
    );
    if (model.confirm && model.confirm.type === "sessions") {
      panel.append(
        confirmBox(
          doc,
          "Auf allen Geräten abmelden?",
          () => a.confirmSignOutEverywhere(),
          () => a.cancel(),
          "Ja, überall abmelden",
        ),
      );
    } else {
      panel.append(
        btn(doc, "Überall abmelden", "sign-out-everywhere", () => a.askSignOutEverywhere(), "btn"),
      );
    }
    return panel;
  }

  function exportPanel(doc, model, a) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "export-panel" });
    panel.append(h(doc, "h3", "", "Daten"));
    panel.append(
      h(
        doc,
        "p",
        "muted",
        "Alle Daten der Familie als eine JSON-Datei: Mitglieder, Routinen, Haken, Aufgaben, Bereiche, Listen, Einkäufe und Einstellungen. Ohne Passwörter und PINs.",
      ),
      btn(doc, "Export", "export", () => a.exportData(), "btn primary"),
    );
    return panel;
  }

  function linksPanel(doc) {
    const panel = h(doc, "div", "panel", undefined, { "data-role": "links" });
    panel.append(h(doc, "h3", "", "Weitere Einstellungen"));
    const list = h(doc, "div", "links");
    for (const l of S.SETTINGS_LINKS) {
      const a = h(doc, "a", "btn", `${l.emoji} ${l.label}`, { href: l.hash, "data-link": l.hash });
      list.append(a);
    }
    panel.append(list);
    return panel;
  }

  /**
   * @param {Document} doc
   * @param {{ members: object[], routines: object[], devices: object[]|null, devicesError?: string,
   *           confirm: ({type: string, id?: string}|null), canPin: boolean, now?: number }} model
   * @param {object} a the actions (see `screen`)
   */
  function buildView(doc, model, a) {
    const root = h(doc, "div", "einstellungen", undefined, { "data-role": "settings" });
    root.append(
      membersPanel(doc, model, a),
      pinPanel(doc, model, a),
      devicesPanel(doc, model, a),
      sessionsPanel(doc, model, a),
      exportPanel(doc, model, a),
      linksPanel(doc),
    );
    return root;
  }

  /** Saves a text file through a temporary link (browser only). */
  function browserDownload(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * ctx: { data, auth, kind?, api?, download?, now? } — `api` (settings API client), `download(filename, text)`
   * and `kind` ("parent" | "pin") are injected by tests; the app uses the browser's.
   */
  function screen(view, ctx) {
    const doc = view.ownerDocument;
    view.append(h(doc, "h1", "", "Einstellungen"));
    const record = ctx.auth && ctx.auth.record && ctx.auth.record();
    const isParent = record && record.member && record.collectionName !== "devices";
    if (!ctx.data || !isParent) {
      view.append(
        h(
          doc,
          "p",
          "muted",
          "Die Einstellungen sind nur für Eltern. Bitte unter „Wer bist du?“ die PIN eingeben.",
        ),
      );
      view.append(h(doc, "a", "btn", "Zu „Wer bist du?“", { href: "#/wer" }));
      return;
    }
    const data = ctx.data;
    const api = ctx.api || S.createSettingsApi({ token: () => ctx.auth.token() });
    const download = ctx.download || browserDownload;
    const kind = ctx.kind || (typeof HH !== "undefined" && HH.flow ? HH.flow.kind() : "parent");
    const model = {
      members: [],
      routines: [],
      devices: null,
      devicesError: "",
      confirm: null,
      canPin: kind !== "pin",
      now: Date.now(),
    };
    const host = h(doc, "div");
    const status = h(doc, "p", "rt-error", "", { role: "alert", "data-role": "status" });
    view.append(status, host);

    const say = (text, ok = false) => {
      status.textContent = text || "";
      status.className = ok ? "rt-ok" : "rt-error";
    };
    function render() {
      model.now = Date.now();
      host.textContent = "";
      host.append(buildView(doc, model, actions));
    }
    const run = async (work, failText = "Das hat nicht geklappt. Bitte noch einmal versuchen.") => {
      say("");
      try {
        await work();
      } catch {
        say(failText);
      }
      render();
    };
    async function loadDevices() {
      const res = await api.listDevices();
      if (res.ok) {
        model.devices = res.items;
        model.devicesError = "";
      } else {
        model.devicesError = res.message;
      }
      render();
    }

    const actions = {
      saveMember(m, raw) {
        const result = S.memberPatch(m, raw);
        if (!result.ok) {
          say(result.message);
          return render(); // show the stored values again
        }
        if (!result.patch) return render();
        return run(() => data.update("members", m.id, result.patch));
      },
      addKid: () => run(() => data.create("members", S.newKid(model.members))),
      askRemoveMember(m) {
        model.confirm = { type: "member", id: m.id };
        render();
      },
      confirmRemoveMember(m) {
        model.confirm = null;
        const guard = S.removalGuard(m, model.members);
        if (!guard.allowed) {
          say(guard.reason);
          return render();
        }
        return run(() => data.delete("members", m.id));
      },
      cancel() {
        model.confirm = null;
        render();
      },
      async setPin(pin, password) {
        say("");
        const res = await api.setPin(pin, password);
        say(res.ok ? "PIN gespeichert." : res.message, res.ok);
        render();
      },
      askRemoveDevice(d) {
        model.confirm = { type: "device", id: d.id };
        render();
      },
      async confirmRemoveDevice(d) {
        model.confirm = null;
        say("");
        const res = await api.removeDevice(d.id);
        if (res.ok) model.devices = (model.devices || []).filter((x) => x.id !== d.id);
        else say(res.message);
        render();
      },
      askSignOutEverywhere() {
        model.confirm = { type: "sessions" };
        render();
      },
      async confirmSignOutEverywhere() {
        model.confirm = null;
        say("");
        const res = await api.signOutEverywhere();
        if (!res.ok) {
          say(res.message);
          return render();
        }
        // The server dropped every token of this account, including this one: clear it and sign in again.
        if (ctx.auth && ctx.auth.clear) await ctx.auth.clear();
        if (typeof location !== "undefined") location.hash = "#/anmelden";
      },
      async exportData() {
        say("");
        const res = await api.exportData();
        if (!res.ok) {
          say(res.message);
          return;
        }
        download(S.exportFileName(res.doc, new Date(model.now)), res.text);
        say(`Export gespeichert (${S.exportSummary(res.doc)}).`, true);
      },
    };

    render();
    loadDevices();
    const offs = ["members", "routines"].map((c) =>
      data.subscribe(c, (rows) => {
        model[c] = rows;
        render();
      }),
    );
    return () => offs.forEach((off) => off());
  }

  return { buildView, screen };
});
