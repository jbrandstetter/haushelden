// Governing: ADR-0003 (kid access via device accounts: the board runs under a device or a parent session),
// ADR-0001 (reads and writes go through the data layer, ticks work offline via its outbox),
// SPEC-0002 REQ "Today Board", REQ "Tomorrow Preview", REQ "Week Strip and Streak", REQ "Completion Celebration",
// REQ "Mascot Feedback", REQ "No Competitive or Reward Mechanics by Default"; SPEC-0001 REQ "Prototype as UI
// Reference" (prototype renderKid), REQ "Household Day and Time Zone"
//
// The kid board, route `#/kind/<memberId>`. `buildView` turns a plain model into DOM (tests render it with a fake
// document); the screen function wires it to the data layer, the mascot's voice and the confetti. The board only
// ever shows ONE member: there is no sibling comparison, ranking, points or prize anywhere on it.

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(
    node ? require("../board.js") : root.HH.board,
    node ? require("../routines.js") : root.HH.routines,
    node ? require("../dates.js") : root.HH.dates,
    root,
  );
  if (node) module.exports = api;
  else {
    root.HH.kind = api;
    root.HH.screens.kind = api.screen;
  }
})(typeof self !== "undefined" ? self : this, function (B, R, dates, root) {
  "use strict";

  function h(doc, tag, className, text, attrs) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  /** Sets a CSS custom property (CSSOM, so a strict style-src needs no 'unsafe-inline'); attribute in test DOMs. */
  function setVar(el, name, value) {
    if (el.style && el.style.setProperty) el.style.setProperty(name, value);
    else el.setAttribute("data-" + name.replace(/^--/, "var-"), value);
  }

  // ---- view ----------------------------------------------------------------------------------------------
  /**
   * model: { member, members, routines, ticks, today, mascot, line, sound, streak, fx, celebration }
   *  - fx: { hop, pop } visual reactions to the last tick (already false under reduced motion)
   *  - celebration: null | { text }
   * actions: { toggle(routine), petTap(), toggleSound(), dismiss() }
   */
  function buildView(doc, m, a) {
    const { member } = m;
    const container = h(doc, "div", "kid", undefined, { "data-member": member.id });
    setVar(container, "--c", `var(--${member.colour || "mauve"})`);

    const due = R.dueFor(m.routines, member, m.members, m.today);
    const progress = B.dayProgress({ ...m, day: m.today });
    const ticked = B.tickIndex(m.ticks, member.id);
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 100;

    // top: back link, name and weekday, progress ring
    const top = h(doc, "div", "top");
    top.append(h(doc, "a", "av", member.emoji || "🙂", { href: "#/", "aria-label": "Zurück" }));
    const hello = h(doc, "div", "hello");
    hello.append(
      h(doc, "b", "kid-name", member.name || ""),
      h(doc, "span", "kid-day", dates.WDL[dates.weekdayOfKey(m.today)]),
    );
    const ring = h(doc, "div", "ring", undefined, {
      role: "progressbar",
      "aria-label": "Fortschritt heute",
      "aria-valuemin": "0",
      "aria-valuemax": String(progress.total),
      "aria-valuenow": String(progress.done),
    });
    setVar(ring, "--p", String(pct));
    ring.append(h(doc, "div", "lbl", `${progress.done}/${progress.total}`));
    top.append(hello, ring);

    // mascot
    const mascot = h(doc, "div", "mascot");
    const pet = h(doc, "button", `pet${m.fx && m.fx.hop ? " hop" : ""}`, m.mascot.emoji, {
      type: "button",
      "aria-label": m.mascot.name,
    });
    pet.addEventListener("click", () => a.petTap());
    const bubble = h(doc, "div", "bubble");
    const line = h(doc, "span", "line", m.line || "", { "aria-live": "polite" });
    bubble.append(h(doc, "small", "mascot-name", m.mascot.name), line);
    mascot.append(pet, bubble);

    // today's tiles, or the free-day message
    const today = h(doc, "div", "tiles");
    if (!due.length) {
      today.className = "";
      today.append(h(doc, "div", "note free-day", "Heute steht nichts an. 🎉"));
    }
    for (const r of due) {
      const done = ticked.has(B.tickKey(r.id, member.id, m.today));
      const cls = `tile${done ? " done" : ""}${m.fx && m.fx.pop === r.id ? " pop" : ""}`;
      const tile = h(doc, "button", cls, undefined, {
        type: "button",
        "data-routine": r.id,
        "aria-pressed": String(done),
      });
      tile.append(h(doc, "span", "tick", "✓", { "aria-hidden": "true" }), h(doc, "div", "em", r.emoji));
      tile.append(h(doc, "div", "tt", r.title));
      if (r.hint && r.who !== "kids_alternating") tile.append(h(doc, "div", "st", r.hint));
      const tag = R.tileTag(r);
      if (tag) tile.append(h(doc, "span", "tag", tag));
      tile.addEventListener("click", () => a.toggle(r));
      today.append(tile);
    }

    container.append(top, mascot, h(doc, "div", "section", "Heute"), today);

    // tomorrow's hobbies with their hints
    const tomorrow = B.tomorrowHobbies(m);
    if (tomorrow.length) {
      const note = h(doc, "div", "note tomorrow");
      tomorrow.forEach((r, i) => {
        if (i) note.append(h(doc, "br"));
        note.append(h(doc, "span", "tm-item", `${r.emoji} ${r.title}${r.hint ? " – " + r.hint : ""}`));
      });
      container.append(h(doc, "div", "section", "Morgen"), note);
    }

    // week strip and streak
    container.append(h(doc, "div", "section", "Diese Woche"));
    const week = h(doc, "div", "week");
    for (const d of B.weekStrip(m)) {
      const cell = h(doc, "div", `d${d.isToday ? " today" : ""}`, d.label, { "data-day": d.day });
      cell.append(
        h(doc, "div", `dot ${d.status}`, d.status === "full" ? "★" : "", { "data-status": d.status }),
      );
      week.append(cell);
    }
    container.append(week);
    const n = m.streak;
    container.append(
      h(doc, "div", "streak", n > 0 ? `🔥 ${n} ${n === 1 ? "Tag" : "Tage"} am Stück alles geschafft` : ""),
    );

    // sound switch, per device
    const sound = h(doc, "div", "sound");
    const snd = h(doc, "button", "link", m.sound ? "🔊 Ton an" : "🔇 Ton aus", {
      type: "button",
      "aria-pressed": String(!!m.sound),
      "data-role": "sound",
    });
    snd.addEventListener("click", () => a.toggleSound());
    sound.append(snd);
    container.append(sound);

    // the celebration: full-screen, one tap anywhere dismisses it
    if (m.celebration) {
      const ov = h(doc, "div", "alldone", undefined, {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Alles geschafft!",
      });
      const box = h(doc, "div", "box");
      box.append(
        h(doc, "div", "pet", m.mascot.emoji),
        h(doc, "h2", "", "Alles geschafft!"),
        h(doc, "p", "celebration-text", m.celebration.text),
      );
      const ok = h(doc, "button", "btn primary", "Juhu!", { type: "button", "data-role": "dismiss" });
      box.append(ok);
      ov.append(box);
      ov.addEventListener("click", () => a.dismiss());
      container.append(ov);
    }
    return container;
  }

  // ---- device capabilities (injectable for tests) ------------------------------------------------------------
  function browserEnv() {
    let voice = null;
    const synth = root.speechSynthesis;
    const pickVoice = () => {
      const vs = synth.getVoices().filter((v) => /^de/i.test(v.lang));
      voice = vs.find((v) => /anna|helena|markus|enhanced|premium/i.test(v.name)) || vs[0] || null;
    };
    if (synth) {
      pickVoice();
      synth.onvoiceschanged = pickVoice;
    }
    const store = {
      get(key) {
        try {
          return root.localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          root.localStorage.setItem(key, value);
        } catch {
          // storage unavailable: the preference lasts until the page is closed
        }
      },
    };
    return {
      store,
      random: Math.random,
      reducedMotion: () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches),
      speak(text) {
        if (!synth || typeof root.SpeechSynthesisUtterance !== "function") return;
        synth.cancel();
        const u = new root.SpeechSynthesisUtterance(B.speechText(text));
        u.lang = "de-DE";
        if (voice) u.voice = voice;
        u.rate = 1.0;
        u.pitch = 1.25;
        synth.speak(u);
      },
      cancelSpeech: () => synth && synth.cancel(),
      confetti: (doc, x, y, count, spread) => confetti(doc, x, y, count, spread),
    };
  }

  // Confetti on a transient full-screen canvas (browser only; skipped under reduced motion by the caller).
  let particles = [];
  let frame = null;
  function confetti(doc, x, y, count = 40, spread = 1) {
    let cv = doc.getElementById("confetti");
    if (!cv) {
      cv = doc.createElement("canvas");
      cv.id = "confetti";
      cv.setAttribute("aria-hidden", "true");
      doc.body.append(cv);
    }
    const dpr = root.devicePixelRatio || 1;
    cv.width = root.innerWidth * dpr;
    cv.height = root.innerHeight * dpr;
    const cs = root.getComputedStyle(doc.documentElement);
    const colours = ["peach", "mauve", "blue", "green", "yellow", "pink", "teal"].map((c) =>
      cs.getPropertyValue("--" + c).trim(),
    );
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = (3 + Math.random() * 6) * spread;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - 5 * spread,
        r: 4 + Math.random() * 5,
        c: colours[Math.floor(Math.random() * colours.length)],
        life: 60 + Math.random() * 40,
        rot: Math.random() * 6,
      });
    }
    if (!frame) frame = root.requestAnimationFrame(() => step(cv, dpr));
  }
  function step(cv, dpr) {
    const cx = cv.getContext("2d");
    cx.clearRect(0, 0, cv.width, cv.height);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      p.vx *= 0.99;
      p.life--;
      p.rot += 0.2;
      cx.save();
      cx.translate(p.x * dpr, p.y * dpr);
      cx.rotate(p.rot);
      cx.fillStyle = p.c;
      cx.globalAlpha = Math.min(1, p.life / 30);
      cx.fillRect((-p.r * dpr) / 2, (-p.r * dpr) / 2, p.r * dpr, p.r * dpr * 0.6);
      cx.restore();
    }
    frame = particles.length ? root.requestAnimationFrame(() => step(cv, dpr)) : null;
    if (!frame) cx.clearRect(0, 0, cv.width, cv.height);
  }

  const hourIn = (now, tz) =>
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: dates.resolveTimeZone(tz),
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(now)
        .find((p) => p.type === "hour").value,
    );

  // ---- screen --------------------------------------------------------------------------------------------
  const SOUND_KEY = "hh.sound";
  const spokeKey = (memberId) => `hh.board.spoke.${memberId}`;

  function screen(view, ctx) {
    const doc = view.ownerDocument;
    const memberId = ctx.args && ctx.args[0];
    if (!ctx.data) {
      view.append(h(doc, "p", "muted", "Nicht angemeldet. Die Anmeldung kommt in einer späteren Version."));
      return;
    }
    if (!memberId) {
      view.append(h(doc, "p", "muted", "Welches Kind? Bitte auf der Startseite ein Kind wählen."));
      view.append(h(doc, "a", "link", "Zur Startseite", { href: "#/" }));
      return;
    }
    const data = ctx.data;
    const env = { ...browserEnvLazy(), ...(ctx.env || {}) };
    const model = { members: [], routines: [], ticks: [], settings: null };
    const ui = {
      loaded: { members: false },
      line: "",
      fx: {},
      celebration: null,
      silentRun: 0,
      greeted: false,
      sound: env.store.get(SOUND_KEY) !== "0",
    };
    const inflight = new Set();
    const timers = [];
    const host = h(doc, "div");
    view.append(host);

    const reduced = () => !!(env.reducedMotion && env.reducedMotion());
    const today = () => ctx.clock.today();
    const member = () => model.members.find((x) => x.id === memberId);
    const vars = () => {
      const mem = member();
      return { name: mem ? mem.name : "", streak: currentStreak() };
    };
    const input = () => ({
      routines: model.routines,
      member: member(),
      members: model.members,
      ticks: model.ticks,
      today: today(),
    });
    const currentStreak = () => B.streak(input());

    function render() {
      host.textContent = "";
      const mem = member();
      if (!ui.loaded.members) return void host.append(h(doc, "p", "muted", "Lädt …"));
      if (!mem || mem.role !== "kid") {
        host.append(
          h(doc, "p", "muted", "Dieses Kind gibt es nicht."),
          h(doc, "a", "link", "Zur Startseite", { href: "#/" }),
        );
        return;
      }
      if (!ui.line) {
        // The opening line: greeting on the first visit of this session, shown but not spoken (a spoken
        // greeting would be speech without a tick; the voice follows SPEC-0002 "Mascot Feedback").
        ui.line = B.openingLine({
          progress: B.dayProgress({ ...input(), day: today() }),
          hour: hourIn(ctx.clock.now ? ctx.clock.now() : new Date(), ctx.clock.tz && ctx.clock.tz()),
          firstVisit: !ui.greeted,
          vars: vars(),
          approved: B.approvedLines(mem.id, today()),
          random: env.random,
        });
        ui.greeted = true;
      }
      host.append(
        buildView(
          doc,
          {
            ...input(),
            mascot: R.mascotOf(model.settings),
            line: ui.line,
            sound: ui.sound,
            streak: currentStreak(),
            fx: ui.fx,
            celebration: ui.celebration,
          },
          actions,
        ),
      );
      ui.fx = {}; // reactions play once, not on the next sync re-render
    }

    function speak(text) {
      if (ui.sound && env.speak) env.speak(text);
    }

    const actions = {
      /** One tap toggles today's tick for this kid (create or delete a routine_done record). */
      async toggle(routine) {
        const mem = member();
        if (!mem || inflight.has(routine.id)) return;
        inflight.add(routine.id);
        try {
          const day = today();
          const existing = B.findTick(model.ticks, routine.id, mem.id, day);
          if (existing) {
            await data.delete("routine_done", existing.id); // un-ticking: no fuss, no celebration
            return;
          }
          const before = B.dayProgress({ ...input(), day });
          const after = { total: before.total, done: before.done + 1 };
          const completed = after.total > 0 && after.done === after.total;
          const spoke = env.store.get(spokeKey(mem.id));
          const decision = B.speechDecision({
            firstOfDay: spoke !== day,
            completed,
            silentRun: ui.silentRun,
            random: env.random,
          });
          ui.silentRun = decision.silentRun;
          env.store.set(spokeKey(mem.id), day);
          const approved = B.approvedLines(mem.id, day);
          let text;
          if (completed) {
            // The streak including today (the tick is not in the mirror yet, so add it).
            const s = B.streakOf((d) => (d === day ? after : B.dayProgress({ ...input(), day: d })), day);
            text = B.celebrationLine({ streak: s, vars: vars(), approved, random: env.random });
          } else {
            text = B.tickLine({ routine, progress: after, vars: vars(), approved, random: env.random });
          }
          ui.line = text;
          ui.fx = reduced() ? {} : { hop: true, pop: routine.id };
          await data.create("routine_done", { routine: routine.id, member: mem.id, day });
          if (completed) {
            const show = () => {
              ui.celebration = { text };
              render();
              speak(text);
              if (!reduced() && env.confetti)
                env.confetti(doc, root.innerWidth / 2, root.innerHeight / 3, 140, 1.4);
            };
            if (reduced()) show();
            else timers.push(setTimeout(show, 450));
          } else {
            if (decision.speak) speak(text);
            if (!reduced() && env.confetti)
              env.confetti(doc, root.innerWidth / 2, root.innerHeight / 2, 28, 0.8);
          }
        } finally {
          inflight.delete(routine.id);
        }
      },
      petTap() {
        const mem = member();
        if (!mem) return;
        // The mascot itself was tapped: a line from the idle/tick pool, spoken (explicit request, not a tick).
        const pool = [...B.linePool("tick", B.approvedLines(mem.id, today())), ...B.linePool("idle")];
        ui.line = B.fill(B.pick(pool, env.random), vars());
        ui.fx = reduced() ? {} : { hop: true };
        render();
        speak(ui.line);
      },
      toggleSound() {
        ui.sound = !ui.sound;
        env.store.set(SOUND_KEY, ui.sound ? "1" : "0");
        if (!ui.sound && env.cancelSpeech) env.cancelSpeech();
        render();
      },
      dismiss() {
        ui.celebration = null;
        render();
      },
    };

    const offs = [
      data.subscribe("members", (rows) => {
        model.members = rows;
        ui.loaded.members = true;
        render();
      }),
      data.subscribe("routines", (rows) => {
        model.routines = rows;
        render();
      }),
      data.subscribe("routine_done", (rows) => {
        model.ticks = rows;
        render();
      }),
      data.subscribe("settings", (rows) => {
        model.settings = rows[0] || null;
        render();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      timers.forEach(clearTimeout);
    };
  }

  const browserEnvLazy = () =>
    root && root.document ? browserEnv() : { store: { get: () => null, set() {} }, random: Math.random };

  return { buildView, screen, hourIn };
});
