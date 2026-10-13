---
status: proposed
date: 2026-10-13
decision-makers: Johannes
extends: [ADR-0003]
governs: [SPEC-0001]
related: [ADR-0001]
---

# ADR-0005: Stateless Sessions, "Sign Out Everywhere", and Short Non-Refreshable PIN Sessions

## Context and Problem Statement

SPEC-0001 originally required that a signed-in session be "listed under that parent's active sessions" and individually
revocable, and that a parent PIN on a family device yields a short parent session. PocketBase issues stateless signed
tokens: the server keeps no list of sessions, and a token is valid until it expires or the account's signing key
changes. During implementation (issues #11 and #12) it became clear that the original requirement cannot be met with
PocketBase's built-in authentication. How should sessions be revoked, and how should the parent PIN session be limited?

## Decision Drivers

* Revoking a lost phone must work immediately (SPEC-0001 scenario "Revoking a lost phone")
* A kid must not be able to turn a 15-minute PIN session into a long-lived parent session
* Few moving parts: one maintainer, no custom session store to keep consistent (ADR-0001)
* Removing an enrolled device must cut it off at once (ADR-0003)

## Considered Options

* Keep PocketBase's stateless tokens; revoke by rotating the account's signing key ("sign out everywhere"); PIN
  sessions are marked non-refreshable and last 15 minutes
* Add a `sessions` collection (one record per login) checked on every request, giving a real session list and
  per-session revocation
* Cookie-based server sessions

## Decision Outcome

Chosen option: "Stateless tokens with sign-out-everywhere and non-refreshable PIN sessions", because it satisfies the
security goals (immediate revocation, bounded PIN sessions) with no custom session store, at the cost of dropping the
per-session list.

Details as built:
- `POST /api/hh/sessions/revoke` (parent only) rotates the signing key of the calling parent's account, which makes every
  token of that account invalid at once, including the current one. The UI offers it as "Überall abmelden".
- A revoked or deleted principal's token is treated by PocketBase as a guest: rule-protected collections answer with
  empty results (or 404) and not with 401. The app detects removal at launch and when returning to the foreground
  because the token refresh fails, and then shows the sign-in screen.
- `POST /api/hh/pin` verifies a parent's 6-digit PIN from an enrolled device and issues a parent token valid for
  15 minutes. That token carries `refreshable: false`, and a refresh hook rejects it, so PocketBase cannot swap it for a
  30-day token. A PIN session cannot enroll devices or set a PIN (setting a PIN needs the password again).
- PIN attempts, sign-in, setup, invite acceptance and PIN setting are limited to 5 failed attempts per 15 minutes (per
  account, or per client address for setup and invite).

### Consequences

* Good, because revoking a lost phone, removing a device and ending a PIN session all work without custom session storage
* Good, because a kid cannot extend a PIN session
* Bad, because there is no list of active sessions, and "sign out everywhere" also ends the session you are using;
  SPEC-0001's scenario was changed accordingly
* Bad, because a removed device is not answered with 401 on every request, only on its next token refresh; the empty
  results are safe but the UI relies on the launch and foreground checks to show the sign-in screen
* Neutral, because the failed-attempt counters live in the application store of the running server, so a restart clears
  them (this only ever loosens the limit for one window)

### Confirmation

Rules/route tests against a real PocketBase: revoking invalidates a held token; a PIN session cannot be refreshed; a
removed device receives empty results; the sixth failed PIN attempt in a window is refused.

## Pros and Cons of the Options

### Stateless tokens with sign-out-everywhere

* Good, because it needs only PocketBase's own mechanisms plus one hook route
* Good, because revocation is immediate and covers every token of the account
* Bad, because no per-session visibility or per-session revocation

### A `sessions` collection

* Good, because it gives the originally specified session list and per-session revocation
* Bad, because every request must be checked against it, which means either custom auth middleware or a hook on every
  collection rule, and a second place that must stay consistent with PocketBase's own tokens
* Bad, because it is a lot of machinery for four users

### Cookie-based sessions

* Good, because server-side expiry is easy
* Bad, because it replaces PocketBase's auth model and adds CSRF handling (SPEC-0001 relies on header tokens instead)

## Architecture Diagram

```mermaid
sequenceDiagram
  actor Kid
  actor Parent
  participant Pad as Family iPad (PWA)
  participant PB as PocketBase
  Kid->>Pad: taps a parent profile
  Pad->>Parent: asks for the 6-digit PIN
  Parent->>Pad: PIN
  Pad->>PB: POST /api/hh/pin (device token, member, PIN)
  PB->>PB: verify salted PIN hash, rate limit 5 per 15 min
  PB-->>Pad: parent token, 15 min, refreshable=false
  Note over Pad,PB: token refresh is rejected by a hook; a PIN session cannot enroll devices or set a PIN
  Pad->>Pad: after 15 min: back to the device's own session, "Wer bist du?"
  Parent->>PB: POST /api/hh/sessions/revoke (own phone)
  PB->>PB: rotate the account's signing key
  PB-->>Parent: every token of that account is now a guest
```

## More Information

Supersedes the "listed under active sessions" wording of SPEC-0001 REQ "Parent Authentication". See also ADR-0003
(device accounts) and SPEC-0001 Security Requirements for the rate limits.
