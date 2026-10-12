// Governing: SPEC-0005 REQ "Lists" (tab per list with open count), REQ "Adding Items" (avatar of who added it,
// duplicate message), REQ "Shopping Flow" (cart section, finish), REQ "Entry Points"
//
// Render tests for the shopping screen on a tiny fake DOM (no browser needed): the screen file is loaded the way
// the browser loads it (it registers itself on HH.screens) and driven through a fake data API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shop = require("../app/js/shop.js");
const rhythm = require("../app/js/rhythm.js");
const shopLearning = require("../app/js/shop-learning.js");

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.handlers = {};
    this.style = { setProperty() {} };
    this.className = "";
    this._text = "";
    this.value = "";
    this.classList = { toggle: () => {} };
  }
  append(...c) {
    this.children.push(...c);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  focus() {}
  select() {}
  set textContent(v) {
    this._text = v;
    if (v === "") this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set innerHTML(v) {
    this._text = "";
  }
  walk(fn) {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }
  all(pred) {
    const out = [];
    this.walk((e) => pred(e) && out.push(e));
    return out;
  }
  has(cls) {
    return this.className.split(" ").includes(cls);
  }
}

function load() {
  const HH = { shop, rhythm, shopLearning, screens: {} };
  const ctx = vm.createContext({
    HH,
    document: { createElement: (t) => new FakeEl(t) },
    window: { confirm: () => true },
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/screens/shopping.js"), "utf8"), ctx);
  return HH.screens.einkauf;
}

const members = [
  { id: "kid1", name: "Test-Kind-1", emoji: "⚽", colour: "peach" },
  { id: "mama", name: "Test-Mama", emoji: "👩", colour: "pink" },
];
const lists = [
  { id: "food", emoji: "🛒", name: "Lebensmittel" },
  { id: "dm", emoji: "🧴", name: "dm" },
];
const items = [
  { id: "1", list: "food", name: "Milch", by: "kid1", bought: "" },
  { id: "2", list: "food", name: "Brot", by: "mama", bought: "" },
  { id: "3", list: "food", name: "Eier", by: "mama", bought: "2026-10-12" },
  { id: "4", list: "dm", name: "Seife", by: "kid1", bought: "" },
];

function fakeData(initial) {
  const store = { lists, shop_items: initial, members };
  const calls = { create: [], update: [], delete: [] };
  const subs = {};
  return {
    calls,
    subscribe(c, cb) {
      subs[c] = cb;
      cb(store[c]);
      return () => {};
    },
    async create(c, d) {
      calls.create.push([c, d]);
      return { id: "new", ...d };
    },
    async update(c, id, d) {
      calls.update.push([c, id, d]);
    },
    async delete(c, id) {
      calls.delete.push([c, id]);
    },
  };
}

function open({ data = fakeData(items), collectionName = "parents", args = ["mama"] } = {}) {
  const view = new FakeEl("div");
  const cleanup = load()(view, {
    args,
    data,
    clock: { today: () => "2026-10-12" },
    auth: { record: () => ({ collectionName, member: "mama" }) },
  });
  return { view, data, cleanup };
}

test("scenario: default lists render as tabs with their number of open items", () => {
  const { view } = open();
  const tabs = view.all((e) => e.has("ltabs"))[0].children;
  assert.deepEqual(
    tabs.map((t) => t.textContent),
    ["🛒 Lebensmittel2", "🧴 dm1"],
  );
  assert.equal(tabs[0].attrs["aria-pressed"], "true");
});

test("open items show the avatar of the member who added them; the cart is its own section", () => {
  const { view } = open();
  const sections = view.all((e) => e.has("section")).map((e) => e.textContent);
  assert.deepEqual(sections, ["Noch zu kaufen (2)", "Im Wagen (1)"]);
  const rows = view.all((e) => e.has("sitem"));
  assert.equal(rows.length, 3);
  const row = (name) => rows.find((r) => r.all((e) => e.has("nm"))[0].textContent === name);
  assert.equal(row("Milch").all((e) => e.has("by"))[0].textContent, "⚽");
  assert.equal(row("Brot").all((e) => e.has("by"))[0].textContent, "👩");
  assert.ok(row("Eier").has("bought"));
  assert.ok(!row("Milch").has("bought"));
});

test("ticking sets the household day, un-ticking clears it", () => {
  const { view, data } = open();
  const rows = view.all((e) => e.has("sitem"));
  const click = (name) => {
    const r = rows.find((x) => x.all((e) => e.has("nm"))[0].textContent === name);
    r.all((e) => e.has("cb"))[0].onclick();
  };
  click("Milch");
  click("Eier");
  assert.deepEqual(data.calls.update, [
    ["shop_items", "1", { bought: "2026-10-12" }],
    ["shop_items", "3", { bought: "" }],
  ]);
});

test("scenario: 'Einkauf fertig' removes the ticked items of the current list only (parents)", async () => {
  const { view, data } = open();
  const finish = view.all((e) => e.tag === "button" && e.textContent.startsWith("Einkauf fertig"))[0];
  finish.onclick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(data.calls.delete, [["shop_items", "3"]]);
});

test("scenario: a device account can tick and add but sees no finish, remove or list management", () => {
  const { view } = open({ collectionName: "devices", args: ["kid1"] });
  const buttons = view.all((e) => e.tag === "button").map((b) => b.textContent);
  assert.ok(!buttons.some((t) => t.startsWith("Einkauf fertig")));
  assert.ok(!buttons.includes("×"));
  assert.ok(!buttons.includes("Listen verwalten"));
  assert.ok(view.all((e) => e.has("sitem"))[0].all((e) => e.has("cb")).length === 1);
});

test("scenario: from the daughter's board, an added item is attributed to her", async () => {
  const { view, data } = open({ collectionName: "devices", args: ["kid1"] });
  const input = view.all((e) => e.tag === "input")[0];
  input.value = "  Haargummis ";
  await view.all((e) => e.tag === "form")[0].onsubmit({ preventDefault() {} });
  assert.deepEqual(data.calls.create, [
    ["shop_items", { list: "food", name: "Haargummis", by: "kid1", auto: false, bought: "" }],
  ]);
});

test("scenario: 'milch' while 'Milch' is open shows a friendly message and creates nothing", async () => {
  const { view, data } = open();
  view.all((e) => e.tag === "input")[0].value = "milch";
  await view.all((e) => e.tag === "form")[0].onsubmit({ preventDefault() {} });
  assert.equal(data.calls.create.length, 0);
  assert.equal(view.all((e) => e.has("hint"))[0].textContent, "Das steht schon auf der Liste.");
});

// ---- purchase-history additions (SPEC-0005 REQ "Automatic Refill", "Suggestions While Typing") ---------------

function withHistory(data, { purchases = [], settings = [] } = {}) {
  const base = data.subscribe;
  data.subscribe = (c, cb) => {
    if (c === "purchases") return (cb(purchases), () => {});
    if (c === "settings") return (cb(settings), () => {});
    return base(c, cb);
  };
  return data;
}
const buys = (list, name, days) => days.map((day) => ({ list, key: name.toLowerCase(), name, day }));

test("scenario: Milk comes back - the automatic item on the list shows its reason", () => {
  const auto = {
    id: "9",
    list: "food",
    name: "Milch",
    auto: true,
    auto_rhythm: 5,
    auto_last: "2026-10-08",
    bought: "",
  };
  const { view } = open({ data: fakeData([auto]) });
  const nm = view.all((e) => e.has("nm"))[0];
  assert.equal(nm.textContent, "Milch✨ automatisch · etwa alle 5 Tage · zuletzt vor 4 Tagen");
});

test("a parent sees frequent items as suggestions on an empty field, but not those already on the list", () => {
  const purchases = [
    ...buys("food", "Kaffee", ["2026-09-01", "2026-09-08", "2026-09-15"]),
    ...buys("food", "Milch", ["2026-09-01", "2026-09-05"]), // Milch is open on the list
    ...buys("dm", "Seife", ["2026-09-01", "2026-09-05"]), // another list
  ];
  const { view } = open({ data: withHistory(fakeData(items), { purchases }) });
  const chips = view.all((e) => e.has("chip")).map((c) => c.textContent);
  assert.deepEqual(chips, ["Kaffee"]);
});

test("with automatic refill off a due item is offered as a marked suggestion", () => {
  const purchases = buys("food", "Shampoo", ["2026-08-01", "2026-09-01", "2026-10-01"]); // rhythm 31, due 2026-10-31
  const off = open({
    data: withHistory(fakeData(items), { purchases, settings: [{ id: "s", auto_refill: false }] }),
  });
  assert.deepEqual(
    off.view.all((e) => e.has("chip")).map((c) => c.textContent),
    ["Shampoo"],
  );
  const purchasesDue = buys("food", "Shampoo", ["2026-07-01", "2026-08-01", "2026-09-01"]); // rhythm 31, due 2026-10-01
  const due = open({
    data: withHistory(fakeData(items), {
      purchases: purchasesDue,
      settings: [{ id: "s", auto_refill: false }],
    }),
  });
  assert.deepEqual(
    due.view.all((e) => e.has("chip")).map((c) => c.textContent),
    ["⏰ Shampoo"],
  );
});

test("a device account gets no purchase history and therefore no suggestions", () => {
  const { view } = open({ collectionName: "devices", args: ["kid1"] });
  assert.equal(view.all((e) => e.has("chip")).length, 0);
});
