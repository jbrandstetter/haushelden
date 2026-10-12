// Governing: SPEC-0001 REQ "Prototype as UI Reference" (hash routes `#/name/arg`)
//
// The route list. Each feature story adds exactly ONE line to ROUTES (merge conflicts here are resolved by
// keeping every line):
//
//     ["kind", "js/screens/kind.js"],
//
// `path` is the first segment after `#/` (an empty path is the start page). `script` is the screen's file under
// app/; it registers its render function as `HH.screens[path || "home"] = function (view, ctx) { ... }`, see
// js/screens/home.js. ctx has `args` (the remaining segments), `data` (the data API), `clock` (household day)
// and `auth`. The service worker caches screen files after the first online visit (the router pre-warms them).

(function (root) {
  "use strict";
  const ROUTES = [
    ["", "js/screens/home.js"], // start page: household day and live member list (shell and sync check)
    ["routinen", "js/screens/routinen.js"],
    ["maskottchen", "js/screens/maskottchen.js"],
    ["eltern", "js/screens/eltern.js"], // parents' to-dos, list mode (SPEC-0003)
    ["setup", "js/screens/setup.js"], // first-run setup (#11)
    ["anmelden", "js/screens/anmelden.js"], // parent sign-in (#11)
    ["einladung", "js/screens/einladung.js"], // invite acceptance (#11)
    ["wer", "js/screens/wer.js"], // "Wer bist du?" (#11)
  ];
  if (typeof module === "object" && module.exports) module.exports = { ROUTES };
  else (root.HH = root.HH || {}).ROUTES = ROUTES;
})(typeof self !== "undefined" ? self : this);
