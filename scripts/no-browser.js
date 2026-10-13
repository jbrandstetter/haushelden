// Governing: SPEC-0007 REQ "Local Development" (a throwaway PocketBase must never touch the developer's desktop)
//
// PocketBase opens its "create the first admin" page in the default browser whenever it starts on a data directory
// that has no superuser yet. Every throwaway server (tests, smoke test) therefore runs with this PATH in front: no-op
// `open` / `xdg-open` (and friends) that only record what they were asked to open, so no browser tab can appear.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LAUNCHERS = [
  "open",
  "xdg-open",
  "x-www-browser",
  "sensible-browser",
  "wslview",
  "gnome-open",
  "kde-open",
];
let cached = null;

/** Creates (once per process) the stub directory and returns { dir, log, env } where env is { PATH, HH_NO_BROWSER_LOG }. */
function noBrowser() {
  if (cached) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-no-browser-"));
  const log = path.join(dir, "launch-requests.log");
  for (const name of LAUNCHERS) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/bin/sh\necho "$@" >> "${HH_NO_BROWSER_LOG:-/dev/null}"\nexit 0\n', {
      mode: 0o755,
    });
  }
  cached = {
    dir,
    log,
    env: { PATH: `${dir}${path.delimiter}${process.env.PATH || ""}`, HH_NO_BROWSER_LOG: log },
  };
  return cached;
}

module.exports = { noBrowser, LAUNCHERS };
