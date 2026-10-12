// Governing: SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Kid Access on Enrolled Devices"
//
// Route `#/einladung`: invite acceptance. The screen itself lives in js/auth-ui.js (shared by the four account screens).

HH.screens.einladung = function (view, ctx) {
  return HH.authui.einladung(view, ctx);
};
