// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0005 REQ "Lists", REQ "Adding Items",
// REQ "Shopping Flow", REQ "Entry Points", SPEC-0001 REQ "Prototype as UI Reference" (port of `renderShop`),
// REQ "Offline Operation" (every write goes through the outbox)
//
// Route #/einkauf/<member id>: tabs per list with open counts, quick-add field, open items with the avatar of who
// added them, "Im Wagen" with "Einkauf fertig", and (parents only) list management. The member id in the route is
// the profile the screen was opened from; items added here are attributed to that member. Without one a parent
// is attributed to their own member and a device account picks who is writing.
// Items put on the list from the meal plan show the meal they are for (SPEC-0009).
// Purchase-history story: automatic items show their reason, parents get suggestions while typing (purchases are
// readable by parents only), and opening a list asks the server to refill it (REQ "Automatic Refill").

(function () {
  "use strict";
  const shop = HH.shop;
  const rhythm = HH.rhythm;
  const learning = HH.shopLearning;
  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Selected tab and the member picked on a device without a profile survive re-renders and revisits.
  let currentList = null;
  let pickedMember = null;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const accent = (member) => `var(--${(member && member.colour) || "green"})`;

  const MESSAGES = {
    empty: "Schreib erst auf, was fehlt.",
    too_long: `Bitte höchstens ${shop.MAX_NAME} Zeichen.`,
    no_member: "Wähle zuerst oben, wer schreibt.",
    duplicate: "Das steht schon auf der Liste.",
  };

  HH.screens.einkauf = function (view, ctx) {
    const root = el("div", "shop");
    view.append(root);
    if (!ctx.data) {
      root.append(el("h1", "", "Einkaufsliste"));
      root.append(el("p", "muted", "Nicht angemeldet."));
      return;
    }
    const data = ctx.data;
    const authRecord = ctx.auth.record() || {};
    const isParent = authRecord.collectionName === "parents";
    const routeMember = ctx.args[0] || null;

    const state = { lists: [], items: [], members: [], purchases: [], settings: [] };
    const memberOf = (id) => state.members.find((m) => m.id === id) || null;
    const writerId = () => routeMember || (isParent ? authRecord.member : null) || pickedMember;

    // ---- static frame -----------------------------------------------------------------------------------
    const top = el("div", "top");
    const back = el("a", "av");
    back.href = "#/";
    back.setAttribute("aria-label", "Zurück");
    const hello = el("div", "hello");
    const helloTitle = el("b", "", "Einkaufsliste");
    const helloSub = el("span", "", "Alle können etwas draufschreiben.");
    hello.append(helloTitle, helloSub);
    top.append(back, hello);

    const chips = el("div", "whochips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Wer schreibt?");
    const tabs = el("div", "ltabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Listen");

    const form = el("form", "qa");
    const input = el("input");
    input.type = "text";
    input.maxLength = 200; // the 80-character limit is checked after whitespace is collapsed
    input.autocomplete = "off";
    input.setAttribute("autocorrect", "on");
    input.setAttribute("aria-label", "Neuer Eintrag");
    const addBtn = el("button", "", "+");
    addBtn.type = "submit";
    addBtn.setAttribute("aria-label", "Hinzufügen");
    form.append(input, addBtn);
    const sugg = el("div", "sugg");
    sugg.setAttribute("aria-label", "Vorschläge");
    const hint = el("div", "hint");
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");

    const body = el("div", "body");
    const manageWrap = el("div", "manage-wrap");
    root.append(top, chips, tabs, form, sugg, hint, body, manageWrap);

    const say = (text, warn) => {
      hint.textContent = text || "";
      hint.classList.toggle("warn", !!warn);
    };

    // ---- rendering --------------------------------------------------------------------------------------
    function avatarOf(member) {
      const by = el("span", "by", member ? member.emoji : "");
      if (member) by.title = member.name;
      return by;
    }

    function itemRow(item) {
      const row = el("div", `sitem${item.bought ? " bought" : ""}${item._pending ? " pending" : ""}`);
      const cb = el("button", "cb");
      cb.type = "button";
      cb.innerHTML = CHECK; // constant markup, no user data
      cb.setAttribute(
        "aria-label",
        item.bought ? `${item.name} wieder auf die Liste` : `${item.name} gekauft`,
      );
      cb.setAttribute("aria-pressed", String(!!item.bought));
      cb.onclick = () => {
        const day = item.bought ? "" : ctx.clock.today();
        shop
          .setBought(data, item, day)
          .catch((err) => console.warn("shop: tick failed", { message: String(err) }));
      };
      const nm = el("div", "nm", item.name);
      const why = learning.reasonEl(document, item, ctx.clock.today());
      if (why) nm.append(why);
      // Put there from the meal plan (SPEC-0009): say which meal it is for.
      if (item.source_meal) nm.append(el("small", "why", `für ${item.source_meal}`));
      row.append(cb, nm, avatarOf(memberOf(item.by)));
      if (isParent && !item.bought) {
        const x = el("button", "x", "×");
        x.type = "button";
        x.setAttribute("aria-label", `${item.name} entfernen`);
        x.onclick = () => data.delete("shop_items", item.id);
        row.append(x);
      }
      return row;
    }

    function renderTabs() {
      tabs.textContent = "";
      for (const list of state.lists) {
        const b = el("button", "", shop.listLabel(list));
        b.type = "button";
        b.setAttribute("aria-pressed", String(list.id === currentList));
        const n = shop.openCount(state.items, list.id);
        b.append(el("small", "", n ? String(n) : ""));
        b.onclick = () => {
          currentList = list.id;
          say("");
          render();
          input.focus();
        };
        tabs.append(b);
      }
    }

    function renderChips() {
      chips.textContent = "";
      const needsPick = !routeMember && !isParent;
      chips.classList.toggle("hidden", !needsPick);
      if (!needsPick) return;
      for (const m of state.members) {
        const b = el("button", "", `${m.emoji} ${m.name}`);
        b.type = "button";
        b.setAttribute("aria-pressed", String(m.id === pickedMember));
        b.onclick = () => {
          pickedMember = m.id;
          say("");
          render();
        };
        chips.append(b);
      }
    }

    function renderHeader() {
      const me = memberOf(writerId());
      root.style.setProperty("--c", accent(me));
      back.textContent = me ? me.emoji : "🛒";
      helloSub.textContent = `${me ? `Hallo ${me.name}! ` : ""}Alle können etwas draufschreiben.`;
    }

    function renderBody() {
      body.textContent = "";
      const list = state.lists.find((l) => l.id === currentList);
      if (!list) {
        body.append(el("div", "note", "Noch keine Liste."));
        input.placeholder = "";
        return;
      }
      input.placeholder = `Was fehlt bei ${list.name}?`;
      const open = shop.openItems(state.items, list.id);
      const cart = shop.cartItems(state.items, list.id);
      body.append(el("div", "section", open.length ? `Noch zu kaufen (${open.length})` : "Alles da"));
      const openBox = el("div", "todos");
      if (open.length) for (const i of open) openBox.append(itemRow(i));
      else openBox.append(el("div", "note", "Nichts auf der Liste. 🎉"));
      body.append(openBox);
      if (cart.length) {
        body.append(el("div", "section", `Im Wagen (${cart.length})`));
        const cartBox = el("div", "todos");
        for (const i of cart) cartBox.append(itemRow(i));
        body.append(cartBox);
        if (isParent) {
          const wrap = el("div");
          wrap.style.marginTop = "10px";
          const done = el("button", "btn primary", "Einkauf fertig – Liste aufräumen");
          done.type = "button";
          done.style.background = "var(--c)";
          done.onclick = () => shop.finishShopping(data, state.items, list.id);
          wrap.append(done);
          body.append(wrap);
        } else {
          body.append(el("p", "muted", "Aufräumen („Einkauf fertig“) machen die Eltern."));
        }
      }
    }

    // ---- list management (parents) ---------------------------------------------------------------------
    let managing = false;
    function renderManage() {
      manageWrap.textContent = "";
      if (!isParent) return;
      const toggle = el("button", "link", managing ? "Listen schließen" : "Listen verwalten");
      toggle.type = "button";
      toggle.onclick = () => {
        managing = !managing;
        renderManage();
      };
      const learned = el("a", "link", "Gelernt anzeigen");
      learned.href = "#/gelernt";
      manageWrap.append(toggle, learned);
      if (!managing) return;
      const panel = el("section", "panel manage");
      panel.append(el("h3", "", "Listen"));
      for (const list of state.lists) {
        const row = el("div", "row");
        const emoji = el("input", "emoji");
        emoji.value = list.emoji;
        emoji.maxLength = 16;
        emoji.setAttribute("aria-label", "Emoji");
        const name = el("input", "name");
        name.value = list.name;
        name.maxLength = 40;
        name.setAttribute("aria-label", "Name der Liste");
        const save = () => {
          const n = name.value.trim();
          const e = emoji.value.trim();
          if (n && e && (n !== list.name || e !== list.emoji))
            data.update("lists", list.id, { emoji: e, name: n });
        };
        emoji.onchange = save;
        name.onchange = save;
        const del = el("button", "btn", "Löschen");
        del.type = "button";
        del.onclick = () => {
          const open = shop.openCount(state.items, list.id);
          const warn = `Liste „${list.name}“ löschen? Alle ${open ? open + " offenen " : ""}Einträge darauf werden gelöscht.`;
          if (!window.confirm(warn)) return;
          if (currentList === list.id) currentList = null;
          data.delete("lists", list.id);
        };
        row.append(emoji, name, del);
        panel.append(row);
      }
      const addRow = el("form", "row");
      const emoji = el("input", "emoji");
      emoji.placeholder = "🛍️";
      emoji.maxLength = 16;
      emoji.setAttribute("aria-label", "Emoji der neuen Liste");
      const name = el("input", "name");
      name.placeholder = "Neue Liste";
      name.maxLength = 40;
      name.setAttribute("aria-label", "Name der neuen Liste");
      const add = el("button", "btn primary", "Anlegen");
      add.type = "submit";
      addRow.append(emoji, name, add);
      addRow.onsubmit = async (ev) => {
        ev.preventDefault();
        const n = name.value.trim();
        if (!n) return;
        const created = await data.create("lists", { emoji: emoji.value.trim() || "🛍️", name: n });
        currentList = created.id;
        name.value = "";
        emoji.value = "";
        render();
      };
      panel.append(addRow);
      manageWrap.append(panel);
    }

    function render() {
      if (!state.lists.find((l) => l.id === currentList))
        currentList = state.lists[0] ? state.lists[0].id : null;
      renderHeader();
      renderChips();
      renderTabs();
      renderBody();
      renderSuggestions();
      refillOpenList();
    }

    // ---- suggestions and automatic refill (SPEC-0005) -------------------------------------------------------
    // Only parents can read the purchase history, so only they get suggestions; kids see the automatic items.
    function renderSuggestions() {
      const list = state.lists.find((l) => l.id === currentList);
      if (!isParent || !list) {
        sugg.textContent = "";
        return;
      }
      const taken = new Set(state.items.filter((i) => i.list === list.id).map((i) => shop.nameKey(i.name)));
      const entries = rhythm.learn(state.purchases.filter((p) => p.list === list.id));
      const autoRefill = state.settings[0] ? !!state.settings[0].auto_refill : true;
      const chipsList = learning.chipsFor({
        entries,
        typed: input.value,
        taken,
        today: ctx.clock.today(),
        autoRefill,
      });
      learning.renderChips(document, sugg, chipsList, (name) => add(name));
    }

    let refilled = null;
    function refillOpenList() {
      if (!currentList || refilled === currentList) return;
      refilled = currentList;
      // The server adds due items; they arrive through live sync like any other item.
      void learning.requestRefill({
        fetchImpl: ctx.fetch || (typeof fetch === "function" ? fetch : null),
        token: ctx.auth.token && ctx.auth.token(),
        listId: currentList,
      });
    }

    // ---- adding -----------------------------------------------------------------------------------------
    async function add(name) {
      if (!currentList) return;
      const result = await shop.addItem(data, state.items, {
        list: currentList,
        name,
        by: writerId(),
      });
      if (!result.ok) {
        say(MESSAGES[result.reason], true);
        if (result.reason === "duplicate") input.select();
        return;
      }
      say("");
      input.value = "";
      input.focus();
      renderSuggestions();
    }
    form.onsubmit = (ev) => {
      ev.preventDefault();
      return add(input.value);
    };
    input.addEventListener("input", () => {
      say("");
      renderSuggestions();
    });

    // ---- live data --------------------------------------------------------------------------------------
    const offs = [
      data.subscribe("lists", (rows) => {
        state.lists = rows;
        render();
        renderManage();
      }),
      data.subscribe("shop_items", (rows) => {
        state.items = rows;
        render();
      }),
      data.subscribe("members", (rows) => {
        state.members = rows;
        render();
      }),
    ];
    if (isParent) {
      offs.push(
        data.subscribe("purchases", (rows) => {
          state.purchases = rows || [];
          renderSuggestions();
        }),
        data.subscribe("settings", (rows) => {
          state.settings = rows || [];
          renderSuggestions();
        }),
      );
    }
    render();
    renderManage();
    return () => offs.forEach((off) => off());
  };
})();
