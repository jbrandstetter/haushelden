// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0002 REQ "Routine Items"
//
// Seed step for `routines`: the prototype's sample routines with generic, made-up hint texts. `kids` and
// `kids_alternating` are household-wide; the hobbies belong to one fake kid each.

const routines = [
  {
    emoji: "🎒",
    title: "Schultasche für morgen packen",
    hint: "Stundenplan checken!",
    kind: "chore",
    days: [0, 1, 2, 3, 6],
    who: "kids",
  },
  { emoji: "📝", title: "Hausaufgaben", hint: "", kind: "chore", days: [0, 1, 2, 3, 4], who: "kids" },
  {
    emoji: "🥪",
    title: "Brotdose in die Spülmaschine",
    hint: "",
    kind: "chore",
    days: [0, 1, 2, 3, 4],
    who: "kids",
  },
  {
    emoji: "🍽️",
    title: "Spülmaschine aus- & einräumen",
    hint: "",
    kind: "chore",
    days: [0, 1, 2, 3, 4, 5, 6],
    who: "kids_alternating",
  },
  {
    emoji: "⚽",
    title: "Fußballtraining",
    hint: "Sportsachen und Trinkflasche",
    time: "17:00",
    kind: "hobby",
    days: [1, 3],
    who: "member",
    member: "kind1",
  },
  {
    emoji: "🎹",
    title: "Klavierstunde",
    hint: "Noten einpacken",
    kind: "hobby",
    days: [1],
    who: "member",
    member: "kind2",
  },
  {
    emoji: "🐴",
    title: "Reiten",
    hint: "Helm und Stiefel",
    kind: "hobby",
    days: [3],
    who: "member",
    member: "kind2",
  },
];

/** Maps the fixtures to API records; `ids` is ctx.ids.members (fixture key -> record id). */
const records = (ids) =>
  routines.map(({ member, time, days, ...r }) => ({
    ...r,
    time: time || "",
    days: days.map(String),
    member: member ? ids[member] : "",
  }));

module.exports = { routines, records };
