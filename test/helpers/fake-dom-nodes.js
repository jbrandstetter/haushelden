// Test helper: a tiny DOM (elements, fragments, text nodes, attributes, events, simple selectors) that is just
// enough to render the screens' `buildView` functions and click through them without a browser.
// Selectors: `.class`, `[attr]`, `[attr="value"]`, `tag`, optionally combined without spaces (`button[data-due="x"]`).

class Node {
  constructor() {
    this.children = [];
    this.parent = null;
  }
}
class Text extends Node {
  constructor(text) {
    super();
    this.text = text;
  }
  get textContent() {
    return this.text;
  }
}
class Element extends Node {
  constructor(tag) {
    super();
    this.tag = tag;
    this.attrs = {};
    this.listeners = {};
    this.value = "";
  }
  get className() {
    return this.attrs.class || "";
  }
  set className(v) {
    this.attrs.class = v;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  append(...nodes) {
    for (const n of nodes) {
      const list = n instanceof Fragment ? n.children.splice(0) : [n];
      for (const c of list) {
        c.parent = this;
        this.children.push(c);
      }
    }
  }
  insertBefore(node, ref) {
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at === -1) return this.append(node);
    node.parent = this;
    this.children.splice(at, 0, node);
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.children = [];
    if (v !== "") this.append(new Text(String(v)));
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, extra = {}) {
    const event = { type, preventDefault() {}, target: this, ...extra };
    for (const fn of this.listeners[type] || []) fn(event);
  }
  click() {
    this.dispatch("click");
  }
  matches(selector) {
    const parts = selector.match(/^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i);
    if (!parts) throw new Error(`unsupported selector ${selector}`);
    if (parts[1] && parts[1] !== this.tag) return false;
    for (const m of parts[2].matchAll(/\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (m[1] && !this.className.split(/\s+/).includes(m[1])) return false;
      if (m[2]) {
        const v = this.getAttribute(m[2]);
        if (v === null || (m[3] !== undefined && v !== m[3])) return false;
      }
    }
    return true;
  }
  /** Descendants matching a selector; spaces mean "descendant of" (`.todos .tt`). */
  querySelectorAll(selector) {
    const steps = selector.trim().split(/\s+/);
    const all = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c instanceof Element) {
          all.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    const matchesChain = (el, i) => {
      if (!el.matches(steps[i])) return false;
      if (i === 0) return true;
      for (let p = el.parent; p && p !== this.parent; p = p.parent) {
        if (p instanceof Element && matchesChain(p, i - 1)) return true;
      }
      return false;
    };
    return all.filter((el) => matchesChain(el, steps.length - 1));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}
class Fragment extends Element {
  constructor() {
    super("#fragment");
  }
}

function createDocument() {
  return {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Fragment(),
    createTextNode: (text) => new Text(text),
  };
}

module.exports = { createDocument };
