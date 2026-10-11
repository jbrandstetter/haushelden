// Governing: SPEC-0001 REQ "Prototype as UI Reference" (hash routing as in the prototype: `#/name/arg`),
// REQ "Installable Web App"
//
// Hash router. `parseHash` and `findRoute` are pure and unit-tested; `createRouter` wires them to the page.
// Screens are separate script files listed in routes.js and loaded on first visit (and pre-warmed into the
// service worker cache while online, so visited and listed screens also open offline).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).router = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** "#/kind/ab12" -> { name: "kind", args: ["ab12"] }; "" or "#/" -> { name: "", args: [] }. */
  function parseHash(hash) {
    const parts = String(hash || "")
      .replace(/^#\/?/, "")
      .split("/")
      .filter((p, i) => p !== "" || i > 0)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    if (parts.length === 1 && parts[0] === "") return { name: "", args: [] };
    return { name: parts[0] || "", args: parts.slice(1) };
  }

  /** routes: [[path, scriptUrl], ...] -> the matching entry as { path, script } or null. */
  function findRoute(routes, name) {
    const hit = routes.find((r) => r[0] === name);
    return hit ? { path: hit[0], script: hit[1] } : null;
  }

  /**
   * @param {{ routes: Array<[string, string]>, view: HTMLElement, screens: Record<string, Function>,
   *           context: () => object, loadScript?: (src: string) => Promise<void>, win?: Window }} options
   * A screen is `function (view, { args, ...context }) -> cleanup | void`, registered as
   * `HH.screens[path || "home"]` by its script.
   */
  function createRouter({ routes, view, screens, context, loadScript, win = window }) {
    const loaded = new Map();
    const load =
      loadScript ||
      ((src) => {
        if (!loaded.has(src)) {
          loaded.set(
            src,
            new Promise((resolve, reject) => {
              const el = win.document.createElement("script");
              el.src = src;
              el.onload = () => resolve();
              el.onerror = () => reject(new Error(`failed to load screen script ${src}`));
              win.document.head.appendChild(el);
            }),
          );
        }
        return loaded.get(src);
      });
    let cleanup = null;
    let token = 0;

    async function render() {
      const mine = ++token;
      if (cleanup) {
        try {
          cleanup();
        } catch (err) {
          console.warn("router: screen cleanup failed", { message: String(err) });
        }
        cleanup = null;
      }
      const { name, args } = parseHash(win.location.hash);
      const route = findRoute(routes, name);
      view.textContent = "";
      if (!route) return renderMessage(view, "Seite nicht gefunden", "Diese Seite gibt es nicht.");
      try {
        await load(route.script);
      } catch (err) {
        console.warn("router: screen unavailable", { route: route.path, message: String(err) });
        if (mine === token)
          renderMessage(view, "Nicht verfügbar", "Diese Seite lässt sich gerade nicht laden.");
        return;
      }
      if (mine !== token) return; // navigated away while the script loaded
      const screen = screens[route.path || "home"];
      if (typeof screen !== "function") {
        renderMessage(view, "Nicht verfügbar", "Diese Seite ist nicht eingerichtet.");
        return;
      }
      const result = screen(view, { args, ...context() });
      if (typeof result === "function") cleanup = result;
    }

    function renderMessage(el, title, text) {
      const doc = el.ownerDocument;
      const h = doc.createElement("h1");
      h.textContent = title;
      const p = doc.createElement("p");
      p.className = "muted";
      p.textContent = text;
      const a = doc.createElement("a");
      a.className = "link";
      a.href = "#/";
      a.textContent = "Zur Startseite";
      el.append(h, p, a);
    }

    return {
      start() {
        win.addEventListener("hashchange", render);
        return render();
      },
      render,
      /** Loads every listed screen script so the service worker caches it while online. */
      preload: () => Promise.allSettled(routes.map((r) => load(r[1]))),
    };
  }

  return { parseHash, findRoute, createRouter };
});
