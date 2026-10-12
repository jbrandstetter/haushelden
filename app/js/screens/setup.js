// Governing: SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Kid Access on Enrolled Devices"
//
// Route `#/setup`: first-run setup. The screen itself lives in js/auth-ui.js (shared by the four account screens).

HH.screens.setup = function (view, ctx) {
  return HH.authui.setup(view, ctx);
};
