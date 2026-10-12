// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0003 REQ "To-dos"
//
// Seed records for the `todos` collection: a few fake to-dos for one parent, the other parent and both,
// spread over the list groups (overdue, today, upcoming, someday, done today). Dates are relative to the
// household day the seed runs on, so the groups look right whenever the seed is run.

const dates = require("../../app/js/dates.js");

function todoRecords({ ids }, now = new Date(), tz = dates.DEFAULT_TZ) {
  const today = dates.householdDay(now, tz);
  const day = (offset) => dates.addDays(today, offset);
  const papa = ids.members.papa;
  const mama = ids.members.mama;
  const area = (key) => (ids.areas && ids.areas[key]) || "";
  return [
    { title: "Test-Aufgabe: Altglas wegbringen", who: papa, due: day(-2), area: area("haus"), done: "" },
    { title: "Test-Aufgabe: Geschenk besorgen", who: mama, due: day(0), area: "", done: "" },
    {
      title: "Test-Aufgabe: Elternabend eintragen",
      who: "parents",
      due: day(1),
      area: area("schule"),
      done: "",
    },
    { title: "Test-Aufgabe: Winterreifen-Termin", who: papa, due: day(9), area: area("auto"), done: "" },
    { title: "Test-Aufgabe: Keller aufräumen", who: "parents", due: "", area: "", done: "" },
    { title: "Test-Aufgabe: Paket abholen", who: mama, due: day(-1), area: "", done: today },
  ];
}

module.exports = { todoRecords };
