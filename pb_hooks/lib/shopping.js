// Governing: SPEC-0005 REQ "Adding Items" (case- and whitespace-insensitive names), REQ "Shopping Flow",
// SPEC-0001 REQ "Household Day and Time Zone"
//
// Helpers for pb_hooks/shopping.pb.js. Pure functions (normalisation, day arithmetic) plus the few database
// operations on `purchases`; they take the app (or transaction app) as an argument so the hook can run them inside
// the transaction of the write that triggered them. The pure part is unit-tested (test/shop-hooks.test.js).

/* global $os, Record, ValidationError, BadRequestError */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
// How far from the server's household day a tick may be dated: offline ticks are replayed days later and keep
// their original day; a future day is never valid (one day of slack for clock skew).
const MAX_PAST_DAYS = 14;
const MAX_FUTURE_DAYS = 1;

/** Display form: trimmed, inner whitespace collapsed to single spaces. */
function normalizeName(name) {
  return String(name == null ? "" : name)
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity of a name within a list: the display form in lower case. */
const nameKey = (name) => normalizeName(name).toLowerCase();

function dayNumber(key) {
  const m = DAY_RE.exec(key);
  if (!m) return NaN;
  const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
  return new Date(n * DAY_MS).toISOString().slice(0, 10) === key ? n : NaN;
}

/** null when `day` is an acceptable tick day relative to `today`, else a short reason. */
function checkTickDay(day, today) {
  const n = dayNumber(day);
  const t = dayNumber(today);
  if (Number.isNaN(n)) return "Ungültiges Datum.";
  if (n > t + MAX_FUTURE_DAYS) return "Das Datum liegt in der Zukunft.";
  if (n < t - MAX_PAST_DAYS) return "Das Datum liegt zu weit zurück.";
  return null;
}

/**
 * The household day on the server. PocketBase's JS runtime has no Intl, so the zone is applied by `date` with
 * TZ set (no shell involved; the zone name is validated by the settings field pattern). Falls back to the UTC
 * day, which the tick-day tolerance above absorbs.
 */
function householdDay(app, now) {
  let tz = "";
  try {
    const settings = app.findAllRecords("settings");
    if (settings.length > 0) tz = settings[0].getString("tz");
  } catch {
    // no settings yet
  }
  if (!tz) tz = $os.getenv("HH_TZ") || "Europe/Berlin";
  if (/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) {
    try {
      const cmd = $os.cmd("date", "+%F");
      cmd.env = ["TZ=" + tz, "PATH=/usr/bin:/bin"];
      const out = String(toString(cmd.output())).trim();
      if (DAY_RE.test(out)) return out;
    } catch {
      // fall through to UTC
    }
  }
  return (now || new Date()).toISOString().slice(0, 10);
}

function findPurchase(app, list, key, day) {
  try {
    return app.findFirstRecordByFilter("purchases", "list = {:list} && key = {:key} && day = {:day}", {
      list,
      key,
      day,
    });
  } catch {
    return null;
  }
}

/** Records the purchase of a bought item for its day, once (idempotent). */
function ensurePurchase(app, item) {
  const list = item.getString("list");
  const key = nameKey(item.getString("name"));
  const day = item.getString("bought");
  if (findPurchase(app, list, key, day)) return;
  const purchase = new Record(app.findCollectionByNameOrId("purchases"));
  purchase.set("list", list);
  purchase.set("name", item.getString("name"));
  purchase.set("key", key);
  purchase.set("day", day);
  purchase.set("item", item.id);
  app.save(purchase);
}

/** Removes the purchase of an un-ticked item, unless another bought item of that name keeps it alive. */
function removePurchase(app, item, day) {
  const list = item.getString("list");
  const key = nameKey(item.getString("name"));
  const purchase = findPurchase(app, list, key, day);
  if (!purchase) return;
  const others = app.findRecordsByFilter(
    "shop_items",
    "list = {:list} && key = {:key} && bought = {:day} && id != {:id}",
    "",
    1,
    0,
    { list, key, day, id: item.id },
  );
  if (others.length === 0) app.delete(purchase);
}

/** The open item with the same name on the same list, or null. `exceptId` skips the item being saved. */
function findOpenDuplicate(app, list, key, exceptId) {
  try {
    const hit = app.findFirstRecordByFilter("shop_items", "list = {:list} && key = {:key} && bought = ''", {
      list,
      key,
    });
    return hit.id === exceptId ? null : hit;
  } catch {
    return null;
  }
}

const DUPLICATE = "Das steht schon auf der Liste.";

/** A 400 whose body names the offending field, so clients can show a friendly message. */
function invalid(field, code, message) {
  const fields = {};
  fields[field] = new ValidationError(code, message);
  return new BadRequestError(message, fields);
}

module.exports = {
  DUPLICATE,
  invalid,
  normalizeName,
  nameKey,
  dayNumber,
  checkTickDay,
  householdDay,
  ensurePurchase,
  removePurchase,
  findOpenDuplicate,
  MAX_PAST_DAYS,
  MAX_FUTURE_DAYS,
};
