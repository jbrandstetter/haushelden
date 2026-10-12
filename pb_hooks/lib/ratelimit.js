// Governing: SPEC-0001 Security Requirements "Rate Limiting" (5 failed attempts per account, or per client
// address for setup and invite, per 15 minutes, then rejected until the window passes)
//
// Failed-attempt counter kept in PocketBase's application store ($app.store()) (shared by all hook handlers). A restart
// clears it, which only ever loosens the limit for one window. `now` is injectable for tests under Node.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function load(store, key, now) {
  let list = [];
  try {
    list = JSON.parse(store.get(key) || "[]");
  } catch {
    list = [];
  }
  return list.filter((t) => now - t < WINDOW_MS);
}

function createLimiter(store, clock = () => Date.now()) {
  const k = (scope, id) => `hh.rl.${scope}.${id}`;
  return {
    /** True while the key has used up its failed attempts in the current window. */
    blocked(scope, id) {
      return load(store, k(scope, id), clock()).length >= MAX_FAILURES;
    },
    /** Records one failed attempt. */
    fail(scope, id) {
      const now = clock();
      const list = load(store, k(scope, id), now);
      list.push(now);
      store.set(k(scope, id), JSON.stringify(list));
    },
    /** Forgets the failures of a key (after a successful attempt). */
    clear(scope, id) {
      store.set(k(scope, id), "[]");
    },
  };
}

module.exports = { createLimiter, WINDOW_MS, MAX_FAILURES };
