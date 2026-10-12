// Test double for the few DOM calls the screens use (createElement, append, prepend, remove, replaceWith,
// querySelector[All] for `.class` and `[attr]`, events, textContent). Enough to render a screen in Node and click
// through it; it is not a browser.

function createFakeDocument() {
  const byId = new Map();
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parent = null;
      this.attrs = {};
      this.dataset = {};
      this.listeners = {};
      this.className = "";
      this.own = "";
    }
    get id() {
      return this.attrs.id || "";
    }
    set id(v) {
      this.attrs.id = v;
      byId.set(v, this);
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
    append(...nodes) {
      for (const n of nodes) this.adopt(n, this.children.length);
    }
    prepend(...nodes) {
      nodes.forEach((n, i) => this.adopt(n, i));
    }
    adopt(n, at) {
      if (typeof n === "string") {
        const t = new Node("#text");
        t.own = n;
        n = t;
      }
      if (n.parent) n.remove();
      n.parent = this;
      this.children.splice(at, 0, n);
    }
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
    replaceWith(n) {
      const p = this.parent;
      const i = p.children.indexOf(this);
      this.remove();
      p.adopt(n, i);
    }
    get firstChild() {
      return this.children[0] || null;
    }
    get lastChild() {
      return this.children[this.children.length - 1] || null;
    }
    get textContent() {
      return this.own + this.children.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this.children.forEach((c) => (c.parent = null));
      this.children = [];
      this.own = String(v);
    }
    matches(sel) {
      if (sel.startsWith(".")) return this.className.split(/\s+/).includes(sel.slice(1));
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (attr) {
        const key = attr[1].startsWith("data-")
          ? attr[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())
          : null;
        const value = key ? this.dataset[key] : this.attrs[attr[1]];
        return value !== undefined && (attr[2] === undefined || value === attr[2]);
      }
      return this.tagName.toLowerCase() === sel;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.matches(sel)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    /** Fires listeners and resolves when async handlers are done. */
    async dispatch(type) {
      const ev = { type, target: this, preventDefault() {} };
      await Promise.all((this.listeners[type] || []).map((fn) => fn(ev)));
    }
    click() {
      return this.dispatch("click");
    }
  }
  const head = new Node("head");
  return {
    createElement: (tag) => new Node(tag),
    getElementById: (id) => byId.get(id) || null,
    head,
  };
}

module.exports = { createFakeDocument };
