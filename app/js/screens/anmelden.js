// Governing: SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Kid Access on Enrolled Devices"
//
// Route `#/anmelden`: parent sign-in. The screen itself lives in js/auth-ui.js (shared by the four account screens).

HH.screens.anmelden = function (view, ctx) {
  return HH.authui.anmelden(view, ctx);
};
