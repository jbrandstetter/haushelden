// Governing: SPEC-0001 REQ "First-Run Setup", REQ "Parent Authentication", REQ "Kid Access on Enrolled Devices"
//
// Route `#/wer`: "Wer bist du?". The screen itself lives in js/auth-ui.js (shared by the four account screens).

HH.screens.wer = function (view, ctx) {
  return HH.authui.wer(view, ctx);
};
