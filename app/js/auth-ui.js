// Governing: ADR-0003 (kid access via device accounts), SPEC-0001 REQ "First-Run Setup", REQ "Parent
// Authentication", REQ "Device Enrollment and Removal", REQ "Kid Access on Enrolled Devices", REQ "Prototype as UI
// Reference" (renderSetup, renderWho), Accessibility Requirements
//
// Screens for accounts and access (registered by js/screens/{setup,anmelden,einladung,wer}.js), ported from the prototype: first-run setup (`#/setup`), parent sign-in
// (`#/anmelden`), invite acceptance (`#/einladung/<token>`) and "Wer bist du?" (`#/wer`) with the parent-PIN prompt
// and "Als Familiengerät einrichten". The logic is in js/auth.js (HH.flow); the screens only draw and call it.
// All text goes in through textContent (no HTML parsing), so names from the data store cannot inject markup.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.HH.authui = factory(root.HH);
})(typeof self !== "undefined" ? self : this, function (HH) {
  "use strict";

  const flow = () => HH.flow;

  function el(doc, tag, className, text) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** A labelled input row: returns { row, input }. */
  function field(doc, id, label, attrs, hint) {
    const row = el(doc, "div", "field");
    const l = el(doc, "label", "", label);
    l.setAttribute("for", id);
    const input = el(doc, "input");
    input.id = id;
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    row.append(l, input);
    if (hint) row.append(el(doc, "span", "hint", hint));
    return { row, input };
  }

  /** Error line announced to screen readers. */
  function errorLine(doc) {
    const p = el(doc, "p", "form-error");
    p.setAttribute("role", "alert");
    return p;
  }

  /**
   * A form whose submit button is disabled while the request runs. `run()` resolves to { ok, message }.
   * On failure the message appears in the error line and the focus stays in the form.
   */
  function form(doc, { submitLabel, fields, run, onDone }) {
    const f = el(doc, "form");
    f.setAttribute("novalidate", "");
    const err = errorLine(doc);
    const btn = el(doc, "button", "btn primary", submitLabel);
    btn.type = "submit";
    f.append(...fields.map((x) => x.row), err, btn);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      err.textContent = "";
      btn.disabled = true;
      try {
        const result = await run();
        if (result.ok) onDone(result);
        else err.textContent = result.message || "Das hat nicht geklappt.";
      } finally {
        btn.disabled = false;
      }
    });
    return { form: f, err, button: btn };
  }

  const go = (hash) => {
    if (typeof location !== "undefined") location.hash = hash;
  };

  function setup(view) {
    const doc = view.ownerDocument;
    const wrap = el(doc, "div", "ph");
    wrap.append(
      el(doc, "h1", "", "Willkommen bei Haushelden 👋"),
      el(
        doc,
        "p",
        "muted",
        "Einmal kurz einrichten (für das erste Elternteil). Den Einrichtungs-Code findest du in der Konfiguration des Servers.",
      ),
    );
    const panel = el(doc, "div", "panel");
    panel.append(el(doc, "h3", "", "Erstes Elternteil"));
    const code = field(doc, "setup-token", "Einrichtungs-Code", {
      type: "password",
      autocomplete: "off",
      required: "",
    });
    const name = field(doc, "setup-name", "Dein Name", {
      type: "text",
      autocomplete: "name",
      maxlength: "40",
    });
    const email = field(doc, "setup-email", "E-Mail", { type: "email", autocomplete: "username" });
    const pw = field(
      doc,
      "setup-password",
      "Passwort",
      { type: "password", autocomplete: "new-password" },
      "Mindestens 12 Zeichen.",
    );
    const f = form(doc, {
      submitLabel: "Los geht's",
      fields: [code, name, email, pw],
      run: () =>
        flow().setup({
          token: code.input.value,
          name: name.input.value,
          email: email.input.value,
          password: pw.input.value,
        }),
      onDone: () => go("#/wer"),
    });
    panel.append(f.form);
    wrap.append(panel);
    const back = el(doc, "a", "link", "Zur Anmeldung");
    back.href = "#/anmelden";
    wrap.append(back);
    view.append(wrap);
    code.input.focus();
  }

  function anmelden(view) {
    const doc = view.ownerDocument;
    const wrap = el(doc, "div", "ph");
    wrap.append(el(doc, "h1", "", "Anmelden"));
    wrap.append(el(doc, "p", "muted", "Für Eltern. Die Kinder brauchen kein Passwort."));
    const panel = el(doc, "div", "panel");
    const email = field(doc, "login-email", "E-Mail", {
      type: "email",
      autocomplete: "username",
      required: "",
    });
    const pw = field(doc, "login-password", "Passwort", {
      type: "password",
      autocomplete: "current-password",
      required: "",
    });
    const f = form(doc, {
      submitLabel: "Anmelden",
      fields: [email, pw],
      run: () => flow().signInParent(email.input.value, pw.input.value),
      onDone: () => go("#/wer"),
    });
    panel.append(f.form);
    wrap.append(panel);
    const first = el(doc, "a", "link", "Erste Einrichtung");
    first.href = "#/setup";
    wrap.append(first);
    view.append(wrap);
    email.input.focus();
  }

  function einladung(view, ctx) {
    const doc = view.ownerDocument;
    const token = (ctx.args && ctx.args[0]) || "";
    const wrap = el(doc, "div", "ph");
    wrap.append(
      el(doc, "h1", "", "Einladung zu Haushelden"),
      el(doc, "p", "muted", "Lege dein Konto an. Die Einladung gilt einmal und 48 Stunden."),
    );
    const panel = el(doc, "div", "panel");
    const name = field(doc, "invite-name", "Dein Name", {
      type: "text",
      autocomplete: "name",
      maxlength: "40",
    });
    const email = field(doc, "invite-email", "E-Mail", { type: "email", autocomplete: "username" });
    const pw = field(
      doc,
      "invite-password",
      "Passwort",
      { type: "password", autocomplete: "new-password" },
      "Mindestens 12 Zeichen.",
    );
    const f = form(doc, {
      submitLabel: "Konto anlegen",
      fields: [name, email, pw],
      run: () =>
        flow().acceptInvite({
          token,
          name: name.input.value,
          email: email.input.value,
          password: pw.input.value,
        }),
      onDone: () => go("#/wer"),
    });
    panel.append(f.form);
    wrap.append(panel);
    view.append(wrap);
    name.input.focus();
  }

  /** The PIN prompt for one parent profile (SPEC-0001 "Kid tries the parent view"). */
  function pinPrompt(doc, member, { onCancel }) {
    const panel = el(doc, "div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `PIN von ${member.name}`);
    panel.append(el(doc, "h3", "", `PIN von ${member.name}`));
    const pin = field(doc, "pin-input", "PIN (6 Ziffern)", {
      type: "password",
      inputmode: "numeric",
      pattern: "[0-9]*",
      maxlength: "6",
      autocomplete: "off",
    });
    pin.input.className += " pin-input";
    const f = form(doc, {
      submitLabel: "Öffnen",
      fields: [pin],
      run: async () => {
        const result = await flow().unlockParent(member.id, pin.input.value);
        pin.input.value = "";
        return result;
      },
      onDone: () => go(`#/ich/${member.id}`),
    });
    const cancel = el(doc, "button", "link", "Abbrechen");
    cancel.type = "button";
    cancel.addEventListener("click", onCancel);
    panel.append(f.form, cancel);
    return { panel, input: pin.input };
  }

  function deviceForm(doc, { onCancel }) {
    const panel = el(doc, "div", "panel");
    panel.append(el(doc, "h3", "", "Als Familiengerät einrichten"));
    panel.append(
      el(
        doc,
        "p",
        "muted",
        "Dieses Gerät zeigt danach „Wer bist du?“, auch wenn du dich abmeldest. Du kannst es jederzeit in den Einstellungen entfernen.",
      ),
    );
    const name = field(doc, "device-name", "Gerätename", {
      type: "text",
      maxlength: "60",
      placeholder: "Kinder-iPad",
    });
    const f = form(doc, {
      submitLabel: "Einrichten",
      fields: [name],
      run: () => flow().enrollDevice(name.input.value.trim()),
      onDone: () => go("#/wer"),
    });
    const cancel = el(doc, "button", "link", "Abbrechen");
    cancel.type = "button";
    cancel.addEventListener("click", onCancel);
    panel.append(f.form, cancel);
    return { panel, input: name.input };
  }

  /** "Wer bist du?": kid profiles open directly, parent profiles ask for the PIN on a family device. */
  function wer(view, ctx) {
    const doc = view.ownerDocument;
    const wrap = el(doc, "div", "who");
    const title = el(doc, "h1", "", "Wer bist du?");
    const day = el(doc, "p");
    if (ctx.clock) {
      const today = ctx.clock.todayNumber();
      day.textContent = `${HH.dates.WDL[HH.dates.weekday(today)]}, ${ctx.clock.today()}`;
    }
    const kidsBox = el(doc, "div", "profiles");
    const adultsBox = el(doc, "div", "profiles adults");
    const overlay = el(doc, "div", "overlay");
    overlay.setAttribute("aria-live", "polite");
    const actions = el(doc, "div", "footer-actions");
    wrap.append(title, day, kidsBox, adultsBox, overlay, actions);
    view.append(wrap);

    const kind = flow().kind();
    const own = ctx.auth && ctx.auth.record && ctx.auth.record();

    function closeOverlay(returnFocusTo) {
      overlay.textContent = "";
      if (returnFocusTo) returnFocusTo.focus();
    }

    function profile(member, boxClass, onTap) {
      const b = el(doc, "button", "profile");
      b.type = "button";
      b.setAttribute("data-member", member.id);
      b.style.setProperty("--c", `var(--${member.colour || "mauve"})`);
      const av = el(doc, "div", "av", member.emoji || "");
      av.setAttribute("aria-hidden", "true");
      const nm = el(doc, "div", "nm", member.name || "");
      if (boxClass === "adults") {
        const inner = el(doc, "div");
        inner.append(nm);
        b.append(av, inner);
      } else {
        b.append(av, nm);
      }
      b.addEventListener("click", () => onTap(member, b));
      return b;
    }

    function renderMembers(members) {
      kidsBox.textContent = "";
      adultsBox.textContent = "";
      for (const m of members) {
        if (m.role === "kid") {
          // Kids need no credential on an enrolled device (SPEC-0001 "Kid opens their board").
          kidsBox.append(profile(m, "kids", (member) => go(`#/kind/${member.id}`)));
        } else if (m.role === "parent") {
          if (kind === "device") {
            adultsBox.append(
              profile(m, "adults", (member, button) => {
                overlay.textContent = "";
                const prompt = pinPrompt(doc, member, { onCancel: () => closeOverlay(button) });
                overlay.append(prompt.panel);
                prompt.input.focus();
              }),
            );
          } else if (own && own.member === m.id) {
            // A signed-in parent opens their own view; the other parent needs the PIN on a family device.
            adultsBox.append(profile(m, "adults", (member) => go(`#/ich/${member.id}`)));
          }
        }
      }
    }

    if (kind === "parent") {
      const enroll = el(doc, "button", "btn", "Als Familiengerät einrichten");
      enroll.type = "button";
      enroll.addEventListener("click", () => {
        overlay.textContent = "";
        const dev = deviceForm(doc, { onCancel: () => closeOverlay(enroll) });
        overlay.append(dev.panel);
        dev.input.focus();
      });
      const out = el(doc, "button", "link", "Abmelden");
      out.type = "button";
      out.addEventListener("click", async () => {
        await flow().signOut();
        go("#/anmelden");
      });
      const settings = el(doc, "a", "btn", "Einstellungen");
      settings.href = "#/einstellungen";
      actions.append(enroll, settings, out);
    } else if (kind === "pin") {
      const back = el(doc, "button", "link", "Fertig – zurück zu „Wer bist du?“");
      back.type = "button";
      back.addEventListener("click", async () => {
        await flow().backToDevice();
        go("#/wer");
      });
      const settings = el(doc, "a", "btn", "Einstellungen");
      settings.href = "#/einstellungen";
      actions.append(settings, back);
    }

    if (!ctx.data) {
      day.textContent = "Wird geladen …";
      return;
    }
    return ctx.data.subscribe("members", renderMembers);
  }

  return { setup, anmelden, einladung, wer };
});
