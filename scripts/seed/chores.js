// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0010 REQ "Standard Chores",
// REQ "Starting a Cleaning Day", REQ "Ticking Off"
//
// Seed steps for the cleaning day: the standard chores (the app's starter set, Papa's list for the first parent, Mama's
// for the second) and a cleaning day on the coming Saturday built from them with the app's own `planDay`, with a few
// chores ticked off (kids' own, one of each parent's). The day is computed from the current date, so a fresh seed
// always shows an upcoming cleaning day. Titles come from the starter set; the people are the fake household.

const C = require("../../app/js/chores.js");

const DAY = 86400000;
const todayKey = (now = new Date()) => new Date(now).toISOString().slice(0, 10);

/** The Saturday on or after today (UTC; the seed is a development convenience). */
const saturday = (now = new Date()) => C.nextSaturday(todayKey(now));

const mapping = (ids) => ({ papa: ids.members.papa, mama: ids.members.mama });

const steps = [
  {
    collection: "chore_templates",
    key: "key",
    records: ({ ids }) => C.starterTemplates(mapping(ids)).map((t) => ({ ...t, key: String(t.sort) })),
    identify: (record) => String(record.sort),
  },
  {
    collection: "chores",
    key: "key",
    records: ({ ids }) => {
      const members = [
        { id: ids.members.kind1, role: "kid" },
        { id: ids.members.kind2, role: "kid" },
        { id: ids.members.papa, role: "parent" },
        { id: ids.members.mama, role: "parent" },
      ];
      const templates = C.starterTemplates(mapping(ids)).map((t) => ({
        ...t,
        id: ids.chore_templates[String(t.sort)],
      }));
      const day = saturday();
      const { creates } = C.planDay({ day, templates, chores: [], members });
      // Tick the first two chores of the first kid, the first of the second kid, and one of each parent.
      const doneOf = new Set();
      for (const who of [
        ids.members.kind1,
        ids.members.kind1,
        ids.members.kind2,
        ids.members.papa,
        ids.members.mama,
      ]) {
        const next = creates.find((c) => c.assignee === who && !doneOf.has(c));
        if (next) doneOf.add(next);
      }
      return creates.map((c) => ({
        ...c,
        key: `${c.sort}`,
        done: doneOf.has(c),
        done_by: doneOf.has(c) ? c.assignee : "",
      }));
    },
  },
];

module.exports = { steps, saturday, DAY };
