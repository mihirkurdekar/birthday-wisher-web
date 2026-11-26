// Birthday state machine — moment-timezone based.
//
// State is computed SERVER-SIDE from BIRTH_DATE + TIME_ZONE so the browser
// can never see personal content outside the open window.
//
//   locked  — now < 00:00 (TIME_ZONE) the day BEFORE the birthday  → countdown only
//   open    — 00:00:00–23:59:59.999 of the birthday day (TIME_ZONE)    → greeting + cake
//   closed  — now > 23:59:59.999 of the birthday day                → "just for birthday" page
//
// OVERRIDE_NOW (epoch ms or ISO string) replaces Date.now() for local tests.
// Never set it in production — it is read from env here, so prod has no way
// to override time unless someone explicitly deploys the variable.

const moment = require("moment-timezone");

function nowMs() {
  const raw = process.env.OVERRIDE_NOW;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function parseBirthDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || "");
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// Public: returns { state, targetMs, birthYmd } for an optional epoch override.
function computeState(epochMs = nowMs(), opts = {}) {
  const timeZone = opts.timeZone || process.env.TIME_ZONE || "UTC";
  const birth = parseBirthDate(opts.birthDate || process.env.BIRTH_DATE || "");
  if (!birth) return { state: "locked", targetMs: null, birthYmd: null, error: "bad BIRTH_DATE" };

  // Midnight of the birthday day (start of birthday) in the configured timezone.
  const birthStart = moment.tz(
    `${birth.y}-${String(birth.m).padStart(2, "0")}-${String(birth.d).padStart(2, "0")}`,
    "YYYY-MM-DD",
    timeZone
  ).startOf("day");

  // Open window starts 1 minute BEFORE the birthday (23:59 of birthday-1),
  // not the whole day before — the surprise is a 1-minute heads-up then the
  // birthday itself through its end.
  const openStart = birthStart.clone().subtract(1, "minute");
  // End of birthday day: 23:59:59.999 (exclusive end is start of next day).
  const openEnd = birthStart.clone().endOf("day");

  const now = moment(epochMs);
  const nowVal = now.valueOf();
  const openStartVal = openStart.valueOf();
  const openEndVal = openEnd.valueOf();

  const birthYmd = `${birth.y}-${String(birth.m).padStart(2, "0")}-${String(birth.d).padStart(2, "0")}`;

  if (nowVal < openStartVal) {
    return { state: "locked", targetMs: openStartVal, birthYmd };
  }
  if (nowVal <= openEndVal) {
    return { state: "open", targetMs: openStartVal, birthYmd };
  }
  return { state: "closed", targetMs: openStartVal, birthYmd };
}

module.exports = { computeState, nowMs, parseBirthDate };