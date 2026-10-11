// Governing: ADR-0001 (PocketBase realtime), SPEC-0001 REQ "Shared State and Live Sync"
//
// Minimal Server-Sent Events parser. PocketBase's realtime endpoint is an SSE stream; reading it with fetch
// (instead of EventSource) keeps one code path for the browser and the Node tests, and allows request headers.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.HH = root.HH || {}).sse = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Returns `{ push(chunk) -> events[] }`; an event is `{ event, data, id }`. */
  function createParser() {
    let buffer = "";
    let event = "message";
    let data = [];
    let id = "";

    function line(l, out) {
      if (l === "") {
        if (data.length) out.push({ event, data: data.join("\n"), id });
        event = "message";
        data = [];
        return;
      }
      if (l.startsWith(":")) return; // comment / keep-alive
      const i = l.indexOf(":");
      const field = i === -1 ? l : l.slice(0, i);
      let value = i === -1 ? "" : l.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }

    return {
      push(chunk) {
        buffer += chunk;
        const out = [];
        let m;
        while ((m = /\r\n|\n|\r/.exec(buffer))) {
          // A lone \r at the very end may be the first half of \r\n: wait for more input.
          if (m[0] === "\r" && m.index === buffer.length - 1) break;
          line(buffer.slice(0, m.index), out);
          buffer = buffer.slice(m.index + m[0].length);
        }
        return out;
      },
    };
  }

  return { createParser };
});
