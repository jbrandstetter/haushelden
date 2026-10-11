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
