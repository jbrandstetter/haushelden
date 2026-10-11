# Haushelden

Prototype of the kids' side of a family planner: each child sees today's tasks as big tiles to tick off,
and a mascot cheers them on (occasionally out loud, in German), with a celebration when everything is done.

Try it: https://jbrandstetter.github.io/haushelden/ or open `index.html` locally (add `?tag=2` to preview the day after tomorrow).

- Per-kid tiles for today, progress ring, "tomorrow" hint for hobbies, week strip and streak
- Tasks per kid, for both, or alternating day by day; weekdays per task
- Grown-ups: own to-do lists (today / upcoming / someday, for me / partner / both), areas of responsibility
  with a main contact, kids' progress at a glance, and a family month calendar (dated to-dos, hobbies, routines)
- Shared shopping lists (Lebensmittel, dm, add more) that everyone can add to; learns how often each item is bought
  and puts due items back on by itself (✨), with typing suggestions from past purchases
- Settings: today's progress, task editor, names/avatars/colours, mascot choice
- Prototype only: data stays on the device. The real version would sit on a small server (PocketBase on pve1)
  so all devices share it, and the mascot's lines would be written nightly by Hermes and approved by a parent.

## v1 development

The production version (PocketBase backend, `app/` PWA) is built next to the prototype, which stays at the repository
root and keeps being served by GitHub Pages. Specs and decisions are in `docs/`; deployment values never live here
(ADR-0004), only the configuration keys in `.env.example`.

| Path | Purpose |
|------|---------|
| `app/` | v1 PWA, served by PocketBase |
| `pb_migrations/` | schema as PocketBase migrations |
| `pb_hooks/` | server-side hooks and custom routes (`lib/config.js` is the configuration loader) |
| `scripts/` | start, seed and PocketBase download scripts |

The PWA shell in `app/` (no build step): `js/data.js` is the only data API for features (`list/get/subscribe/create/update/delete`,
realtime plus IndexedDB mirror plus offline outbox); each feature story adds one line to `js/routes.js`. Household days are
`YYYY-MM-DD` strings in `HH_TZ` (`js/dates.js`).

Run it locally (Node 22 or newer, macOS arm64/amd64 or Linux amd64, no homelab access needed):

```sh
cp .env.example .env
npm start        # downloads the pinned PocketBase (HH_PB_VERSION, checksum verified), then serves app/ on 127.0.0.1:8090
npm run seed     # in a second terminal: fills the fake household (Test-Papa, Test-Mama, Test-Kind-1, Test-Kind-2)
```

The admin UI is at `/_/`; `npm start` creates a fake local superuser from `HH_DEV_ADMIN_EMAIL` and
`HH_DEV_ADMIN_PASSWORD` in `.env`. The seed script only creates what exists: for each collection it checks the local
PocketBase and skips collections that no later story has added yet. Each story that adds a collection also adds
its seed mapping in `scripts/seed/steps.js` (fake data in `scripts/seed/fixtures.js`), so the seeded household
grows with v1. The seed now creates the fake household: four members, two parent accounts, one enrolled device and the settings
record (passwords from `HH_DEV_PARENT_PASSWORD` / `HH_DEV_DEVICE_SECRET`, local only); running it twice changes nothing.

With `HH_MODE=production`, startup stops with `missing configuration: <KEY>` when a required key is missing
(`HH_PUBLIC_URL`, `HH_BACKUP_TARGET`, `HH_PB_VERSION`, and `HH_SETUP_TOKEN` on a fresh install). Checks:
`npm test`, `npm run lint`, `npm run format:check`; `npm run test:rules` runs the access-rule and seed tests against a
throwaway PocketBase (needs `npm run pb:download` once).
