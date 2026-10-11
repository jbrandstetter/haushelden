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
  ];
  if (typeof module === "object" && module.exports) module.exports = { ROUTES };
  else (root.HH = root.HH || {}).ROUTES = ROUTES;
})(typeof self !== "undefined" ? self : this);
