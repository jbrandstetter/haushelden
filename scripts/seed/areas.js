// Governing: SPEC-0007 REQ "Local Development", ADR-0004 (fake data only), SPEC-0003 REQ "Areas of Responsibility"
//
// The seven starter areas come from the `areas` migration itself, so there is nothing to create here. This step
// only maps the existing areas back to short keys, so the to-do seed can put its fake to-dos into areas.

const KEYS = {
  "Haus & Garten": "haus",
  Auto: "auto",
  "Finanzen & Versicherungen": "finanzen",
  "Schule & Kinder": "schule",
  "Gesundheit & Ärzte": "gesundheit",
  "Hobbys & Fahrdienste": "hobbys",
  "Technik & Smart Home": "technik",
};

module.exports = { KEYS, identify: (record) => KEYS[record.name] };
